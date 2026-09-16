import { prisma } from '../../lib/prisma'
import { recordStatusChange } from './status-history.service'
import { resolveStatusCascade } from './status-cascade.service'

/**
 * Move a lead onto a lifecycle status by slug (catalog-sent, confirmed, lost).
 * No-op if the status is missing or the lead is already there.
 */
export async function markLeadBySlug(
  leadId: bigint,
  slug: string,
  userId: bigint,
  reason: string,
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { leadStatus: true, leadSubStatus: true, leadStatusId: true, departmentId: true },
  })
  if (!lead) return

  const status = await prisma.leadStatus.findFirst({
    where: {
      slug,
      status: 1,
      ...(lead.departmentId ? { departmentId: lead.departmentId } : {}),
    },
    select: { id: true, title: true },
  })
  if (!status || lead.leadStatusId === status.id) return

  const cascade = await resolveStatusCascade({
    leadStatusId: status.id,
    currentDepartmentId: lead.departmentId,
  })
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      leadStatusId: status.id,
      leadStatus: cascade.leadStatus ?? status.title,
      ...(cascade.departmentId !== undefined ? { departmentId: cascade.departmentId } : {}),
      ...(cascade.statusLeadTypeId !== undefined ? { statusLeadTypeId: cascade.statusLeadTypeId } : {}),
    },
  })
  await recordStatusChange({
    leadId,
    changedById: userId,
    fromStatus: lead.leadStatus,
    toStatus: cascade.leadStatus ?? status.title,
    fromSubStatus: lead.leadSubStatus,
    toSubStatus: lead.leadSubStatus,
    reason,
    source: 'api',
  })
}
