@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.tasks

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.PhoneForwarded
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.LocalTextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.tutelage.crm.counsellor.ui.components.StatValue
import com.tutelage.crm.counsellor.util.toLocaleString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.leadwork.TaskLeadDto
import com.tutelage.crm.counsellor.ui.leads.AvatarCircle
import com.tutelage.crm.counsellor.util.maskPhone

private val ANSWERED_GAP_PRESETS = listOf(30, 40, 50, 60, 90)
private val NO_ANSWER_GAP_PRESETS = listOf(10, 15, 20, 25, 30)

/**
 * Auto-dialer for one Calling Task's leads. Dials each remaining lead via
 * ACTION_CALL, waits for the call to end (device telephony state, not
 * remote-answer — Android gives non-dialer apps no such signal), then
 * counts down the configured gap before dialing the next one. Pause/Stop
 * never lose the current position — Start/Resume always continues from
 * wherever the queue left off, so nothing gets double-dialed.
 */
@Composable
fun TaskAutoDialerScreen(
    batchId: Long,
    onBack: () -> Unit,
    vm: TaskAutoDialerViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme

    LaunchedEffect(batchId) { vm.load(batchId) }

    // ── Permissions ────────────────────────────────────────────────────────
    val requiredPerms = remember {
        arrayOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG,
        )
    }
    // Only needed so Skip and Stop can end a call that's in progress. Nothing
    // hangs up automatically, so without this the queue still works — Skip just
    // leaves the current call for the counsellor to end themselves.
    val optionalPerms = remember { arrayOf(Manifest.permission.ANSWER_PHONE_CALLS) }
    fun hasAllPerms(): Boolean = requiredPerms.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
    fun hasHangupPerm(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED
    var permsGranted by remember { mutableStateOf(hasAllPerms()) }
    var hangupPermGranted by remember { mutableStateOf(hasHangupPerm()) }
    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        permsGranted = hasAllPerms()
        hangupPermGranted = hasHangupPerm()
    }

    // Once required perms are in, also (silently) ask for the optional
    // auto-hang-up permission — no extra gate screen for it.
    LaunchedEffect(permsGranted) {
        if (permsGranted && !hangupPermGranted) permLauncher.launch(optionalPerms)
    }

    // ── Place the call the ViewModel asks for ─────────────────────────────
    LaunchedEffect(Unit) {
        vm.dialRequests.collect { lead ->
            val phone = lead.mobile ?: return@collect
            runCatching {
                val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(phone)}")).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
        }
    }

    // ── Force-end a call, ONLY on the counsellor's explicit Stop or Skip.
    // Requires ANSWER_PHONE_CALLS + API 28 — best-effort: if we can't, they
    // just end the call on the phone themselves. ──────────────────────────
    fun toast(msg: String) {
        runCatching { android.widget.Toast.makeText(context, msg, android.widget.Toast.LENGTH_SHORT).show() }
    }
    LaunchedEffect(Unit) {
        vm.hangupRequests.collect {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
                toast("Can't auto hang-up on this Android version — please end the call manually")
                return@collect
            }
            if (!hangupPermGranted) {
                toast("Missing 'Answer phone calls' permission — please end the call manually")
                return@collect
            }
            val tm = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
            @Suppress("MissingPermission")
            val ok = runCatching { tm?.endCall() }.getOrDefault(false) == true
            if (!ok) toast("Couldn't auto hang-up — please end the call manually")
        }
    }

    // ── Telephony state — local, transient; only drives loop sequencing.
    // Actual call LOGGING/sync is owned app-wide by PhoneStateReceiver. ────
    DisposableEffect(permsGranted) {
        if (!permsGranted) return@DisposableEffect onDispose {}
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        var receiver: BroadcastReceiver? = null
        var telephonyCallback: TelephonyCallback? = null
        @Suppress("DEPRECATION")
        var legacyListener: PhoneStateListener? = null

        fun handleState(callState: String) {
            when (callState) {
                TelephonyManager.EXTRA_STATE_OFFHOOK -> vm.onCallOffHook()
                TelephonyManager.EXTRA_STATE_IDLE -> vm.onCallIdle()
            }
        }

        receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                intent?.getStringExtra(TelephonyManager.EXTRA_STATE)?.let(::handleState)
            }
        }
        val filter = IntentFilter("android.intent.action.PHONE_STATE")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        if (tm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val cb = object : TelephonyStateCallbackAd() {
                override fun onCallStateChanged(state: Int) {
                    when (state) {
                        TelephonyManager.CALL_STATE_OFFHOOK -> vm.onCallOffHook()
                        TelephonyManager.CALL_STATE_IDLE -> vm.onCallIdle()
                    }
                }
            }
            telephonyCallback = cb
            runCatching { tm.registerTelephonyCallback(context.mainExecutor, cb) }
        } else if (tm != null) {
            @Suppress("DEPRECATION")
            val listener = object : PhoneStateListener() {
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    when (state) {
                        TelephonyManager.CALL_STATE_OFFHOOK -> vm.onCallOffHook()
                        TelephonyManager.CALL_STATE_IDLE -> vm.onCallIdle()
                    }
                }
            }
            legacyListener = listener
            @Suppress("DEPRECATION")
            runCatching { tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE) }
        }

        onDispose {
            receiver.let { runCatching { context.unregisterReceiver(it) } }
            if (tm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                telephonyCallback?.let { cb -> runCatching { tm.unregisterTelephonyCallback(cb) } }
            } else if (tm != null) {
                @Suppress("DEPRECATION")
                legacyListener?.let { l -> runCatching { tm.listen(l, PhoneStateListener.LISTEN_NONE) } }
            }
        }
    }

    Scaffold(
        containerColor = cs.background,
        topBar = {
            TopAppBar(
                title = { Text(state.taskTitle.ifBlank { "Auto Dialer" }, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = { vm.pause(); onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = cs.onPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = cs.primary, titleContentColor = cs.onPrimary),
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            when {
                !permsGranted -> PermissionGate(onGrant = { permLauncher.launch(requiredPerms + optionalPerms) })
                state.phase is DialerPhase.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                state.phase is DialerPhase.Error -> ErrorState((state.phase as DialerPhase.Error).message)
                state.queue.isEmpty() -> EmptyQueueState()
                state.phase is DialerPhase.Setup -> SetupPanel(
                    total = state.total,
                    remaining = state.remaining,
                    unreachable = state.unreachableCount,
                    answeredGapSec = state.answeredGapSec,
                    noAnswerGapSec = state.noAnswerGapSec,
                    onAnsweredGapChange = vm::setAnsweredGapSec,
                    onNoAnswerGapChange = vm::setNoAnswerGapSec,
                    onStart = vm::start,
                )
                else -> RunnerPanel(
                    state = state,
                    onPause = vm::pause,
                    onResume = vm::start,
                    onStop = vm::stop,
                    onSkip = vm::skip,
                    onConfirmAnswered = vm::confirmAnswered,
                    onCallNow = vm::callNow,
                )
            }
        }
    }
}

@Composable
private fun PermissionGate(onGrant: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.Call, contentDescription = null, tint = cs.primary, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text("Phone permissions needed", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
        Spacer(Modifier.height(6.dp))
        Text(
            "Auto Dialer needs call and phone-state permissions to place calls and know when to move to the next lead.",
            style = MaterialTheme.typography.bodySmall,
            color = cs.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        Button(onClick = onGrant) { Text("Grant permissions") }
    }
}

@Composable
private fun ErrorState(message: String) {
    val cs = MaterialTheme.colorScheme
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = cs.error, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(8.dp))
        Text(message, color = cs.error, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun EmptyQueueState() {
    val cs = MaterialTheme.colorScheme
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Color(0xFF10B981), modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(8.dp))
        Text("Nothing left to call", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
        Spacer(Modifier.height(4.dp))
        Text(
            "Every lead in this task has already been called or has no phone number on file.",
            style = MaterialTheme.typography.bodySmall,
            color = cs.onSurfaceVariant,
        )
    }
}

@Composable
private fun SetupPanel(
    total: Int,
    remaining: Int,
    /** Pending leads with no phone number — can't be dialed, so say so. */
    unreachable: Int,
    answeredGapSec: Int,
    noAnswerGapSec: Int,
    onAnsweredGapChange: (Int) -> Unit,
    onNoAnswerGapChange: (Int) -> Unit,
    onStart: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val resuming = remaining < total

    LazyColumn(modifier = Modifier.fillMaxWidth()) {
        item {
            Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = cs.surface)) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text(
                        if (resuming) "$remaining of $total lead${if (total == 1) "" else "s"} left to call" else "$total lead${if (total == 1) "" else "s"} to call",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    )
                    Text(
                        if (resuming) "Picking up where you left off — already-called leads won't be dialed again."
                        else "Each call is placed for you. If nobody answers within the ring timeout it's auto-cut; if you confirm it's answered, the call runs as long as it needs to.",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    if (unreachable > 0) {
                        Text(
                            "$unreachable more lead${if (unreachable == 1) " has" else "s have"} no phone number — " +
                                "the dialer can't ring ${if (unreachable == 1) "it" else "them"}. " +
                                "Open the task's leads to handle ${if (unreachable == 1) "it" else "them"}.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFB45309),
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Text("Wrap-up time between calls", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
            Text(
                "Set from what actually happened on the call — read from your phone's call log, nothing to tap. You can always hit \"Call now\" to skip the wait.",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )

            Spacer(Modifier.height(12.dp))
            Text("After a call that connected", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ANSWERED_GAP_PRESETS.forEach { sec ->
                    ChoiceChip(sec, sec == answeredGapSec) { onAnsweredGapChange(sec) }
                }
            }

            Spacer(Modifier.height(14.dp))
            Text("After no answer", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NO_ANSWER_GAP_PRESETS.forEach { sec ->
                    ChoiceChip(sec, sec == noAnswerGapSec) { onNoAnswerGapChange(sec) }
                }
            }

            Spacer(Modifier.height(24.dp))
            Button(onClick = onStart, modifier = Modifier.fillMaxWidth().height(50.dp)) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(if (resuming) "Resume Auto Dialing" else "Start Auto Dialing", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ChoiceChip(sec: Int, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (selected) cs.primary else cs.surfaceVariant,
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(
            "${sec}s",
            color = if (selected) cs.onPrimary else cs.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun RunnerPanel(
    state: AutoDialerUiState,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    onSkip: () -> Unit,
    onConfirmAnswered: () -> Unit,
    onCallNow: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val midCall = state.phase is DialerPhase.Dialing || state.phase is DialerPhase.InCall ||
        state.phase is DialerPhase.Talking
    Column(modifier = Modifier.fillMaxSize()) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Counter("Dialed", state.dialedCount, cs.primary, Modifier.weight(1f))
            Counter("Connected", state.connectedCount, Color(0xFF22C55E), Modifier.weight(1f))
            Counter("No answer", state.noAnswerCount, Color(0xFFB45309), Modifier.weight(1f))
            Counter("Left", state.remaining, cs.onSurfaceVariant, Modifier.weight(1f))
        }

        Spacer(Modifier.height(16.dp))
        PhaseCard(state.phase)

        // Between calls, show what just happened and who's next — the two things
        // the counsellor needs during the gap.
        val betweenCalls = state.phase is DialerPhase.Waiting || state.phase is DialerPhase.Wrapping
        if (betweenCalls) {
            state.lastOutcome?.let {
                Spacer(Modifier.height(10.dp))
                LastCallCard(it)
            }
            state.nextLead?.let { next ->
                Spacer(Modifier.height(8.dp))
                NextUpCard(next, position = state.currentIndex + 1, total = state.total)
            }
        }

        if (state.phase is DialerPhase.Waiting && state.nextLead != null) {
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = onCallNow,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Icon(Icons.Filled.PhoneForwarded, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Call now — skip the wait", fontWeight = FontWeight.SemiBold)
            }
        }

        // Optional tally tag only — nothing here ends or extends the call.
        if (state.phase is DialerPhase.InCall) {
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onConfirmAnswered,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E)),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Icon(Icons.Filled.Call, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Mark as answered", fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.weight(1f))

        when {
            state.phase is DialerPhase.Done -> Text(
                if (state.unreachableCount > 0)
                    "Every lead the dialer can ring has been called. " +
                        "${state.unreachableCount} more ${if (state.unreachableCount == 1) "has" else "have"} no phone " +
                        "number — open the task's leads to handle ${if (state.unreachableCount == 1) "it" else "them"}."
                else "All leads in this task have been called.",
                style = MaterialTheme.typography.bodyMedium,
                color = if (state.unreachableCount > 0) Color(0xFFB45309) else cs.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
            state.phase is DialerPhase.Loading -> {}
            midCall -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onSkip, modifier = Modifier.weight(1f).height(50.dp)) {
                    Icon(Icons.Filled.SkipNext, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Skip")
                }
                if (state.isRunning) {
                    OutlinedButton(onClick = onPause, modifier = Modifier.weight(1f).height(50.dp)) {
                        Icon(Icons.Filled.Pause, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Pause")
                    }
                } else {
                    Button(onClick = onResume, modifier = Modifier.weight(1f).height(50.dp)) {
                        Icon(Icons.Filled.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Resume")
                    }
                }
                OutlinedButton(onClick = onStop, modifier = Modifier.weight(1f).height(50.dp)) {
                    Icon(Icons.Filled.Close, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Stop")
                }
            }
            state.isRunning && state.phase is DialerPhase.Waiting -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onPause, modifier = Modifier.weight(1f).height(50.dp)) {
                    Icon(Icons.Filled.Pause, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Pause")
                }
                OutlinedButton(onClick = onStop, modifier = Modifier.weight(1f).height(50.dp)) {
                    Icon(Icons.Filled.Close, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Stop")
                }
            }
            else -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onResume, modifier = Modifier.weight(1f).height(50.dp)) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Resume")
                }
                OutlinedButton(onClick = onStop, modifier = Modifier.weight(1f).height(50.dp)) {
                    Icon(Icons.Filled.Close, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Stop")
                }
            }
        }

        if (midCall && !state.isRunning) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Auto-dialing is paused — this call keeps going until it ends, then the queue won't continue until you tap Resume.",
                style = MaterialTheme.typography.labelSmall,
                color = cs.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun Counter(label: String, value: Int, color: Color, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.10f))) {
        // Four of these share one row at weight(1f), so each gets ~25% of the screen
        // minus padding. Both lines have to survive that: the label ellipsizes and
        // the value shrinks rather than being clipped mid-digit.
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                label,
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            StatValue(
                text = value.toLocaleString(),
                style = LocalTextStyle.current.copy(fontSize = 18.sp, fontWeight = FontWeight.Bold),
                color = color,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun PhaseCard(phase: DialerPhase) {
    val cs = MaterialTheme.colorScheme
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
        Box(modifier = Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
            when (phase) {
                is DialerPhase.Dialing -> LeadCard(phase.lead, "Dialing…")
                is DialerPhase.InCall -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    AvatarCircle(name = phase.lead.name, size = 56)
                    Spacer(Modifier.height(8.dp))
                    Text(phase.lead.name?.takeIf { it.isNotBlank() } ?: "(unnamed)", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(maskPhone(phase.lead.mobile), fontSize = 12.sp, color = cs.onSurfaceVariant)
                    Spacer(Modifier.height(10.dp))
                    Text("Call in progress", fontSize = 13.sp, color = cs.primary, fontWeight = FontWeight.Medium)
                    Text(
                        "End the call on your phone when you're done — the next one dials after that.",
                        fontSize = 11.sp,
                        color = cs.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                is DialerPhase.Talking -> LeadCard(phase.lead, "In call — talking. Tap Pause any time.")
                is DialerPhase.Wrapping -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Call ended", color = cs.onSurfaceVariant, fontSize = 12.sp)
                    Text(phase.lastLead.name ?: "(unnamed)", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(12.dp))
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.height(8.dp))
                    Text("Checking how the call went…", fontSize = 11.sp, color = cs.onSurfaceVariant)
                }
                is DialerPhase.Waiting -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Next call in", color = cs.onSurfaceVariant, fontSize = 12.sp)
                    Text("${phase.remainingSec}s", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = cs.primary)
                    Text("until next call", fontSize = 12.sp, color = cs.onSurfaceVariant)
                }
                is DialerPhase.Paused -> Text("Paused", fontSize = 18.sp, color = cs.onSurfaceVariant)
                is DialerPhase.Done -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Color(0xFF22C55E), modifier = Modifier.size(44.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("Done", color = cs.onSurface)
                }
                is DialerPhase.Error -> Text(phase.message, color = cs.error)
                else -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Working…")
                }
            }
        }
    }
}

private fun formatTalkTime(sec: Int): String = when {
    sec <= 0 -> "0s"
    sec < 60 -> "${sec}s"
    else -> "${sec / 60}m ${sec % 60}s"
}

/**
 * What actually happened on the call that just ended — taken from the system
 * call log's duration, not from anything the counsellor had to tap.
 */
@Composable
private fun LastCallCard(outcome: LastCallOutcome) {
    val cs = MaterialTheme.colorScheme
    val tone = if (outcome.answered) Color(0xFF059669) else Color(0xFFB45309)
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = tone.copy(alpha = 0.10f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Icon(
                if (outcome.answered) Icons.Filled.Call else Icons.Filled.CallEnd,
                contentDescription = null,
                tint = tone,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Last call", fontSize = 10.sp, color = cs.onSurfaceVariant)
                Text(
                    outcome.lead.name?.takeIf { it.isNotBlank() } ?: "(unnamed)",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when {
                        !outcome.confirmed -> "Couldn't read the call log — treated as not connected"
                        outcome.answered -> "Connected · talked ${formatTalkTime(outcome.durationSec)}"
                        else -> "Not connected · nobody picked up"
                    },
                    fontSize = 11.sp,
                    color = tone,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/** Who's next, so the counsellor can read the name before the phone starts ringing. */
@Composable
private fun NextUpCard(lead: TaskLeadDto, position: Int, total: Int) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surfaceVariant.copy(alpha = 0.45f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AvatarCircle(name = lead.name, size = 36)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("Up next · $position of $total", fontSize = 10.sp, color = cs.onSurfaceVariant)
                    Text(
                        lead.name?.takeIf { it.isNotBlank() } ?: "(unnamed)",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(maskPhone(lead.mobile), fontSize = 11.sp, color = cs.onSurfaceVariant)
                }
                if (!lead.leadStatus.isNullOrBlank()) {
                    Surface(shape = RoundedCornerShape(999.dp), color = cs.surface) {
                        Text(
                            lead.leadStatus,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = cs.onSurfaceVariant,
                            maxLines = 1,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
            }
            LeadCallHistoryLine(lead, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/**
 * Compact one-liner showing prior call activity on this lead:
 *   "3 attempts · last no-answer 2h ago" / "1 attempt · answered 00:47 · 15m ago"
 * Renders nothing when the lead has never been called — the calling counsellor
 * doesn't need "0 attempts" noise on every fresh card.
 */
@Composable
private fun LeadCallHistoryLine(lead: TaskLeadDto, modifier: Modifier = Modifier) {
    if (lead.callAttempts <= 0) return
    val cs = MaterialTheme.colorScheme
    val answered = lead.lastCallOutcome == "ANSWERED"
    val tone = if (answered) Color(0xFF059669) else Color(0xFFB45309)
    val ago = relativeTimeAgo(lead.lastCallAt)
    val label = buildString {
        append(lead.callAttempts)
        append(if (lead.callAttempts == 1) " attempt" else " attempts")
        val outcomeLabel = when (lead.lastCallOutcome) {
            "ANSWERED" -> "answered"
            "NO_ANSWER" -> "no answer"
            "MISSED" -> "missed"
            "BUSY" -> "busy"
            "REJECTED", "DECLINED" -> "declined"
            "FAILED" -> "failed"
            "SWITCHED_OFF", "SWITCHED OFF" -> "switched off"
            "WRONG_NUMBER" -> "wrong number"
            null -> null
            else -> lead.lastCallOutcome.lowercase().replace('_', ' ')
        }
        if (outcomeLabel != null) append(" · last $outcomeLabel")
        if (answered && lead.lastCallDurationSec > 0) append(" ${formatTalkTime(lead.lastCallDurationSec)}")
        if (ago != null) append(" · $ago")
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier) {
        Icon(
            if (answered) Icons.Filled.Call else Icons.Filled.CallEnd,
            contentDescription = null,
            tint = tone,
            modifier = Modifier.size(12.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(label, fontSize = 10.sp, color = cs.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** "2h ago" / "45m ago" / "yesterday" / "3d ago" — null when no timestamp. */
private fun relativeTimeAgo(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val instant = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return null
    val secs = (System.currentTimeMillis() - instant.toEpochMilli()) / 1000L
    if (secs < 60) return "just now"
    val mins = secs / 60
    if (mins < 60) return "${mins}m ago"
    val hours = mins / 60
    if (hours < 24) return "${hours}h ago"
    val days = hours / 24
    if (days == 1L) return "yesterday"
    if (days < 30) return "${days}d ago"
    return null
}

@Composable
private fun LeadCard(lead: TaskLeadDto, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        AvatarCircle(name = lead.name, size = 64)
        Spacer(Modifier.height(10.dp))
        Text(lead.name?.takeIf { it.isNotBlank() } ?: "(unnamed)", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Text(maskPhone(lead.mobile), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
        // Show prior attempts on the same lead so the counsellor knows if this
        // is a fresh dial or a re-try — matters most when the current call is
        // ringing and they're mentally deciding what to say if it connects.
        if (lead.callAttempts > 0) {
            Spacer(Modifier.height(6.dp))
            LeadCallHistoryLine(lead)
        }
    }
}

@RequiresApi(Build.VERSION_CODES.S)
private abstract class TelephonyStateCallbackAd : TelephonyCallback(), TelephonyCallback.CallStateListener
