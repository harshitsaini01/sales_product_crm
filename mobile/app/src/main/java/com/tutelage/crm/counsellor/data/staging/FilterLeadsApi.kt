package com.tutelage.crm.counsellor.data.staging

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.Path

/**
 * "Filter Leads" — the lead-staging / batch-verification feature mirrored from
 * the web (frontend FilterLeads.tsx + FilterLeadsBatch.tsx). An admin uploads a
 * batch of purchased leads and assigns it to counsellors; the counsellor opens
 * the batch, calls each lead, marks it Verified / Not Verified and leaves a
 * note. Seeding the verified ones into "My Leads" stays an admin/web action.
 */

@Serializable
data class StagingAssigneeDto(
    val id: Long,
    val name: String? = null,
)

/** One bulk-uploaded lead awaiting verification. */
@Serializable
data class StagingItemDto(
    val id: Long,
    val batchId: Long,
    val name: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val father: String? = null,
    val mother: String? = null,
    val email2: String? = null,
    val email3: String? = null,
    val mobile2: String? = null,
    val mobile3: String? = null,
    val fatherMobile: String? = null,
    val motherMobile: String? = null,
    val city: String? = null,
    val state: String? = null,
    val country: String? = null,
    val pincode: String? = null,
    val dob: String? = null,
    val gender: String? = null,
    val nationality: String? = null,
    val intrestedCourse: String? = null,
    val intrestedUniversity: String? = null,
    val event: String? = null,
    val source: String? = null,
    val leadType: String? = null,
    /** The "Comment" column from the original upload sheet. */
    val leadComment: String? = null,
    /** null = pending, true = verified, false = not verified (rejected). */
    val verified: Boolean? = null,
    /**
     * Third review state — mutually exclusive with [verified]. Set when the
     * tele-caller couldn't reach this lead; the item stays out of the seed
     * pool until someone reaches them and flips it to verified.
     */
    val callNotAnswered: Boolean = false,
    /** The counsellor's verification note (separate from [leadComment]). */
    val comments: String? = null,
    val seeded: Boolean = false,
    /** Set once the item has been seeded into a real Lead row. */
    val leadId: Long? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class StagingBatchDto(
    val id: Long,
    val name: String,
    val fileName: String? = null,
    val totalCount: Int = 0,
    val verifiedCount: Int = 0,
    val rejectedCount: Int = 0,
    val callNotAnsweredCount: Int = 0,
    val seededCount: Int = 0,
    val assignees: List<StagingAssigneeDto> = emptyList(),
    val createdAt: String? = null,
    /** Only populated by the detail endpoint, not the list endpoint. */
    val items: List<StagingItemDto> = emptyList(),
)

/**
 * PATCH body. [status] is one of "verified" / "rejected" / "pending" /
 * "call_not_answered" — a string (not a nullable boolean) so "set to pending"
 * survives the app's `explicitNulls = false` JSON config, which would
 * otherwise drop a null.
 */
@Serializable
data class UpdateStagingItemBody(
    val status: String? = null,
    val comments: String? = null,
)

interface FilterLeadsApi {
    @GET("api/mobile/filter-leads")
    suspend fun batches(): List<StagingBatchDto>

    @GET("api/mobile/filter-leads/{id}")
    suspend fun batch(@Path("id") id: Long): StagingBatchDto

    @PATCH("api/mobile/filter-leads/items/{itemId}")
    suspend fun updateItem(
        @Path("itemId") itemId: Long,
        @Body body: UpdateStagingItemBody,
    ): StagingItemDto
}
