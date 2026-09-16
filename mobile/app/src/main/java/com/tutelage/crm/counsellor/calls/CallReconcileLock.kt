package com.tutelage.crm.counsellor.calls

import kotlinx.coroutines.sync.Mutex
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Serializes every "does a row already exist for this physical call" check-and-insert
 * across the three independent producers (in-app pre-log finalization in
 * PhoneStateReceiver, CallLogBackfiller's periodic/backfill scan, and
 * CallRepository's stale-RINGING reconciler).
 *
 * Each producer used to run its own read-then-write ("query for an open/matching
 * sibling, insert if none found") with no coordination between them. When two fired
 * close together — e.g. the periodic CallSyncWorker backfill landing in the same
 * window as PhoneStateReceiver's onCallEnded — both could observe "no match yet" and
 * each insert its own row for the same call. Funneling all three through this single
 * lock makes that sequence impossible: whichever runs first either finalizes the
 * pending row or inserts it, and by the time the second acquires the lock it sees
 * that committed state and adopts it instead of duplicating it.
 */
@Singleton
class CallReconcileLock @Inject constructor() {
    val mutex = Mutex()
}
