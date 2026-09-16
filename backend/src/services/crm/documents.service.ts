// ─────────────────────────────────────────────────────────────────────────────
// Line items and totals, shared by quotes, orders and invoices.
//
// All three documents carry the same line shape and the same arithmetic. Three
// copies of it is how a quote and the invoice raised from it end up disagreeing
// by a rupee, so there is one copy, here, and every document goes through it.
//
// TOTALS ARE NEVER ACCEPTED FROM A CLIENT. They are recomputed from the lines
// on every write. A total a caller can post is a total that will eventually
// stop matching the lines underneath it.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import { summarize, type LineInput } from './deals.service'

export type DocumentKind = 'quote' | 'order' | 'invoice'

export interface LineBody {
  productId?: number | null
  name: string
  sku?: string | null
  quantity: number
  unitPrice: number
  discountPercent: number
  taxPercent: number
}

/**
 * Recompute a document's header totals from its lines.
 *
 * Called after every line insert, update and delete. For an invoice it also
 * refreshes `status` from what has been paid, because "is this paid?" is a fact
 * about the payments, not something anybody should be setting by hand.
 */
export async function recalc(kind: DocumentKind, id: bigint): Promise<void> {
  if (kind === 'quote') {
    const items = await prisma.quoteItem.findMany({ where: { quoteId: id } })
    const t = summarize(items.map(toLineInput))
    await prisma.quote.update({ where: { id }, data: t })
    return
  }

  if (kind === 'order') {
    const items = await prisma.orderItem.findMany({ where: { orderId: id } })
    const t = summarize(items.map(toLineInput))
    await prisma.order.update({ where: { id }, data: t })
    return
  }

  const items = await prisma.crmInvoiceItem.findMany({ where: { invoiceId: id } })
  const t = summarize(items.map(toLineInput))

  const invoice = await prisma.crmInvoice.findUnique({ where: { id }, select: { status: true } })
  const paid = await paidTotal(id)

  await prisma.crmInvoice.update({
    where: { id },
    data: { ...t, amountPaid: paid, status: invoiceStatus(invoice?.status ?? 'draft', t.total, paid) },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLineInput(l: any): LineInput {
  return {
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discountPercent: Number(l.discountPercent),
    taxPercent: Number(l.taxPercent),
  }
}

export async function paidTotal(invoiceId: bigint): Promise<number> {
  const rows = await prisma.crmPayment.findMany({ where: { invoiceId }, select: { amount: true } })
  return Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100
}

/**
 * Where an invoice stands, given its total and what has been received.
 *
 * MONEY RECEIVED MEANS IT IS NOT A DRAFT. This used to preserve `draft` on the
 * reasoning that a draft is not a claim on anybody yet — true right up until
 * somebody pays it. An invoice raised from an order starts as a draft, so a
 * payment against one left it reading "draft" with a part-paid balance forever,
 * invisible to both the ageing report and the overdue filter. Caught by
 * scripts/smoke-b2b-flow.ts.
 *
 * `cancelled` IS still sticky. A payment landing against a cancelled invoice is
 * a real-world mess — a refund, or money applied to the wrong invoice — and it
 * needs a person, not an automatic flip back to "paid".
 *
 * Note `overdue` is absent on purpose — it is derived on read from the due date
 * (see isOverdue), so it can never be a stale stored flag waiting on a nightly
 * job that did not run.
 */
export function invoiceStatus(current: string, total: number, paid: number): string {
  if (current === 'cancelled') return current
  if (total > 0 && paid >= total) return 'paid'
  if (paid > 0) return 'partial'
  // Nothing received yet: a draft stays a draft until somebody sends it.
  return current === 'draft' ? 'draft' : 'sent'
}

export function isOverdue(inv: { status: string; dueDate: Date | null }): boolean {
  if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'draft') return false
  if (!inv.dueDate) return false
  return new Date(inv.dueDate).getTime() < Date.now()
}

/**
 * Next number in a series: QUO-000042, ORD-000042, INV-000042.
 *
 * Derived from the row's own id rather than a counter, because two people
 * raising an invoice at the same instant against a shared counter is a
 * duplicate number, and a duplicate invoice number is an accounting problem
 * rather than a software one.
 */
export function documentNumber(prefix: string, id: bigint | number): string {
  return `${prefix}-${String(id).padStart(6, '0')}`
}

/**
 * Copy the lines of one document onto another — quote → order, order → invoice.
 *
 * The whole point of the chain: nobody retypes twelve lines to turn an accepted
 * quote into an order. Prices are copied as they stood on the source, not
 * re-read from the product catalogue, so a price rise between quoting and
 * invoicing cannot silently change what the customer agreed to pay.
 */
export async function copyLines(
  from: { kind: DocumentKind; id: bigint },
  to: { kind: DocumentKind; id: bigint },
): Promise<number> {
  const source =
    from.kind === 'quote'
      ? await prisma.quoteItem.findMany({ where: { quoteId: from.id }, orderBy: { sortOrder: 'asc' } })
      : from.kind === 'order'
        ? await prisma.orderItem.findMany({ where: { orderId: from.id }, orderBy: { sortOrder: 'asc' } })
        : await prisma.crmInvoiceItem.findMany({
            where: { invoiceId: from.id },
            orderBy: { sortOrder: 'asc' },
          })

  if (!source.length) return 0

  const rows = source.map((l, i) => ({
    productId: l.productId,
    name: l.name,
    sku: l.sku,
    hsnCode: 'hsnCode' in l ? (l as { hsnCode?: string | null }).hsnCode ?? null : null,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    taxPercent: l.taxPercent,
    total: l.total,
    sortOrder: i * 10,
  }))

  if (to.kind === 'quote') {
    await prisma.quoteItem.createMany({ data: rows.map((r) => ({ ...r, quoteId: to.id })) })
  } else if (to.kind === 'order') {
    await prisma.orderItem.createMany({ data: rows.map((r) => ({ ...r, orderId: to.id })) })
  } else {
    await prisma.crmInvoiceItem.createMany({ data: rows.map((r) => ({ ...r, invoiceId: to.id })) })
  }

  await recalc(to.kind, to.id)
  return rows.length
}
