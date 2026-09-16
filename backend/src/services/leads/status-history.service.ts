import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'
import type { Prisma, PrismaClient } from '@prisma/client'

export type StatusChangeSource = 'manual' | 'call' | 'followup' | 'bulk' | 'api'

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/**
 * Appends a row to lead_status_history if either status or sub_status changed.
 * Safe to call inside or outside a transaction — pass `tx` when nested.
 */
export async function recordStatusChange(args: {
  leadId: bigint
  changedById: bigint
  fromStatus?: string | null
  toStatus: string
  fromSubStatus?: string | null
  toSubStatus?: string | null
  reason?: string
  source?: StatusChangeSource
  tx?: TxClient | Prisma.TransactionClient
}) {
  const client = args.tx ?? prisma
  const statusChanged = (args.fromStatus ?? null) !== args.toStatus
  const subChanged = (args.fromSubStatus ?? null) !== (args.toSubStatus ?? null)
  if (!statusChanged && !subChanged) return null

  // Lead score: +3 whenever the main leadStatus actually changes. Sub-status
  // only changes don't count (they're finer-grained and would double-fire on
  // every follow-up). Fires from every caller — followup, call-outcome, bulk,
  // manual — because the increment lives inside the shared service.
  if (statusChanged) {
    await client.lead.update({
      where: { id: args.leadId },
      data: { leadScore: { increment: 3 } },
    })
  }

  return client.leadStatusHistory.create({
    data: {
      leadId: args.leadId,
      changedById: args.changedById,
      fromStatus: args.fromStatus ?? null,
      toStatus: args.toStatus,
      fromSubStatus: args.fromSubStatus ?? null,
      toSubStatus: args.toSubStatus ?? null,
      reason: args.reason ?? null,
      source: args.source ?? 'manual',
    },
  })
}

/** Get full history of a lead, newest first. */
export async function getStatusHistory(leadId: bigint, limit = 100) {
  const rows = await prisma.leadStatusHistory.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { changedBy: { select: { id: true, name: true } } },
  })
  return bigintFix(rows)
}
