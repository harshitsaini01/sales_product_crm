package com.tutelage.crm.counsellor.data.release

import kotlinx.serialization.Serializable
import retrofit2.http.GET

interface AppReleaseApi {
    @GET("api/app-releases/latest")
    suspend fun latest(): AppReleaseDto?
}

@Serializable
data class AppReleaseDto(
    val id: Long,
    val versionCode: Int,
    val versionName: String,
    val fileUrl: String,
    val sha256: String,
    val sizeBytes: Long,
    val releaseNotes: String? = null,
    val isMandatory: Boolean = false,
    val uploadedAt: String,
)
