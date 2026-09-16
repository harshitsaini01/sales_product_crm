package com.tutelage.crm.counsellor.data.leads

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LeadRepository @Inject constructor(
    private val api: LeadApi,
    private val dao: LeadDao,
    @ApplicationContext context: Context,
) {
    private val syncPrefs: SharedPreferences =
        context.getSharedPreferences("lead_sync", Context.MODE_PRIVATE)

    fun observe(query: String): Flow<List<LeadEntity>> =
        if (query.isBlank()) dao.observeAll() else dao.search(query.trim())

    /** Server-paginated list — bypasses the 1000-row Room cache so the user
     *  can find ANY assigned lead, not just the most recently-updated 1000. */
    suspend fun list(
        page: Int,
        pageSize: Int,
        q: String?,
        status: String?,
        subStatus: String?,
        hasFollowup: String?,
        called: String?,
        fromDate: String?,
        toDate: String?,
        orderBy: String? = null,
        orderDir: String? = null,
        ids: String? = null,
        batchId: Long? = null,
        excludeMode: String? = null,
    ): LeadListPageDto = api.list(
        page = page,
        pageSize = pageSize,
        q = q,
        status = status,
        subStatus = subStatus,
        hasFollowup = hasFollowup,
        called = called,
        fromDate = fromDate,
        toDate = toDate,
        orderBy = orderBy,
        orderDir = orderDir,
        ids = ids,
        batchId = batchId,
        excludeMode = excludeMode,
    )

    suspend fun statusOptions(): LeadStatusOptionsDto = api.statusOptions()

    suspend fun byId(id: Long): LeadEntity? = dao.byId(id)

    /**
     * Run a lead-scoped API call, evicting the lead from the local cache when
     * the server tells us it is not ours any more.
     *
     * `sync()` already prunes reassigned leads via `keepIds`, but only on its
     * own schedule — until it next ran, a lead an admin had reassigned stayed
     * in Room, kept being listed, and 403'd on every tap. The 403 body is the
     * earliest and most authoritative signal that the assignment is gone, so
     * act on it immediately: the Leads list is a Room Flow, so deleting the row
     * makes the stale entry disappear on its own.
     *
     * The exception is always rethrown — this only heals the cache, the caller
     * still gets to show the error.
     */
    private suspend fun <T> leadScoped(id: Long, block: suspend () -> T): T =
        try {
            block()
        } catch (e: HttpException) {
            if (e.code() == 403 && isNotAssigned(e)) dao.deleteIds(listOf(id))
            throw e
        }

    /**
     * `peek()` rather than `string()`: reading the error body outright consumes
     * it, and a caller that later wants the server's message would find it
     * empty. Nothing does today, but a one-way read is a trap to leave behind.
     */
    private fun isNotAssigned(e: HttpException): Boolean = try {
        e.response()?.errorBody()?.source()?.peek()?.readUtf8()?.contains("\"not_assigned\"") == true
    } catch (_: Throwable) {
        false
    }

    suspend fun fetchDetail(id: Long): LeadDetailDto = leadScoped(id) { api.byId(id) }

    /**
     * The whole detail screen in one round trip. See [LeadApi.detail].
     *
     * Falls back to the old seven-call fan-out if the server does not know the
     * route yet, so this build works against a backend that has not been
     * deployed. Without it, shipping the APK before the backend would take the
     * lead-detail screen down completely — this makes the deploy order a
     * preference rather than a hard dependency.
     */
    suspend fun fetchDetailBundle(id: Long): LeadDetailBundleDto = leadScoped(id) {
        try {
            api.detail(id)
        } catch (e: HttpException) {
            if (!isMissingRoute(e)) throw e
            legacyDetailBundle(id)
        }
    }

    /**
     * Distinguish "this server has no /detail route" from "this lead does not
     * exist", which are both 404s.
     *
     * Our own handler answers with a JSON body (`{"error":"Not found"}`); an
     * unmatched route falls through to the framework's plain-text 404. Only the
     * latter is worth retrying the old way — a genuinely missing lead would just
     * 404 seven more times.
     */
    private fun isMissingRoute(e: HttpException): Boolean {
        if (e.code() != 404) return false
        val body = try {
            e.response()?.errorBody()?.source()?.peek()?.readUtf8().orEmpty()
        } catch (_: Throwable) {
            ""
        }
        return !body.trimStart().startsWith("{")
    }

    /** The pre-bundle behaviour: seven requests in parallel. */
    private suspend fun legacyDetailBundle(id: Long): LeadDetailBundleDto = coroutineScope {
        val lead = async { api.byId(id) }
        val notes = async { runCatching { api.notes(id) }.getOrDefault(emptyList()) }
        val comments = async { runCatching { api.comments(id) }.getOrDefault(emptyList()) }
        val followups = async { runCatching { api.followups(id) }.getOrDefault(emptyList()) }
        val history = async { runCatching { api.history(id) }.getOrDefault(emptyList()) }
        val flags = async { runCatching { api.flags(id) }.getOrDefault(emptyList()) }
        val timeline = async { runCatching { api.timeline(id) }.getOrDefault(emptyList()) }
        LeadDetailBundleDto(
            // Not wrapped in runCatching: without the lead there is no screen to
            // draw, so its failure must surface exactly as it did before.
            lead = lead.await(),
            notes = notes.await(),
            comments = comments.await(),
            followups = followups.await(),
            history = history.await(),
            flags = flags.await(),
            timeline = timeline.await(),
        )
    }

    suspend fun patch(id: Long, body: LeadPatchBody): LeadDetailDto {
        val updated = leadScoped(id) { api.patch(id, body) }
        // Reflect status/sub-status into the local cache immediately so the
        // Leads list and Home followup tiles update without waiting for sync.
        val existing = dao.byId(id)
        if (existing != null) {
            dao.upsertAll(listOf(
                existing.copy(
                    leadStatus = updated.leadStatus ?: existing.leadStatus,
                    leadSubStatus = updated.leadSubStatus ?: existing.leadSubStatus,
                    updatedAt = updated.updatedAt ?: existing.updatedAt,
                )
            ))
        }
        return updated
    }

    suspend fun leadConfig(): LeadConfigDto = api.leadConfig()

    suspend fun notes(id: Long): List<LeadNoteDto> = leadScoped(id) { api.notes(id) }

    suspend fun addNote(id: Long, note: String): LeadNoteDto =
        leadScoped(id) { api.addNote(id, NoteBody(note)) }

    suspend fun timeline(id: Long): List<TimelineEntryDto> = leadScoped(id) { api.timeline(id) }

    suspend fun followups(id: Long): List<FollowupRecordDto> = leadScoped(id) { api.followups(id) }

    suspend fun addFollowup(id: Long, body: FollowupCreateBody): FollowupRecordDto =
        leadScoped(id) { api.addFollowup(id, body) }

    suspend fun comments(id: Long): List<LeadCommentDto> = leadScoped(id) { api.comments(id) }

    suspend fun addComment(id: Long, comment: String): LeadCommentDto =
        leadScoped(id) { api.addComment(id, CommentBody(comment)) }

    suspend fun flags(id: Long): List<FlagMessageDto> = leadScoped(id) { api.flags(id) }

    suspend fun toggleFlag(id: Long, message: String?): FlagState =
        leadScoped(id) { api.toggleFlag(id, FlagBody(message)) }

    suspend fun history(id: Long): List<StatusHistoryDto> = leadScoped(id) { api.history(id) }

    // withContext(IO): `suspend` alone does NOT move work off the caller's
    // dispatcher, and every caller here launches on viewModelScope (Main). The
    // two SharedPreferences hits plus the Room writes below were all running on
    // the main thread.
    suspend fun sync(force: Boolean = false): Result<Int> = withContext(Dispatchers.IO) {
        runCatching {
        val since = if (force) null else syncPrefs.getString(KEY_LAST_SYNC, null)
        val resp = api.sync(since)
        if (resp.leads.isNotEmpty()) {
            dao.upsertAll(resp.leads.map { it.toEntity() })
        }
        // Prune leads that are no longer assigned to this counsellor. Old
        // versions of the backend may not return assignedIds — leave the
        // cache alone in that case to avoid wiping rows on stale servers.
        resp.assignedIds?.let { ids ->
            if (ids.isEmpty()) dao.clear() else dao.keepIds(ids)
        }
        syncPrefs.edit().putString(KEY_LAST_SYNC, resp.syncedAt).apply()
        resp.leads.size
        }
    }

    companion object {
        private const val KEY_LAST_SYNC = "last_sync"
    }
}
