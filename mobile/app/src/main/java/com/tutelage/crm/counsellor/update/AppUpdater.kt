package com.tutelage.crm.counsellor.update

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.core.content.FileProvider
import com.tutelage.crm.counsellor.BuildConfig
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.release.AppReleaseApi
import com.tutelage.crm.counsellor.data.release.AppReleaseDto
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

data class UpdateAvailable(val release: AppReleaseDto, val isMandatory: Boolean)

@Singleton
class AppUpdater @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: AppReleaseApi,
    private val tokenStore: TokenStore,
) {
    private val _state = MutableStateFlow<UpdateAvailable?>(null)
    val state: StateFlow<UpdateAvailable?> = _state.asStateFlow()

    // Surfaces a one-line failure reason when installApk() can't launch the
    // system installer (e.g. "install unknown apps" not permitted for this
    // app, or no installer present) — installApk() runs from a background
    // BroadcastReceiver too, so it can't show UI directly.
    private val _installError = MutableStateFlow<String?>(null)
    val installError: StateFlow<String?> = _installError.asStateFlow()
    fun clearInstallError() { _installError.value = null }

    /**
     * Whether a download is in flight, owned here rather than per-ViewModel.
     *
     * MandatoryUpdateViewModel used to keep its own copy: it set the flag on tap
     * and NOTHING ever cleared it, because startDownload() only enqueues with
     * DownloadManager and returns. On the mandatory gate — non-dismissible, back
     * swallowed, button disabled while "downloading" — a failed download left the
     * counsellor with a dead spinner and no way out but force-stopping the app.
     * The flag now belongs to the singleton that actually knows the download's
     * fate, and every terminal outcome clears it.
     */
    private val _downloading = MutableStateFlow(false)
    val downloading: StateFlow<Boolean> = _downloading.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var watchJob: Job? = null

    // Expected SHA-256 per in-flight download id. Disk-backed so it survives a
    // process death between download completion and the install broadcast.
    private val pendingPrefs = context.getSharedPreferences("app_update", Context.MODE_PRIVATE)

    private val downloadManager: DownloadManager
        get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    /**
     * Throws on network failure — callers decide how to surface that (silent
     * background checks swallow it via runCatching; the manual "Check for
     * updates" button distinguishes "failed" from "you're up to date").
     */
    suspend fun checkForUpdate() {
        // A process death mid-download would otherwise leave the persisted id
        // with nobody watching it, and the gate stuck on its next composition.
        reattachPendingWatcher()
        val latest = api.latest()
        if (latest != null && latest.versionCode > BuildConfig.VERSION_CODE) {
            _state.value = UpdateAvailable(latest, latest.isMandatory)
            Timber.i("Update available: %s (current %d)", latest.versionName, BuildConfig.VERSION_CODE)
        } else {
            _state.value = null
        }
    }

    fun dismiss() { _state.value = null }

    /**
     * Triggers DownloadManager to fetch the APK and (when complete) opens the system installer.
     * The receiver in the manifest watches DownloadManager.ACTION_DOWNLOAD_COMPLETE.
     */
    fun startDownload(release: AppReleaseDto) {
        val url = "${BuildConfig.API_BASE_URL.trimEnd('/')}/api/app-releases/${release.id}/download"
        val token = tokenStore.token

        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("Tutelage Counsellor ${release.versionName}")
            .setDescription("Downloading update")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "tutelage-${release.versionName}.apk")
            .setMimeType("application/vnd.android.package-archive")
        if (!token.isNullOrBlank()) req.addRequestHeader("Authorization", "Bearer $token")

        val id = try {
            downloadManager.enqueue(req)
        } catch (t: Throwable) {
            // Most often the Download Manager being disabled by the user or an
            // OEM. Surface it — the caller's only other signal is a spinner.
            Timber.e(t, "Couldn't enqueue update download")
            _installError.value =
                "Couldn't start the download. Make sure the system \"Downloads\" app is enabled, then try again."
            _downloading.value = false
            return
        }
        // Remember the expected hash so ApkInstallReceiver can verify the bytes
        // before handing them to the system installer, and the id itself so a
        // process restart can pick the watch back up.
        pendingPrefs.edit()
            .putString("sha_$id", release.sha256)
            .putLong(KEY_PENDING_ID, id)
            .apply()
        _downloading.value = true
        watch(id)
        Timber.d("Update download started, dmId=%d", id)
    }

    /**
     * Poll DownloadManager until this download reaches a terminal state.
     *
     * DownloadManager only broadcasts ACTION_DOWNLOAD_COMPLETE, and only on
     * success in practice — a failure (no network, 401, server 404, full disk)
     * can leave the row sitting at STATUS_FAILED with nothing telling us. Polling
     * is what makes "the download died" observable at all, and the ceiling makes
     * a genuinely stalled transfer terminate instead of pinning the gate forever.
     */
    private fun watch(id: Long) {
        watchJob?.cancel()
        watchJob = scope.launch {
            val deadline = System.currentTimeMillis() + WATCH_CEILING_MS
            while (isActive && System.currentTimeMillis() < deadline) {
                when (val status = queryStatus(id)) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        // ApkInstallReceiver normally takes it from here (verify,
                        // then install) and clears the flag once it has a verdict.
                        // Don't *depend* on that broadcast though — if it is
                        // dropped, the gate would sit on a spinner with the bytes
                        // already on disk. Give it a grace window, then release.
                        awaitInstallVerdict(id)
                        return@launch
                    }
                    DownloadManager.STATUS_FAILED -> {
                        failDownload(id, "Download failed (${reasonLabel(queryReason(id))}). Please try again.")
                        return@launch
                    }
                    // Row gone: cancelled from the notification shade, or cleared.
                    null -> {
                        failDownload(id, "The download was cancelled. Tap Update now to retry.")
                        return@launch
                    }
                    // PENDING / RUNNING / PAUSED — keep waiting.
                    else -> Timber.v("Update download %d status=%d", id, status)
                }
                delay(POLL_INTERVAL_MS)
            }
            if (isActive) {
                runCatching { downloadManager.remove(id) }
                failDownload(id, "The download timed out. Check your connection and try again.")
            }
        }
    }

    /**
     * Wait out ApkInstallReceiver's verdict on a completed download, then make
     * sure the flag comes down either way.
     */
    private suspend fun awaitInstallVerdict(id: Long) {
        val deadline = System.currentTimeMillis() + INSTALL_VERDICT_GRACE_MS
        while (System.currentTimeMillis() < deadline) {
            if (!_downloading.value) return // receiver already resolved it
            delay(POLL_INTERVAL_MS)
        }
        Timber.w("No install verdict for download %d — releasing the update gate", id)
        _installError.value =
            "The update downloaded but the installer didn't open. Tap the download notification, " +
            "or try Update now again."
        clearPending(id)
    }

    /** Re-attach after a process restart, so a stranded id can still resolve. */
    private fun reattachPendingWatcher() {
        if (watchJob?.isActive == true) return
        val id = pendingPrefs.getLong(KEY_PENDING_ID, -1L)
        if (id <= 0L) return
        when (queryStatus(id)) {
            DownloadManager.STATUS_RUNNING,
            DownloadManager.STATUS_PENDING,
            DownloadManager.STATUS_PAUSED -> {
                _downloading.value = true
                watch(id)
            }
            // Bytes are already down. Release the gate, but keep `sha_<id>` so a
            // DOWNLOAD_COMPLETE broadcast still in flight can verify and install
            // — wiping it would refuse the install AND waste a 27 MB re-download.
            DownloadManager.STATUS_SUCCESSFUL -> _downloading.value = false
            // Failed, or the row is gone — nothing left to wait for.
            else -> clearPending(id)
        }
    }

    private fun queryStatus(id: Long): Int? = runCatching {
        downloadManager.query(DownloadManager.Query().setFilterById(id))?.use { c ->
            if (!c.moveToFirst()) return@use null
            val ix = c.getColumnIndex(DownloadManager.COLUMN_STATUS)
            if (ix < 0) null else c.getInt(ix)
        }
    }.getOrNull()

    private fun queryReason(id: Long): Int = runCatching {
        downloadManager.query(DownloadManager.Query().setFilterById(id))?.use { c ->
            if (!c.moveToFirst()) return@use 0
            val ix = c.getColumnIndex(DownloadManager.COLUMN_REASON)
            if (ix < 0) 0 else c.getInt(ix)
        } ?: 0
    }.getOrDefault(0)

    private fun reasonLabel(reason: Int): String = when (reason) {
        DownloadManager.ERROR_INSUFFICIENT_SPACE -> "not enough storage"
        DownloadManager.ERROR_DEVICE_NOT_FOUND -> "storage unavailable"
        DownloadManager.ERROR_CANNOT_RESUME -> "connection lost and could not resume"
        DownloadManager.ERROR_HTTP_DATA_ERROR -> "connection interrupted"
        DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "server redirect loop"
        DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "unexpected server response"
        // DownloadManager puts the raw HTTP status in COLUMN_REASON when it
        // doesn't have a dedicated constant for it — 401 here means the token
        // didn't survive to the download endpoint.
        in 400..599 -> "server returned $reason"
        else -> "error $reason"
    }

    /** Called by ApkInstallReceiver when DownloadManager reports a non-success. */
    fun onDownloadFailed(id: Long, status: Int) {
        failDownload(id, "Download failed (status $status). Please try again.")
    }

    private fun failDownload(id: Long, message: String) {
        Timber.w("Update download %d failed: %s", id, message)
        _installError.value = message
        clearPending(id)
    }

    private fun clearPending(id: Long) {
        _downloading.value = false
        pendingPrefs.edit().remove("sha_$id").remove(KEY_PENDING_ID).apply()
    }

    /**
     * Verify the freshly-downloaded APK against the SHA-256 the server advertised
     * for this release, then install it. A mismatch (corrupted download, or a
     * CDN/MITM swap) deletes the file and aborts — the unverified APK is never
     * handed to the installer.
     *
     * NOTE for full hardening: serve the release metadata + APK over HTTPS so the
     * expected hash itself can't be tampered with, and replace the debug signing
     * key with a real release key so Android's same-signer update check adds a
     * second, independent gate.
     */
    fun verifyAndInstall(downloadId: Long, file: File) {
        val expected = pendingPrefs.getString("sha_$downloadId", null)
        // Every exit below is terminal for this download, so the gate's spinner
        // must come down on all of them. These used to be Timber-only — which,
        // with no tree planted, meant a silent dead end.
        watchJob?.cancel()
        clearPending(downloadId)
        if (expected.isNullOrBlank()) {
            // Doubles as the download-id ownership check: only ids WE enqueued
            // have a stored hash, so a replayed or guessed EXTRA_DOWNLOAD_ID
            // stops here instead of reaching the system installer.
            Timber.e("No expected SHA-256 for download %d — refusing to install unverified APK", downloadId)
            return
        }
        // The file must be the one we asked DownloadManager to write, inside our
        // own external-files dir. Anything else is not ours to install.
        if (!isOurDownload(file)) {
            Timber.e("Refusing to install %s — outside our download directory", file.absolutePath)
            _installError.value = "The downloaded file wasn't where we expected it. Please try again."
            return
        }
        val actual = runCatching { sha256Of(file) }.getOrNull()
        if (actual == null || !actual.equals(expected, ignoreCase = true)) {
            Timber.e("APK SHA-256 mismatch (expected %s, got %s) — deleting, NOT installing", expected, actual)
            runCatching { file.delete() }
            _installError.value =
                "The update failed its integrity check and was not installed. Please try again, " +
                "and tell your admin if it keeps happening."
            return
        }
        Timber.i("APK SHA-256 verified for download %d — launching installer", downloadId)
        installApk(file)
    }

    /**
     * True when [file] really sits under this app's own
     * `Android/data/<pkg>/files/Download` directory. Canonical paths, so a
     * `..` traversal in a crafted local URI can't point us at someone else's
     * APK. Deliberately does NOT delete a file that fails this check — it isn't
     * ours to remove.
     */
    private fun isOurDownload(file: File): Boolean = runCatching {
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.canonicalPath ?: return false
        val path = file.canonicalPath
        path.startsWith(dir + File.separator) && path.endsWith(".apk")
    }.getOrDefault(false)

    private fun sha256Of(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { ins ->
            val buf = ByteArray(8192)
            while (true) {
                val read = ins.read(buf)
                if (read < 0) break
                md.update(buf, 0, read)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Fires the system installer for a finished APK file (called by ApkInstallReceiver).
     */
    fun installApk(file: File) {
        try {
            val authority = "${context.packageName}.fileprovider"
            val uri: Uri = FileProvider.getUriForFile(context, authority, file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            // No installer available, or "Install unknown apps" isn't granted for
            // this app on this OEM/Android version — surface it instead of crashing.
            Timber.e(e, "Couldn't launch installer for %s", file.absolutePath)
            _installError.value =
                "Couldn't open the installer. Please allow \"Install unknown apps\" for this app in Settings, then tap the download notification again."
        }
    }

    private companion object {
        const val KEY_PENDING_ID = "pending_download_id"
        const val POLL_INTERVAL_MS = 2_000L

        /**
         * Hard ceiling on a single download. The backend streams the ~27 MB APK
         * with no Accept-Ranges, so a dropped connection restarts from zero —
         * without a ceiling a repeatedly-stalling transfer would hold the
         * mandatory gate open indefinitely.
         */
        const val WATCH_CEILING_MS = 15 * 60_000L

        /** How long to wait for ApkInstallReceiver after DownloadManager reports success. */
        const val INSTALL_VERDICT_GRACE_MS = 60_000L
    }
}
