package com.tutelage.crm.counsellor.data.auth

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

@Serializable
data class LoginRequest(
    val loginid: String,
    val password: String,
    val deviceId: String,
    val fcmToken: String? = null,
    val appVersion: String? = null,
)

@Serializable
data class LoginUser(
    val id: Long,
    val name: String,
    val email: String? = null,
    val mobile: String? = null,
    val role: String,
    val showFullPhone: Boolean = false,
    val showBucket: Boolean = true,
    val locationTrackingEnabled: Boolean = false,
    val locationRequired: Boolean = false,
)

@Serializable
data class LoginResponse(val token: String, val user: LoginUser)

@Serializable
data class FcmTokenRequest(
    val fcmToken: String,
    val deviceId: String,
    val appVersion: String? = null,
)

@Serializable
data class LogoutRequest(val fcmToken: String? = null)

@Serializable
data class SimpleResult(val success: Boolean)

@Serializable
data class MeResponse(
    val id: Long,
    val name: String,
    val email: String? = null,
    val mobile: String? = null,
    val role: String,
    val showFullPhone: Boolean = false,
    val showBucket: Boolean = true,
    val locationTrackingEnabled: Boolean = false,
    val locationRequired: Boolean = false,
)

interface AuthApi {
    @POST("api/mobile/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("api/mobile/fcm-token")
    suspend fun registerFcmToken(@Body body: FcmTokenRequest): SimpleResult

    @POST("api/mobile/logout")
    suspend fun logout(@Body body: LogoutRequest): SimpleResult

    @GET("api/mobile/me")
    suspend fun me(): MeResponse
}
