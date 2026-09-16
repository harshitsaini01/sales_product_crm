package com.tutelage.crm.counsellor.data.leads

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class LeadSyncResponse(
    val syncedAt: String,
    val leads: List<LeadDto>,
    /** Full current set of lead IDs assigned to this counsellor. The app uses
     *  this to prune local rows whose assignment was revoked admin-side. May
     *  be omitted by older backends — treat null as "don't prune". */
    val assignedIds: List<Long>? = null,
)

/** One row in the paginated leads list (server-side paginated, NOT cached). */
@Serializable
data class LeadListRowDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val mobile2: String? = null,
    val email: String? = null,
    val city: String? = null,
    val state: String? = null,
    val leadStatus: String? = null,
    val leadSubStatus: String? = null,
    val intrestedCourse: String? = null,
    val source: String? = null,
    val followupDate: String? = null,
    val called: Int? = null,
    val flagSend: Int? = null,
    val flagRcv: Int? = null,
    val updatedAt: String? = null,
    val createdAt: String? = null,
    /** When this lead was last actually rung — app-captured calls and calls
     *  logged from the web CRM, whichever is later. Null if never called. */
    val lastCallAt: String? = null,
    /** Is this lead on one of MY calling tasks for today? The card is tinted
     *  green when it is, so today's work stands out in the ordinary list. */
    val inTodayTask: Boolean = false,
    // ── Only populated when the list is scoped to one calling task ──────────
    /** The LeadWorkBatchItem this row stands for — what "mark done" acts on.
     *  A lead can sit in more than one task, so this is per-task, not per-lead. */
    val taskItemId: Long? = null,
    /** Has this lead's task item been completed (called / followed up)? */
    val taskDone: Boolean = false,
    val taskCompletedAt: String? = null,
    /** CALL_ANSWERED / CALL_NO_ANSWER / MANUAL_* / FOLLOWUP_RECORDED / … */
    val taskCompletionType: String? = null,
    val callAttempts: Int = 0,
    val lastCallOutcome: String? = null,
    val lastCallDurationSec: Int = 0,
)

@Serializable
data class LeadListPageDto(
    val rows: List<LeadListRowDto> = emptyList(),
    val page: Int = 1,
    val pageSize: Int = 500,
    val total: Int = 0,
    val totalPages: Int = 1,
    /** Set when the page was requested with `batchId` — the task's own title. */
    val taskTitle: String? = null,
)

@Serializable
data class LeadStatusOptionDto(
    val value: String,
    val count: Int = 0,
)

@Serializable
data class LeadSubStatusOptionDto(
    val value: String,
    val parentStatus: String? = null,
    val count: Int = 0,
)

@Serializable
data class LeadStatusOptionsDto(
    val statuses: List<LeadStatusOptionDto> = emptyList(),
    val subStatuses: List<LeadSubStatusOptionDto> = emptyList(),
)

@Serializable
data class LeadDetailDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val mobile2: String? = null,
    val email: String? = null,
    val city: String? = null,
    val state: String? = null,
    val leadStatus: String? = null,
    val leadSubStatus: String? = null,
    val leadStatusId: Long? = null,
    val leadSubStatusId: Long? = null,
    val leadFollowStatus: Long? = null,
    val departmentId: Long? = null,
    val intrestedCourse: String? = null,
    val followupDate: String? = null,
    val comment: String? = null,
    val flagSend: Int? = null,
    val flagRcv: Int? = null,
    val called: Int? = null,
    val wapp: Int? = null,
    val fatherName: String? = null,
    val motherName: String? = null,
    val dob: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

/**
 * Payload of `GET /api/mobile/leads/{id}/detail` — the lead plus every list the
 * detail screen renders, fetched in one round trip instead of seven.
 *
 * Every list defaults to empty so a server that stops sending one (or an older
 * server that never did) degrades to a missing section rather than a parse
 * failure that blanks the whole screen.
 */
@Serializable
data class LeadDetailBundleDto(
    val lead: LeadDetailDto,
    val notes: List<LeadNoteDto> = emptyList(),
    val comments: List<LeadCommentDto> = emptyList(),
    val followups: List<FollowupRecordDto> = emptyList(),
    val history: List<StatusHistoryDto> = emptyList(),
    val flags: List<FlagMessageDto> = emptyList(),
    val timeline: List<TimelineEntryDto> = emptyList(),
)

@Serializable
data class LeadSubStatusDto(
    val id: Long,
    val subStatus: String,
    val statusId: Long,
    val departmentId: Long? = null,
    val statusLeadTypeId: Long? = null,
    val moveTo: Long? = null,
)

@Serializable
data class LeadStatusDto(
    val id: Long,
    val title: String,
    val slug: String? = null,
    val departmentId: Long? = null,
    val moveTo: String? = null,
    val priority: Int? = null,
    val status: Int? = null,
    val subStatuses: List<LeadSubStatusDto> = emptyList(),
)

@Serializable
data class LeadFollowupStatusDto(
    val id: Long,
    val status: String? = null,
    val shortnote: String? = null,
)

@Serializable
data class DepartmentDto(
    val id: Long,
    val name: String? = null,
    val title: String? = null,
    val slug: String? = null,
    val priority: Int? = null,
    val status: Int? = null,
)

@Serializable
data class LeadConfigDto(
    val statuses: List<LeadStatusDto> = emptyList(),
    val followupStatuses: List<LeadFollowupStatusDto> = emptyList(),
    val departments: List<DepartmentDto> = emptyList(),
)

@Serializable
data class LeadPatchBody(
    val leadStatusId: Long? = null,
    val leadSubStatusId: Long? = null,
    val followupDate: String? = null,
    val comment: String? = null,
)

@Serializable
data class LeadNoteDto(
    val id: Long,
    val note: String,
    val createdAt: String,
    val userId: Long,
    val userName: String? = null,
)

@Serializable
data class NoteBody(val note: String)

@Serializable
data class CommentBody(val comment: String)

@Serializable
data class FlagBody(val message: String? = null)

@Serializable
data class FlagState(val flagSend: Int? = null, val flagRcv: Int? = null)

@Serializable
data class LeadCommentDto(
    val id: Long,
    val comment: String,
    val createdAt: String,
    val userId: Long,
    val userName: String? = null,
)

@Serializable
data class FlagMessageDto(
    val id: Long,
    val message: String,
    val type: String,
    val createdAt: String,
    val userId: Long,
    val userName: String? = null,
)

@Serializable
data class TimelineEntryDto(
    val id: String,
    val type: String,
    val at: String,
    val byId: Long? = null,
    val byName: String? = null,
    val summary: String,
    val detail: String? = null,
)

@Serializable
data class StatusHistoryDto(
    val id: Long,
    val fromStatus: String? = null,
    val toStatus: String,
    val fromSubStatus: String? = null,
    val toSubStatus: String? = null,
    val source: String? = null,
    val reason: String? = null,
    val createdAt: String,
    val byName: String? = null,
)

@Serializable
data class FollowupRecordDto(
    val id: Long,
    val comment: String? = null,
    val followupDate: String? = null,
    val leadStatusId: Long? = null,
    val leadSubStatusId: Long? = null,
    val callAnsweredStatus: Int? = null,
    val type: String? = null,
    val description: String? = null,
    val createdAt: String? = null,
    val flagRcv: Int? = null,
    val flagSend: Int? = null,
    val user: SimpleUserDto? = null,
)

@Serializable
data class SimpleUserDto(
    val id: Long? = null,
    val name: String? = null,
)

@Serializable
data class FollowupCreateBody(
    val comment: String,
    val followupDate: String? = null,
    val leadStatusId: Long? = null,
    val leadSubStatusId: Long? = null,
    val departmentId: Long? = null,
    val statusLeadTypeId: Long? = null,
    val callAnsweredStatus: Int? = null,
    val leadFollowStatus: Long? = null,
    val type: String? = "followup",
)

@Serializable
data class BucketLeadDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val email: String? = null,
    val city: String? = null,
    val state: String? = null,
    val intrestedCourse: String? = null,
    val website: String? = null,
    val source: String? = null,
    val createdAt: String? = null,
    val flagRcv: Int? = null,
    val flagSend: Int? = null,
)

@Serializable
data class BucketFacetDto(val value: String, val count: Int = 0)

@Serializable
data class BucketFacetsDto(val total: Int = 0, val websites: List<BucketFacetDto> = emptyList(), val sources: List<BucketFacetDto> = emptyList(), val events: List<BucketFacetDto> = emptyList())

@Serializable
data class BucketPageDto(
    val rows: List<BucketLeadDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 50,
    val totalPages: Int = 1,
)

@Serializable
data class BucketClaimBody(val leadIds: List<Long>)

@Serializable
data class BucketClaimResult(val claimed: Int = 0, val skipped: Int = 0, val message: String = "")
interface LeadApi {
    @GET("api/mobile/leads/bucket")
    suspend fun bucket(@Query("page") page: Int = 1, @Query("pageSize") pageSize: Int = 50, @Query("q") q: String? = null, @Query("website") website: String? = null, @Query("source") source: String? = null, @Query("event") event: String? = null, @Query("fromDate") fromDate: String? = null, @Query("toDate") toDate: String? = null, @Query("flagBucket") flagBucket: String? = null): BucketPageDto

    @GET("api/mobile/leads/bucket/facets")
    suspend fun bucketFacets(@Query("flagBucket") flagBucket: String? = null): BucketFacetsDto

    @POST("api/mobile/leads/bucket/claim")
    suspend fun claimBucket(@Body body: BucketClaimBody): BucketClaimResult

    @GET("api/mobile/leads/sync")
    suspend fun sync(@Query("since") since: String? = null): LeadSyncResponse

    /** Server-paginated list with filters — mirrors the web /app/leads page.
     *  Use this for the Leads tab instead of relying on the (1000-row capped)
     *  /leads/sync cache, so counsellors with >1000 leads can find ANY lead. */
    @GET("api/mobile/leads/list")
    suspend fun list(
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 500,
        @Query("q") q: String? = null,
        @Query("status") status: String? = null,
        @Query("subStatus") subStatus: String? = null,
        @Query("hasFollowup") hasFollowup: String? = null,
        @Query("called") called: String? = null,
        @Query("fromDate") fromDate: String? = null,
        @Query("toDate") toDate: String? = null,
        @Query("orderBy") orderBy: String? = null,
        @Query("orderDir") orderDir: String? = null,
        /** Comma-separated lead ids — scopes the list to exactly this set
         *  (used by the Tasks screen to show a calling task's leads in the
         *  same list format as the regular Leads tab). */
        @Query("ids") ids: String? = null,
        /** One of the counsellor's own calling tasks. Supersedes [ids]: the
         *  server scopes the list to that batch, orders it still-to-call
         *  first / already-called after, and stamps each row with its task
         *  state so nothing disappears once the call lands. */
        @Query("batchId") batchId: Long? = null,
        /** "1" flips every user-picked filter above into its negation — the
         *  server returns leads matching NONE of them. The `ids` task scope is
         *  never inverted. Send it only when at least one filter is actually
         *  set, otherwise it is a no-op. */
        @Query("excludeMode") excludeMode: String? = null,
    ): LeadListPageDto

    @GET("api/mobile/leads/status-options")
    suspend fun statusOptions(): LeadStatusOptionsDto

    @GET("api/mobile/leads/{id}")
    suspend fun byId(@Path("id") id: Long): LeadDetailDto

    /**
     * The whole detail screen in one request.
     *
     * Replaces [byId] + [notes] + [comments] + [followups] + [timeline] +
     * [history] + [flags] — seven round trips on every screen open and again on
     * every 60s poll tick. Those are kept only so an older app build talking to
     * a newer server still works; nothing in this build should call them.
     */
    @GET("api/mobile/leads/{id}/detail")
    suspend fun detail(@Path("id") id: Long): LeadDetailBundleDto

    @PATCH("api/mobile/leads/{id}")
    suspend fun patch(@Path("id") id: Long, @Body body: LeadPatchBody): LeadDetailDto

    @GET("api/mobile/lead-config")
    suspend fun leadConfig(): LeadConfigDto

    @GET("api/mobile/leads/{id}/notes")
    suspend fun notes(@Path("id") id: Long): List<LeadNoteDto>

    @POST("api/mobile/leads/{id}/notes")
    suspend fun addNote(@Path("id") id: Long, @Body body: NoteBody): LeadNoteDto

    @GET("api/mobile/leads/{id}/timeline")
    suspend fun timeline(@Path("id") id: Long): List<TimelineEntryDto>

    @GET("api/mobile/leads/{id}/followups")
    suspend fun followups(@Path("id") id: Long): List<FollowupRecordDto>

    @POST("api/mobile/leads/{id}/followups")
    suspend fun addFollowup(@Path("id") id: Long, @Body body: FollowupCreateBody): FollowupRecordDto

    @GET("api/mobile/leads/{id}/comments")
    suspend fun comments(@Path("id") id: Long): List<LeadCommentDto>

    @POST("api/mobile/leads/{id}/comments")
    suspend fun addComment(@Path("id") id: Long, @Body body: CommentBody): LeadCommentDto

    @GET("api/mobile/leads/{id}/flags")
    suspend fun flags(@Path("id") id: Long): List<FlagMessageDto>

    @POST("api/mobile/leads/{id}/flag")
    suspend fun toggleFlag(@Path("id") id: Long, @Body body: FlagBody): FlagState

    @GET("api/mobile/leads/{id}/history")
    suspend fun history(@Path("id") id: Long): List<StatusHistoryDto>
}
