package com.tutelage.crm.counsellor.data.leadwork

import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LeadWorkRepository @Inject constructor(
    private val api: LeadWorkApi,
) {
    suspend fun batches(): List<TaskBatchDto> = api.batches()

    suspend fun markItemDone(itemId: Long, reason: String, notes: String? = null): MarkDoneResponse =
        api.markItemDone(itemId, MarkDoneBody(reason = reason, notes = notes))

    suspend fun undoItemDone(itemId: Long): MarkDoneResponse = api.undoItemDone(itemId)
}
