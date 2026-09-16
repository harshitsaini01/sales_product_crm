// ===== AUTO-DIALER DISABLED (feature no longer in use) =====
// The entire file below is commented out. Wiring was also removed/commented in:
//   MainScreen.kt (nav route), HomeScreen.kt (AutoDialerCard), NetworkModule.kt
//   (provideAutoDialerApi), AndroidManifest.xml (CampaignRunnerActivity).
// To re-enable: strip the leading '// ' from each line and restore that wiring.
// ============================================================

// package com.tutelage.crm.counsellor.data.autodialer
//
// import kotlinx.serialization.Serializable
// import retrofit2.http.GET
// import retrofit2.http.POST
// import retrofit2.http.Path
//
// interface AutoDialerApi {
//
//     @GET("api/auto-dialer/campaigns")
//     suspend fun campaigns(): CampaignListResponse
//
//     @GET("api/auto-dialer/campaigns/{id}")
//     suspend fun campaign(@Path("id") id: Long): CampaignDto
//
//     @GET("api/auto-dialer/campaigns/{id}/next")
//     suspend fun next(@Path("id") id: Long): NextContactResponse
//
//     @POST("api/auto-dialer/campaigns/{id}/contacts/{contactId}/skip")
//     suspend fun skip(@Path("id") id: Long, @Path("contactId") contactId: Long): SimpleOk
//
//     @GET("api/auto-dialer/campaigns/{id}/stats")
//     suspend fun stats(@Path("id") id: Long): CampaignStatsDto
// }
//
// @Serializable
// data class SimpleOk(val ok: Boolean = true)
//
// @Serializable
// data class CampaignListResponse(
//     val data: List<CampaignDto> = emptyList(),
//     val total: Int = 0,
//     val page: Int = 1,
//     val limit: Int = 25,
//     val totalPages: Int = 1,
// )
//
// @Serializable
// data class CampaignDto(
//     val id: Long,
//     val name: String,
//     val description: String? = null,
//     val type: String,
//     val callGapSec: Int = 30,
//     val status: String,
//     val totalContacts: Int = 0,
//     val createdAt: String? = null,
//     val startedAt: String? = null,
//     val recording: RecordingMetaDto? = null,
// )
//
// @Serializable
// data class RecordingMetaDto(
//     val id: Long,
//     val name: String,
//     val durationSec: Int = 0,
//     val streamUrl: String? = null,
// )
//
// @Serializable
// data class NextContactResponse(
//     val done: Boolean = false,
//     val remaining: Int = 0,
//     val campaignContactId: Long? = null,
//     val contact: B2bContactDto? = null,
//     val recording: RecordingMetaDto? = null,
//     val callGapSec: Int = 30,
// )
//
// @Serializable
// data class B2bContactDto(
//     val id: Long,
//     val name: String,
//     val phone: String,
//     val email: String? = null,
//     val state: String? = null,
// )
//
// @Serializable
// data class CampaignStatsDto(
//     val totalContacts: Int = 0,
//     val dialed: Int = 0,
//     val pending: Int = 0,
//     val connected: Int = 0,
//     val noAnswer: Int = 0,
//     val busy: Int = 0,
//     val declined: Int = 0,
//     val failed: Int = 0,
//     val skipped: Int = 0,
//     val completed: Int = 0,
//     val totalCallDurationSec: Long = 0,
//     val avgTalkTimeSec: Int = 0,
//     val progressPct: Int = 0,
//     val callsLogged: Int = 0,
// )
//
