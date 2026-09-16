// SalesEvent dispatcher: quote viewed, reserve TTL, overdue invoices, low stock,
// replenish due, cadence steps. Each tick is idempotent enough to run often.

import { prisma } from '../../lib/prisma'
import * as stock from './stock.service'
import * as activity from './activity.service'
import { hasFeature } from '../../lib/tenant-context'
import { perTenant } from '../tenant-runner'

const n = (v: unknown) => (v == null ? 0 : Number(v))

export async function bumpLeadScore(leadId: bigint | null | undefined, delta: number, reason: string) {
  if (!leadId || !delta) return
  await prisma.lead.update({
    where: { id: leadId },
    data: { leadScore: { increment: delta } },
  }).catch(() => undefined)
  await activity.recordSafe({
    entityType: 'lead',
    entityId: leadId,
    kind: 'system',
    subject: `Sales signal +${delta}: ${reason}`,
    meta: { delta, reason },
  })
}

export async function leadIdForQuote(quote: { dealId: bigint | null }): Promise<bigint | null> {
  if (quote.dealId) {
    const deal = await prisma.deal.findUnique({ where: { id: quote.dealId }, select: { leadId: true } })
    if (deal?.leadId) return deal.leadId
  }
  return null
}

function healthOf(opts: { daysSinceOrder: number | null; overdueValue: number; rmaCount: number }): 'green' | 'amber' | 'red' {
  if (opts.overdueValue > 0 || opts.rmaCount >= 3) return 'red'
  if ((opts.daysSinceOrder != null && opts.daysSinceOrder > 90) || opts.rmaCount > 0) return 'amber'
  return 'green'
}

export async function refreshAccountHealth(accountId: bigint) {
  const [account, invoices, rmas] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { lastOrderedAt: true, replenishDays: true } }),
    prisma.crmInvoice.findMany({
      where: { accountId, status: { in: ['sent', 'partial'] } },
      select: { total: true, amountPaid: true, dueDate: true },
    }),
    prisma.creditNote.count({ where: { accountId } }),
  ])
  if (!account) return
  const overdueValue = invoices.reduce((s, i) => {
    const bal = n(i.total) - n(i.amountPaid)
    if (bal > 0 && i.dueDate && i.dueDate < new Date()) return s + bal
    return s
  }, 0)
  const daysSinceOrder = account.lastOrderedAt
    ? Math.floor((Date.now() - account.lastOrderedAt.getTime()) / 86_400_000)
    : null
  const health = healthOf({ daysSinceOrder, overdueValue, rmaCount: rmas })
  await prisma.account.update({ where: { id: accountId }, data: { health } })
}

export interface DispatcherResult {
  expiredReserves: number
  overdueInvoices: number
  lowStock: number
  replenishDue: number
  cadenceSteps: number
}

/**
 * One sweep of product-sales automations. Safe to call from a scheduler or an admin button.
 */
export async function dispatchSalesEvents(): Promise<DispatcherResult> {
  const result: DispatcherResult = {
    expiredReserves: 0,
    overdueInvoices: 0,
    lowStock: 0,
    replenishDue: 0,
    cadenceSteps: 0,
  }
  if (!hasFeature('sales_docs') && !hasFeature('deals')) return result

  const now = new Date()

  const staleQuotes = await prisma.quote.findMany({
    where: {
      reservedUntil: { lt: now },
      status: { in: ['sent', 'viewed', 'expired', 'rejected'] },
    },
    include: { items: true },
    take: 50,
  })
  for (const q of staleQuotes) {
    try {
      await stock.releaseLines(
        q.items.map((l) => ({ productId: l.productId, quantity: n(l.quantity) })),
        { type: 'quote', id: q.id },
        null,
      )
      await prisma.quote.update({
        where: { id: q.id },
        data: {
          reservedUntil: null,
          ...(q.status === 'sent' || q.status === 'viewed' ? { status: 'expired', decidedAt: now } : {}),
        },
      })
      result.expiredReserves++
    } catch {
      /* keep going */
    }
  }

  const overdue = await prisma.crmInvoice.findMany({
    where: {
      status: { in: ['sent', 'partial'] },
      dueDate: { lt: now },
    },
    take: 40,
    select: { id: true, invoiceNumber: true, accountId: true, ownerId: true, total: true, amountPaid: true },
  })
  for (const inv of overdue) {
    if (inv.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: inv.accountId,
        kind: 'system',
        subject: `Invoice ${inv.invoiceNumber} is overdue`,
        meta: { invoiceId: Number(inv.id) },
      })
      await refreshAccountHealth(inv.accountId)
    }
    result.overdueInvoices++
  }

  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, name: true, sku: true, stockQuantity: true, reservedQuantity: true, minStockLevel: true },
    take: 200,
  })
  for (const p of products) {
    const status = stock.stockStatus(n(p.stockQuantity), n(p.reservedQuantity), n(p.minStockLevel))
    if (status === 'low_stock' || status === 'out_of_stock') {
      result.lowStock++
    }
  }

  const accounts = await prisma.account.findMany({
    where: { trash: 0, lastOrderedAt: { not: null }, replenishDays: { not: null } },
    select: { id: true, name: true, lastOrderedAt: true, replenishDays: true, ownerId: true },
    take: 80,
  })
  for (const a of accounts) {
    const due = a.lastOrderedAt && a.replenishDays
      ? new Date(a.lastOrderedAt.getTime() + a.replenishDays * 86_400_000)
      : null
    if (due && due <= now) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: a.id,
        kind: 'system',
        subject: `${a.name} is due to replenish`,
        meta: { replenishDue: due.toISOString() },
      })
      result.replenishDue++
    }
  }

  const dueEnrollments = await prisma.cadenceEnrollment.findMany({
    where: { status: 'active', nextAt: { lte: now } },
    include: { cadence: { include: { steps: { orderBy: { sortOrder: 'asc' } } } } },
    take: 40,
  })
  for (const en of dueEnrollments) {
    const step = en.cadence.steps[en.stepIndex]
    if (!step) {
      await prisma.cadenceEnrollment.update({ where: { id: en.id }, data: { status: 'completed', nextAt: null } })
      continue
    }
    await activity.recordSafe({
      entityType: 'lead',
      entityId: en.leadId,
      kind: step.channel === 'call' ? 'call' : step.channel === 'whatsapp' ? 'whatsapp' : 'email',
      subject: step.subject || `Cadence: ${en.cadence.name} · day ${step.dayOffset}`,
      body: step.body,
      meta: { cadenceId: Number(en.cadenceId), stepIndex: en.stepIndex, eventKey: step.eventKey },
    })
    const next = en.cadence.steps[en.stepIndex + 1]
    await prisma.cadenceEnrollment.update({
      where: { id: en.id },
      data: next
        ? {
            stepIndex: en.stepIndex + 1,
            nextAt: new Date(en.startedAt.getTime() + next.dayOffset * 86_400_000),
          }
        : { status: 'completed', nextAt: null, stepIndex: en.stepIndex + 1 },
    })
    result.cadenceSteps++
  }

  const hours = Number(
    (await prisma.systemSetting.findUnique({ where: { key: 'first_response_hours' } }))?.value || 4,
  )
  const cutoff = new Date(Date.now() - hours * 3600_000)
  const breached = await prisma.lead.findMany({
    where: { trash: 0, called: { not: 1 }, wapp: { not: 1 }, createdAt: { lt: cutoff } },
    select: { id: true, name: true },
    take: 20,
  })
  for (const l of breached) {
    await activity.recordSafe({
      entityType: 'lead',
      entityId: l.id,
      kind: 'system',
      subject: `First-response SLA breached (${hours}h)`,
      sourceType: 'sla',
      sourceId: l.id,
    })
  }

  return result
}

let timer: NodeJS.Timeout | null = null

export function startSalesDispatcher() {
  if (timer) return
  const tick = perTenant('sales-events', async () => {
    await dispatchSalesEvents()
  })
  setTimeout(() => void tick(), 45_000).unref?.()
  timer = setInterval(() => void tick(), 5 * 60_000)
  timer.unref?.()
}
