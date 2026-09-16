package com.tutelage.crm.counsellor.data.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import com.tutelage.crm.counsellor.BuildConfig
import com.tutelage.crm.counsellor.calls.CallLogBackfiller
import com.tutelage.crm.counsellor.calls.CallReconcileLock
import com.tutelage.crm.counsellor.calls.CallRecordingFinder
import com.tutelage.crm.counsellor.di.RecordingUploadClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import timber.log.Timber
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CallRepository @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val dao: CallDao,
    private val api: CallApi,
    /** Same interface, long-timeout client — recordings only. */
    @RecordingUploadClient private val uploadApi: CallApi,
    private val backfiller: CallLogBackfiller,
    private val reconcileLock: CallReconcileLock,
) {
    fun observeByLead(leadId: Long): Flow<List<CallEntity>> = dao.observeByLeadId(leadId)

    suspend fun savePending(call: CallEntity) = dao.upsert(call)

    /**
     * The stored row for one call. Used by the auto-dialer to read the real
     * outcome (status + duration) that PhoneStateReceiver writes from the system
     * CallLog once the call ends — the only trustworthy answer to "did they
     * actually pick up", since Android never tells an app that directly.
     */
    suspend fun byDeviceCallId(deviceCallId: String): CallEntity? = dao.byDeviceCallId(deviceCallId)

    suspend fun finalize(deviceCallId: String, status: String, startedAt: Long, endedAt: Long, durationSec: Int) =
        dao.finalize(deviceCallId, status, startedAt, endedAt, durationSec)

    /**
     * Serializes the whole read-ship-stamp cycle below.
     *
     * The one-shot and periodic CallSyncWorkers use different unique-work names,
     * so WorkManager can run them at the same time, and forceSeedToday() calls in
     * from the UI as well. Two overlapping passes both read the same `unsynced()`
     * rows and POST them, so the server took a duplicate push of every pending
     * call — and the markSyncedIfUnchanged snapshot guard, which exists to catch
     * a row changing mid-flight, would fire spuriously on the loser and leave
     * clean rows dirty for the next pass.
     */
    private val syncMutex = Mutex()

    /**
     * Send all unsynced rows to backend. Returns the number of rows persisted server-side.
     * Failures bubble up so WorkManager can retry.
     */
    suspend fun syncPending(): Int = syncMutex.withLock { syncPendingLocked() }

    private suspend fun syncPendingLocked(): Int {
        // Ship calls from a rolling 48h window (matches reconcile()'s cutoff).
        // Using start-of-today used to permanently strand any row that failed to
        // sync before midnight (device offline overnight, repeated retry
        // failures) — once the clock rolled past midnight it was never picked up
        // again. A rolling window keeps recent-but-stuck calls eligible while
        // still keeping genuinely old history local.
        val cutoff = System.currentTimeMillis() - 48 * 3600 * 1000L
        val pending = dao.unsynced().filter { it.startedAt >= cutoff }
        if (pending.isEmpty()) return 0
        val items = pending.map { c ->
            CallSyncItemDto(
                deviceCallId = c.deviceCallId,
                leadId = c.leadId,
                phoneNumber = c.phoneNumber,
                direction = c.direction,
                status = c.status,
                startedAt = ISO.format(Instant.ofEpochMilli(c.startedAt)),
                endedAt = c.endedAt?.let { ISO.format(Instant.ofEpochMilli(it)) },
                durationSec = c.durationSec,
                triggerCallId = c.triggerCallId,
                notes = c.notes,
                simSlot = c.simSlot,
                simCarrier = c.simCarrier,
                simNumber = c.simNumber,
                source = c.source ?: when {
                    c.campaignContactId != null -> "AUTO_DIALER"
                    c.triggerCallId != null -> "CRM_WEB"
                    c.direction == "INCOMING" -> "INCOMING"
                    else -> "SYSTEM_DIALER"
                },
                campaignContactId = c.campaignContactId,
                recordingPlayedId = c.recordingPlayedId,
            )
        }
        val resp = api.sync(CallSyncRequest(items))
        val now = System.currentTimeMillis()
        // Snapshot of what we actually shipped, so a row that changed while the
        // request was in flight isn't marked clean. PhoneStateReceiver /
        // reconcile can call finalize() on any of these mid-sync (correcting a
        // RINGING row to ANSWERED with a real duration); that write re-dirties
        // the row, and stamping syncedAt unconditionally used to bury the
        // correction — the server kept the stale status forever.
        val shipped = pending.associateBy { it.deviceCallId }
        for (r in resp.results) {
            val snap = shipped[r.deviceCallId]
            val marked = if (snap == null) 0 else dao.markSyncedIfUnchanged(
                deviceCallId = r.deviceCallId,
                serverId = r.id,
                syncedAt = now,
                status = snap.status,
                startedAt = snap.startedAt,
                durationSec = snap.durationSec,
            )
            if (marked == 0) {
                // Row moved under us: keep the server id (the uploader needs it
                // and it never changes) but leave it dirty for the next pass.
                dao.setServerId(r.deviceCallId, r.id)
                Timber.d("Call %s changed mid-sync — left pending for the next push", r.deviceCallId)
            }
        }
        return resp.synced
    }

    /**
     * Force-seed today's call log into the local DB and immediately ship the
     * result to the backend. This is the "manual fix" the counsellor invokes
     * when they notice a call missing from the app's history — typically when
     * battery optimisation killed the receiver before it could capture.
     *
     * @return [ForceSeedResult] with counts (inserted/recordings/scanned/synced)
     */
    suspend fun forceSeedToday(): ForceSeedResult = withContext(Dispatchers.IO) {
        val (inserted, recordings, scanned) = backfiller.forceSeedToday(appContext)
        // Also run the stale-RINGING + missing-recording reconciler so anything
        // that was half-captured gets cleaned up in the same pass.
        runCatching { reconcile() }.onFailure {
            Timber.w(it, "forceSeedToday: reconcile failed (continuing)")
        }
        val synced = runCatching { syncPending() }.getOrElse {
            Timber.w(it, "forceSeedToday: syncPending failed; uploads will retry later")
            0
        }
        ForceSeedResult(
            scanned = scanned,
            inserted = inserted,
            recordingsAttached = recordings,
            synced = synced,
        )
    }

    /**
     * Best-effort reconcile: close out stale RINGING rows (PhoneStateReceiver
     * never got the IDLE broadcast — usually the process was killed mid-call)
     * and attach missing recordings to already-finalized calls (the OEM dialer
     * sometimes flushes the recording file *after* our receiver's window has
     * closed). Both paths flip syncedAt to null on change so the NEXT push of
     * `syncPending()` ships the corrected state. Safe to call repeatedly —
     * each step is a no-op when nothing needs fixing.
     */
    suspend fun reconcile() = withContext(Dispatchers.IO) {
        val cutoff = System.currentTimeMillis() - 48 * 3600 * 1000L
        // 1) Stale RINGING — older than 2 minutes is a strong signal the call
        //    has actually ended; PhoneStateReceiver just missed the IDLE. Held
        //    under reconcileLock so this can't race PhoneStateReceiver's own
        //    finalize/insert for the same row — see CallReconcileLock.
        val staleCutoff = System.currentTimeMillis() - 2 * 60_000L
        reconcileLock.mutex.withLock {
            val stale = dao.staleRinging(staleCutoff)
            if (stale.isNotEmpty() && hasCallLogPermission()) {
                for (row in stale) {
                    runCatching { finalizeFromCallLog(row) }
                        .onFailure { Timber.w(it, "reconcile: finalizeFromCallLog failed for %s", row.deviceCallId) }
                }
            }
        }
        // 2) Missing recordings — re-scan the OEM dialer's folders. Today only,
        //    since older recordings would already have been picked up or the
        //    OEM's call-recording window expired.
        val needsRec = dao.syncedWithoutRecording(cutoff)
        for (row in needsRec) {
            val ended = row.endedAt ?: (row.startedAt + row.durationSec * 1000L)
            val rec = runCatching {
                CallRecordingFinder.find(appContext, row.phoneNumber, row.startedAt, ended, fastMode = true)
            }.getOrNull()
            if (rec != null) {
                dao.setRecording(row.deviceCallId, rec)
                Timber.d("reconcile: attached late recording %s to %s", rec, row.deviceCallId)
            }
        }
    }

    private fun hasCallLogPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED

    private suspend fun finalizeFromCallLog(row: CallEntity) {
        val tail = row.phoneNumber.replace(Regex("\\D"), "").takeLast(10)
        if (tail.isEmpty()) return
        // Look ±10 minutes around startedAt — outgoing calls can sit ringing for
        // a while before the OS commits the row.
        val from = row.startedAt - 60_000L
        val to = row.startedAt + 10 * 60_000L
        val cursor = appContext.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
            "${CallLog.Calls.DATE} BETWEEN ? AND ?",
            arrayOf(from.toString(), to.toString()),
            "${CallLog.Calls.DATE} ASC",
        ) ?: return
        cursor.use { c ->
            val nIx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val tIx = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dIx = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durIx = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            while (c.moveToNext()) {
                val n = c.getString(nIx) ?: continue
                if (n.replace(Regex("\\D"), "").takeLast(10) != tail) continue
                val type = c.getInt(tIx)
                val dateMs = c.getLong(dIx)
                val durationSec = c.getLong(durIx).toInt()
                val status = when (type) {
                    CallLog.Calls.OUTGOING_TYPE -> if (durationSec > 0) "ANSWERED" else "NO_ANSWER"
                    CallLog.Calls.INCOMING_TYPE -> "ANSWERED"
                    CallLog.Calls.MISSED_TYPE -> "MISSED"
                    CallLog.Calls.REJECTED_TYPE,
                    CallLog.Calls.BLOCKED_TYPE -> "REJECTED"
                    else -> if (durationSec > 0) "ANSWERED" else "FAILED"
                }
                val endedAt = dateMs + durationSec * 1000L
                dao.finalize(row.deviceCallId, status, dateMs, endedAt, durationSec)
                Timber.d(
                    "reconcile: closed stale RINGING %s → %s/%ds",
                    row.deviceCallId, status, durationSec,
                )
                return
            }
        }
    }

    /**
     * Upload all finalised local recordings whose calls have a serverId. Returns count uploaded.
     * Caller (Worker) should retry on throw.
     */
    /**
     * Give recordings parked by a server-side rejection one more chance, once
     * per app version.
     *
     * The backend used to 409 every recording whose call row a stale re-sync had
     * relabelled NO_ANSWER — real audio from real answered calls, rejected six
     * times each and then parked forever. Clearing the counter after an upgrade
     * lets the fixed server accept them on the next pass. Version-keyed so it
     * runs once and does not become a loop that retries genuinely bad files on
     * every worker tick.
     */
    private suspend fun reviveStuckRecordingsOncePerVersion() {
        val prefs = appContext.getSharedPreferences(RECOVERY_PREFS, Context.MODE_PRIVATE)
        val current = BuildConfig.VERSION_CODE
        if (prefs.getInt(KEY_REVIVED_FOR_VERSION, -1) == current) return
        val revived = runCatching { dao.reviveStuckUploads() }.getOrDefault(0)
        prefs.edit().putInt(KEY_REVIVED_FOR_VERSION, current).apply()
        if (revived > 0) Timber.i("Revived %d stuck recording upload(s) after upgrade", revived)
    }

    suspend fun uploadPendingRecordings(): Int {
        reviveStuckRecordingsOncePerVersion()
        val pending = dao.pendingUploads()
        if (pending.isEmpty()) return 0
        var uploaded = 0
        for (c in pending) {
            val path = c.recordingPath ?: continue
            val serverId = c.serverId ?: continue
            val file = File(path)
            if (!file.exists() || file.length() == 0L) {
                Timber.w("Recording file missing for %s — clearing path", c.deviceCallId)
                dao.markRecordingUploaded(c.deviceCallId, System.currentTimeMillis())
                continue
            }
            // A file too big to finish inside a background upload window would
            // just burn retries and hold up everything queued behind it. Park it
            // at the give-up ceiling and say so, rather than looping forever.
            if (file.length() > MAX_RECORDING_BYTES) {
                Timber.w(
                    "Recording for %s is %d bytes (limit %d) — skipping upload",
                    c.deviceCallId, file.length(), MAX_RECORDING_BYTES,
                )
                dao.setUploadAttempts(c.deviceCallId, MAX_UPLOAD_ATTEMPTS)
                continue
            }
            // Isolate each upload: one poison file (server 4xx, oversized, corrupt)
            // must not abort the whole batch and starve every later recording. A
            // failed file stays pending (not marked uploaded) and the periodic
            // worker retries it on a later pass.
            val ok = runCatching {
                val media = "audio/mp4".toMediaTypeOrNull()
                val part = MultipartBody.Part.createFormData(
                    "recording", file.name, file.asRequestBody(media)
                )
                uploadApi.uploadRecording(serverId, part)
            }.onFailure {
                Timber.w(it, "Recording upload failed for %s — will retry later", c.deviceCallId)
            }.isSuccess
            if (!ok) {
                // Bounded retries. Without a counter a file the server keeps
                // rejecting sat at the head of the queue on every pass forever.
                dao.bumpUploadAttempts(c.deviceCallId)
                continue
            }
            dao.markRecordingUploaded(c.deviceCallId, System.currentTimeMillis())
            // Only delete files we created ourselves (legacy MediaRecorder path
            // under filesDir/recordings/). NEVER touch the OEM dialer's recording
            // file on shared storage — that belongs to the user.
            if (!CallRecordingFinder.isExternalRecording(appContext, path)) {
                runCatching { file.delete() }
            }
            uploaded++
        }
        return uploaded
    }

    /** What [forceSeedToday] actually did, surfaced to the UI as a toast. */
    data class ForceSeedResult(
        val scanned: Int,
        val inserted: Int,
        val recordingsAttached: Int,
        val synced: Int,
    )

    companion object {
        /**
         * Thread-safe by construction, unlike the SimpleDateFormat this replaces.
         *
         * `syncPending()` formats every row's timestamps through this, and it has
         * three independent entrants: CallSyncWorker's one-shot ("call-sync") and
         * periodic ("call-sync-periodic") passes are SEPARATE unique-work names,
         * so WorkManager will happily run them concurrently, and the manual Sync
         * tap (CallsViewModel → forceSeedToday) is a third. SimpleDateFormat
         * keeps mutable state in a shared Calendar, so concurrent format() calls
         * either interleave into a garbage timestamp — silently posting wrong
         * call times to the CRM — or throw out of the worker. DateTimeFormatter
         * is immutable and safe to share.
         */
        private val ISO: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                .withZone(ZoneOffset.UTC)
        private const val RECOVERY_PREFS = "recording_recovery"
        private const val KEY_REVIVED_FOR_VERSION = "revived_for_version"
    }
}
