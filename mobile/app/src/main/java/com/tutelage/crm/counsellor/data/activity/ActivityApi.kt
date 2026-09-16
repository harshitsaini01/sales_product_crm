package com.tutelage.crm.counsellor.data.activity

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

@Serializable
data class InactivityThresholdsDto(
    val warning: Int = 0,
    val alert: Int = 0,
    val halfday: Int = 0,
)

@Serializable
data class InactivityPendingEventDto(
    val id: Long,
    /** 'alert' or 'halfday' — the server only sets [pendingEvent] for those. */
    val kind: String,
    val raisedAt: String? = null,
)

@Serializable
data class InactivityStatusDto(
    val enabled: Boolean = true,
    /** 'ok' | 'warning' | 'alert' | 'halfday' — mirror of the web tracker. */
    val stage: String = "ok",
    val inactiveSeconds: Int = 0,
    val thresholds: InactivityThresholdsDto = InactivityThresholdsDto(),
    val pendingEvent: InactivityPendingEventDto? = null,
)

@Serializable
data class AckResponseDto(val acknowledged: Int = 0)

@Serializable
data class PingResponseDto(val ok: Boolean = true)

@Serializable
data class PhoneStateRequestDto(
    val onCall: Boolean,
    /** ISO-8601 instant. Optional — server falls back to its own clock. */
    val since: String? = null,
)

@Serializable
data class PhoneStateResponseDto(
    val onCall: Boolean = false,
    val onCallSince: String? = null,
)

interface ActivityApi {
    @GET("api/mobile/activity/status")
    suspend fun status(): InactivityStatusDto

    @POST("api/mobile/activity/ping")
    suspend fun ping(): PingResponseDto

    @POST("api/mobile/activity/ack")
    suspend fun ack(): AckResponseDto

    @POST("api/mobile/activity/phone-state")
    suspend fun phoneState(@Body body: PhoneStateRequestDto): PhoneStateResponseDto
}
