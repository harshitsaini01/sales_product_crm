package com.tutelage.crm.counsellor.ui.inactivity

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.runtime.DisposableEffect
import com.tutelage.crm.counsellor.data.activity.InactivityStatusDto

private fun formatSecs(s: Int): String {
    val m = s / 60
    val r = s % 60
    return when {
        m == 0 -> "${r}s"
        r == 0 -> "${m}m"
        else -> "${m}m ${r}s"
    }
}

/**
 * Renders the warning snackbar + blocking alert dialog wherever it's mounted.
 * Pulls state from [InactivityViewModel]; runs even when the user is on Login
 * if mounted there, but in this app we mount it on [com.tutelage.crm.counsellor.ui.MainScreen]
 * so it's strictly post-login.
 *
 * Also wires a foreground hook: when the host activity comes to foreground we
 * push a ping so passive app use (re-opening without making a network call)
 * resets the idle timer.
 */
@Composable
fun InactivityHost(
    snackbarHostState: SnackbarHostState,
    vm: InactivityViewModel = hiltViewModel(),
) {
    val status by vm.status.collectAsState()
    val warningTick by vm.warningEvents.collectAsState()
    val isAcking by vm.isAcking.collectAsState()

    // Foreground hook — every time the user brings the app back, treat that as
    // activity so the timer resets without needing a network mutation.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val obs = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) vm.ping()
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    // Warning toast — fires on the rising edge into 'warning'.
    LaunchedEffect(warningTick) {
        if (warningTick == 0) return@LaunchedEffect
        val s = status ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(
            message = "You've been idle for ${formatSecs(s.inactiveSeconds)}. Take an action soon to avoid a half-day mark.",
            duration = SnackbarDuration.Long,
        )
    }

    val s = status ?: return
    val showDialog =
        s.pendingEvent != null || s.stage == "alert" || s.stage == "halfday"
    if (!showDialog) return

    val isHalfDay = s.stage == "halfday" || s.pendingEvent?.kind == "halfday"

    AlertDialog(
        onDismissRequest = { /* not dismissable — must press the button */ },
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
        icon = {
            Icon(
                Icons.Filled.Warning,
                contentDescription = null,
                tint = if (isHalfDay) Color(0xFFD32F2F) else Color(0xFFF57C00),
            )
        },
        title = {
            Text(
                if (isHalfDay) "Half-Day Marked"
                else "Are you still working?",
                style = MaterialTheme.typography.titleLarge,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isHalfDay) {
                    Text(
                        "We didn't see any activity from you on the web app or mobile " +
                            "app for ${formatSecs(s.inactiveSeconds)}. As per policy, your day " +
                            "has been recorded as a half-day.",
                    )
                    Text(
                        "If you believe this is incorrect, please reach out to your admin.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                } else {
                    Text(
                        "You haven't made a call, updated a lead status, or taken any " +
                            "other action for ${formatSecs(s.inactiveSeconds)}.",
                    )
                    Text(
                        "If you're still here, press \"Mark as Read\" below. If we don't " +
                            "hear from you, your day will be auto-marked as a half-day.",
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Heads up: activity from both the web CRM and this app counts — " +
                            "make a call or update a lead from either to reset the timer.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { vm.acknowledge() },
                enabled = !isAcking,
                modifier = Modifier.fillMaxWidth().padding(PaddingValues(0.dp)),
            ) {
                if (isAcking) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(18.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text(if (isHalfDay) "Okay, I understand" else "Mark as Read")
                }
            }
        },
    )
}
