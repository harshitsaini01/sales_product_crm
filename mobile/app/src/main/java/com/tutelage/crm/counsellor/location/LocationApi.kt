package com.tutelage.crm.counsellor.location

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

@Serializable
data class LocationSampleRequest(
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double? = null,
    val altitudeM: Double? = null,
    val speedMps: Double? = null,
    val bearingDeg: Double? = null,
)

@Serializable
data class DeviceLocationStatusRequest(
    val permissionGranted: Boolean,
    val backgroundGranted: Boolean,
    val gpsEnabled: Boolean,
    val batteryExempt: Boolean,
    val callPhoneGranted: Boolean,
    val phoneStateGranted: Boolean,
    val callLogGranted: Boolean,
    val recordAudioGranted: Boolean,
    val notificationsGranted: Boolean,
    val blocked: Boolean,
    val blockReason: String? = null,
)

interface LocationApi {
    @POST("api/mobile/location")
    suspend fun upload(@Body sample: LocationSampleRequest)

    // Self-reported gate state — lets the admin dashboard show the exact reason
    // tracking stopped (e.g. GPS on but permission revoked) instead of guessing
    // from a stale timestamp.
    @POST("api/mobile/device-status")
    suspend fun reportDeviceStatus(@Body status: DeviceLocationStatusRequest)
}