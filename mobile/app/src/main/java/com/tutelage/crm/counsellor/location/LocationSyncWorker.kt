package com.tutelage.crm.counsellor.location

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.tutelage.crm.counsellor.data.auth.AuthApi
import com.tutelage.crm.counsellor.data.auth.TokenStore
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import timber.log.Timber
import java.util.concurrent.TimeUnit

/**
 * Three jobs in one pass, all aimed at the same failure mode: tracking silently
 * going stale/blocked without the admin ever finding out until they dig into
 * the dashboard.
 *
 * 1. Pulls locationTrackingEnabled/locationRequired fresh from the server — the
 *    app previously only read these at login, so an admin flipping the flag on
 *    an already-logged-in counsellor had no effect until they re-logged in.
 * 2. Restarts LocationTrackingService if it should be running but isn't — the
 *    OS/OEM can kill a foreground service (Doze, battery optimization, low
 *    memory) well before the user ever reopens the app.
 * 3. Reports the device's own permission/GPS/battery gate state to the server
 *    so the admin dashboard shows the *exact* reason tracking stopped (e.g.
 *    GPS is on but location permission was revoked) instead of a generic
 *    "stale" badge inferred from silence. MandatoryLocationHost enqueues a
 *    one-shot run of this worker the instant its own gate state changes, so
 *    this isn't only a 15-minute-stale report.
 */
@HiltWorker
class LocationSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val authApi: AuthApi,
    private val locationApi: LocationApi,
    private val tokenStore: TokenStore,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (tokenStore.token.isNullOrBlank()) return Result.success()

        runCatching { authApi.me() }
            .onSuccess { me ->
                tokenStore.locationTrackingEnabled = me.locationTrackingEnabled
                tokenStore.locationRequired = me.locationRequired
            }
            .onFailure {
                Timber.w(it, "LocationSyncWorker: failed to refresh location flags; will retry")
                return Result.retry()
            }

        val missing = AppPermissionGate.firstMissing(applicationContext, tokenStore)
        val blocked = missing != null

        runCatching {
            locationApi.reportDeviceStatus(
                DeviceLocationStatusRequest(
                    permissionGranted = LocationGate.hasPermission(applicationContext),
                    backgroundGranted = LocationGate.hasBackgroundPermission(applicationContext),
                    gpsEnabled = LocationGate.isGpsEnabled(applicationContext),
                    batteryExempt = LocationGate.isIgnoringBatteryOptimizations(applicationContext),
                    callPhoneGranted = AppPermissionGate.granted(applicationContext, android.Manifest.permission.CALL_PHONE),
                    phoneStateGranted = AppPermissionGate.granted(applicationContext, android.Manifest.permission.READ_PHONE_STATE),
                    callLogGranted = AppPermissionGate.granted(applicationContext, android.Manifest.permission.READ_CALL_LOG),
                    recordAudioGranted = AppPermissionGate.granted(applicationContext, android.Manifest.permission.RECORD_AUDIO),
                    notificationsGranted = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU ||
                        AppPermissionGate.granted(applicationContext, android.Manifest.permission.POST_NOTIFICATIONS),
                    blocked = blocked,
                    blockReason = missing?.let { AppPermissionGate.shortLabel(it) },
                )
            )
        }.onFailure { Timber.w(it, "LocationSyncWorker: failed to report device status") }

        if (blocked) {
            LocationTrackingService.stop(applicationContext)
            LocationBlockNotifier.notify(applicationContext, AppPermissionGate.shortLabel(missing!!))
        } else {
            LocationBlockNotifier.clear(applicationContext)
            if (tokenStore.locationTrackingEnabled) {
                // start() is a no-op safety net when the service is already alive — it just
                // redelivers onStartCommand, which re-registers the same location request.
                LocationTrackingService.start(applicationContext)
            } else {
                LocationTrackingService.stop(applicationContext)
            }
        }
        return Result.success()
    }

    companion object {
        private const val ONE_TIME_NAME = "location-sync"
        private const val PERIODIC_NAME = "location-sync-periodic"

        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<LocationSyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONE_TIME_NAME, ExistingWorkPolicy.REPLACE, req)
        }

        // 15 minutes is WorkManager's minimum periodic interval — this is the watchdog
        // floor, not the sampling rate (the foreground service itself samples every 30s
        // while alive; this just makes sure it's alive and the flags are current).
        fun enqueuePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<LocationSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
