package com.tutelage.crm.counsellor.ui.bucket

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.leads.BucketLeadDto
import com.tutelage.crm.counsellor.data.leads.LeadApi
import com.tutelage.crm.counsellor.data.leads.BucketClaimBody
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

val BUCKET_PAGE_SIZES = listOf(10, 50, 100, 500)

data class BucketUiState(
    val loading: Boolean = true, val refreshing: Boolean = false, val claiming: Boolean = false,
    val error: String? = null, val rows: List<BucketLeadDto> = emptyList(), val total: Int = 0,
    val page: Int = 1, val pageSize: Int = 50, val totalPages: Int = 1, val selected: Set<Long> = emptySet(),
    val query: String = "", val flagMode: Boolean = false, val websites: List<String> = emptyList(), val sources: List<String> = emptyList(), val events: List<String> = emptyList(), val website: String = "", val source: String = "", val event: String = "",
    val fromDate: String = "", val toDate: String = "", val filtersExpanded: Boolean = false,
)
@HiltViewModel
class BucketViewModel @Inject constructor(private val api: LeadApi) : ViewModel() {
    private val _state = MutableStateFlow(BucketUiState())
    val state: StateFlow<BucketUiState> = _state.asStateFlow()
    private var searchJob: Job? = null
    init { load(true) }
    fun refresh() = load(false)
    fun setFlagMode(value: Boolean) { _state.update { it.copy(flagMode=value,page=1,selected=emptySet()) }; load(false) }
    fun setQuery(v: String) { _state.update { it.copy(query=v, page=1) }; debounce() }
    fun setWebsite(v: String) { _state.update { it.copy(website=v, page=1) }; debounce() }
    fun setSource(v: String) { _state.update { it.copy(source=v, page=1) }; debounce() }
    fun setEvent(v: String) { _state.update { it.copy(event=v, page=1) }; debounce() }
    fun setFromDate(v: String) { _state.update { it.copy(fromDate=v, page=1) }; load(false) }
    fun setToDate(v: String) { _state.update { it.copy(toDate=v, page=1) }; load(false) }
    fun toggleFilters() = _state.update { it.copy(filtersExpanded = !it.filtersExpanded) }
    fun clearFilters() = _state.update { it.copy(query="",website="",source="",event="",fromDate="",toDate="",page=1) }.also { load(false) }
    fun setPageSize(v: Int) { _state.update { it.copy(pageSize=v,page=1,selected=emptySet()) }; load(false) }
    fun previousPage() { if (state.value.page > 1) { _state.update { it.copy(page=it.page-1,selected=emptySet()) }; load(false) } }
    fun nextPage() { if (state.value.page < state.value.totalPages) { _state.update { it.copy(page=it.page+1,selected=emptySet()) }; load(false) } }
    fun toggle(id: Long) = _state.update { it.copy(selected=if(id in it.selected) it.selected-id else it.selected+id) }
    fun toggleAll() = _state.update { val ids=it.rows.map { row -> row.id }.toSet(); it.copy(selected=if(ids.isNotEmpty()&&ids.all { id -> id in it.selected }) emptySet() else ids) }
    fun claimSelected() {
        val ids=state.value.selected.toList(); if(ids.isEmpty()||state.value.claiming)return
        _state.update { it.copy(claiming=true,error=null) }
        viewModelScope.launch { runCatching { api.claimBucket(BucketClaimBody(ids)) }.onSuccess { load(false) }.onFailure { e -> _state.update { it.copy(claiming=false,error=e.message?:"Could not assign leads") } } }
    }
    private fun debounce() { searchJob?.cancel(); searchJob=viewModelScope.launch { delay(350); load(false) } }
    private fun load(initial: Boolean) {
        val s=state.value
        _state.update { it.copy(loading=initial&&it.rows.isEmpty(),refreshing=!initial,error=null) }
        viewModelScope.launch { runCatching { api.bucketFacets(if(state.value.flagMode)"1" else null) }.onSuccess { f -> _state.update { it.copy(websites=f.websites.map { x -> x.value }, sources=f.sources.map { x -> x.value }, events=f.events.map { x -> x.value }) } } }
        viewModelScope.launch { runCatching { api.bucket(s.page,s.pageSize,s.query.trim().ifBlank{null},s.website.trim().ifBlank{null},s.source.trim().ifBlank{null},s.event.trim().ifBlank{null},s.fromDate.ifBlank{null},s.toDate.ifBlank{null},if(s.flagMode)"1" else null) }.onSuccess { page -> _state.update { it.copy(loading=false,refreshing=false,claiming=false,rows=page.rows,total=page.total,page=page.page,totalPages=page.totalPages,selected=it.selected.intersect(page.rows.map { row -> row.id }.toSet())) } }.onFailure { e -> _state.update { it.copy(loading=false,refreshing=false,claiming=false,error=e.message?:"Could not load bucket") } } }
    }
}