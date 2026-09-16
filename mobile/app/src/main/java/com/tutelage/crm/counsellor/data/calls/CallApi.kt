package com.tutelage.crm.counsellor.data.calls

import kotlinx.serialization.Serializable
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path

interface CallApi {
    @POST("api/calls/sync")
    suspend fun sync(@Body request: CallSyncRequest): CallSyncResponse

    @GET("api/calls/pending")
    suspend fun pending(): List<PendingCallDto>

    @Multipart
    @POST("api/calls/{id}/recording")
    suspend fun uploadRecording(
        @Path("id") id: Long,
        @Part recording: MultipartBody.Part,
    ): RecordingUploadResponse
}

@Serializable
data class RecordingUploadResponse(
    val success: Boolean = false,
    val path: String? = null,
    val size: Long? = null,
)

@Serializable
data class PendingCallDto(
    val id: Long,
    val phoneNumber: String,
    val leadId: Long? = null,
    val startedAt: String,
    val lead: PendingLeadDto? = null,
)

@Serializable
data class PendingLeadDto(val name: String? = null)
