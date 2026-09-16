package com.tutelage.crm.counsellor.data.leadwork

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-batch progress marker for the in-app auto-dialer.
 *
 * The counsellor often has to leave the runner screen mid-batch — check a
 * lead's notes, take a real call, jump back to the home screen when a car
 * arrives. When they come back, they expect to resume exactly where they
 * stopped, not at the top of the list again. The dialer ViewModel is
 * screen-scoped, so its in-memory `currentIndex` is gone the moment they
 * navigate away.
 *
 * We persist the *lead id* of the next call rather than the index — the queue
 * is filtered by `completedAt == null` on every load, so its length and
 * offsets shift as the backend catches up with what was called. A lead id
 * survives that filter and reliably re-anchors the position on the next open.
 */
@Singleton
class TaskAutoDialerStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("task_auto_dialer", Context.MODE_PRIVATE)

    /** The lead the runner should ring next, or null if the batch has no saved
     *  position (never started, or explicitly cleared after completion). */
    fun nextLeadId(batchId: Long): Long? {
        val v = prefs.getLong(key(batchId), -1L)
        return if (v <= 0L) null else v
    }

    /** Save the next-to-dial lead id after the runner advances past a call.
     *  Passing null clears the marker for that batch. */
    fun setNextLeadId(batchId: Long, leadId: Long?) {
        prefs.edit().apply {
            if (leadId == null) remove(key(batchId)) else putLong(key(batchId), leadId)
        }.apply()
    }

    fun clear(batchId: Long) = setNextLeadId(batchId, null)

    private fun key(batchId: Long) = "next_lead_id:$batchId"
}
