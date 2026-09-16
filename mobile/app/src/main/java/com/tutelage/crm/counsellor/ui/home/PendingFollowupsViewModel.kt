package com.tutelage.crm.counsellor.ui.home

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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

enum class FollowupBucket { TODAY, OVERDUE, UPCOMING }

data class PendingFollowupsUiState(
    val active: FollowupBucket = FollowupBucket.TODAY,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    /** Lead list keyed by bucket so switching tabs feels instant (we keep
     *  whichever buckets we've already loaded). */
    val byBucket: Map<FollowupBucket, List<FollowupLeadDto>> = emptyMap(),
    val error: String? = null,
)

@HiltViewModel
class PendingFollowupsViewModel @Inject constructor(
    private val api: DashboardApi,
) : ViewModel() {
    private val _state = MutableStateFlow(PendingFollowupsUiState())
    val state: StateFlow<PendingFollowupsUiState> = _state.asStateFlow()

    private var pollingJob: Job? = null

    init {
        // Pull all three buckets up-front so tab switches don't show a spinner.
        loadBucket(FollowupBucket.TODAY, silent = false)
        loadBucket(FollowupBucket.OVERDUE, silent = true)
        loadBucket(FollowupBucket.UPCOMING, silent = true)

        // Live refresh — every 15s we re-pull the currently-active bucket
        // so a counsellor who just changed a followup-date in another tab
        // sees it disappear without needing to refresh.
        pollingJob = viewModelScope.launch {
            AppForeground.pollWhileForeground(30_000) {
                loadBucket(_state.value.active, silent = true)
            }
        }
    }

    override fun onCleared() {
        pollingJob?.cancel()
        super.onCleared()
    }

    fun selectBucket(b: FollowupBucket) {
        if (_state.value.active == b) return
        _state.update { it.copy(active = b, error = null) }
        // If we don't have the bucket cached yet, load it.
        if (_state.value.byBucket[b] == null) {
            loadBucket(b, silent = false)
        } else {
            // Have cached rows — fire a silent refresh in the background.
            loadBucket(b, silent = true)
        }
    }

    private fun loadBucket(bucket: FollowupBucket, silent: Boolean) {
        _state.update {
            it.copy(
                loading = !silent && it.byBucket[bucket].isNullOrEmpty(),
                refreshing = silent || it.byBucket[bucket]?.isNotEmpty() == true,
            )
        }
        viewModelScope.launch {
            runCatching {
                when (bucket) {
                    FollowupBucket.TODAY -> api.todayFollowups()
                    FollowupBucket.OVERDUE -> api.overdueFollowups()
                    FollowupBucket.UPCOMING -> api.upcomingFollowups()
                }
            }
                .onSuccess { leads ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            byBucket = it.byBucket + (bucket to leads),
                            error = null,
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            error = e.message?.takeIf { m -> m.isNotBlank() }
                                ?: "Couldn't load followups",
                        )
                    }
                }
        }
    }
}
