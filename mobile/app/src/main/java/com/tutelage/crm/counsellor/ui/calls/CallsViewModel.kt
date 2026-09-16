package com.tutelage.crm.counsellor.ui.calls

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.calls.CallDao
import com.tutelage.crm.counsellor.data.calls.CallRepository
import com.tutelage.crm.counsellor.data.dashboard.CallLogRowDto
import com.tutelage.crm.counsellor.data.dashboard.CallLogSummaryDto
import com.tutelage.crm.counsellor.data.dashboard.DashboardApi
import com.tutelage.crm.counsellor.work.CallSyncWorker
import com.tutelage.crm.counsellor.work.RecordingUploadWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

/**
 * Quick-range chips above the date inputs. Mirrors the web Calls page.
 * `ALL` clears fromDate/toDate; the others compute an inclusive window
 * ending today.
 */
enum class QuickRange(val key: String, val label: String, val days: Int) {
    TODAY("today", "Today", 1),
    WEEK("7d", "Last 7 days", 7),
    MONTH("30d", "Last 30 days", 30),
    YEAR("365d", "Last 365 days", 365),
    ALL("all", "All time", -1);
}

/** Page-size options exposed in the footer selector — matches web. */
val PAGE_SIZES = listOf(50, 100, 200, 500)

data class CallsUiState(
    /** True only on the very first load before any rows are available. */
    val loading: Boolean = false,
    /** True during a silent background poll while existing rows are shown. */
    val refreshing: Boolean = false,
    /** True while the manual force-seed action is running. */
    val forceSeeding: Boolean = false,

    val rows: List<CallLogRowDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    // 50, not 500. refresh() replaces the row list wholesale and each card does
    // its own date/SIM formatting, so a 500-row page was half a megabyte of
    // main-thread formatting work on every poll for rows nobody had scrolled to.
    val pageSize: Int = 50,
    val totalPages: Int = 1,

    // ─── Filter state ─────────────────────────────────────────────────────
    /** Raw text in the search box (debounced into [appliedQuery]). */
    val searchInput: String = "",
    /** The query actually sent to the server (debounced). */
    val appliedQuery: String = "",
    val status: String = "",      // "" = All
    val direction: String = "",   // "" = All
    val fromDate: String = "",    // YYYY-MM-DD or empty
    val toDate: String = "",      // YYYY-MM-DD or empty
    /** Currently-highlighted quick-range chip (null when user picked custom dates). */
    val quickRange: QuickRange? = QuickRange.ALL,
    /** Show/hide the expandable Filters panel. */
    val filtersExpanded: Boolean = false,

    val summary: CallLogSummaryDto = CallLogSummaryDto(),
    val today: CallLogSummaryDto = CallLogSummaryDto(),
    val error: String? = null,
    val lastSyncedAtMs: Long? = null,
    /** One-shot message after a force-seed run — UI shows it as a toast and
     *  must call [CallsViewModel.consumeMessage] when displayed. */
    val message: String? = null,
    /** True if required permissions (READ_CALL_LOG, READ_PHONE_STATE) are missing. */
    val permissionsMissing: Boolean = false,
)

@HiltViewModel
class CallsViewModel @Inject constructor(
    private val application: Application,
    private val api: DashboardApi,
    private val callRepo: CallRepository,
    callDao: CallDao,
) : AndroidViewModel(application) {
    private val _state = MutableStateFlow(CallsUiState())
    val state: StateFlow<CallsUiState> = _state.asStateFlow()

    /** Live count of recordings sitting on the phone waiting to be uploaded. */
    val pendingUploads: StateFlow<Int> = callDao.pendingUploadsCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Live count of call rows we haven't pushed to the server. */
    val pendingSync: StateFlow<Int> = callDao.unsyncedCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    private var pollingJob: Job? = null
    private var searchDebounceJob: Job? = null

    init {
        updatePermissionStatus()
        kickWorkers()
        refresh(showSpinner = true)
        startPolling()
    }

    // ─── User actions ─────────────────────────────────────────────────────

    fun pullToRefresh() {
        updatePermissionStatus()
        kickWorkers()
        refresh(showSpinner = false)
    }

    private fun updatePermissionStatus() {
        val callLog = androidx.core.content.ContextCompat.checkSelfPermission(
            application, android.Manifest.permission.READ_CALL_LOG
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val phoneState = androidx.core.content.ContextCompat.checkSelfPermission(
            application, android.Manifest.permission.READ_PHONE_STATE
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        _state.update { it.copy(permissionsMissing = !callLog || !phoneState) }
    }

    /**
     * Manual recovery for "this call from my dialer didn't show up." Reads all
     * of today's OS CallLog rows, inserts anything missing, attaches recordings
     * that arrived late, and pushes the result to the backend.
     */
    fun forceSyncToday() {
        if (_state.value.forceSeeding) return
        _state.update { it.copy(forceSeeding = true, error = null) }
        viewModelScope.launch {
            val result = runCatching { callRepo.forceSeedToday() }
            result
                .onSuccess { r ->
                    val msg = buildString {
                        append("Scanned ").append(r.scanned).append(" call")
                        if (r.scanned != 1) append("s")
                        if (r.inserted > 0) append(" · added ").append(r.inserted)
                        if (r.recordingsAttached > 0) append(" · ").append(r.recordingsAttached).append(" recording")
                        if (r.recordingsAttached > 1) append("s")
                        if (r.inserted == 0 && r.recordingsAttached == 0) append(" · already in sync")
                    }
                    _state.update { it.copy(forceSeeding = false, message = msg) }
                    refresh(showSpinner = false)
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(forceSeeding = false, error = e.userMessage())
                    }
                }
        }
    }

    fun consumeMessage() {
        _state.update { it.copy(message = null) }
    }

    /** Search box edits — debounced 350ms before triggering a fetch. */
    fun setSearch(value: String) {
        _state.update { it.copy(searchInput = value) }
        searchDebounceJob?.cancel()
        searchDebounceJob = viewModelScope.launch {
            delay(350)
            val trimmed = value.trim()
            if (trimmed == _state.value.appliedQuery) return@launch
            _state.update { it.copy(appliedQuery = trimmed, page = 1) }
            refresh(showSpinner = true)
        }
    }

    fun setStatus(status: String) {
        if (_state.value.status == status) return
        _state.update { it.copy(status = status, page = 1) }
        refresh(showSpinner = true)
    }

    /** Toggle — click an already-selected status to clear it. */
    fun toggleStatus(status: String) {
        val s = _state.value
        val next = if (s.status == status) "" else status
        setStatus(next)
    }

    fun setDirection(direction: String) {
        if (_state.value.direction == direction) return
        _state.update { it.copy(direction = direction, page = 1) }
        refresh(showSpinner = true)
    }

    fun setFromDate(date: String) {
        _state.update { it.copy(fromDate = date, quickRange = null, page = 1) }
        refresh(showSpinner = true)
    }

    fun setToDate(date: String) {
        _state.update { it.copy(toDate = date, quickRange = null, page = 1) }
        refresh(showSpinner = true)
    }

    fun applyQuickRange(range: QuickRange) {
        val (from, to) = rangeFor(range)
        _state.update {
            it.copy(fromDate = from, toDate = to, quickRange = range, page = 1)
        }
        refresh(showSpinner = true)
    }

    fun toggleFiltersPanel() {
        _state.update { it.copy(filtersExpanded = !it.filtersExpanded) }
    }

    fun clearFilters() {
        val (from, to) = rangeFor(QuickRange.ALL)
        _state.update {
            it.copy(
                searchInput = "",
                appliedQuery = "",
                status = "",
                direction = "",
                fromDate = from,
                toDate = to,
                quickRange = QuickRange.ALL,
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

    private fun goToPage(page: Int) {
        val s = _state.value
        val clamped = page.coerceIn(1, s.totalPages.coerceAtLeast(1))
        if (clamped == s.page) return
        _state.update { it.copy(page = clamped) }
        refresh(showSpinner = true)
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
                api.calls(
                    page = s.page,
                    pageSize = s.pageSize,
                    range = if (s.fromDate.isEmpty() && s.toDate.isEmpty()) s.quickRange?.key else null,
                    q = s.appliedQuery.takeIf { it.length >= 3 },
                    status = s.status.ifBlank { null },
                    direction = s.direction.ifBlank { null },
                    fromDate = s.fromDate.ifBlank { null },
                    toDate = s.toDate.ifBlank { null },
                )
            }
                .onSuccess { p ->
                    _state.update { cur ->
                        cur.copy(
                            loading = false,
                            refreshing = false,
                            rows = p.rows,
                            total = p.total,
                            page = p.page,
                            totalPages = p.totalPages.coerceAtLeast(1),
                            summary = p.summary,
                            today = p.today,
                            lastSyncedAtMs = System.currentTimeMillis(),
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(loading = false, refreshing = false, error = e.userMessage())
                    }
                }
        }
    }

    private fun startPolling() {
        if (pollingJob?.isActive == true) return
        pollingJob = viewModelScope.launch {
            // 30s, not 12s: each tick kicks two WorkManager jobs AND
            // refetches the whole visible page. Call rows are not
            // second-by-second data, and PhoneStateReceiver already enqueues a
            // sync the moment a call ends. Foreground-gated on top of that —
            // WorkManager's 15-min periodic pass covers the background case.
            AppForeground.pollWhileForeground(30_000) {
                kickWorkers()
                // Only auto-refresh page 1 — page 2+ becomes stale on its own
                // when the user manually navigates; refreshing them mid-scroll
                // is jarring.
                if (_state.value.page == 1) refresh(showSpinner = false)
            }
        }
    }

    private fun kickWorkers() {
        val ctx = getApplication<Application>()
        CallSyncWorker.enqueue(ctx)
        RecordingUploadWorker.enqueue(ctx)
    }

    override fun onCleared() {
        pollingJob?.cancel()
        searchDebounceJob?.cancel()
        super.onCleared()
    }
}

// LocalDate/DateTimeFormatter rather than SimpleDateFormat: this is called from
// ViewModel coroutines (the 30s poll and user-driven reloads can overlap), and a
// shared SimpleDateFormat is not thread-safe.
private val DATE_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US)

/** Returns inclusive [from, to] strings for a quick range. */
internal fun rangeFor(r: QuickRange): Pair<String, String> {
    if (r == QuickRange.ALL) return "" to ""
    val today = LocalDate.now()
    val toStr = DATE_FMT.format(today)
    if (r == QuickRange.TODAY) return toStr to toStr
    return DATE_FMT.format(today.minusDays((r.days - 1).toLong())) to toStr
}

private fun Throwable.userMessage(): String =
    message?.takeIf { it.isNotBlank() } ?: "Couldn't reach server — will retry"
