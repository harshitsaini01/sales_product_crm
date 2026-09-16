package com.tutelage.crm.counsellor.ui.followups

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.dashboard.DashboardApi
import com.tutelage.crm.counsellor.data.dashboard.FollowupLeadDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FollowupsListState(
    val bucket: String = "today",
    val query: String = "",
    val loading: Boolean = true,
    val leads: List<FollowupLeadDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class FollowupsListViewModel @Inject constructor(
    private val api: DashboardApi,
) : ViewModel() {

    private val _state = MutableStateFlow(FollowupsListState())
    val state: StateFlow<FollowupsListState> = _state.asStateFlow()

    private var searchJob: Job? = null

    /** The in-flight fetch. Untracked before, so a slow older query could land
     *  after a fast newer one and leave the list showing stale results. */
    private var loadJob: Job? = null

    fun bind(bucket: String) {
        if (_state.value.bucket == bucket && _state.value.leads.isNotEmpty()) return
        _state.update { it.copy(bucket = bucket, loading = true) }
        load()
    }

    fun setQuery(q: String) {
        _state.update { it.copy(query = q) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            load()
        }
    }

    private fun load() {
        val bucket = _state.value.bucket
        val q = _state.value.query.trim().ifBlank { null }
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            runCatching {
                when (bucket) {
                    "overdue" -> api.overdueFollowups(q)
                    "upcoming" -> api.upcomingFollowups(q)
                    else -> api.todayFollowups(q)
                }
            }
                // Belt-and-braces on top of the cancel: only apply a result
                // that still matches what the user is looking at.
                .onSuccess { v ->
                    _state.update {
                        if (it.bucket != bucket || it.query.trim().ifBlank { null } != q) it
                        else it.copy(loading = false, leads = v)
                    }
                }
                .onFailure { e ->
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    _state.update { it.copy(loading = false, error = e.message) }
                }
        }
    }
}
