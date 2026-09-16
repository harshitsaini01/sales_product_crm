package com.tutelage.crm.counsellor.ui.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.calls.CallEntity
import com.tutelage.crm.counsellor.data.calls.CallRepository
import com.tutelage.crm.counsellor.data.leadwork.LeadWorkRepository
import com.tutelage.crm.counsellor.data.leadwork.TaskAutoDialerStore
import com.tutelage.crm.counsellor.data.leadwork.TaskLeadDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/**
 * Auto-dialer for a single Calling Task's leads. Reuses the same call
 * pipeline as the normal "Call" button (CallRepository.savePending +
 * ACTION_CALL) so calls are attributed and logged exactly like a manual
 * call — the system-wide PhoneStateReceiver still owns logging/reconcile.
 *
 * Sequencing contract:
 *  - Dial → OFFHOOK (call left our side "idle") → InCall. The dialer NEVER
 *    ends a call on its own: Android gives non-dialer apps no signal for
 *    "remote party answered", so any automatic hang-up is guessing, and a
 *    wrong guess cuts a live conversation. The counsellor hangs up.
 *    Tapping "They answered" only tags the call as connected for the
 *    running tally — it does not change when or whether the call ends.
 *  - The only hang-ups we ever request are the counsellor's own explicit
 *    Skip and Stop.
 *  - Whenever the OS reports IDLE (call actually over, for ANY reason —
 *    hung up by the counsellor or by the other party), we advance to the
 *    next lead, then run the configured gap countdown before dialing again.
 *  - Pause never touches an in-progress call — it only stops the loop from
 *    starting the NEXT call. Stop force-ends any in-progress call attempt
 *    and returns to Setup. Neither ever resets [currentIndex], so
 *    Start/Resume always continues exactly where the queue left off —
 *    nothing gets re-dialed, nothing gets skipped.
 */
sealed class DialerPhase {
    data object Setup : DialerPhase()
    data object Loading : DialerPhase()
    data class Dialing(val lead: TaskLeadDto) : DialerPhase()
    /** Call is up. We cannot tell ringing from connected, and never cut it. */
    data class InCall(val lead: TaskLeadDto, val startedAtMs: Long) : DialerPhase()
    data class Talking(val lead: TaskLeadDto, val startedAtMs: Long) : DialerPhase()
    data class Waiting(val lastLead: TaskLeadDto, val remainingSec: Int, val totalSec: Int) : DialerPhase()
    /** Call ended; reading the real outcome out of the system call log. */
    data class Wrapping(val lastLead: TaskLeadDto) : DialerPhase()
    data object Paused : DialerPhase()
    data object Done : DialerPhase()
    data class Error(val message: String) : DialerPhase()
}

/** What actually happened on the call that just ended, read from the call log. */
data class LastCallOutcome(
    val lead: TaskLeadDto,
    val answered: Boolean,
    val durationSec: Int,
    /** False when the call log never produced a row — outcome is a best guess. */
    val confirmed: Boolean = true,
)

data class AutoDialerUiState(
    val taskTitle: String = "",
    val queue: List<TaskLeadDto> = emptyList(),
    val currentIndex: Int = 0,
    val dialedCount: Int = 0,
    val connectedCount: Int = 0,
    val noAnswerCount: Int = 0,
    val skippedCount: Int = 0,
    /** Wrap-up time after a call that connected — more, because there's more to record. */
    val answeredGapSec: Int = 50,
    /** Wrap-up time after a call nobody picked up — less, there's nothing to write up. */
    val noAnswerGapSec: Int = 30,
    val isRunning: Boolean = false,
    val phase: DialerPhase = DialerPhase.Setup,
    val lastOutcome: LastCallOutcome? = null,
    /** Pending leads the dialer cannot ring because the lead row has no phone
     *  number. They are silently absent from [queue], which used to make the
     *  dialer report "nothing left" while the task still counted them as calls
     *  to do — so it is stated on the Setup panel instead. */
    val unreachableCount: Int = 0,
) {
    val total: Int get() = queue.size
    val remaining: Int get() = (queue.size - currentIndex).coerceAtLeast(0)
    /** Who the dialer will ring next, so the counsellor can prepare during the gap. */
    val nextLead: TaskLeadDto? get() = queue.getOrNull(currentIndex)
}

@HiltViewModel
class TaskAutoDialerViewModel @Inject constructor(
    private val leadWorkRepository: LeadWorkRepository,
    private val callRepository: CallRepository,
    private val resumeStore: TaskAutoDialerStore,
) : ViewModel() {

    /** Batch this VM is bound to — captured on load() so persistence keys stay
     *  scoped to the right task even if the screen is later reused. */
    private var boundBatchId: Long = 0L

    private val _state = MutableStateFlow(AutoDialerUiState())
    val state: StateFlow<AutoDialerUiState> = _state.asStateFlow()

    /** Screen (has Context) places the actual ACTION_CALL. */
    private val _dialRequests = MutableSharedFlow<TaskLeadDto>(extraBufferCapacity = 1)
    val dialRequests: SharedFlow<TaskLeadDto> = _dialRequests.asSharedFlow()

    /** Screen (has Context) performs the actual TelecomManager.endCall().
     *  Emitted ONLY from the counsellor's explicit Skip and Stop — never on a
     *  timer. Nothing in this ViewModel ends a call automatically. */
    private val _hangupRequests = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val hangupRequests: SharedFlow<Unit> = _hangupRequests.asSharedFlow()

    private var loaded = false
    private var gapJob: Job? = null

    /** The lead currently mid-call (Dialing/InCall/Talking), or null when
     *  nothing is in flight. Single source of truth so a hang-up requested
     *  by skip()/stop() can't be double-processed when the real IDLE event
     *  arrives afterward. */
    private var activeCall: TaskLeadDto? = null

    /** deviceCallId of the row for [activeCall], so its outcome can be read back. */
    private var activeDeviceCallId: String? = null

    fun load(batchId: Long) {
        if (loaded) return
        loaded = true
        boundBatchId = batchId
        _state.update { it.copy(phase = DialerPhase.Loading) }
        viewModelScope.launch {
            runCatching { leadWorkRepository.batches() }
                .onSuccess { batches ->
                    val batch = batches.firstOrNull { it.id == batchId }
                    if (batch == null) {
                        _state.update { it.copy(phase = DialerPhase.Error("Task not found")) }
                        return@onSuccess
                    }
                    val pendingItems = batch.items.filter { it.completedAt == null }
                    val queue = pendingItems
                        // Fold the item's call metrics onto the lead so the
                        // cards can render "3 attempts · last no-answer 2h
                        // ago" without extra plumbing.
                        .map { item ->
                            item.lead.copy(
                                callAttempts = item.callAttempts,
                                lastCallAt = item.lastCallAt,
                                lastCallDurationSec = item.lastCallDurationSec,
                                lastCallOutcome = item.lastCallOutcome,
                                totalCallDurationSec = item.totalCallDurationSec,
                            )
                        }
                        .filter { !it.mobile.isNullOrBlank() }
                    // Leads the task still counts but the dialer physically
                    // can't ring. Surfaced rather than dropped — see
                    // [AutoDialerUiState.unreachableCount].
                    val unreachable = pendingItems.count { it.lead.mobile.isNullOrBlank() }
                    // Restore the last position. We saved a LEAD ID (not an
                    // index) precisely because the queue shrinks as the backend
                    // finalises calls — a saved index would drift onto the
                    // wrong lead. If the saved lead has since been completed
                    // (or otherwise fell out of the queue) we resume at 0,
                    // which is the top of what still needs calling — never
                    // back at the very first lead of the original list.
                    val savedLeadId = resumeStore.nextLeadId(batchId)
                    val resumeIndex = if (savedLeadId != null) {
                        queue.indexOfFirst { it.id == savedLeadId }.let { if (it < 0) 0 else it }
                    } else 0
                    _state.update {
                        it.copy(
                            taskTitle = batch.title,
                            queue = queue,
                            currentIndex = resumeIndex,
                            unreachableCount = unreachable,
                            phase = DialerPhase.Setup,
                        )
                    }
                    if (queue.isEmpty()) {
                        resumeStore.clear(batchId)
                        _state.update { it.copy(phase = DialerPhase.Done) }
                    }
                }
                .onFailure { e ->
                    _state.update { it.copy(phase = DialerPhase.Error(e.message ?: "Couldn't load this task's leads")) }
                }
        }
    }

    fun setAnsweredGapSec(sec: Int) = _state.update { it.copy(answeredGapSec = sec.coerceIn(5, 300)) }
    fun setNoAnswerGapSec(sec: Int) = _state.update { it.copy(noAnswerGapSec = sec.coerceIn(5, 300)) }

    /** Skip the remaining wrap-up time and ring the next lead right now. */
    fun callNow() {
        gapJob?.cancel(); gapJob = null
        if (!_state.value.isRunning) _state.update { it.copy(isRunning = true) }
        if (activeCall == null) dialCurrentOrFinish()
    }

    /** Start (Setup/Done) or resume (Paused/after a call ended). Never
     *  re-dials a call that's still actually in progress. */
    fun start() {
        if (_state.value.isRunning) return
        _state.update { it.copy(isRunning = true) }
        if (activeCall == null) dialCurrentOrFinish()
        // else: a real call is still active — it'll continue on its own;
        // onCallIdle() will pick the loop back up once it ends.
    }

    /** Stops the loop from starting the NEXT call. Does NOT touch a call
     *  that's already in progress — that's a real phone call the counsellor
     *  is on; we just won't auto-advance until Resume. */
    fun pause() {
        gapJob?.cancel(); gapJob = null
        _state.update {
            val midCall = activeCall != null
            it.copy(isRunning = false, phase = if (midCall) it.phase else DialerPhase.Paused)
        }
    }

    /** Harder stop — also force-ends any call currently in flight and
     *  returns to the Setup screen. [currentIndex] is untouched, so tapping
     *  "Start Auto Dialing" again on Setup continues from the same lead. */
    fun stop() {
        gapJob?.cancel(); gapJob = null

        val wasActive = activeCall != null
        activeCall = null; activeDeviceCallId = null
        _state.update { it.copy(isRunning = false, phase = DialerPhase.Setup) }
        if (wasActive) viewModelScope.launch { _hangupRequests.emit(Unit) }
    }

    /** Manually skip the current lead. If a call is in flight, force-ends it
     *  first (with a short settle delay) before moving on — otherwise we'd
     *  try to dial the next lead while the old call is still connected. */
    fun skip() {
        gapJob?.cancel(); gapJob = null

        if (_state.value.currentIndex >= _state.value.queue.size) return
        val wasActive = activeCall != null
        activeCall = null; activeDeviceCallId = null
        _state.update { it.copy(currentIndex = it.currentIndex + 1, skippedCount = it.skippedCount + 1) }
        saveResumePoint()
        if (!_state.value.isRunning) return
        if (wasActive) {
            viewModelScope.launch {
                _hangupRequests.emit(Unit)
                delay(1_500) // let the OS actually tear the call down first
                if (_state.value.isRunning) dialCurrentOrFinish()
            }
        } else {
            dialCurrentOrFinish()
        }
    }

    /** Counsellor heard the callee say "Hello?" — tags this call as connected
     *  for the running tally. Purely a label: it does not affect when the call
     *  ends, since nothing here ever ends a call. */
    fun confirmAnswered() {
        val phase = _state.value.phase as? DialerPhase.InCall ?: return
        _state.update {
            it.copy(
                phase = DialerPhase.Talking(phase.lead, phase.startedAtMs),
                connectedCount = it.connectedCount + 1,
            )
        }
    }

    private fun dialCurrentOrFinish() {
        val s = _state.value
        val lead = s.queue.getOrNull(s.currentIndex)
        if (lead == null) {
            // Batch is finished — drop the resume marker so a fresh assignment
            // of the same batch id (unlikely but possible) doesn't inherit a
            // stale pointer that would sit past the new queue's end.
            if (boundBatchId > 0) resumeStore.clear(boundBatchId)
            _state.update { it.copy(isRunning = false, phase = DialerPhase.Done) }
            return
        }
        val phone = lead.mobile
        if (phone.isNullOrBlank()) {
            skip()
            return
        }
        activeCall = lead
        // Held so we can look this exact row up again once the call ends and read
        // the duration PhoneStateReceiver back-fills from the system call log.
        val deviceCallId = "auto_${System.currentTimeMillis()}_${UUID.randomUUID()}"
        activeDeviceCallId = deviceCallId
        _state.update { it.copy(phase = DialerPhase.Dialing(lead), dialedCount = it.dialedCount + 1) }
        viewModelScope.launch {
            runCatching {
                callRepository.savePending(
                    CallEntity(
                        deviceCallId = deviceCallId,
                        leadId = lead.id,
                        phoneNumber = phone,
                        direction = "OUTGOING",
                        status = "RINGING",
                        startedAt = System.currentTimeMillis(),
                        source = "IN_APP",
                    ),
                )
            }
            _dialRequests.emit(lead)
        }
    }

    /**
     * Waits for the call row to be finalized with a real duration.
     *
     * PhoneStateReceiver reconciles against the system call log about two seconds
     * after the call ends, so the row is briefly still open — poll until it lands
     * rather than reading a half-written row. A call with any duration at all was
     * picked up; a zero-duration outgoing call was not. If the log never produces
     * a row we fall back to "not answered" and mark the outcome unconfirmed, so
     * the UI can say so instead of asserting something it doesn't know.
     */
    private suspend fun awaitOutcome(lead: TaskLeadDto, deviceCallId: String?): LastCallOutcome {
        if (deviceCallId == null) return LastCallOutcome(lead, answered = false, durationSec = 0, confirmed = false)
        repeat(OUTCOME_POLL_ATTEMPTS) {
            val row = runCatching { callRepository.byDeviceCallId(deviceCallId) }.getOrNull()
            if (row?.endedAt != null) {
                return LastCallOutcome(
                    lead = lead,
                    answered = row.durationSec > 0,
                    durationSec = row.durationSec,
                )
            }
            delay(OUTCOME_POLL_INTERVAL_MS)
        }
        return LastCallOutcome(lead, answered = false, durationSec = 0, confirmed = false)
    }

    /** Screen's telephony listener — call left our side "idle" (dialing out
     *  / ringing / connected all look identical from here). No timer is
     *  started: the call runs until the counsellor ends it. */
    fun onCallOffHook() {
        val lead = activeCall ?: return
        if (_state.value.phase !is DialerPhase.Dialing) return // already processed
        _state.update { it.copy(phase = DialerPhase.InCall(lead, System.currentTimeMillis())) }
    }


    /** Screen's telephony listener — the call is genuinely over (however it
     *  ended). Single place that advances the queue. */
    fun onCallIdle() {
        val lead = activeCall ?: return // already handled by skip()/stop()
        val deviceCallId = activeDeviceCallId
        activeCall = null; activeDeviceCallId = null
        _state.update { it.copy(currentIndex = it.currentIndex + 1) }
        saveResumePoint()

        gapJob?.cancel()
        gapJob = viewModelScope.launch {
            _state.update { it.copy(phase = DialerPhase.Wrapping(lead)) }
            val outcome = awaitOutcome(lead, deviceCallId)
            // Tally from what actually happened rather than what anyone tapped.
            // Talking already counted this call as connected, so don't double it.
            val alreadyTagged = _state.value.phase is DialerPhase.Talking
            _state.update {
                it.copy(
                    lastOutcome = outcome,
                    connectedCount = if (outcome.answered && !alreadyTagged) it.connectedCount + 1 else it.connectedCount,
                    noAnswerCount = if (!outcome.answered) it.noAnswerCount + 1 else it.noAnswerCount,
                )
            }
            if (!_state.value.isRunning) {
                _state.update { it.copy(phase = DialerPhase.Paused) }
                return@launch
            }
            // A call that connected earns the longer wrap-up; one that nobody
            // picked up has nothing to write up, so the queue moves on sooner.
            val gap = if (outcome.answered) _state.value.answeredGapSec else _state.value.noAnswerGapSec
            for (secLeft in gap downTo 1) {
                if (!_state.value.isRunning) return@launch
                _state.update { it.copy(phase = DialerPhase.Waiting(lead, secLeft, gap)) }
                delay(1_000)
            }
            if (_state.value.isRunning) dialCurrentOrFinish()
        }
    }

    /** Save the id of the lead we should ring next (queue[currentIndex]).
     *  Called after every queue advance so leaving the screen and coming back
     *  resumes at the same lead — the batch-id-scoped SharedPreferences entry
     *  outlives ViewModel destruction. Cleared when the queue is exhausted. */
    private fun saveResumePoint() {
        if (boundBatchId <= 0L) return
        val s = _state.value
        val next = s.queue.getOrNull(s.currentIndex)?.id
        resumeStore.setNextLeadId(boundBatchId, next)
    }

    override fun onCleared() {
        gapJob?.cancel()
        super.onCleared()
    }

    private companion object {
        // ~8s of polling: the receiver reconciles about 2s after IDLE, but a busy
        // device or a slow OEM call-log write can take noticeably longer.
        const val OUTCOME_POLL_ATTEMPTS = 16
        const val OUTCOME_POLL_INTERVAL_MS = 500L
    }
}
