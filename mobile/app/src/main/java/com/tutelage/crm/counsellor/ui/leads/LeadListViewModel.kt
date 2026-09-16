package com.tutelage.crm.counsellor.ui.leads

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import com.tutelage.crm.counsellor.data.auth.AuthRepository
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.leads.LeadListRowDto
import com.tutelage.crm.counsellor.data.leads.LeadRepository
import com.tutelage.crm.counsellor.data.leads.LeadStatusOptionDto
import com.tutelage.crm.counsellor.data.leads.LeadSubStatusOptionDto
import com.tutelage.crm.counsellor.data.leadwork.LeadWorkRepository
import com.tutelage.crm.counsellor.data.release.AppReleaseDto
import com.tutelage.crm.counsellor.update.AppUpdater
import com.tutelage.crm.counsellor.update.UpdateAvailable
import com.tutelage.crm.counsellor.work.CallSyncWorker
import com.tutelage.crm.counsellor.work.RecordingUploadWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import retrofit2.HttpException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

/** Quick-followup chips, mirrored from the web filter UI. */
enum class FollowupFilter(val key: String, val label: String) {
    NONE("", "Any"),
    TODAY("today", "Today's followups"),
    OVERDUE("overdue", "Overdue"),
    UPCOMING("upcoming", "Next 7 days"),
    HAS_ANY("any", "Has any followup"),
}

/** Page sizes for the footer selector — matches web /app/leads. */
val LEAD_PAGE_SIZES = listOf(50, 100, 200, 500)

data class LeadListUiState(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
    val userName: String? = null,

    val rows: List<LeadListRowDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 50,
    val totalPages: Int = 1,

    // ─── Filter state ─────────────────────────────────────────────────────
    /** Raw search box value (debounced into [appliedQuery]). */
    val searchInput: String = "",
    /** The query actually sent to the server (debounced). */
    val appliedQuery: String = "",
    val status: String = "",
    val subStatus: String = "",
    val followupFilter: FollowupFilter = FollowupFilter.NONE,
    val called: String = "",            // "" / "0" / "1"
    val fromDate: String = "",
    val toDate: String = "",
    /** Include (false) vs Exclude (true). In Exclude mode the server returns
     *  leads matching NONE of the filters above — each one negated on its own,
     *  the same semantics as the web Leads page. It is a MODE, not a filter:
     *  it never counts toward the active-filter badge, and on its own (with no
     *  filter set) it changes nothing. */
    val excludeMode: Boolean = false,
    val filtersExpanded: Boolean = false,

    val statusOptions: List<LeadStatusOptionDto> = emptyList(),
    val subStatusOptions: List<LeadSubStatusOptionDto> = emptyList(),

    // ─── Task scope ───────────────────────────────────────────────────────
    /** Set when this screen was opened from a Calling Task's "View leads"
     *  button — scopes the list to exactly this set of lead ids and shows
     *  the task's title instead of "My Leads". Empty when browsing normally. */
    val taskTitle: String? = null,
    val taskIdOrder: List<Long> = emptyList(),
    /** The calling task this list is scoped to, or 0 when browsing normally.
     *  With a batch id the SERVER owns the scope and the order (still-to-call
     *  first, already-called underneath) and stamps each row with its task
     *  state, so a lead never drops off the list once its call lands. */
    val taskBatchId: Long = 0L,
    /** Task item currently being marked done, so the row can show a spinner. */
    val markingItemId: Long? = null,
    /** One-shot banner after a manual mark (success or failure). */
    val markMessage: String? = null,
) {
    /** Is there anything for Exclude mode to invert?
     *
     *  `taskIdOrder` is deliberately absent: it is the Calling-Task scope, not
     *  a filter the counsellor picked, and inverting it would hand back every
     *  lead EXCEPT the task's — the opposite of what the screen is for. The
     *  server enforces the same rule, this just keeps the UI honest. */
    fun hasExcludableFilter(): Boolean =
        appliedQuery.isNotBlank() || status.isNotEmpty() || subStatus.isNotEmpty() ||
            followupFilter != FollowupFilter.NONE || called.isNotEmpty() ||
            fromDate.isNotEmpty() || toDate.isNotEmpty()
}

@HiltViewModel
class LeadListViewModel @Inject constructor(
    application: Application,
    private val leadRepository: LeadRepository,
    private val leadWorkRepository: LeadWorkRepository,
    private val authRepository: AuthRepository,
    private val tokenStore: TokenStore,
    private val appUpdater: AppUpdater,
) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(LeadListUiState(userName = tokenStore.userName))
    val state: StateFlow<LeadListUiState> = _state.asStateFlow()

    /** Guards against a duplicate first-load fetch — [start] runs once per
     *  ViewModel instance (each nav entry gets its own instance), triggered
     *  from a `LaunchedEffect(Unit)` in the composable. */
    private var started = false

    /** Kicks off the first load. When [taskIds] is non-empty this screen was
     *  opened via a Calling Task's "View leads" button — it scopes the list
     *  to exactly those lead ids (server-side) and preserves their order
     *  (mirrors the web's /app/leads?ids=... flow); otherwise it's the normal
     *  "My Leads" tab. */
    fun start(taskIds: List<Long> = emptyList(), taskTitle: String? = null, taskBatchId: Long = 0L) {
        if (started) return
        started = true
        if (taskIds.isNotEmpty() || taskBatchId > 0L) {
            _state.update {
                it.copy(
                    taskTitle = taskTitle,
                    taskIdOrder = taskIds,
                    taskBatchId = taskBatchId,
                    // A batch opened without a pre-supplied id list still needs
                    // a real page size — coercing 0 up would give a 1-row page.
                    pageSize = if (taskIds.isEmpty()) 100 else taskIds.size.coerceAtMost(500),
                )
            }
        }
        refresh(showSpinner = true)
    }

    val updateAvailable: StateFlow<UpdateAvailable?> = appUpdater.state

    fun installUpdate(release: AppReleaseDto) = appUpdater.startDownload(release)
    fun dismissUpdate() = appUpdater.dismiss()

    private var pollingJob: Job? = null
    private var searchDebounceJob: Job? = null

    init {
        // Actual first fetch is deferred to start() — called once the screen
        // composes so a task-scoped open (see [start]) never races an
        // unscoped fetch that would otherwise fire here first.
        // Local Room sync runs in parallel so /leads/:id detail still works
        // offline and previously-cached leads remain available.
        viewModelScope.launch { runCatching { leadRepository.sync() } }
        viewModelScope.launch { loadStatusOptions() }
        registerFcmToken()
        viewModelScope.launch { runCatching { appUpdater.checkForUpdate() } }
        startPolling()
    }

    private fun startPolling() {
        if (pollingJob != null) return
        pollingJob = viewModelScope.launch {
            // Polling only refreshes the visible page so the user doesn't get
            // yanked to page 1 mid-scroll. Also kicks the Room sync so cached
            // rows stay fresh for offline access. Foreground-gated: this used
            // to keep syncing the whole lead cache with the app closed.
            AppForeground.pollWhileForeground(30_000) {
                runCatching { leadRepository.sync() }
                refresh(showSpinner = false)
            }
        }
    }

    fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    override fun onCleared() {
        stopPolling()
        searchDebounceJob?.cancel()
        super.onCleared()
    }

    // ─── User actions ─────────────────────────────────────────────────────

    fun setSearch(value: String) {
        _state.update { it.copy(searchInput = value) }
        searchDebounceJob?.cancel()
        searchDebounceJob = viewModelScope.launch {
            delay(350)
            val trimmed = value.trim()
            if (trimmed == _state.value.appliedQuery) return@launch
            _state.update { it.copy(appliedQuery = trimmed, page = 1) }
            // showSpinner = false: with `true` the list was cleared and replaced
            // by a full-screen spinner on every debounced keystroke, so typing a
            // name flashed the results away and back. The inline refreshing
            // indicator is enough — the previous results stay readable until the
            // new ones land.
            refresh(showSpinner = false)
        }
    }

    fun setStatus(status: String) {
        if (_state.value.status == status) return
        // Switching status resets sub-status (sub-statuses are scoped to parent).
        _state.update { it.copy(status = status, subStatus = "", page = 1) }
        refresh(showSpinner = true)
    }

    fun toggleStatus(status: String) {
        val next = if (_state.value.status == status) "" else status
        setStatus(next)
    }

    fun setSubStatus(subStatus: String) {
        if (_state.value.subStatus == subStatus) return
        _state.update { it.copy(subStatus = subStatus, page = 1) }
        refresh(showSpinner = true)
    }

    fun setFollowupFilter(f: FollowupFilter) {
        if (_state.value.followupFilter == f) return
        _state.update { it.copy(followupFilter = f, page = 1) }
        refresh(showSpinner = true)
    }

    fun setCalled(value: String) {
        if (_state.value.called == value) return
        _state.update { it.copy(called = value, page = 1) }
        refresh(showSpinner = true)
    }

    fun setFromDate(d: String) {
        _state.update { it.copy(fromDate = d, page = 1) }
        refresh(showSpinner = true)
    }

    fun setToDate(d: String) {
        _state.update { it.copy(toDate = d, page = 1) }
        refresh(showSpinner = true)
    }

    fun setExcludeMode(value: Boolean) {
        if (_state.value.excludeMode == value) return
        _state.update { it.copy(excludeMode = value, page = 1) }
        refresh(showSpinner = true)
    }

    fun toggleFiltersPanel() {
        _state.update { it.copy(filtersExpanded = !it.filtersExpanded) }
    }

    fun clearFilters() {
        _state.update {
            it.copy(
                searchInput = "",
                appliedQuery = "",
                status = "",
                subStatus = "",
                followupFilter = FollowupFilter.NONE,
                called = "",
                fromDate = "",
                toDate = "",
                excludeMode = false,
                page = 1,
            )
        }
        refresh(showSpinner = true)
    }

    fun setPageSize(size: Int) {
        if (_state.value.pageSize == size) return
        _state.update { it.copy(pageSize = size, page = 1) }
        refresh(showSpinner = true)
    }

    fun firstPage() = goToPage(1)
    fun prevPage() = goToPage(_state.value.page - 1)
    fun nextPage() = goToPage(_state.value.page + 1)
    fun lastPage() = goToPage(_state.value.totalPages.coerceAtLeast(1))

    fun goToPage(p: Int) {
        val s = _state.value
        val clamped = p.coerceIn(1, s.totalPages.coerceAtLeast(1))
        if (clamped == s.page) return
        _state.update { it.copy(page = clamped) }
        refresh(showSpinner = true)
    }

    /** Pull-to-refresh: triggers a fresh page fetch AND a Room sync. */
    fun pullToRefresh() {
        refresh(showSpinner = false)
        viewModelScope.launch { runCatching { leadRepository.sync() } }
        val ctx = getApplication<Application>()
        CallSyncWorker.enqueue(ctx)
        RecordingUploadWorker.enqueue(ctx)
    }

    /**
     * Clear a task item no call can ever satisfy — no number on the lead, a
     * wrong number, or the person was reached some other way. Mirrors the web's
     * Mark-done button: the server writes a real CallLog row, so this shows on
     * the lead and in reports rather than being a private "task done" flag.
     */
    fun markTaskItemDone(itemId: Long, reason: String) {
        if (_state.value.markingItemId != null) return
        _state.update { it.copy(markingItemId = itemId, markMessage = null) }
        viewModelScope.launch {
            runCatching { leadWorkRepository.markItemDone(itemId, reason) }
                .onSuccess {
                    _state.update { it.copy(markingItemId = null, markMessage = "Marked done") }
                    // Re-fetch so the row picks up its DONE marker and drops to
                    // the already-called half of the list.
                    refresh(showSpinner = false)
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            markingItemId = null,
                            markMessage = e.message?.takeIf { m -> m.isNotBlank() } ?: "Couldn't mark this lead done",
                        )
                    }
                }
        }
    }

    /** Put a manually-marked item back to pending. Only offered on MANUAL_*
     *  completions — the server refuses anything a real call produced. */
    fun undoTaskItemDone(itemId: Long) {
        if (_state.value.markingItemId != null) return
        _state.update { it.copy(markingItemId = itemId, markMessage = null) }
        viewModelScope.launch {
            runCatching { leadWorkRepository.undoItemDone(itemId) }
                .onSuccess {
                    _state.update { it.copy(markingItemId = null, markMessage = "Moved back to pending") }
                    refresh(showSpinner = false)
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            markingItemId = null,
                            markMessage = e.message?.takeIf { m -> m.isNotBlank() } ?: "Couldn't undo this mark",
                        )
                    }
                }
        }
    }

    fun clearMarkMessage() = _state.update { it.copy(markMessage = null) }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            authRepository.logout()
            onDone()
        }
    }

    // ─── Fetch ────────────────────────────────────────────────────────────

    private fun refresh(showSpinner: Boolean) {
        _state.update {
            it.copy(
                loading = showSpinner && it.rows.isEmpty(),
                refreshing = it.rows.isNotEmpty() && !showSpinner,
                error = null,
            )
        }
        viewModelScope.launch {
            val s = _state.value
            runCatching {
                leadRepository.list(
                    page = s.page,
                    pageSize = s.pageSize,
                    q = s.appliedQuery.ifBlank { null },
                    status = s.status.ifBlank { null },
                    subStatus = s.subStatus.ifBlank { null },
                    hasFollowup = s.followupFilter.key.ifBlank { null },
                    called = s.called.ifBlank { null },
                    fromDate = s.fromDate.ifBlank { null },
                    toDate = s.toDate.ifBlank { null },
                    ids = s.taskIdOrder.takeIf { it.isNotEmpty() }?.joinToString(","),
                    batchId = s.taskBatchId.takeIf { it > 0L },
                    // Only meaningful when there is a filter to invert. Sending
                    // it with nothing selected would be a no-op on the server
                    // and would needlessly differ from what the UI shows.
                    excludeMode = if (s.excludeMode && s.hasExcludableFilter()) "1" else null,
                )
            }
                .onSuccess { p ->
                    // In batch mode the server already returned the rows in
                    // task order (pending first, done after) — re-sorting them
                    // by the raw item order here would put finished leads back
                    // in the middle of the queue. Only the legacy id-scoped
                    // path needs the client-side rank restore.
                    val rows = if (s.taskBatchId <= 0L && s.taskIdOrder.isNotEmpty()) {
                        val rank = s.taskIdOrder.withIndex().associate { (i, id) -> id to i }
                        p.rows.sortedBy { rank[it.id] ?: Int.MAX_VALUE }
                    } else p.rows
                    _state.update { cur ->
                        cur.copy(
                            loading = false,
                            refreshing = false,
                            rows = rows,
                            total = p.total,
                            page = p.page,
                            totalPages = p.totalPages.coerceAtLeast(1),
                            taskTitle = p.taskTitle ?: cur.taskTitle,
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            error = leadLoadingMessage(e),
                        )
                    }
                }
        }
    }

private fun leadLoadingMessage(error: Throwable): String = when (error) {
        is SocketTimeoutException -> "Leads are taking longer than usual to load. Check your internet and try again."
        is UnknownHostException, is ConnectException, is IOException -> "No internet connection. Check your network and tap refresh to load leads."
        is HttpException -> when (error.code()) {
            401 -> "Your session has expired. Please sign in again."
            403 -> "You do not have permission to view these leads."
            in 500..599 -> "The server is temporarily unavailable. Please tap refresh and try again."
            else -> "Could not load leads. Please tap refresh and try again."
        }
        else -> "Could not load leads. Please tap refresh and try again."
    }
    private suspend fun loadStatusOptions() {
        runCatching { leadRepository.statusOptions() }
            .onSuccess { opts ->
                _state.update {
                    it.copy(
                        statusOptions = opts.statuses,
                        subStatusOptions = opts.subStatuses,
                    )
                }
            }
    }

    private fun registerFcmToken() {
        viewModelScope.launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                authRepository.registerFcmToken(token)
            }
        }
    }
}
