package com.tutelage.crm.counsellor.data.activity

import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ActivityRepository @Inject constructor(
    private val api: ActivityApi,
) {
    suspend fun status(): Result<InactivityStatusDto> = runCatching { api.status() }
    suspend fun ack(): Result<AckResponseDto> = runCatching { api.ack() }
    suspend fun ping(): Result<PingResponseDto> = runCatching { api.ping() }

    /**
     * Report a phone-call state change to the server so the inactivity tracker
     * can suppress warnings while the counsellor is on a call.
     */
    suspend fun phoneState(onCall: Boolean, since: String? = null): Result<PhoneStateResponseDto> =
        runCatching { api.phoneState(PhoneStateRequestDto(onCall = onCall, since = since)) }
}
