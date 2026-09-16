// ===== AUTO-DIALER DISABLED (feature no longer in use) =====
// The entire file below is commented out. Wiring was also removed/commented in:
//   MainScreen.kt (nav route), HomeScreen.kt (AutoDialerCard), NetworkModule.kt
//   (provideAutoDialerApi), AndroidManifest.xml (CampaignRunnerActivity).
// To re-enable: strip the leading '// ' from each line and restore that wiring.
// ============================================================

// package com.tutelage.crm.counsellor.autodialer
//
// import android.Manifest
// import android.content.BroadcastReceiver
// import android.content.Context
// import android.content.Intent
// import android.content.IntentFilter
// import android.content.pm.PackageManager
// import android.media.AudioAttributes
// import android.media.AudioDeviceInfo
// import android.media.AudioFocusRequest
// import android.media.AudioManager
// import android.media.MediaPlayer
// import android.net.Uri
// import android.os.Build
// import android.os.Bundle
// import android.telecom.TelecomManager
// import android.telephony.PhoneStateListener
// import android.telephony.TelephonyCallback
// import android.telephony.TelephonyManager
// import androidx.annotation.RequiresApi
// import androidx.activity.ComponentActivity
// import androidx.activity.compose.setContent
// import androidx.activity.result.contract.ActivityResultContracts
// import androidx.activity.viewModels
// import androidx.compose.foundation.background
// import androidx.compose.foundation.layout.*
// import androidx.compose.foundation.shape.CircleShape
// import androidx.compose.foundation.shape.RoundedCornerShape
// import androidx.compose.material.icons.Icons
// import androidx.compose.material.icons.filled.*
// import androidx.compose.material3.*
// import androidx.compose.runtime.*
// import androidx.compose.ui.Alignment
// import androidx.compose.ui.Modifier
// import androidx.compose.ui.draw.clip
// import androidx.compose.ui.graphics.Color
// import androidx.compose.ui.text.font.FontWeight
// import androidx.compose.ui.unit.dp
// import androidx.compose.ui.unit.sp
// import androidx.core.content.ContextCompat
// import androidx.lifecycle.compose.collectAsStateWithLifecycle
// import androidx.lifecycle.lifecycleScope
// import com.tutelage.crm.counsellor.BuildConfig
// import com.tutelage.crm.counsellor.data.auth.TokenStore
// import com.tutelage.crm.counsellor.data.autodialer.B2bContactDto
// import com.tutelage.crm.counsellor.data.calls.CallDao
// import com.tutelage.crm.counsellor.data.calls.CallEntity
// import com.tutelage.crm.counsellor.ui.theme.TutelageTheme
// import com.tutelage.crm.counsellor.work.CallSyncWorker
// import dagger.hilt.android.AndroidEntryPoint
// import kotlinx.coroutines.Dispatchers
// import kotlinx.coroutines.Job
// import kotlinx.coroutines.delay
// import kotlinx.coroutines.launch
// import kotlinx.coroutines.withContext
// import okhttp3.OkHttpClient
// import okhttp3.Request
// import timber.log.Timber
// import java.io.File
// import java.util.UUID
// import javax.inject.Inject
//
// /**
//  * Auto-dialer runner.
//  *
//  *  Flow (auto-starts on open):
//  *    permissions → fetch next → dial via ACTION_CALL → OFFHOOK detected
//  *    (TelephonyCallback / PHONE_STATE broadcast) → wait POST_OFFHOOK_DELAY_MS
//  *    → speakerphone on + MediaPlayer plays recording → onCompletion →
//  *    TelecomManager.endCall() auto-hangup → IDLE → finalize → wait gap →
//  *    fetch next → loop.
//  *
//  *  Hard limit: we cannot detect remote-party answer without the system-
//  *  dialer role. OFFHOOK fires when YOUR side dials, not when the called
//  *  party picks up. We use a fixed POST_OFFHOOK_DELAY_MS heuristic.
//  */
// @AndroidEntryPoint
// class CampaignRunnerActivity : ComponentActivity() {
//
//     private val vm: CampaignRunnerViewModel by viewModels()
//
//     @Inject lateinit var callDao: CallDao
//     @Inject lateinit var tokenStore: TokenStore
//     @Inject lateinit var okHttp: OkHttpClient
//
//     private var phoneReceiver: BroadcastReceiver? = null
//     private var telephonyCallback: TelephonyCallback? = null
//     @Suppress("DEPRECATION")
//     private var legacyPhoneListener: PhoneStateListener? = null
//     private var mediaPlayer: MediaPlayer? = null
//     private var lastDialedDeviceCallId: String? = null
//     private var lastCallStartMs: Long = 0L
//     private var currentRecordingId: Long? = null
//     private var currentCampaignContactId: Long? = null
//     private var seenOffHook = false
//     private var hangupQueued = false
//     private var playbackJob: Job? = null
//     private var playbackFired = false
//     private var audioFocusRequest: AudioFocusRequest? = null
//
//     private val permLauncher = registerForActivityResult(
//         ActivityResultContracts.RequestMultiplePermissions(),
//     ) { results ->
//         val callOk = results[Manifest.permission.CALL_PHONE] ?: hasPermission(Manifest.permission.CALL_PHONE)
//         val phoneStateOk = results[Manifest.permission.READ_PHONE_STATE] ?: hasPermission(Manifest.permission.READ_PHONE_STATE)
//         if (!hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)) {
//             toast("Grant 'Answer phone calls' so we can auto-hangup after the recording")
//         }
//         if (callOk && phoneStateOk) {
//             beginLoop()
//         } else {
//             Timber.w("Required permissions denied — aborting auto-dialer")
//             vm.stop()
//             finish()
//         }
//     }
//
//     override fun onCreate(savedInstanceState: Bundle?) {
//         super.onCreate(savedInstanceState)
//         val id = intent.getLongExtra(EXTRA_CAMPAIGN_ID, -1L)
//         if (id <= 0) { finish(); return }
//         vm.init(id)
//         registerPhoneStateReceiver()
//         registerTelephonyListener()
//
//         setContent {
//             TutelageTheme {
//                 val state by vm.state.collectAsStateWithLifecycle()
//                 RunnerScreen(
//                     state = state,
//                     onPause = { vm.pause(); stopPrimer() },
//                     onResume = { beginLoop() },
//                     onStop = { vm.stop(); stopPrimer(); finish() },
//                     onSkip = {
//                         currentCampaignContactId?.let { ccId -> vm.skip(ccId) }
//                         stopPrimer()
//                         lifecycleScope.launch { afterCallSettled(triggeredBySkip = true) }
//                     },
//                     onReplayScript = { replayScriptInEarpiece() },
//                     onPlayNow = { onPlayNowTapped() },
//                 )
//             }
//         }
//
//         ensurePermissionsThenStart()
//     }
//
//     private fun ensurePermissionsThenStart() {
//         val missing = mutableListOf<String>()
//         if (!hasPermission(Manifest.permission.CALL_PHONE)) missing += Manifest.permission.CALL_PHONE
//         if (!hasPermission(Manifest.permission.READ_PHONE_STATE)) missing += Manifest.permission.READ_PHONE_STATE
//         if (!hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)) missing += Manifest.permission.ANSWER_PHONE_CALLS
//         if (missing.isNotEmpty()) {
//             permLauncher.launch(missing.toTypedArray())
//         } else {
//             beginLoop()
//         }
//     }
//
//     private fun hasPermission(perm: String): Boolean =
//         ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED
//
//     private fun beginLoop() {
//         vm.start()
//         lifecycleScope.launch {
//             val phase = vm.fetchNext()
//             if (phase is RunnerPhase.Dialing) dialAndLog(phase)
//         }
//     }
//
//     private suspend fun dialAndLog(phase: RunnerPhase.Dialing) {
//         val contact = phase.contact
//         val deviceCallId = "camp_${phase.campaignContactId}_${System.currentTimeMillis()}_${UUID.randomUUID()}"
//         val now = System.currentTimeMillis()
//         lastDialedDeviceCallId = deviceCallId
//         lastCallStartMs = now
//         currentRecordingId = phase.recording?.id
//         currentCampaignContactId = phase.campaignContactId
//         seenOffHook = false
//         playbackFired = false
//         playbackJob?.cancel()
//         playbackJob = null
//
//         withContext(Dispatchers.IO) {
//             runCatching {
//                 callDao.upsert(
//                     CallEntity(
//                         deviceCallId = deviceCallId,
//                         phoneNumber = contact.phone,
//                         direction = "OUTGOING",
//                         status = "RINGING",
//                         startedAt = now,
//                         source = "AUTO_DIALER",
//                         campaignContactId = phase.campaignContactId,
//                         recordingPlayedId = phase.recording?.id,
//                     )
//                 )
//             }
//         }
//
//         // Prefetch the recording so the script primer / replay button is
//         // ready immediately on disk.
//         phase.recording?.let { rec ->
//             withContext(Dispatchers.IO) { prefetchSync(rec.id) }
//         }
//
//         vm.onCallStarted(contact, phase.campaignContactId)
//
//         // Place the call immediately. Playback now starts AFTER OFFHOOK
//         // + POST_OFFHOOK_DELAY_MS (see onCallOffHook).
//         placeCall(contact.phone)
//     }
//
//     private fun prefetchSync(recordingId: Long): Boolean {
//         val target = recordingCacheFile(recordingId)
//         if (target.exists() && target.length() > 0) return true
//         return runCatching {
//             val req = Request.Builder()
//                 .url(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/auto-dialer/recordings/$recordingId/stream")
//                 .header("Authorization", "Bearer ${tokenStore.token.orEmpty()}")
//                 .build()
//             okHttp.newCall(req).execute().use { resp ->
//                 if (!resp.isSuccessful) {
//                     Timber.w("Recording fetch failed: ${resp.code}")
//                     return@runCatching false
//                 }
//                 target.outputStream().use { out -> resp.body?.byteStream()?.copyTo(out) }
//                 target.exists() && target.length() > 0
//             }
//         }.onFailure { Timber.e(it, "Recording fetch error") }.getOrDefault(false)
//     }
//
//     private fun recordingCacheFile(id: Long): File =
//         File(cacheDir, "auto-dialer-recording-$id.audio")
//
//     private fun placeCall(phone: String) {
//         if (!hasPermission(Manifest.permission.CALL_PHONE)) {
//             Timber.w("CALL_PHONE not granted — cannot auto-dial")
//             return
//         }
//         runCatching {
//             val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(phone)}")).apply {
//                 addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
//             }
//             startActivity(intent)
//         }.onFailure { Timber.e(it, "ACTION_CALL failed") }
//     }
//
//     private fun registerTelephonyListener() {
//         val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return
//         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
//             val cb = TelephonyStateCallback { handlePhoneState(it) }
//             telephonyCallback = cb
//             runCatching { tm.registerTelephonyCallback(mainExecutor, cb) }
//                 .onFailure { Timber.w(it, "registerTelephonyCallback failed") }
//         } else {
//             @Suppress("DEPRECATION")
//             val listener = object : PhoneStateListener() {
//                 override fun onCallStateChanged(state: Int, phoneNumber: String?) {
//                     handlePhoneState(state)
//                 }
//             }
//             legacyPhoneListener = listener
//             @Suppress("DEPRECATION")
//             runCatching { tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE) }
//         }
//     }
//
//     private fun handlePhoneState(state: Int) {
//         Timber.d("Telephony state=%d", state)
//         when (state) {
//             TelephonyManager.CALL_STATE_OFFHOOK -> onCallOffHook()
//             TelephonyManager.CALL_STATE_IDLE -> onCallIdle()
//         }
//     }
//
//     private fun registerPhoneStateReceiver() {
//         phoneReceiver = object : BroadcastReceiver() {
//             override fun onReceive(ctx: Context?, intent: Intent?) {
//                 val st = intent?.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
//                 Timber.d("Auto-dialer PHONE_STATE=%s", st)
//                 when (st) {
//                     TelephonyManager.EXTRA_STATE_OFFHOOK -> onCallOffHook()
//                     TelephonyManager.EXTRA_STATE_IDLE -> onCallIdle()
//                 }
//             }
//         }
//         val filter = IntentFilter("android.intent.action.PHONE_STATE")
//         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
//             registerReceiver(phoneReceiver, filter, Context.RECEIVER_EXPORTED)
//         } else {
//             @Suppress("UnspecifiedRegisterReceiverFlag")
//             registerReceiver(phoneReceiver, filter)
//         }
//     }
//
//     private fun onCallOffHook() {
//         if (seenOffHook) return // ignore duplicate fires
//         seenOffHook = true
//         hangupQueued = false
//         toast("Call started — tap 'Play recording NOW' when caller answers")
//         vm.onCallConnected()
//
//         // Android exposes NO signal for remote-party answer to non-dialer
//         // apps. So we do not auto-trigger anything. The counsellor listens
//         // for the "Hello?", then taps the big green button → playback fires
//         // → onCompletion → auto-hangup.
//     }
//
//     /** Idempotent playback trigger — first caller (auto delay OR manual button) wins. */
//     private fun triggerPlaybackOnce(source: String) {
//         if (playbackFired) return
//         playbackFired = true
//         playbackJob?.cancel()
//         playbackJob = null
//         Timber.d("Playback triggered by %s", source)
//         configureAudioForCall()
//         playRecordingViaSpeaker(endCallOnComplete = true)
//     }
//
//     /** Called from the UI button — counsellor heard the remote answer. */
//     fun onPlayNowTapped() {
//         if (!seenOffHook) {
//             toast("Call hasn't started yet")
//             return
//         }
//         triggerPlaybackOnce(source = "manual")
//     }
//
//     /**
//      * Route audio through the LOUDSPEAKER so the handset mic loops it back
//      * into the call upstream. The call must already be active. We force the
//      * speaker repeatedly because some OEMs (Samsung, Xiaomi, Realme) reset
//      * audio routing when an active cellular call exists.
//      */
//     private fun configureAudioForCall() {
//         val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
//         runCatching { am.mode = AudioManager.MODE_IN_COMMUNICATION }
//             .onFailure { Timber.w(it, "setMode failed") }
//         requestAudioFocusForPlayback(am)
//         forceSpeakerOn(am)
//         maxAllStreamVolumes(am)
//     }
//
//     private fun forceSpeakerOn(am: AudioManager) {
//         // Belt + suspenders: try BOTH new setCommunicationDevice and the
//         // legacy isSpeakerphoneOn. Some devices honor only one.
//         @Suppress("DEPRECATION")
//         runCatching { am.isSpeakerphoneOn = true }
//
//         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
//             runCatching {
//                 val speaker = am.availableCommunicationDevices.firstOrNull {
//                     it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
//                 }
//                 if (speaker != null) {
//                     am.setCommunicationDevice(speaker)
//                     Timber.d("setCommunicationDevice → TYPE_BUILTIN_SPEAKER")
//                 } else {
//                     Timber.w("No TYPE_BUILTIN_SPEAKER comm device available")
//                 }
//             }.onFailure { Timber.w(it, "setCommunicationDevice failed") }
//         }
//
//         @Suppress("DEPRECATION")
//         runCatching { am.isSpeakerphoneOn = true }
//     }
//
//     private fun maxAllStreamVolumes(am: AudioManager) {
//         for (stream in intArrayOf(
//             AudioManager.STREAM_MUSIC,
//             AudioManager.STREAM_VOICE_CALL,
//             AudioManager.STREAM_NOTIFICATION,
//             AudioManager.STREAM_SYSTEM,
//         )) {
//             runCatching {
//                 val max = am.getStreamMaxVolume(stream)
//                 am.setStreamVolume(stream, max, 0)
//             }
//         }
//     }
//
//     private fun requestAudioFocusForPlayback(am: AudioManager) {
//         if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
//         if (audioFocusRequest != null) return
//         val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
//             .setAudioAttributes(
//                 AudioAttributes.Builder()
//                     .setUsage(AudioAttributes.USAGE_MEDIA)
//                     .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
//                     .build()
//             )
//             .setWillPauseWhenDucked(false)
//             .setOnAudioFocusChangeListener { /* ignore */ }
//             .build()
//         audioFocusRequest = req
//         val res = runCatching { am.requestAudioFocus(req) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
//         Timber.d("AudioFocus request result=%d", res)
//     }
//
//     private fun releaseAudioFocus() {
//         if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
//         val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
//         audioFocusRequest?.let { runCatching { am.abandonAudioFocusRequest(it) } }
//         audioFocusRequest = null
//     }
//
//     private fun resetAudioMode() {
//         val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
//         runCatching {
//             if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
//                 am.clearCommunicationDevice()
//             } else {
//                 @Suppress("DEPRECATION")
//                 am.isSpeakerphoneOn = false
//             }
//             am.mode = AudioManager.MODE_NORMAL
//         }
//         releaseAudioFocus()
//     }
//
//     private fun playRecordingViaSpeaker(endCallOnComplete: Boolean = false) {
//         val recId = currentRecordingId ?: run {
//             toast("No recording attached to this campaign")
//             return
//         }
//         val file = recordingCacheFile(recId)
//         if (!file.exists() || file.length() == 0L) {
//             toast("Recording not on disk — playback skipped")
//             return
//         }
//         stopPrimer()
//         val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
//
//         val mp = MediaPlayer()
//         mediaPlayer = mp
//         runCatching {
//             mp.setAudioAttributes(
//                 AudioAttributes.Builder()
//                     .setUsage(AudioAttributes.USAGE_MEDIA)
//                     .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
//                     .build()
//             )
//             mp.setDataSource(file.absolutePath)
//             mp.setVolume(1.0f, 1.0f)
//
//             // Pin playback to the built-in loudspeaker BEFORE prepare so
//             // routing is decided up-front.
//             if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
//                 val speaker = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull {
//                     it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
//                 }
//                 if (speaker != null) {
//                     runCatching { mp.setPreferredDevice(speaker) }
//                         .onFailure { Timber.w(it, "setPreferredDevice failed") }
//                 } else {
//                     Timber.w("No TYPE_BUILTIN_SPEAKER output device found")
//                 }
//             }
//
//             mp.setOnPreparedListener { player ->
//                 // Re-force speaker JUST before start — some OEMs reset it.
//                 forceSpeakerOn(am)
//                 maxAllStreamVolumes(am)
//                 runCatching { player.start() }
//                     .onFailure { e -> Timber.e(e, "MediaPlayer start failed") }
//                 // Re-force AGAIN after start because some devices reroute
//                 // immediately when an active call's audio session is open.
//                 forceSpeakerOn(am)
//                 toast("Playing recording on LOUDSPEAKER…")
//             }
//             mp.setOnErrorListener { _, what, extra ->
//                 Timber.e("MediaPlayer error: %d/%d", what, extra)
//                 toast("Playback error $what/$extra")
//                 if (endCallOnComplete) endCurrentCall("playback error")
//                 true
//             }
//             mp.setOnCompletionListener {
//                 Timber.d("Recording finished playing")
//                 toast("Recording finished")
//                 if (endCallOnComplete) endCurrentCall("recording finished")
//             }
//             mp.prepareAsync()
//         }.onFailure {
//             Timber.e(it, "Playback setup failed")
//             toast("Playback setup failed: ${it.message}")
//             stopPrimer()
//             if (endCallOnComplete) endCurrentCall("playback setup failed")
//         }
//     }
//
//     /**
//      * Programmatically hang up the ongoing cellular call. Requires the
//      * ANSWER_PHONE_CALLS runtime permission (API 28+). The call ends and
//      * PHONE_STATE transitions to IDLE, which triggers the normal post-call
//      * flow (afterCallSettled → wait gap → fetch next).
//      */
//     private fun endCurrentCall(reason: String) {
//         if (hangupQueued) return
//         hangupQueued = true
//         Timber.d("Auto-hangup requested: %s", reason)
//         if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
//             toast("Auto-hangup unsupported on this Android version")
//             return
//         }
//         if (!hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)) {
//             toast("Missing ANSWER_PHONE_CALLS — cannot auto-hangup")
//             return
//         }
//         val tm = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: run {
//             toast("TelecomManager unavailable")
//             return
//         }
//         val ok = runCatching {
//             @Suppress("MissingPermission")
//             tm.endCall()
//         }.onFailure {
//             Timber.e(it, "endCall failed")
//             toast("endCall threw: ${it.message}")
//         }.getOrDefault(false)
//         toast(if (ok) "Hung up — next call in queue" else "endCall returned false")
//     }
//
//     private fun toast(msg: String) {
//         runCatching {
//             android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
//         }
//     }
//
//     private fun replayScriptInEarpiece() {
//         // Manual replay via the in-call button — re-trigger the speaker
//         // playback. Honors current audio routing.
//         configureAudioForCall()
//         playRecordingViaSpeaker()
//     }
//
//     private fun stopPrimer() {
//         mediaPlayer?.runCatching { if (isPlaying) stop() }
//         mediaPlayer?.runCatching { release() }
//         mediaPlayer = null
//     }
//
//     private fun onCallIdle() {
//         stopPrimer()
//         resetAudioMode()
//         val started = lastCallStartMs
//         if (started == 0L) return
//         val ended = System.currentTimeMillis()
//         val deviceCallId = lastDialedDeviceCallId ?: return
//         val durationSec = ((ended - started) / 1000).toInt().coerceAtLeast(0)
//         // We don't know answered/missed without dialer role. Heuristic:
//         // ≥ 3s ⇒ ANSWERED, else NO_ANSWER. CallSyncWorker will reconcile.
//         val finalStatus = if (durationSec >= 3) "ANSWERED" else "NO_ANSWER"
//         lifecycleScope.launch(Dispatchers.IO) {
//             val existing = callDao.byDeviceCallId(deviceCallId)
//             // CRITICAL: If PhoneStateReceiver already processed the IDLE event, it
//             // will have the true talk-time duration from the OS CallLog. We must
//             // NOT overwrite an ANSWERED status or a non-zero duration with our
//             // heuristic dial-to-hangup time.
//             if (existing != null && (existing.status == "ANSWERED" || (existing.durationSec ?: 0) > 0)) {
//                 Timber.d("onCallIdle: skipping finalize, PhoneStateReceiver already logged %s/%ds",
//                     existing.status, existing.durationSec)
//             } else {
//                 callDao.finalize(deviceCallId, finalStatus, started, ended, durationSec)
//             }
//             CallSyncWorker.enqueue(this@CampaignRunnerActivity)
//         }
//         lifecycleScope.launch { afterCallSettled() }
//     }
//
//     private suspend fun afterCallSettled(triggeredBySkip: Boolean = false) {
//         val campaign = vm.state.value.campaign ?: return
//         if (!vm.state.value.isRunning && !triggeredBySkip) return
//         vm.startCountdown(campaign.callGapSec) {
//             lifecycleScope.launch {
//                 val phase = vm.fetchNext()
//                 if (phase is RunnerPhase.Dialing) dialAndLog(phase)
//             }
//         }
//     }
//
//     override fun onDestroy() {
//         super.onDestroy()
//         stopPrimer()
//         resetAudioMode()
//         phoneReceiver?.let { runCatching { unregisterReceiver(it) } }
//         phoneReceiver = null
//         val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
//         if (tm != null) {
//             if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
//                 telephonyCallback?.let { cb -> runCatching { tm.unregisterTelephonyCallback(cb) } }
//             } else {
//                 @Suppress("DEPRECATION")
//                 legacyPhoneListener?.let { listener ->
//                     runCatching { tm.listen(listener, PhoneStateListener.LISTEN_NONE) }
//                 }
//             }
//         }
//         telephonyCallback = null
//         legacyPhoneListener = null
//     }
//
//     companion object {
//         const val EXTRA_CAMPAIGN_ID = "campaign_id"
//
//
//         fun newIntent(ctx: Context, campaignId: Long): Intent =
//             Intent(ctx, CampaignRunnerActivity::class.java).putExtra(EXTRA_CAMPAIGN_ID, campaignId)
//     }
// }
//
// @RequiresApi(Build.VERSION_CODES.S)
// private class TelephonyStateCallback(
//     private val onState: (Int) -> Unit,
// ) : TelephonyCallback(), TelephonyCallback.CallStateListener {
//     override fun onCallStateChanged(state: Int) {
//         onState(state)
//     }
// }
//
// @androidx.compose.runtime.Composable
// private fun RunnerScreen(
//     state: RunnerState,
//     onPause: () -> Unit,
//     onResume: () -> Unit,
//     onStop: () -> Unit,
//     onSkip: () -> Unit,
//     onReplayScript: () -> Unit,
//     onPlayNow: () -> Unit,
// ) {
//     val cs = MaterialTheme.colorScheme
//     Surface(modifier = Modifier.fillMaxSize(), color = cs.background) {
//         Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
//             Text(
//                 text = state.campaign?.name ?: "Auto Dialer",
//                 style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
//             )
//             Spacer(Modifier.height(4.dp))
//             Text(
//                 text = state.campaign?.let { "Gap ${it.callGapSec}s · ${it.totalContacts} contacts" } ?: "",
//                 style = MaterialTheme.typography.bodySmall,
//                 color = cs.onSurfaceVariant,
//             )
//
//             Spacer(Modifier.height(16.dp))
//
//             Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
//                 Counter("Dialed", state.dialedCount, cs.primary, Modifier.weight(1f))
//                 Counter("Connected", state.connectedCount, Color(0xFF22C55E), Modifier.weight(1f))
//                 Counter("Skipped", state.skippedCount, cs.tertiary, Modifier.weight(1f))
//             }
//
//             Spacer(Modifier.height(24.dp))
//             PhaseCard(state.phase)
//
//             // Script reference card — visible while dialing / in a call so the
//             // counsellor can replay the primer in their own ear if needed.
//             val showScript = state.phase is RunnerPhase.Dialing || state.phase is RunnerPhase.InCall
//             if (showScript) {
//                 Spacer(Modifier.height(12.dp))
//                 ScriptCard(
//                     campaignDescription = state.campaign?.description,
//                     onReplayScript = onReplayScript,
//                     onPlayNow = onPlayNow,
//                 )
//             }
//
//             Spacer(Modifier.weight(1f))
//
//             // Bottom controls
//             when (state.phase) {
//                 is RunnerPhase.Idle, is RunnerPhase.FetchingNext -> {
//                     OutlinedButton(onClick = onStop, modifier = Modifier.fillMaxWidth().height(48.dp)) {
//                         Icon(Icons.Default.Close, contentDescription = null); Spacer(Modifier.width(8.dp))
//                         Text("Cancel")
//                     }
//                 }
//                 is RunnerPhase.Paused, is RunnerPhase.Error -> {
//                     Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
//                         Button(onClick = onResume, modifier = Modifier.weight(1f).height(48.dp)) {
//                             Icon(Icons.Default.PlayArrow, contentDescription = null); Spacer(Modifier.width(8.dp))
//                             Text("Resume")
//                         }
//                         OutlinedButton(onClick = onStop, modifier = Modifier.weight(1f).height(48.dp)) {
//                             Icon(Icons.Default.Close, contentDescription = null); Spacer(Modifier.width(8.dp))
//                             Text("Stop")
//                         }
//                     }
//                 }
//                 is RunnerPhase.Done -> {
//                     Button(onClick = onStop, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Close") }
//                 }
//                 else -> {
//                     Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
//                         OutlinedButton(onClick = onSkip, modifier = Modifier.weight(1f).height(48.dp)) {
//                             Icon(Icons.Default.SkipNext, contentDescription = null); Spacer(Modifier.width(8.dp))
//                             Text("Skip")
//                         }
//                         OutlinedButton(onClick = onPause, modifier = Modifier.weight(1f).height(48.dp)) {
//                             Icon(Icons.Default.Pause, contentDescription = null); Spacer(Modifier.width(8.dp))
//                             Text("Pause")
//                         }
//                     }
//                 }
//             }
//         }
//     }
// }
//
// @androidx.compose.runtime.Composable
// private fun Counter(label: String, value: Int, color: Color, modifier: Modifier = Modifier) {
//     Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.08f))) {
//         Column(modifier = Modifier.padding(12.dp)) {
//             Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
//             Text("$value", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = color)
//         }
//     }
// }
//
// @androidx.compose.runtime.Composable
// private fun PhaseCard(phase: RunnerPhase) {
//     val cs = MaterialTheme.colorScheme
//     Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
//         Box(modifier = Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
//             when (phase) {
//                 is RunnerPhase.Idle -> Row(verticalAlignment = Alignment.CenterVertically) {
//                     CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
//                     Spacer(Modifier.width(12.dp))
//                     Text("Starting auto-dialer…")
//                 }
//                 is RunnerPhase.FetchingNext -> Row(verticalAlignment = Alignment.CenterVertically) {
//                     CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
//                     Spacer(Modifier.width(12.dp))
//                     Text("Fetching next contact…")
//                 }
//                 is RunnerPhase.Dialing -> CallingCard(phase.contact, "Dialing…")
//                 is RunnerPhase.InCall -> CallingCard(phase.contact, "In call · playing recording on speaker")
//                 is RunnerPhase.Waiting -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
//                     Text("Waiting", color = cs.onSurfaceVariant, fontSize = 12.sp)
//                     Spacer(Modifier.height(4.dp))
//                     Text("${phase.remainingSec}s", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = cs.primary)
//                     Text("until next call", fontSize = 12.sp, color = cs.onSurfaceVariant)
//                 }
//                 is RunnerPhase.Paused -> Text("Paused", fontSize = 18.sp, color = cs.onSurfaceVariant)
//                 is RunnerPhase.Done -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
//                     Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF22C55E), modifier = Modifier.size(48.dp))
//                     Spacer(Modifier.height(8.dp))
//                     Text(phase.message, color = cs.onSurface)
//                 }
//                 is RunnerPhase.Error -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
//                     Icon(Icons.Default.Warning, contentDescription = null, tint = cs.error, modifier = Modifier.size(40.dp))
//                     Spacer(Modifier.height(8.dp))
//                     Text(phase.message, color = cs.error)
//                 }
//             }
//         }
//     }
// }
//
// @androidx.compose.runtime.Composable
// private fun ScriptCard(
//     campaignDescription: String?,
//     onReplayScript: () -> Unit,
//     onPlayNow: () -> Unit,
// ) {
//     val cs = MaterialTheme.colorScheme
//     Card(
//         modifier = Modifier.fillMaxWidth(),
//         shape = RoundedCornerShape(12.dp),
//         colors = CardDefaults.cardColors(containerColor = cs.surfaceVariant.copy(alpha = 0.4f)),
//     ) {
//         Column(modifier = Modifier.padding(14.dp)) {
//             Row(verticalAlignment = Alignment.CenterVertically) {
//                 Icon(Icons.Default.Description, contentDescription = null, tint = cs.primary, modifier = Modifier.size(18.dp))
//                 Spacer(Modifier.width(8.dp))
//                 Text("Script", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
//             }
//             if (!campaignDescription.isNullOrBlank()) {
//                 Spacer(Modifier.height(6.dp))
//                 Text(campaignDescription, fontSize = 13.sp, color = cs.onSurfaceVariant)
//             }
//             Spacer(Modifier.height(10.dp))
//             Button(
//                 onClick = onPlayNow,
//                 modifier = Modifier.fillMaxWidth().height(48.dp),
//                 colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E)),
//             ) {
//                 Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
//                 Spacer(Modifier.width(8.dp))
//                 Text("Play recording NOW (caller answered)", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
//             }
//             Spacer(Modifier.height(8.dp))
//             OutlinedButton(
//                 onClick = onReplayScript,
//                 modifier = Modifier.fillMaxWidth().height(40.dp),
//             ) {
//                 Icon(Icons.Default.Hearing, contentDescription = null, modifier = Modifier.size(16.dp))
//                 Spacer(Modifier.width(8.dp))
//                 Text("Play in earpiece (counsellor only)", fontSize = 13.sp)
//             }
//         }
//     }
// }
//
// @androidx.compose.runtime.Composable
// private fun CallingCard(contact: B2bContactDto, label: String) {
//     Column(horizontalAlignment = Alignment.CenterHorizontally) {
//         Box(
//             modifier = Modifier.size(72.dp).clip(CircleShape)
//                 .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
//             contentAlignment = Alignment.Center,
//         ) {
//             Icon(Icons.Default.Call, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
//         }
//         Spacer(Modifier.height(12.dp))
//         Text(contact.name, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
//         Text(contact.phone, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
//         contact.state?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
//         Spacer(Modifier.height(8.dp))
//         Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
//     }
// }
//
