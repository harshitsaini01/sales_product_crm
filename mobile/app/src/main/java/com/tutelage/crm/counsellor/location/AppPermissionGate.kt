package com.tutelage.crm.counsellor.location

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.os.Build
import androidx.core.content.ContextCompat
import com.tutelage.crm.counsellor.data.auth.TokenStore

/**
 * Every runtime condition the counsellor app requires to do its job, in the
 * order we ask for them. The whole app is blocked while ANY of these is unmet —
 * a counsellor with call permission but no location (or vice versa) is exactly
 * the half-working state that produced untracked calls in the field.
 *
 * LocationGate holds the location-specific primitives; this widens the same
 * idea to calling, call logging, recording and notifications so there is a
 * single definition of "this device is compliant" used by the UI gate, the
 * click-to-call trigger and the background watchdog alike.
 */
enum class AppRequirement {
    LOCATION_PERMISSION,
    BACKGROUND_LOCATION,
    GPS_ENABLED,
    BATTERY_EXEMPTION,
    CALL_PHONE,
    PHONE_STATE,
    CALL_LOG,
    RECORD_AUDIO,
    NOTIFICATIONS,

    /**
     * Android 14 stopped granting USE_FULL_SCREEN_INTENT at install to anything
     * that isn't the device's calling or alarm app. We are neither, so on a
     * fresh install on 14+ the click-to-call push silently degrades from a
     * full-screen, screen-waking call prompt to an ordinary heads-up
     * notification — the counsellor's phone stays dark and the CRM's call
     * request goes unanswered, with nothing anywhere reporting a problem.
     * The user has to grant it from a dedicated Settings screen.
     */
    FULL_SCREEN_INTENT,
}

object AppPermissionGate {

    /**
     * Order matters: location first (it is the one being enforced hardest), then
     * the calling stack, then notifications. The gate always reports the first
     * unmet requirement so the counsellor is walked through them one at a time
     * rather than being shown a wall of toggles.
     */
    fun firstMissing(context: Context, tokenStore: TokenStore): AppRequirement? {
        if (!LocationGate.mustEnforce(tokenStore)) return null
        if (!LocationGate.hasPermission(context)) return AppRequirement.LOCATION_PERMISSION
        if (!LocationGate.hasBackgroundPermission(context)) return AppRequirement.BACKGROUND_LOCATION
        if (!LocationGate.isGpsEnabled(context)) return AppRequirement.GPS_ENABLED
        if (!LocationGate.isIgnoringBatteryOptimizations(context)) return AppRequirement.BATTERY_EXEMPTION
        if (!granted(context, Manifest.permission.CALL_PHONE)) return AppRequirement.CALL_PHONE
        if (!granted(context, Manifest.permission.READ_PHONE_STATE)) return AppRequirement.PHONE_STATE
        if (!granted(context, Manifest.permission.READ_CALL_LOG)) return AppRequirement.CALL_LOG
        if (!granted(context, Manifest.permission.RECORD_AUDIO)) return AppRequirement.RECORD_AUDIO
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !granted(context, Manifest.permission.POST_NOTIFICATIONS)
        ) return AppRequirement.NOTIFICATIONS
        if (!canUseFullScreenIntent(context)) return AppRequirement.FULL_SCREEN_INTENT
        return null
    }

    fun isBlocked(context: Context, tokenStore: TokenStore): Boolean = firstMissing(context, tokenStore) != null

    fun granted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Below Android 14 the manifest declaration is enough. From 14 the platform
     * only auto-grants this to calling/alarm apps, so we must ask the system
     * whether we actually hold it rather than assume the manifest entry works.
     */
    fun canUseFullScreenIntent(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val nm = context.getSystemService(NotificationManager::class.java) ?: return true
        return nm.canUseFullScreenIntent()
    }

    /** Settings screen that grants it — there is no runtime-permission dialog for this one. */
    fun fullScreenIntentSettingsIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
            Uri.parse("package:${context.packageName}"),
        )

    /** The runtime permission behind a requirement, or null when it's a system setting (GPS/battery). */
    fun permissionFor(requirement: AppRequirement): String? = when (requirement) {
        AppRequirement.LOCATION_PERMISSION -> Manifest.permission.ACCESS_FINE_LOCATION
        AppRequirement.BACKGROUND_LOCATION -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Manifest.permission.ACCESS_BACKGROUND_LOCATION else null
        AppRequirement.CALL_PHONE -> Manifest.permission.CALL_PHONE
        AppRequirement.PHONE_STATE -> Manifest.permission.READ_PHONE_STATE
        AppRequirement.CALL_LOG -> Manifest.permission.READ_CALL_LOG
        AppRequirement.RECORD_AUDIO -> Manifest.permission.RECORD_AUDIO
        AppRequirement.NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.POST_NOTIFICATIONS else null
        // Settings-screen grants, not runtime-permission dialogs.
        AppRequirement.GPS_ENABLED, AppRequirement.BATTERY_EXEMPTION, AppRequirement.FULL_SCREEN_INTENT -> null
    }

    fun title(requirement: AppRequirement): String = when (requirement) {
        AppRequirement.LOCATION_PERMISSION -> "Location is required"
        AppRequirement.BACKGROUND_LOCATION -> "All-time location required"
        AppRequirement.GPS_ENABLED -> "Turn on device location"
        AppRequirement.BATTERY_EXEMPTION -> "Allow background activity"
        AppRequirement.CALL_PHONE -> "Calling permission required"
        AppRequirement.PHONE_STATE -> "Phone access required"
        AppRequirement.CALL_LOG -> "Call log access required"
        AppRequirement.RECORD_AUDIO -> "Microphone access required"
        AppRequirement.NOTIFICATIONS -> "Notifications required"
        AppRequirement.FULL_SCREEN_INTENT -> "Allow full-screen call alerts"
    }

    fun message(requirement: AppRequirement): String = when (requirement) {
        AppRequirement.LOCATION_PERMISSION -> "Allow location permission to continue using the CRM app."
        AppRequirement.BACKGROUND_LOCATION -> "Set location access to \"Allow all the time\" so tracking keeps working while the app is in the background."
        AppRequirement.GPS_ENABLED -> "Device location (GPS) is off. Turn it on to continue using the CRM app."
        AppRequirement.BATTERY_EXEMPTION -> "This device is optimizing the app's battery usage, which stops location tracking in the background. Allow unrestricted battery usage to continue."
        AppRequirement.CALL_PHONE -> "Allow phone calling so leads can be dialled from the CRM."
        AppRequirement.PHONE_STATE -> "Allow phone access so call activity is recorded against the right lead."
        AppRequirement.CALL_LOG -> "Allow call log access so your calls sync to the CRM."
        AppRequirement.RECORD_AUDIO -> "Allow microphone access so call recordings reach the CRM."
        AppRequirement.NOTIFICATIONS -> "Allow notifications so click-to-call and alerts reach you."
        AppRequirement.FULL_SCREEN_INTENT -> "Allow this app to show full-screen call alerts, so a call request from the CRM wakes your screen instead of arriving as a silent notification."
    }

    /** Short label used by the persistent notification and the admin dashboard. */
    fun shortLabel(requirement: AppRequirement): String = when (requirement) {
        AppRequirement.LOCATION_PERMISSION -> "Location permission is off"
        AppRequirement.BACKGROUND_LOCATION -> "Not set to \"Allow all the time\""
        AppRequirement.GPS_ENABLED -> "Device GPS is off"
        AppRequirement.BATTERY_EXEMPTION -> "Battery optimization is killing tracking"
        AppRequirement.CALL_PHONE -> "Calling permission is off"
        AppRequirement.PHONE_STATE -> "Phone access is off"
        AppRequirement.CALL_LOG -> "Call log access is off"
        AppRequirement.RECORD_AUDIO -> "Microphone access is off"
        AppRequirement.NOTIFICATIONS -> "Notifications are off"
        AppRequirement.FULL_SCREEN_INTENT -> "Full-screen call alerts are off"
    }
}
