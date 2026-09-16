package com.tutelage.crm.counsellor.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.CallLog
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.tutelage.crm.counsellor.data.activity.ActivityRepository
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.calls.CallDao
import com.tutelage.crm.counsellor.data.calls.CallEntity
import com.tutelage.crm.counsellor.work.CallSyncWorker
import com.tutelage.crm.counsellor.work.RecordingUploadWorker
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import java.time.Instant
import javax.inject.Inject

/**
 * Listens for phone state transitions. When a call ends (state → IDLE), reads the most recent
 * CallLog row and reconciles it with our local pending CallEntity (or creates a fresh one for
 * incoming calls), hunts down the OEM dialer's recording file, then enqueues CallSyncWorker.
 *
 * Recording strategy: we do NOT record ourselves (Android 10+ silently mutes MIC during a
 * call for non-dialer apps). Instead we wait for the OEM's built-in call recorder to write
 * its file to shared storage and pick that up — see CallRecordingFinder.
 */
@AndroidEntryPoint
class PhoneStateReceiver : BroadcastReceiver() {

    @Inject lateinit var callDao: CallDao
    @Inject lateinit var activityRepo: ActivityRepository
    @Inject lateinit var tokenStore: TokenStore
    @Inject lateinit var reconcileLock: CallReconcileLock

    companion object {
        // Coalesce dual-SIM duplicate broadcasts: Android delivers PHONE_STATE
        // once per subscription, so OFFHOOK can arrive twice for the same call.
        // We only fire one onCall:true / onCall:false to the server.
        //
        // Deliberately disk-backed, not a companion AtomicBoolean as it was
        // before. Companion state dies with the process, and an aggressive OEM
        // killing the app mid-call is routine on the devices this app targets.
        // The flag then silently reset to false, so the IDLE that followed
        // matched the "already in that state" check below and returned early —
        // the server never learned the call had ended and the counsellor stayed
        // flagged on-call indefinitely, suppressing inactivity warnings forever.
        private const val PREFS = "call_state"
        private const val KEY_ON_CALL = "on_call_reported"
        private val stateLock = Any()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return

        when (state) {
            TelephonyManager.EXTRA_STATE_OFFHOOK,
            TelephonyManager.EXTRA_STATE_RINGING -> {
                // Either an outgoing call connected, or an incoming call is ringing.
                // Both protect the user from being flagged as inactive.
                reportPhoneState(context, true)
                if (state == TelephonyManager.EXTRA_STATE_OFFHOOK) {
                    Timber.d("Phone OFFHOOK — OEM recorder takes over if enabled")
                } else {
                    Timber.d("Phone RINGING — suppressing inactivity warnings")
                }
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                reportPhoneState(context, false)
                onCallEnded(context)
            }
            else -> Timber.d("Phone state %s — waiting", state)
        }
    }

    private fun reportPhoneState(context: Context, onCall: Boolean) {
        // Skip the network call if we're already in the desired state — keeps
        // dual-SIM duplicate broadcasts from spamming the endpoint.
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(stateLock) {
            // Absent means "unknown" (fresh process), which must NOT be read as
            // "already false" — an IDLE arriving in that state has to report.
            val known = if (prefs.contains(KEY_ON_CALL)) prefs.getBoolean(KEY_ON_CALL, false) else null
            if (known == onCall) return
            // commit(), not apply(): the process may be killed moments later and
            // this flag has to survive that to stay correct.
            prefs.edit().putBoolean(KEY_ON_CALL, onCall).commit()
        }

        val since = if (onCall) Instant.now().toString() else null
        val pending = safeGoAsync() ?: return
        CoroutineScope(Dispatchers.IO).launch {
            try {
                activityRepo.phoneState(onCall = onCall, since = since)
                    .onFailure { Timber.w(it, "phone-state report failed (onCall=%s)", onCall) }
            } finally {
                pending.finishSafely()
            }
        }
    }

    private fun onCallEnded(context: Context) {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Timber.w("READ_CALL_LOG not granted; skipping reconcile")
            return
        }

        val pending = safeGoAsync() ?: return
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Give the OS a moment to flush the call log row
                delay(2_000)
                // Held for the whole check-then-insert below so a concurrent
                // CallLogBackfiller pass (periodic CallSyncWorker) can't observe
                // the same "no match yet" state and insert its own duplicate row
                // — see CallReconcileLock.
                reconcileLock.mutex.withLock { reconcile(context) }
                CallSyncWorker.enqueue(context)
                // Belt-and-braces: even if no new row needed syncing, kick the
                // uploader so the recording we just attached gets shipped ASAP.
                RecordingUploadWorker.enqueue(context)
            } catch (t: Throwable) {
                Timber.w(t, "PhoneStateReceiver reconcile failed")
            } finally {
                pending.finishSafely()
            }
        }
    }

    /**
     * goAsync() is a Java platform type from Kotlin's view, so a null or an
     * IllegalStateException (broadcast already finished, or goAsync() called
     * more than once for this delivery — happens with dual-SIM duplicate
     * PHONE_STATE broadcasts) won't be caught by the compiler. Returning null
     * here lets callers bail out instead of crashing on a null PendingResult.
     */
    private fun BroadcastReceiver.safeGoAsync(): PendingResult? = try {
        goAsync()
    } catch (t: Throwable) {
        Timber.w(t, "goAsync() failed — broadcast already finished?")
        null
    }

    private fun PendingResult?.finishSafely() {
        try {
            this?.finish()
        } catch (t: Throwable) {
            Timber.w(t, "PendingResult.finish() failed — already finished?")
        }
    }

    private suspend fun reconcile(context: Context) {
        val resolver = context.contentResolver
        val cols = arrayOf(
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_ID,
        )
        val cursor = resolver.query(
            CallLog.Calls.CONTENT_URI,
            cols,
            null,
            null,
            "${CallLog.Calls.DATE} DESC",
        ) ?: return

        cursor.use { c ->
            if (!c.moveToFirst()) return
            val number = c.getString(c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)) ?: ""
            val type = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.TYPE))
            val dateMs = c.getLong(c.getColumnIndexOrThrow(CallLog.Calls.DATE))
            val durationSec = c.getLong(c.getColumnIndexOrThrow(CallLog.Calls.DURATION)).toInt()
            val phoneAccountId = c.getString(c.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_ID))
            val sim = SimLookup.resolve(context, phoneAccountId)

            val direction = when (type) {
                CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                CallLog.Calls.INCOMING_TYPE, CallLog.Calls.MISSED_TYPE, CallLog.Calls.REJECTED_TYPE -> "INCOMING"
                else -> "OUTGOING"
            }
            val status = when (type) {
                CallLog.Calls.OUTGOING_TYPE -> if (durationSec > 0) "ANSWERED" else "NO_ANSWER"
                CallLog.Calls.INCOMING_TYPE -> "ANSWERED"
                CallLog.Calls.MISSED_TYPE -> "MISSED"
                CallLog.Calls.REJECTED_TYPE -> "REJECTED"
                CallLog.Calls.BLOCKED_TYPE -> "REJECTED"
                else -> if (durationSec > 0) "ANSWERED" else "FAILED"
            }
            val endedAt = dateMs + durationSec * 1000L

            // Try to match a pending OUTGOING row we created when the user tapped Call.
            // Look across ALL pending outgoing rows (synced or not) — the early RINGING
            // row may already have been pushed by CallSyncWorker. finalize() will mark
            // it dirty; the next sync pass UPDATEs the existing server row by
            // deviceCallId (the backend's /sync upserts on that key) instead of
            // creating a duplicate ANSWERED row.
            //
            // CRITICAL: only consider a match when the current OS event is also
            // OUTGOING. Otherwise an INCOMING REJECTED (or MISSED) from the same
            // number would get merged into a stale pending OUTGOING row — the
            // counsellor would lose the incoming-reject event entirely and see
            // their old outbound call's status mutated to REJECTED instead.
            val tail = number.replace(Regex("\\D"), "").takeLast(10)
            val match = if (direction == "OUTGOING") {
                callDao.pendingOutgoing().firstOrNull { existing ->
                    existing.phoneNumber.replace(Regex("\\D"), "").takeLast(10) == tail
                }
            } else null

            if (match != null) {
                callDao.finalize(match.deviceCallId, status, dateMs, endedAt, durationSec)
                callDao.setSim(match.deviceCallId, sim.slot, sim.carrier, sim.number)
                if (match.recordingPath == null && durationSec > 0) {
                    val rec = CallRecordingFinder.find(context, number, dateMs, endedAt)
                    if (rec != null) callDao.setRecording(match.deviceCallId, rec)
                    Timber.d("Reconciled outgoing call %s → %s/%ds, rec=%s",
                        match.deviceCallId, status, durationSec, rec ?: "none")
                }
            } else {
                // Skip insert if CallLogBackfiller (or another receiver pass) already
                // logged this call — same phone tail AND same direction within ±5s
                // of the same start time. Direction must match: an outgoing call
                // followed by an incoming reject from the same number within seconds
                // is two distinct events and both need to be logged.
                val nearby = callDao.findInRange(dateMs - 5_000L, dateMs + 5_000L)
                val siblings = nearby.filter {
                    it.direction == direction &&
                        it.phoneNumber.replace(Regex("\\D"), "").takeLast(10) == tail
                }
                // An open/unfinalized sibling (e.g. an in-app-dialer row still at
                // RINGING with endedAt == null, because pendingOutgoing() didn't
                // catch it in the match block above) IS this same call. Finalize
                // it in place — don't insert a duplicate SYSTEM_DIALER twin.
                // This is the same open-row-adoption CallLogBackfiller does.
                val openSibling = siblings.firstOrNull { it.endedAt == null }
                if (openSibling != null) {
                    callDao.finalize(openSibling.deviceCallId, status, dateMs, endedAt, durationSec)
                    callDao.setSim(openSibling.deviceCallId, sim.slot, sim.carrier, sim.number)
                    if (openSibling.recordingPath == null && durationSec > 0) {
                        val rec = CallRecordingFinder.find(context, number, dateMs, endedAt)
                        if (rec != null) callDao.setRecording(openSibling.deviceCallId, rec)
                    }
                    Timber.d("Adopted open sibling %s for %s call tail=%s dur=%ds",
                        openSibling.deviceCallId, direction, tail, durationSec)
                    return@use
                }
                // For already-closed siblings, fall back to durationSec parity to
                // distinguish "same physical call captured twice" from a real
                // rapid-redial to the same number. A back-to-back ANSWERED (30s)
                // + NO_ANSWER (0s) to the same tail within 5s is TWO calls, not
                // one — the durations differ, so we must NOT collapse. Same
                // durations (or both 0) → almost certainly the same call
                // captured through two paths → collapse.
                if (siblings.any {
                    it.durationSec == durationSec ||
                        (it.durationSec == 0 && durationSec == 0)
                }) {
                    Timber.d("Skipping duplicate %s call for tail %s near %d", direction, tail, dateMs)
                    return@use
                }
                // Deterministic deviceCallId so a duplicate reconcile (Samsung dual-SIM
                // delivers PHONE_STATE per subscription, and a concurrent CallSyncWorker
                // backfiller can also fire) collides on the PK and REPLACE collapses
                // them instead of creating two server rows.
                val deviceCallId = "${direction.lowercase()}_${tokenStore.userId}_${dateMs}_${durationSec}_$tail"
                val source = if (direction == "INCOMING") "INCOMING" else "SYSTEM_DIALER"
                // Persist the row FIRST. CallRecordingFinder.find() can take up to ~8s
                // (retry backoff while OEM flushes the file), which combined with the
                // 2s initial delay used to overrun the goAsync window — Android tore
                // the receiver down before upsert ran, so answered system-dialer calls
                // were never synced. Upsert now → search → setRecording.
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
                        source = source,
                    )
                )
                Timber.d(
                    "Logged %s call %s (%s, %ds, source=%s)",
                    direction, deviceCallId, status, durationSec, source,
                )
                // Only meaningful if the call actually connected.
                if (durationSec > 0) {
                    val rec = CallRecordingFinder.find(context, number, dateMs, endedAt)
                    if (rec != null) {
                        callDao.setRecording(deviceCallId, rec)
                        Timber.d("Attached recording %s to %s", rec, deviceCallId)
                    }
                }
            }
        }
    }
}
