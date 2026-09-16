package com.tutelage.crm.counsellor.data.dashboard

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Query

@Serializable
data class DashboardTodayDto(
    val total: Int = 0,
    val answered: Int = 0,
    /** Incoming calls we didn't pick up. Counted separately from [noAnswer]. */
    val missed: Int = 0,
    /** Outgoing calls that rang out. Counsellors track this distinctly from
     *  [missed] — it tells them which leads are still un-reached. Optional;
     *  older backends won't send it. */
    val noAnswer: Int = 0,
    /** Counsellor-or-target declined the call. Includes BUSY since the user
     *  experience is the same (didn't connect, wasn't ignored). Optional —
     *  older backends won't send it. */
    val rejected: Int = 0,
    val totalDurationSec: Int = 0,
    val outgoing: Int = 0,
    val incoming: Int = 0,
)

@Serializable
data class DashboardLeadsDto(
    val total: Int = 0,
    val hot: Int = 0,
)

@Serializable
data class DashboardFollowupsDto(
    val today: Int = 0,
)

@Serializable
data class DashboardDto(
    val today: DashboardTodayDto = DashboardTodayDto(),
    val leads: DashboardLeadsDto = DashboardLeadsDto(),
    val followups: DashboardFollowupsDto = DashboardFollowupsDto(),
)

@Serializable
data class FollowupLeadDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val followupDate: String? = null,
    val leadStatus: String? = null,
    val leadSubStatus: String? = null,
)

@Serializable
data class CallLogLeadDto(val id: Long, val name: String? = null)

@Serializable
data class CallLogRowDto(
    val id: Long,
    val phoneNumber: String,
    val direction: String,
    val status: String,
    val startedAt: String,
    val endedAt: String? = null,
    val durationSec: Int = 0,
    val hasRecording: Boolean = false,
    val simSlot: Int? = null,
    val simCarrier: String? = null,
    val simNumber: String? = null,
    val lead: CallLogLeadDto? = null,
)

@Serializable
data class CallLogSummaryDto(
    val total: Int = 0,
    val answered: Int = 0,
    val missed: Int = 0,
    val noAnswer: Int = 0,
    val rejected: Int = 0,
    val failed: Int = 0,
    val totalSec: Int = 0,
    val answeredSec: Int = 0,
    /** Alias for [totalSec] kept for older clients that read `talkSec`. */
    val talkSec: Int = 0,
)

@Serializable
data class CallLogPageDto(
    val rows: List<CallLogRowDto> = emptyList(),
    val page: Int = 1,
    val pageSize: Int = 25,
    val total: Int = 0,
    val totalPages: Int = 1,
    /** Aggregates over the active filter — drives the Stat tiles. */
    val summary: CallLogSummaryDto = CallLogSummaryDto(),
    /** Today's snapshot, independent of the filter — header chip. */
    val today: CallLogSummaryDto = CallLogSummaryDto(),
)

@kotlinx.serialization.Serializable
data class FollowupCountsDto(
    val today: Int = 0,
    val overdue: Int = 0,
    val upcoming: Int = 0,
)

@Serializable
data class NextFollowupDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val leadStatus: String? = null,
    val leadSubStatus: String? = null,
    val followupDate: String,
)

@Serializable
data class RecentCallDto(
    val id: Long,
    val phoneNumber: String,
    val direction: String,
    val status: String,
    val startedAt: String,
    val durationSec: Int = 0,
    val lead: CallLogLeadDto? = null,
)

@Serializable
data class WeekDayDto(val date: String, val count: Int)

@Serializable
data class HomeFollowupsDto(
    val today: Int = 0,
    val overdue: Int = 0,
    val upcoming: Int = 0,
)

@Serializable
data class HomeOverviewDto(
    val today: DashboardTodayDto = DashboardTodayDto(),
    val leads: DashboardLeadsDto = DashboardLeadsDto(),
    val followups: HomeFollowupsDto = HomeFollowupsDto(),
    val nextFollowup: NextFollowupDto? = null,
    val recentCalls: List<RecentCallDto> = emptyList(),
    val weekStats: List<WeekDayDto> = emptyList(),
)

interface DashboardApi {
    @GET("api/mobile/home/overview")
    suspend fun homeOverview(): HomeOverviewDto

    @GET("api/mobile/dashboard")
    suspend fun dashboard(): DashboardDto

    @GET("api/mobile/calls")
    suspend fun calls(
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 100,
        @Query("range") range: String? = null,
        @Query("q") q: String? = null,
        @Query("status") status: String? = null,
        @Query("direction") direction: String? = null,
        @Query("fromDate") fromDate: String? = null,
        @Query("toDate") toDate: String? = null,
        @Query("hasRecording") hasRecording: String? = null,
    ): CallLogPageDto

    @GET("api/mobile/followups/today")
    suspend fun todayFollowups(@Query("q") q: String? = null): List<FollowupLeadDto>

    @GET("api/mobile/followups/overdue")
    suspend fun overdueFollowups(@Query("q") q: String? = null): List<FollowupLeadDto>

    @GET("api/mobile/followups/upcoming")
    suspend fun upcomingFollowups(@Query("q") q: String? = null): List<FollowupLeadDto>

    @GET("api/mobile/followups/counts")
    suspend fun followupCounts(): FollowupCountsDto
}
