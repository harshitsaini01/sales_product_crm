package com.tutelage.crm.counsellor.location

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.tutelage.crm.counsellor.R
import com.tutelage.crm.counsellor.data.auth.TokenStore
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class LocationTrackingService : Service() {
    @Inject lateinit var api: LocationApi
    @Inject lateinit var tokenStore: TokenStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }
    /** Last fix we actually shipped — the reference for the filters below. */
    private var lastAccepted: Location? = null
    private var lastUploadAtMs = 0L

    /**
     * Decide whether a fix is worth sending.
     *
     * Every fix used to be uploaded verbatim, which is why a counsellor sitting
     * still for an hour rendered as a 200 m blob of scatter with long spikes
     * radiating out of it. Three different things produce that:
     *
     *  1. **Low-accuracy fixes.** Indoors the fused provider falls back to wifi
     *     and cell towers, returning points with 50-500 m accuracy. The map drew
     *     them as if they were exact. This is the main cause of the spikes.
     *  2. **Teleports.** A single bad fix lands hundreds of metres away and the
     *     route line runs out to it and back. A speed sanity check kills those
     *     without needing to know anything about the map.
     *  3. **Stationary drift.** GPS wanders a few metres constantly; at one fix
     *     every 30 s that is 120 points an hour of pure noise for someone who
     *     never moved. setMinUpdateDistanceMeters(10f) does not help, because
     *     noise reliably exceeds 10 m — the threshold has to scale with the
     *     fix's own reported accuracy.
     *
     * A heartbeat still goes out periodically while stationary, so "last seen"
     * stays fresh and an idle counsellor is not mistaken for one who went dark.
     */
    private fun shouldUpload(location: Location): Boolean {
        // 1. Accuracy gate.
        if (!location.hasAccuracy() || location.accuracy > MAX_ACCURACY_M) return false

        val previous = lastAccepted ?: return true
        val metres = location.distanceTo(previous)
        val seconds = (location.time - previous.time) / 1000.0

        // 2. Speed sanity. Over a long gap this is naturally small, so a genuine
        //    journey resumed after hours still passes.
        if (seconds > 0 && metres / seconds > MAX_SPEED_MPS) return false

        // 3. Real movement, or the keep-alive.
        val moved = metres > maxOf(MIN_MOVE_M, location.accuracy)
        val heartbeatDue = System.currentTimeMillis() - lastUploadAtMs >= HEARTBEAT_MS
        return moved || heartbeatDue
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            // Prefer the most accurate fix in the batch rather than simply the
            // newest — a batch often contains one good GPS fix alongside coarser
            // network ones.
            val location = result.locations.minByOrNull { it.accuracy } ?: result.lastLocation ?: return
            if (!shouldUpload(location)) return
            lastAccepted = location
            lastUploadAtMs = System.currentTimeMillis()
            scope.launch {
                runCatching {
                    api.upload(
                        LocationSampleRequest(
                            latitude = location.latitude,
                            longitude = location.longitude,
                            accuracyM = location.accuracy.toDouble(),
                            altitudeM = if (location.hasAltitude()) location.altitude else null,
                            speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
                            // Direction of travel — lets the CRM map rotate the live marker to
                            // face the way the counsellor is actually moving, like a driver puck.
                            bearingDeg = if (location.hasBearing()) location.bearing.toDouble() else null,
                        )
                    )
                }
                    .onFailure { android.util.Log.w("LocationTrackingService", "Failed to upload location sample", it) }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!tokenStore.locationTrackingEnabled || tokenStore.token.isNullOrBlank() || !hasLocationPermission()) { stopSelf(); return START_NOT_STICKY }
        startForeground(NOTIFICATION_ID, notification())
        // Aggressive interval: counsellors move between visits, admins need near-live
        // positions, not a stale point from half an hour ago.
        val request = LocationRequest.Builder(TRACKING_INTERVAL_MS)
            .setMinUpdateDistanceMeters(10f)
            .setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY)
            .setMinUpdateIntervalMillis(TRACKING_INTERVAL_MS)
            .setMaxUpdateDelayMillis(TRACKING_INTERVAL_MS)
            .build()
        runCatching {
            client.requestLocationUpdates(request, callback, mainLooper)
                .addOnFailureListener { android.util.Log.w("LocationTrackingService", "requestLocationUpdates failed", it) }
        }.onFailure {
            android.util.Log.w("LocationTrackingService", "requestLocationUpdates threw", it)
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }
    // cancel(): the scope outlived the service, so upload coroutines from a
    // stopped service kept running (and kept retrying) after teardown.
    override fun onDestroy() {
        runCatching { client.removeLocationUpdates(callback) }
        scope.cancel()
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    private fun hasLocationPermission() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    private fun notification() : android.app.Notification { val manager=getSystemService(NotificationManager::class.java); if (manager.getNotificationChannel(CHANNEL_ID)==null) manager.createNotificationChannel(NotificationChannel(CHANNEL_ID,"Location tracking",NotificationManager.IMPORTANCE_LOW)); return NotificationCompat.Builder(this,CHANNEL_ID).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Location tracking active").setContentText("Sharing your work location with CRM").setOngoing(true).build() }
    companion object {
        private const val CHANNEL_ID = "location_tracking"
        private const val NOTIFICATION_ID = 3101
        const val TRACKING_INTERVAL_MS = 30_000L

        /**
         * Drop anything coarser than this. A 50 m circle is about the width of
         * the street the counsellor is standing on — beyond that the point says
         * "somewhere in this neighbourhood", which is worse than no point at
         * all once it is drawn as a dot and joined to a route line.
         */
        private const val MAX_ACCURACY_M = 50f

        /** ~126 km/h. Above this the fix is noise, not travel. */
        private const val MAX_SPEED_MPS = 35f

        /** Floor for "actually moved"; the real threshold is max(this, accuracy). */
        private const val MIN_MOVE_M = 25f

        /** Keep-alive while stationary, so "last seen" does not go stale. */
        private const val HEARTBEAT_MS = 5 * 60_000L
        fun hasLocationPermission(context: Context) = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        fun start(context: Context) { if (hasLocationPermission(context)) ContextCompat.startForegroundService(context, Intent(context, LocationTrackingService::class.java)) }
        fun stop(context: Context) { context.stopService(Intent(context, LocationTrackingService::class.java)) }
    }
}