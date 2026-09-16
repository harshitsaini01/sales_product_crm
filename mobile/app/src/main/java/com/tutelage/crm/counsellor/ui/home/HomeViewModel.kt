package com.tutelage.crm.counsellor.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.dashboard.DashboardApi
import com.tutelage.crm.counsellor.data.dashboard.HomeOverviewDto
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

data class HomeUiState(
    /** True only on the very first load when no data is yet available. */
    val loading: Boolean = false,
    /** True during silent background polls — UI shows a slim progress strip
     *  inside the hero rather than a full-screen spinner. */
    val refreshing: Boolean = false,
    val data: HomeOverviewDto? = null,
    val error: String? = null,
    val userName: String? = null,
    val lastRefreshedAtMs: Long? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val api: DashboardApi,
    tokenStore: TokenStore,
) : ViewModel() {
    private val _state = MutableStateFlow(HomeUiState(userName = tokenStore.userName))
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    private var pollingJob: Job? = null

    init {
        refresh()
        // 12s cadence so newly-synced calls (from system dialer + receiver) and
        // freshly-assigned leads appear on the home almost immediately. The
        // refresh is silent (no spinner — just the hero's progress strip) so
        // it doesn't feel disruptive.
        pollingJob = viewModelScope.launch {
            // 12s was the most aggressive poller in the app and ran while
            // backgrounded too. 30s + foreground-gated.
            AppForeground.pollWhileForeground(30_000) { refresh(silent = true) }
        }
    }

    override fun onCleared() {
        pollingJob?.cancel()
        super.onCleared()
    }

    /** Public entry-point used by the hero "refresh" tap. */
    fun refresh() = refresh(silent = false)

    /** The in-flight fetch, so a manual refresh can pre-empt a silent poll. */
    private var fetchJob: Job? = null

    private fun refresh(silent: Boolean) {
        // A silent poll defers to whatever is already running. A user tap wins:
        // it cancels the in-flight fetch and starts its own. Previously both
        // bailed on `refreshing`, so tapping refresh while a poll was mid-flight
        // did nothing at all — and a request hanging toward the 60s read timeout
        // made every tap a no-op for that whole window.
        if (silent && fetchJob?.isActive == true) return
        if (!silent) fetchJob?.cancel()
        _state.update {
            it.copy(
                loading = !silent && it.data == null,
                refreshing = true,
                error = null,
            )
        }
        fetchJob = viewModelScope.launch {
            runCatching { api.homeOverview() }
                .onSuccess { d ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            data = d,
                            lastRefreshedAtMs = System.currentTimeMillis(),
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            error = e.message?.takeIf { m -> m.isNotBlank() }
                                ?: "Couldn't load — will retry",
                        )
                    }
                }
        }
    }
}
