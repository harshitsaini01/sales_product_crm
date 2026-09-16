package com.tutelage.crm.counsellor.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.calls.CallDao
import com.tutelage.crm.counsellor.data.calls.CallEntity
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pulls rows from the OS CallLog that we haven't seen yet (e.g. incoming calls that
 * happened while the app was killed) and inserts them into Room as un-synced. The
 * CallSyncWorker then ships them to the server on its next pass.
 *
 * Idempotency: each CallLog row gets a stable deviceCallId of `clog_<userId>_<callLogId>`
 * (userId is baked in because CallLog._ID is only unique per-device, not globally — see
 * schema.prisma's MobileCall.deviceCallId comment). We also skip rows that match an
 * existing local row by phone-tail within a ±5s window so PhoneStateReceiver-created
 * rows aren't duplicated, finalizing an open (unfinalized) match in place instead.
 */
@Singleton
class CallLogBackfiller @Inject constructor(
    private val callDao: CallDao,
    private val tokenStore: TokenStore,
    private val reconcileLock: CallReconcileLock,
) {
    // Holds reconcileLock.mutex for the whole scan so PhoneStateReceiver's
    // concurrent check-then-insert for a just-ended call can't race this one —
    // see CallReconcileLock.
    suspend fun backfill(context: Context): Int = reconcileLock.mutex.withLock { backfillLocked(context) }

    private suspend fun backfillLocked(context: Context): Int {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Timber.d("READ_CALL_LOG not granted; skipping backfill")
            return 0
        }

        // Always scan all of today's CallLog rows — using maxStartedAt as the
        // floor used to drop calls. Concretely: if the first capture today was at
        // 9am (e.g. app was killed before that), maxStartedAt=9am and any row
        // with DATE before 9am could never get backfilled. The byDeviceCallId
        // check below is an O(1) lookup so scanning the full day is cheap.
        val since = startOfTodayMs()

        val resolver = context.contentResolver
        val cols = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_ID,
        )
        val cursor = resolver.query(
            CallLog.Calls.CONTENT_URI,
            cols,
            "${CallLog.Calls.DATE} >= ?",
            arrayOf(since.toString()),
            "${CallLog.Calls.DATE} ASC",
        ) ?: return 0

        var inserted = 0
        cursor.use { c ->
            val numIdx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val typeIdx = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateIdx = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durIdx = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val accIdx = c.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_ID)

            while (c.moveToNext()) {
                val number = c.getString(numIdx)?.takeIf { it.isNotBlank() } ?: continue
                val type = c.getInt(typeIdx)
                val dateMs = c.getLong(dateIdx)
                val durationSec = c.getLong(durIdx).toInt()
                val phoneAccountId = c.getString(accIdx)
                // CallLog._ID is NOT stable: Android recycles it when the user
                // clears their call log, so a new physical call can inherit the
                // same _ID as an unrelated older call. The server used to update
                // that stale row (mutating started_at/status/dur) while leaving
                // the old row's recording_path intact — surfacing as "NO_ANSWER
                // rows showing playback of some other call's audio." Cleanup on
                // 2026-07-23 nulled 402 such rows.
                // Content-based id: the tuple (user, startedAt-ms, duration, phone-tail)
                // uniquely identifies the physical call and cannot be recycled.
                val tailForId = number.replace(NON_DIGIT, "").takeLast(10)
                val deviceCallId = "clog_${tokenStore.userId}_${dateMs}_${durationSec}_$tailForId"

                if (callDao.byDeviceCallId(deviceCallId) != null) continue

                val direction = when (type) {
                    CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                    CallLog.Calls.INCOMING_TYPE,
                    CallLog.Calls.MISSED_TYPE,
                    CallLog.Calls.REJECTED_TYPE,
                    CallLog.Calls.BLOCKED_TYPE -> "INCOMING"
                    else -> "INCOMING"
                }

                val status = when (type) {
                    CallLog.Calls.OUTGOING_TYPE -> if (durationSec > 0) "ANSWERED" else "NO_ANSWER"
                    CallLog.Calls.INCOMING_TYPE -> "ANSWERED"
                    CallLog.Calls.MISSED_TYPE -> "MISSED"
                    CallLog.Calls.REJECTED_TYPE,
                    CallLog.Calls.BLOCKED_TYPE -> "REJECTED"
                    else -> if (durationSec > 0) "ANSWERED" else "FAILED"
                }
                val endedAt = dateMs + durationSec * 1000L

                // Skip if PhoneStateReceiver / LeadDetailViewModel already logged the
                // same call under a different deviceCallId (live capture). Require
                // direction match so an outgoing→incoming-reject pair within 60s is
                // not collapsed into a single row. We also check duration to ensure
                // a failed app dial (duration 0) doesn't deduplicate against a
                // successful immediate redial (duration > 0).
                val tail = number.replace(NON_DIGIT, "").takeLast(10)
                val nearby = callDao.findInRange(dateMs - DEDUP_WINDOW_MS, dateMs + DEDUP_WINDOW_MS)
                val sameCall = nearby.filter { existing ->
                    existing.direction == direction &&
                        existing.phoneNumber.replace(NON_DIGIT, "").takeLast(10) == tail
                }
                // An open/unfinalized live-capture row (still RINGING or duration=0
                // with no endedAt — PhoneStateReceiver hasn't seen IDLE yet) is the
                // SAME call as this now-finalized CallLog row, even though their
                // durations don't match yet. Finalize it in place instead of
                // treating the mismatch as "distinct" and inserting a duplicate —
                // that duplicate-insert is what caused a second row (and orphaned
                // 0-duration entries) for calls seen this way.
                val openMatch = sameCall.firstOrNull { it.endedAt == null }
                if (openMatch != null) {
                    callDao.finalize(openMatch.deviceCallId, status, dateMs, endedAt, durationSec)
                    continue
                }
                val collision = sameCall.any { existing ->
                    // If durations differ significantly (e.g. one connected, one didn't), they are distinct
                    existing.durationSec == durationSec || (existing.durationSec == 0 && durationSec == 0)
                }
                if (collision) continue
                val sim = SimLookup.resolve(context, phoneAccountId)

                callDao.upsert(
                    CallEntity(
                        deviceCallId = deviceCallId,
                        leadId = null,
                        phoneNumber = number,
                        direction = direction,
                        status = status,
                        startedAt = dateMs,
                        endedAt = endedAt,
                        durationSec = durationSec,
                        simSlot = sim.slot,
                        simCarrier = sim.carrier,
                        simNumber = sim.number,
                        source = if (direction == "OUTGOING") "SYSTEM_DIALER" else "INCOMING",
                    )
                )
                inserted++
            }
        }
        if (inserted > 0) {
            Timber.d("CallLogBackfiller inserted %d row(s) since %d", inserted, since)
        }
        return inserted
    }

    /**
     * Force-seed today's call log. Unlike [backfill], this:
     *   1. Re-reads every today's row from the OS CallLog (does not skip on the
     *      ±5s dedup — instead trusts the deterministic deviceCallId to dedup).
     *   2. For rows that already exist in Room, attaches a recording if one is
     *      now available on disk and the row doesn't have one yet.
     *   3. For rows missing entirely, inserts them.
     *
     * Use this when the counsellor reports "a few calls didn't sync". After it
     * runs, the caller should kick CallSyncWorker so the new/updated rows ship
     * to the backend.
     *
     * @return Triple(inserted, recordingsAttached, scanned)
     */
    suspend fun forceSeedToday(context: Context): Triple<Int, Int, Int> =
        reconcileLock.mutex.withLock { forceSeedTodayLocked(context) }

    private suspend fun forceSeedTodayLocked(context: Context): Triple<Int, Int, Int> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Timber.d("READ_CALL_LOG not granted; force-seed skipped")
            return Triple(0, 0, 0)
        }

        val since = startOfTodayMs()
        val resolver = context.contentResolver
        val cols = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_ID,
        )
        val cursor = resolver.query(
            CallLog.Calls.CONTENT_URI,
            cols,
            "${CallLog.Calls.DATE} >= ?",
            arrayOf(since.toString()),
            "${CallLog.Calls.DATE} ASC",
        ) ?: return Triple(0, 0, 0)

        var inserted = 0
        var recordingsAttached = 0
        var scanned = 0
        cursor.use { c ->
            val numIdx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val typeIdx = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateIdx = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durIdx = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val accIdx = c.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_ID)
            while (c.moveToNext()) {
                scanned++
                val number = c.getString(numIdx)?.takeIf { it.isNotBlank() } ?: continue
                val type = c.getInt(typeIdx)
                val dateMs = c.getLong(dateIdx)
                val durationSec = c.getLong(durIdx).toInt()
                val phoneAccountId = c.getString(accIdx)

                val direction = when (type) {
                    CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                    CallLog.Calls.INCOMING_TYPE,
                    CallLog.Calls.MISSED_TYPE,
                    CallLog.Calls.REJECTED_TYPE,
                    CallLog.Calls.BLOCKED_TYPE -> "INCOMING"
                    else -> "INCOMING"
                }
                val status = when (type) {
                    CallLog.Calls.OUTGOING_TYPE -> if (durationSec > 0) "ANSWERED" else "NO_ANSWER"
                    CallLog.Calls.INCOMING_TYPE -> "ANSWERED"
                    CallLog.Calls.MISSED_TYPE -> "MISSED"
                    CallLog.Calls.REJECTED_TYPE,
                    CallLog.Calls.BLOCKED_TYPE -> "REJECTED"
                    else -> if (durationSec > 0) "ANSWERED" else "FAILED"
                }
                val endedAt = dateMs + durationSec * 1000L
                val tail = number.replace(NON_DIGIT, "").takeLast(10)

                // Find an existing row that represents this same physical call.
                // Match by direction + tail + same dateMs (±5s) — that's the
                // strongest signal of "same logical call".
                val nearby = callDao.findInRange(dateMs - 5_000L, dateMs + 5_000L)
                val existing = nearby.firstOrNull {
                    it.direction == direction &&
                        it.phoneNumber.replace(NON_DIGIT, "").takeLast(10) == tail
                }

                if (existing != null) {
                    // Row exists. If it's missing a recording for an answered
                    // call, try to attach one now (OEM may have flushed the file
                    // after the live capture window closed).
                    if (existing.recordingPath == null && durationSec > 0 &&
                        (status == "ANSWERED" || existing.status == "ANSWERED")
                    ) {
                        val rec = runCatching {
                            com.tutelage.crm.counsellor.calls.CallRecordingFinder
                                .find(context, number, dateMs, endedAt)
                        }.getOrNull()
                        if (rec != null) {
                            callDao.setRecording(existing.deviceCallId, rec)
                            recordingsAttached++
                        }
                    }
                    continue
                }

                // No existing row — insert one. Use deterministic ID so any
                // future capture from the receiver collides via REPLACE.
                val deviceCallId = "${direction.lowercase()}_${tokenStore.userId}_${dateMs}_$tail"
                val sim = SimLookup.resolve(context, phoneAccountId)
                val rec = if (durationSec > 0) {
                    runCatching {
                        com.tutelage.crm.counsellor.calls.CallRecordingFinder
                            .find(context, number, dateMs, endedAt)
                    }.getOrNull()
                } else null
                callDao.upsert(
                    CallEntity(
                        deviceCallId = deviceCallId,
                        leadId = null,
                        phoneNumber = number,
                        direction = direction,
                        status = status,
                        startedAt = dateMs,
                        endedAt = endedAt,
                        durationSec = durationSec,
                        simSlot = sim.slot,
                        simCarrier = sim.carrier,
                        simNumber = sim.number,
                        source = if (direction == "OUTGOING") "SYSTEM_DIALER" else "INCOMING",
                        recordingPath = rec,
                    )
                )
                inserted++
                if (rec != null) recordingsAttached++
            }
        }
        Timber.d(
            "forceSeedToday: scanned=%d inserted=%d recordings=%d",
            scanned, inserted, recordingsAttached,
        )
        return Triple(inserted, recordingsAttached, scanned)
    }

    companion object {
        // Receiver and backfiller see the SAME CallLog.Calls.DATE for one logical
        // call, so a tight ±5s window is enough to bridge them. A wider window
        // used to drop legitimate redials made within a minute of each other.
        private const val DEDUP_WINDOW_MS = 5_000L
        private val NON_DIGIT = Regex("\\D")

        private fun startOfTodayMs(): Long {
            val cal = java.util.Calendar.getInstance()
            cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
            cal.set(java.util.Calendar.MINUTE, 0)
            cal.set(java.util.Calendar.SECOND, 0)
            cal.set(java.util.Calendar.MILLISECOND, 0)
            return cal.timeInMillis
        }
    }
}
