package com.tutelage.crm.counsellor.ui.location

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.DialogProperties
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.location.AppPermissionGate
import com.tutelage.crm.counsellor.location.AppRequirement
import com.tutelage.crm.counsellor.location.LocationBlockNotifier
import com.tutelage.crm.counsellor.location.LocationGate
import com.tutelage.crm.counsellor.location.LocationSyncWorker
import com.tutelage.crm.counsellor.location.LocationTrackingService
import kotlinx.coroutines.delay

/**
 * Full-app lock, no partial state. Any counsellor with tracking enabled is
 * treated as required, and the app stays locked until EVERY requirement in
 * AppPermissionGate is satisfied — location permission, "allow all the time",
 * GPS, battery exemption, calling, phone state, call log, microphone and
 * notifications. A counsellor who has calling but no location (or the reverse)
 * is exactly the half-working state that produced untracked field calls.
 *
 * Blocking is immediate, not resume-gated. Flipping GPS off from the
 * quick-settings shade never pauses the activity, so we listen for
 * PROVIDERS_CHANGED and lock the app the moment it fires. A slow
 * [GATE_RECHECK_INTERVAL_MS] fallback tick covers the requirements with no
 * broadcast (chiefly the battery exemption), and ON_RESUME re-checks after any
 * trip to Settings. The same AppPermissionGate.isBlocked() check gates the
 * click-to-call trigger and the background watchdog, so there is one definition
 * of "blocked" everywhere the app can act for the user.
 */
@Composable
fun MandatoryLocationHost(tokenStore: TokenStore) {
    if (!LocationGate.mustEnforce(tokenStore)) return
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var refresh by remember { mutableStateOf(0) }
    var requested by remember { mutableStateOf(setOf<AppRequirement>()) }
    var foreground by remember { mutableStateOf(true) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> { foreground = true; refresh++ }
                Lifecycle.Event.ON_PAUSE -> foreground = false
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Immediate detection for the case that actually needs it: GPS toggled from
    // the quick-settings shade never pauses the activity, so resume events alone
    // would let a counsellor keep working with location off. The system tells us
    // the moment it happens, which is strictly better than polling for it.
    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: android.content.Context?, i: Intent?) { refresh++ }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        onDispose { runCatching { context.unregisterReceiver(receiver) } }
    }

    // Slow fallback for the requirements with no broadcast — chiefly the battery
    // exemption. This used to tick every SECOND, and because the service start
    // below sat directly in the composable body, it re-issued
    // startForegroundService() (plus ~11 permission binder IPCs and two keystore
    // decrypts) once per second for as long as the app was open.
    LaunchedEffect(foreground) {
        while (foreground) {
            delay(GATE_RECHECK_INTERVAL_MS)
            refresh++
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh++ }
    val settingsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh++ }

    // `refresh` is read here so every tick re-evaluates the gate.
    @Suppress("UNUSED_EXPRESSION") refresh
    val missing = AppPermissionGate.firstMissing(context, tokenStore)
    val trackingEnabled = tokenStore.locationTrackingEnabled

    // Keyed, NOT in the composable body: composition can run many times per
    // frame, and starting/stopping a service is a side effect that must happen
    // only when the decision actually changes.
    LaunchedEffect(missing, trackingEnabled) {
        if (missing == null && trackingEnabled) {
            LocationTrackingService.start(context)
        } else if (missing == AppRequirement.LOCATION_PERMISSION) {
            // The foreground service cannot run without location permission.
            LocationTrackingService.stop(context)
        }
    }

    LaunchedEffect(missing) {
        if (missing != null) LocationBlockNotifier.notify(context, AppPermissionGate.shortLabel(missing))
        else LocationBlockNotifier.clear(context)
        // Push the current state to the server immediately rather than waiting for
        // the watchdog's 15-minute cadence, so the admin dashboard reflects reality.
        LocationSyncWorker.enqueue(context)
    }

    if (missing != null) {
        // Swallow the back button so the dialog cannot be dismissed out from under
        // the gate — without this, back would pop the whole screen behind it.
        BackHandler(enabled = true) {}
        val activity = context as? Activity
        val permission = AppPermissionGate.permissionFor(missing)
        // Android stops showing the system prompt after "don't ask again"; once we've
        // asked and rationale is no longer offered, the only route left is Settings.
        val permanentlyDenied = permission != null && requested.contains(missing) && activity != null &&
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)

        val isSystemSetting = missing == AppRequirement.GPS_ENABLED ||
            missing == AppRequirement.BATTERY_EXEMPTION ||
            missing == AppRequirement.FULL_SCREEN_INTENT
        val actionLabel = when {
            permanentlyDenied || isSystemSetting -> if (missing == AppRequirement.BATTERY_EXEMPTION) "Allow" else "Open settings"
            missing == AppRequirement.BACKGROUND_LOCATION -> "Allow all the time"
            else -> "Allow"
        }

        AlertDialog(
            onDismissRequest = {},
            properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            title = { Text(AppPermissionGate.title(missing)) },
            text = {
                Text(
                    if (permanentlyDenied) "${AppPermissionGate.message(missing)}\n\nIt was permanently denied, so open app settings and allow it there."
                    else AppPermissionGate.message(missing)
                )
            },
            confirmButton = {
                Button(onClick = {
                    when {
                        missing == AppRequirement.GPS_ENABLED ->
                            context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                        missing == AppRequirement.BATTERY_EXEMPTION ->
                            settingsLauncher.launch(LocationGate.batteryOptimizationExemptionIntent(context))
                        // Android 14+ only, and there is no runtime dialog for
                        // it — the grant lives on its own Settings screen.
                        missing == AppRequirement.FULL_SCREEN_INTENT ->
                            settingsLauncher.launch(AppPermissionGate.fullScreenIntentSettingsIntent(context))
                        permanentlyDenied || permission == null ->
                            context.startActivity(LocationGate.appSettingsIntent(context))
                        else -> {
                            requested = requested + missing
                            permissionLauncher.launch(permissionsToRequest(missing, permission))
                        }
                    }
                }) { Text(actionLabel) }
            },
            dismissButton = { OutlinedButton(onClick = { refresh++ }) { Text("I've turned it on — recheck") } },
        )
    }
}

/**
 * Fallback re-check cadence for requirements the system does not broadcast.
 * GPS has PROVIDERS_CHANGED, the battery exemption has nothing, and revoking a
 * permission from Settings kills the process — so this only has to be brisk
 * enough to catch a battery-optimisation change made outside our own
 * settingsLauncher round-trip.
 */
private const val GATE_RECHECK_INTERVAL_MS = 10_000L

/**
 * Foreground location must be granted in the same request as coarse, and on
 * Android 11+ background location can only be asked for on its own — bundling
 * it with anything else makes the system silently drop the request.
 */
private fun permissionsToRequest(requirement: AppRequirement, permission: String): Array<String> = when (requirement) {
    AppRequirement.LOCATION_PERMISSION -> arrayOf(
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    AppRequirement.BACKGROUND_LOCATION ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) arrayOf(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        else emptyArray()
    else -> arrayOf(permission)
}
