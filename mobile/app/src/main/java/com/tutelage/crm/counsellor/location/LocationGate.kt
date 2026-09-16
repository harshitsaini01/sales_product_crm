package com.tutelage.crm.counsellor.location

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.tutelage.crm.counsellor.data.auth.TokenStore

/**
 * Single source of truth for "is this counsellor allowed to use the app right now."
 * Any entry point that can act on behalf of the user (MainScreen's NavHost,
 * CallTriggerActivity's push-triggered dialer, future ones) must consult this
 * instead of re-deriving the permission/GPS checks itself — CallTriggerActivity
 * bypassing MandatoryLocationHost's own inline checks is exactly how counsellors
 * were able to place calls with location turned off.
 */
object LocationGate {
    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    // Below Android 10 there's no separate background-location permission — a foreground
    // grant already means all-the-time access, so treat it as satisfied.
    fun hasBackgroundPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasPermission(context)
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    fun isGpsEnabled(context: Context): Boolean {
        val manager = context.getSystemService(LocationManager::class.java) ?: return false
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    /** Any counsellor with tracking enabled is treated as required — not only ones explicitly flagged locationRequired. */
    fun mustEnforce(tokenStore: TokenStore): Boolean = tokenStore.locationRequired || tokenStore.locationTrackingEnabled

    /**
     * Hard block: foreground permission + "allow all the time" background permission +
     * GPS on + battery-optimization exempt. Every entry point that can act on behalf of
     * the counsellor (in-app nav, the CTC call trigger, the background watchdog) must
     * agree on exactly this condition — a looser check anywhere is a bypass.
     */
    fun isBlocked(context: Context, tokenStore: TokenStore): Boolean =
        mustEnforce(tokenStore) && (!hasPermission(context) || !hasBackgroundPermission(context) || !isGpsEnabled(context) || !isIgnoringBatteryOptimizations(context))

    // OEM power managers (MIUI/ColorOS/FuntouchOS/OneUI) routinely freeze or kill a
    // foreground service within minutes of screen-off unless the app is whitelisted
    // from battery optimization — this is the #1 cause of counsellors going stale/
    // "never reported" despite permission + GPS being fine.
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun batteryOptimizationExemptionIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))

    fun appSettingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
}
