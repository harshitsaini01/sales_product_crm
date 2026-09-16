package com.tutelage.crm.counsellor.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber
import java.io.File
import javax.inject.Inject

/**
 * Catches DOWNLOAD_COMPLETE for our APK download and triggers the system installer.
 *
 * Not exported (see the manifest): DownloadManager targets the completion
 * broadcast at the package that enqueued the download, so we still receive it,
 * while a local app can no longer replay a crafted EXTRA_DOWNLOAD_ID at our
 * installer. `verifyAndInstall` then checks that the id is one we enqueued,
 * that the file lives in our own external-files dir, and that its SHA-256
 * matches what the server advertised — in that order — before anything is
 * handed to the package installer.
 */
@AndroidEntryPoint
class ApkInstallReceiver : BroadcastReceiver() {

    @Inject lateinit var updater: AppUpdater

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        if (id == -1L) return

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor: Cursor = dm.query(DownloadManager.Query().setFilterById(id)) ?: return
        cursor.use { c ->
            if (!c.moveToFirst()) return
            val statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
            if (statusIdx < 0 || uriIdx < 0) return
            val status = c.getInt(statusIdx)
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                // Must reach the updater, not just the log: the mandatory-update
                // gate keys its (disabled) button off `downloading`, so a silent
                // return here left the counsellor on a permanent spinner.
                updater.onDownloadFailed(id, status)
                return
            }
            val localUri = c.getString(uriIdx) ?: return
            val file = File(Uri.parse(localUri).path ?: return)
            if (!file.exists()) {
                Timber.w("APK download succeeded but file missing: %s", file.absolutePath)
                updater.onDownloadFailed(id, status)
                return
            }
            updater.verifyAndInstall(id, file)
        }
    }
}
