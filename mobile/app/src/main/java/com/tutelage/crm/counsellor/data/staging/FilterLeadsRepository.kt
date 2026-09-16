package com.tutelage.crm.counsellor.data.staging

import javax.inject.Inject
import javax.inject.Singleton

/** Verification status a counsellor can set on a staging item. */
enum class StagingStatus(val wire: String) {
    PENDING("pending"),
    VERIFIED("verified"),
    REJECTED("rejected"),
    /**
     * "Call Not Answered" — tele-caller tried but couldn't reach the lead.
     * The item stays out of the seed pool until someone reaches them and
     * flips it to [VERIFIED]. Mutually exclusive with [VERIFIED] and
     * [REJECTED] on the server side.
     */
    CALL_NOT_ANSWERED("call_not_answered"),
}

@Singleton
class FilterLeadsRepository @Inject constructor(
    private val api: FilterLeadsApi,
) {
    suspend fun batches(): List<StagingBatchDto> = api.batches()

    suspend fun batch(id: Long): StagingBatchDto = api.batch(id)

    suspend fun setStatus(itemId: Long, status: StagingStatus): StagingItemDto =
        api.updateItem(itemId, UpdateStagingItemBody(status = status.wire))

    suspend fun setComment(itemId: Long, comment: String): StagingItemDto =
        api.updateItem(itemId, UpdateStagingItemBody(comments = comment))
}
