import { prisma } from '../../lib/prisma'

// Keep each transaction bounded. Imported production databases can contain
// hundreds of related rows per lead, so a 1,000-ID transaction can easily run
// past Prisma's interactive-transaction timeout.
const DELETE_BATCH_SIZE = 250
const DELETE_TRANSACTION_TIMEOUT_MS = 60_000

/**
 * Permanently delete leads and every row protected by a restrictive lead FK.
 *
 * Nullable historical links (campaign mail, inbound mail and mobile calls) are
 * retained and detached from the lead. All owned lead data is deleted in the
 * same transaction as its lead. IDs are chunked to stay below PostgreSQL's
 * parameter limit when Empty Trash is used on a large imported database.
 */
export async function permanentlyDeleteLeads(ids: bigint[]): Promise<number> {
  const uniqueIds = [...new Set(ids)]
  let deleted = 0

  for (let offset = 0; offset < uniqueIds.length; offset += DELETE_BATCH_SIZE) {
    const batch = uniqueIds.slice(offset, offset + DELETE_BATCH_SIZE)

    deleted += await prisma.$transaction(
      async (tx) => {
        const whereLeadId = { leadId: { in: batch } }

        // These records remain useful as history and their lead FK is nullable.
        await tx.mobileCall.updateMany({ where: whereLeadId, data: { leadId: null } })
        await tx.emailCampaignRecipient.updateMany({ where: whereLeadId, data: { leadId: null } })
        await tx.inboundMail.updateMany({ where: whereLeadId, data: { leadId: null } })

        // Remove every record whose FK uses ON DELETE RESTRICT.
        await tx.asignedLead.deleteMany({ where: { stdId: { in: batch } } })
        await tx.leadFollowup.deleteMany({ where: { stdId: { in: batch } } })
        await tx.leadNote.deleteMany({ where: whereLeadId })
        await tx.leadComment.deleteMany({ where: whereLeadId })
        await tx.reminder.deleteMany({ where: whereLeadId })
        await tx.callLog.deleteMany({ where: whereLeadId })
        await tx.leadStatusHistory.deleteMany({ where: whereLeadId })
        await tx.studentMailHistory.deleteMany({ where: whereLeadId })
        await tx.studentDocument.deleteMany({ where: whereLeadId })
        await tx.studentSchoolHistory.deleteMany({ where: whereLeadId })
        await tx.studentExamUcat.deleteMany({ where: whereLeadId })
        await tx.studentExamDmat.deleteMany({ where: whereLeadId })
        await tx.studentExamSat.deleteMany({ where: whereLeadId })
        await tx.studentFeedback.deleteMany({ where: whereLeadId })

        const result = await tx.lead.deleteMany({ where: { id: { in: batch } } })
        return result.count
      },
      {
        maxWait: 10_000,
        timeout: DELETE_TRANSACTION_TIMEOUT_MS,
      },
    )
  }

  return deleted
}
