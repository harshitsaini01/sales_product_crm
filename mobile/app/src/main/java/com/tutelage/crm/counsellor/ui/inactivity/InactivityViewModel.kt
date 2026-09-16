package com.tutelage.crm.counsellor.ui.inactivity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.activity.ActivityRepository
import com.tutelage.crm.counsellor.data.activity.InactivityStatusDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import timber.log.Timber
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

/**
 * Polls /api/mobile/activity/status every [POLL_INTERVAL_MS]. Surfaces three
 * pieces of state to Compose:
 *
 *  - [status]               — latest server snapshot, drives the overlay.
 *  - [warningEvents]        — fires once per warning crossing so the UI can
 *                             show a snackbar without re-firing every poll.
 *  - [lastErrorMessage]     — non-fatal; the overlay just stays in its last
 *                             known state if the server is unreachable.
 */
@HiltViewModel
class InactivityViewModel @Inject constructor(
    private val repo: ActivityRepository,
) : ViewModel() {

    private val _status = MutableStateFlow<InactivityStatusDto?>(null)
    val status: StateFlow<InactivityStatusDto?> = _status.asStateFlow()

    private val _warningEvents = MutableStateFlow(0)
    val warningEvents: StateFlow<Int> = _warningEvents.asStateFlow()

    private val _isAcking = MutableStateFlow(false)
    val isAcking: StateFlow<Boolean> = _isAcking.asStateFlow()

    private var lastSeenStage: String? = null

    init {
        viewModelScope.launch {
            // Interval unchanged: this one drives a compliance overlay and has
            // to stay responsive. Foreground-gated only — a backgrounded app
            // cannot be "idle at the screen" in the sense this measures.
            AppForeground.pollWhileForeground(POLL_INTERVAL_MS, runImmediately = true) { refresh() }
        }
    }

    private suspend fun refresh() {
        repo.status().onSuccess { s ->
            _status.value = s
            // Bump the warning counter only on a fresh transition into 'warning'
            // (or higher) — we don't want to spam the snackbar every 30s.
            if (s.stage == "warning" && lastSeenStage != "warning") {
                _warningEvents.value = _warningEvents.value + 1
            }
            if (s.stage == "ok") {
                // Reset so the next idle period gets a new warning toast.
                lastSeenStage = null
            } else {
                lastSeenStage = s.stage
            }
        }.onFailure { Timber.w(it, "[inactivity] status fetch failed") }
    }

    /** Called when the user taps "Mark as Read" inside the dialog. */
    fun acknowledge() {
        viewModelScope.launch {
            _isAcking.value = true
            repo.ack()
                .onSuccess {
                    // Refresh immediately so the dialog closes without waiting
                    // for the next poll tick.
                    refresh()
                }
                .onFailure { Timber.w(it, "[inactivity] ack failed") }
            _isAcking.value = false
        }
    }

    /** Called on app foreground or explicit "I'm here" gestures. */
    fun ping() {
        viewModelScope.launch {
            repo.ping().onFailure { Timber.d(it, "[inactivity] ping failed (ignored)") }
            refresh()
        }
    }

    companion object {
        private const val POLL_INTERVAL_MS = 30_000L
    }
}
