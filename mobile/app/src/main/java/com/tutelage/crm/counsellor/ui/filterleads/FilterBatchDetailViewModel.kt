package com.tutelage.crm.counsellor.ui.filterleads

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.staging.FilterLeadsRepository
import com.tutelage.crm.counsellor.data.staging.StagingBatchDto
import com.tutelage.crm.counsellor.data.staging.StagingItemDto
import com.tutelage.crm.counsellor.data.staging.StagingStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

val FILTER_PAGE_SIZES = listOf(100, 200, 500)

/** Verification tabs, mirrored from the web FilterLeadsBatch tabs. */
enum class ItemFilter(val label: String) {
    ALL("All"),
    PENDING("Pending"),
    VERIFIED("Verified"),
    REJECTED("Not Verified"),
    CALL_NOT_ANSWERED("Call Not Answered"),
    SEEDED("Seeded"),
}

data class FilterBatchDetailUiState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val batch: StagingBatchDto? = null,
    val items: List<StagingItemDto> = emptyList(),
    val filter: ItemFilter = ItemFilter.ALL,
    val search: String = "",
    /** Selected States (multi-select). Empty = "All states". Options are derived
     *  from this batch's own items so each folder only surfaces its own geography. */
    val stateFilter: Set<String> = emptySet(),
    /** Selected Cities (multi-select). Empty = "All cities". */
    val cityFilter: Set<String> = emptySet(),
    /** When true, only items with no counsellor comment (null or blank) match.
     *  Mirrors the web "no comments" cleanup view — useful for finding leads
     *  that have been called but not noted, or that haven't been touched yet. */
    val noCommentsOnly: Boolean = false,
    /** Items currently being saved (status/comment) — disables each card's own
     *  buttons. A Set (not a single id) so verifying lead B isn't blocked while
     *  lead A's request is still in flight — the core rapid-verification flow. */
    val savingItemIds: Set<Long> = emptySet(),
    val page: Int = 1,
    val pageSize: Int = 100,
    val error: String? = null,
    val message: String? = null,
)

@HiltViewModel
class FilterBatchDetailViewModel @Inject constructor(
    private val repo: FilterLeadsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(FilterBatchDetailUiState())
    val state: StateFlow<FilterBatchDetailUiState> = _state.asStateFlow()

    private var batchId: Long = 0L

    fun bind(id: Long) {
        if (batchId == id && _state.value.batch != null) return
        batchId = id
        _state.update { FilterBatchDetailUiState(loading = true) }
        load(showSpinner = true)
    }

    fun refresh() = load(showSpinner = false)

    private fun load(showSpinner: Boolean) {
        if (batchId == 0L) return
        _state.update {
            it.copy(
                loading = showSpinner && it.batch == null,
                refreshing = !showSpinner,
                error = null,
            )
        }
        viewModelScope.launch {
            runCatching { repo.batch(batchId) }
                .onSuccess { b ->
                    _state.update {
                        it.copy(loading = false, refreshing = false, batch = b, items = b.items, error = null)
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            error = e.message ?: "Couldn't load this batch",
                        )
                    }
                }
        }
    }

    fun setFilter(f: ItemFilter) = _state.update { it.copy(filter = f, page = 1) }
    fun setSearch(s: String) = _state.update { it.copy(search = s, page = 1) }
    fun setStateFilter(s: Set<String>) = _state.update { it.copy(stateFilter = s, page = 1) }
    fun setCityFilter(c: Set<String>) = _state.update { it.copy(cityFilter = c, page = 1) }
    fun toggleNoCommentsOnly() = _state.update { it.copy(noCommentsOnly = !it.noCommentsOnly, page = 1) }
    fun removeStateFilter(s: String) = _state.update { it.copy(stateFilter = it.stateFilter - s, page = 1) }
    fun removeCityFilter(c: String) = _state.update { it.copy(cityFilter = it.cityFilter - c, page = 1) }
    fun clearAllFilters() = _state.update {
        it.copy(stateFilter = emptySet(), cityFilter = emptySet(), noCommentsOnly = false, page = 1)
    }
    fun clearMessage() = _state.update { it.copy(message = null, error = null) }

    fun setPageSize(size: Int) {
        if (_state.value.pageSize == size) return
        _state.update { it.copy(pageSize = size, page = 1) }
    }
    fun firstPage(totalPages: Int) = goToPage(1, totalPages)
    fun prevPage(totalPages: Int) = goToPage(_state.value.page - 1, totalPages)
    fun nextPage(totalPages: Int) = goToPage(_state.value.page + 1, totalPages)
    fun lastPage(totalPages: Int) = goToPage(totalPages, totalPages)

    private fun goToPage(p: Int, totalPages: Int) {
        val clamped = p.coerceIn(1, totalPages.coerceAtLeast(1))
        if (clamped == _state.value.page) return
        _state.update { it.copy(page = clamped) }
    }

    /**
     * Set an item's verification status. Tapping the already-active state clears
     * it back to pending (matches the web toggle behaviour). Optimistic — the
     * card flips instantly, then reconciles with the server response.
     */
    fun setStatus(item: StagingItemDto, target: StagingStatus) {
        if (item.seeded || item.id in _state.value.savingItemIds) return
        // Mirror the backend's mutual-exclusion rule client-side so the card
        // flips instantly: verified/rejected/pending live on `verified`, while
        // call-not-answered lives on its own boolean and clears `verified`.
        val (optimisticVerified, optimisticCallNotAnswered) = when (target) {
            StagingStatus.VERIFIED -> true to false
            StagingStatus.REJECTED -> false to false
            StagingStatus.PENDING -> null to false
            StagingStatus.CALL_NOT_ANSWERED -> null to true
        }
        _state.update {
            it.copy(
                savingItemIds = it.savingItemIds + item.id,
                error = null,
                message = null,
                items = it.items.map { row ->
                    if (row.id == item.id) row.copy(
                        verified = optimisticVerified,
                        callNotAnswered = optimisticCallNotAnswered,
                    ) else row
                },
            )
        }
        viewModelScope.launch {
            runCatching { repo.setStatus(item.id, target) }
                .onSuccess { updated -> applyUpdatedItem(updated, "Marked ${label(target)}") }
                .onFailure { e -> failItem(item.id, e, "Couldn't update status") }
        }
    }

    fun saveComment(item: StagingItemDto, comment: String) {
        if (item.seeded || item.id in _state.value.savingItemIds) return
        val trimmed = comment.trim()
        // Optimistically reflect the typed note so the card and editor agree
        // instantly; failItem() re-pulls server truth to roll it back on error.
        _state.update {
            it.copy(
                savingItemIds = it.savingItemIds + item.id,
                error = null,
                message = null,
                items = it.items.map { row ->
                    if (row.id == item.id) row.copy(comments = trimmed) else row
                },
            )
        }
        viewModelScope.launch {
            runCatching { repo.setComment(item.id, trimmed) }
                .onSuccess { updated -> applyUpdatedItem(updated, "Comment saved") }
                .onFailure { e -> failItem(item.id, e, "Couldn't save comment") }
        }
    }

    private fun applyUpdatedItem(updated: StagingItemDto, msg: String) {
        _state.update {
            it.copy(
                savingItemIds = it.savingItemIds - updated.id,
                message = msg,
                items = it.items.map { row -> if (row.id == updated.id) updated else row },
            )
        }
    }

    private fun failItem(itemId: Long, e: Throwable, fallback: String) {
        _state.update {
            it.copy(
                savingItemIds = it.savingItemIds - itemId,
                error = e.message?.ifBlank { null } ?: fallback,
            )
        }
        // Re-pull truth so an optimistic flip the server rejected is undone.
        refresh()
    }

    private fun label(s: StagingStatus) = when (s) {
        StagingStatus.VERIFIED -> "Verified"
        StagingStatus.REJECTED -> "Not Verified"
        StagingStatus.PENDING -> "Pending"
        StagingStatus.CALL_NOT_ANSWERED -> "Call Not Answered"
    }
}
