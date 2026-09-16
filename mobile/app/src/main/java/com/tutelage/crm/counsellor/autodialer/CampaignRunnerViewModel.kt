// ===== AUTO-DIALER DISABLED (feature no longer in use) =====
// The entire file below is commented out. Wiring was also removed/commented in:
//   MainScreen.kt (nav route), HomeScreen.kt (AutoDialerCard), NetworkModule.kt
//   (provideAutoDialerApi), AndroidManifest.xml (CampaignRunnerActivity).
// To re-enable: strip the leading '// ' from each line and restore that wiring.
// ============================================================

// package com.tutelage.crm.counsellor.autodialer
//
// import androidx.lifecycle.ViewModel
// import androidx.lifecycle.viewModelScope
// import com.tutelage.crm.counsellor.data.autodialer.AutoDialerApi
// import com.tutelage.crm.counsellor.data.autodialer.B2bContactDto
// import com.tutelage.crm.counsellor.data.autodialer.CampaignDto
// import com.tutelage.crm.counsellor.data.autodialer.RecordingMetaDto
// import dagger.hilt.android.lifecycle.HiltViewModel
// import kotlinx.coroutines.Job
// import kotlinx.coroutines.delay
// import kotlinx.coroutines.flow.MutableStateFlow
// import kotlinx.coroutines.flow.StateFlow
// import kotlinx.coroutines.flow.asStateFlow
// import kotlinx.coroutines.launch
// import timber.log.Timber
// import javax.inject.Inject
//
// sealed class RunnerPhase {
//     object Idle : RunnerPhase()
//     object FetchingNext : RunnerPhase()
//     data class Dialing(val contact: B2bContactDto, val campaignContactId: Long, val recording: RecordingMetaDto?) : RunnerPhase()
//     data class InCall(val contact: B2bContactDto, val campaignContactId: Long, val startedAtMs: Long) : RunnerPhase()
//     data class Waiting(val remainingSec: Int, val nextEta: Long) : RunnerPhase()
//     object Paused : RunnerPhase()
//     data class Done(val message: String) : RunnerPhase()
//     data class Error(val message: String) : RunnerPhase()
// }
//
// data class RunnerState(
//     val campaign: CampaignDto? = null,
//     val phase: RunnerPhase = RunnerPhase.Idle,
//     val dialedCount: Int = 0,
//     val connectedCount: Int = 0,
//     val skippedCount: Int = 0,
//     val isRunning: Boolean = false,
// )
//
// @HiltViewModel
// class CampaignRunnerViewModel @Inject constructor(
//     private val api: AutoDialerApi,
// ) : ViewModel() {
//
//     private val _state = MutableStateFlow(RunnerState())
//     val state: StateFlow<RunnerState> = _state.asStateFlow()
//
//     private var campaignId: Long = -1L
//     private var loopJob: Job? = null
//     private var countdownJob: Job? = null
//
//     fun init(id: Long) {
//         if (campaignId == id && _state.value.campaign != null) return
//         campaignId = id
//         viewModelScope.launch {
//             runCatching { api.campaign(id) }
//                 .onSuccess { _state.value = _state.value.copy(campaign = it) }
//                 .onFailure { Timber.e(it, "Failed to load campaign $id") }
//         }
//     }
//
//     fun start() {
//         if (_state.value.isRunning) return
//         _state.value = _state.value.copy(isRunning = true, phase = RunnerPhase.FetchingNext)
//         // The activity drives the loop by calling fetchNext() and reportXxx() —
//         // the VM exposes the state transitions; phone-state events come from
//         // PhoneStateReceiver via the activity. Recording playback is also
//         // owned by the activity (needs Android Context).
//     }
//
//     fun pause() {
//         loopJob?.cancel()
//         countdownJob?.cancel()
//         _state.value = _state.value.copy(isRunning = false, phase = RunnerPhase.Paused)
//     }
//
//     fun resume() {
//         if (_state.value.isRunning) return
//         _state.value = _state.value.copy(isRunning = true, phase = RunnerPhase.FetchingNext)
//     }
//
//     fun stop() {
//         loopJob?.cancel()
//         countdownJob?.cancel()
//         _state.value = _state.value.copy(isRunning = false, phase = RunnerPhase.Done("Stopped by user"))
//     }
//
//     suspend fun fetchNext(): RunnerPhase {
//         return try {
//             val resp = api.next(campaignId)
//             if (resp.done || resp.contact == null || resp.campaignContactId == null) {
//                 _state.value = _state.value.copy(
//                     isRunning = false,
//                     phase = RunnerPhase.Done("All contacts done — ${resp.remaining} pending"),
//                 )
//                 RunnerPhase.Done("Done")
//             } else {
//                 val phase = RunnerPhase.Dialing(resp.contact, resp.campaignContactId, resp.recording)
//                 _state.value = _state.value.copy(phase = phase)
//                 phase
//             }
//         } catch (e: Exception) {
//             Timber.e(e, "fetchNext failed")
//             _state.value = _state.value.copy(isRunning = false, phase = RunnerPhase.Error(e.message ?: "Network error"))
//             RunnerPhase.Error("Failed")
//         }
//     }
//
//     fun onCallStarted(contact: B2bContactDto, campaignContactId: Long) {
//         _state.value = _state.value.copy(
//             phase = RunnerPhase.InCall(contact, campaignContactId, System.currentTimeMillis()),
//             dialedCount = _state.value.dialedCount + 1,
//         )
//     }
//
//     fun onCallConnected() {
//         _state.value = _state.value.copy(connectedCount = _state.value.connectedCount + 1)
//     }
//
//     fun startCountdown(gapSec: Int, onComplete: () -> Unit) {
//         countdownJob?.cancel()
//         val end = System.currentTimeMillis() + gapSec * 1000L
//         countdownJob = viewModelScope.launch {
//             for (i in gapSec downTo 1) {
//                 if (!_state.value.isRunning) return@launch
//                 _state.value = _state.value.copy(phase = RunnerPhase.Waiting(i, end))
//                 delay(1000)
//             }
//             if (_state.value.isRunning) onComplete()
//         }
//     }
//
//     fun cancelCountdown() {
//         countdownJob?.cancel()
//     }
//
//     fun skip(contactId: Long) {
//         viewModelScope.launch {
//             runCatching { api.skip(campaignId, contactId) }
//             _state.value = _state.value.copy(skippedCount = _state.value.skippedCount + 1)
//         }
//     }
// }
//
