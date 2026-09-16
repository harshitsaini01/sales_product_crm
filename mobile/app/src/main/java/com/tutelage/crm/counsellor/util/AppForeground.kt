package com.tutelage.crm.counsellor.util

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive

/**
 * Whether the app is in the foreground, and a poll loop that respects it.
 *
 * Every screen polls on its own timer from `viewModelScope`, and viewModelScope
 * is tied to the ViewModel, not to visibility — so those loops kept firing while
 * the app sat in the background. On the Home tab alone that was four concurrent
 * loops (overview 12s, followups 15s, inactivity 30s, update check 60s) on top
 * of a 30s location upload: roughly 5-7 requests a minute per counsellor, all
 * day, whether or not anyone was looking at the screen. Multiplied across a
 * field team that is most of the API's traffic, and a real share of the battery.
 *
 * [pollWhileForeground] suspends rather than sleeping-and-discarding, so a
 * backgrounded app issues no requests at all and resumes promptly on return.
 * The foreground flag is fed by CounsellorApp's existing ProcessLifecycleOwner
 * observer.
 */
object AppForeground {

    private val _isForeground = MutableStateFlow(true)
    val isForeground: StateFlow<Boolean> = _isForeground.asStateFlow()

    fun set(foreground: Boolean) { _isForeground.value = foreground }

    /**
     * Run [block] every [intervalMs], but only while the app is visible.
     *
     * @param runImmediately fetch once up front (the usual "populate on entry"
     *   behaviour) before the first delay.
     */
    suspend fun pollWhileForeground(
        intervalMs: Long,
        runImmediately: Boolean = false,
        block: suspend () -> Unit,
    ) {
        if (runImmediately) {
            isForeground.first { it }
            block()
        }
        while (currentCoroutineContext().isActive) {
            delay(intervalMs)
            // Parks the coroutine for free while backgrounded; no timer, no
            // request, no wakeup — and resumes the moment we're visible again.
            isForeground.first { it }
            block()
        }
    }
}
