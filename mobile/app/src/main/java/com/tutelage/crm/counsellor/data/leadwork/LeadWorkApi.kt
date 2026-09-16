package com.tutelage.crm.counsellor.data.leadwork

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * "Calling Tasks" — the batches an admin assigns from the web Lead Workboard
 * (frontend LeadCallingTasks.tsx / Tasks.tsx). Mirrors GET /lead-work/batches,
 * scoped server-side to the signed-in counsellor's own batches.
 */

@Serializable
data class TaskAssigneeDto(
    val id: Long,
    val name: String? = null,
)

@Serializable
data class TaskLeadDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val followupDate: String? = null,
    val leadStatus: String? = null,
    // Mirrors of TaskItemDto's call-metric fields. Populated by the ViewModel
    // when the queue is built (backend keeps these on the item, not the lead,
    // to avoid duplication in the JSON payload). Kept here so the cards can
    // render "3 attempts · last 00:47 · 2h ago" from a plain TaskLeadDto
    // without threading item context through every screen composable.
    val callAttempts: Int = 0,
    val lastCallAt: String? = null,
    val lastCallDurationSec: Int = 0,
    val lastCallOutcome: String? = null,
    val totalCallDurationSec: Int = 0,
)

@Serializable
data class TaskItemDto(
    val id: Long,
    val leadId: Long,
    val completedAt: String? = null,
    /** How the item was completed — CALL_ANSWERED, CALL_NO_ANSWER, MANUAL_*,
     *  FOLLOWUP_RECORDED, etc. Populated for both auto-derived and manual
     *  completions; null for still-pending items. */
    val completionType: String? = null,
    /** Total call attempts on this lead (across duplicate rows on the same
     *  number) within the task's credit window. Zero for a lead that hasn't
     *  been rung yet, even if the item is manually marked done. */
    val callAttempts: Int = 0,
    val callAnswered: Int = 0,
    /** ISO timestamp of the most recent call attempt, or null if none. */
    val lastCallAt: String? = null,
    val lastCallDurationSec: Int = 0,
    /** Outcome of the most recent call — ANSWERED / NO_ANSWER / BUSY / etc. */
    val lastCallOutcome: String? = null,
    val totalCallDurationSec: Int = 0,
    val lead: TaskLeadDto,
)

@Serializable
data class TaskSummaryDto(
    val connected: Int = 0,
    val noAnswer: Int = 0,
    val busyRejected: Int = 0,
    val followupsCreated: Int = 0,
)

@Serializable
data class TaskBatchDto(
    val id: Long,
    val title: String,
    val workType: String = "INITIAL_CALL",
    val priority: String = "high",
    val notes: String? = null,
    val sequence: Int = 1,
    /** Dense 1..N position of this task among the counsellor's tasks for the
     *  SAME work day, with [dayTaskCount] as N. `sequence` is the stored
     *  allocation and goes sparse once tasks are deleted; these two are what
     *  the UI counts the day by ("Task 2 of 3"). Zero on an older backend. */
    val daySequence: Int = 0,
    val dayTaskCount: Int = 0,
    val state: String = "READY", // READY | IN_PROGRESS | LOCKED | COMPLETED
    val workDateLabel: String? = null,
    val leadDateLabel: String? = null,
    val total: Int = 0,
    val completed: Int = 0,
    val remaining: Int = 0,
    val progress: Int = 0,
    val assignedBy: TaskAssigneeDto? = null,
    val assignedTo: TaskAssigneeDto? = null,
    val summary: TaskSummaryDto? = null,
    val items: List<TaskItemDto> = emptyList(),
)

/** Why a counsellor is clearing an item no call could satisfy. Keys must match
 *  the server's MANUAL_REASONS map (GET /lead-work/manual-reasons lists them). */
@Serializable
data class MarkDoneBody(
    val reason: String,
    val notes: String? = null,
)

@Serializable
data class MarkDoneResponse(
    val ok: Boolean = false,
    val completedAt: String? = null,
    val completionType: String? = null,
)

interface LeadWorkApi {
    @GET("api/mobile/lead-work/batches")
    suspend fun batches(): List<TaskBatchDto>

    /** Manual completion for one task item, mirroring the web's Mark-done
     *  button. Writes a real CallLog row server-side, so it also shows on the
     *  lead and in the counsellor-performance report. */
    @POST("api/mobile/lead-work/items/{itemId}/mark-done")
    suspend fun markItemDone(
        @Path("itemId") itemId: Long,
        @Body body: MarkDoneBody,
    ): MarkDoneResponse

    /** Undo a MANUAL_* mark. The server refuses on items completed by real
     *  activity — that completion would just be re-derived on the next fetch. */
    @POST("api/mobile/lead-work/items/{itemId}/undo-done")
    suspend fun undoItemDone(@Path("itemId") itemId: Long): MarkDoneResponse
}
