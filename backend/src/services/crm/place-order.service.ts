// Quote → order: dispatch stock, auto-raise invoice, stamp the account.

import { prisma } from '../../lib/prisma'
import { documentNumber, copyLines, recalc } from './documents.service'
import * as stock from './stock.service'
import * as activity from './activity.service'
import { markLeadBySlug } from '../leads/lifecycle.service'

const n = (v: unknown) => (v == null ? 0 : Number(v))

export class PlaceOrderError extends Error {
  status: number
  extra?: Record<string, unknown>
  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export async function creditBlocked(accountId: bigint | null): Promise<string | null> {
  if (!accountId) return null
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account?.creditLimit) return null
  const invoices = await prisma.crmInvoice.findMany({
    where: { accountId, status: { in: ['sent', 'partial', 'draft'] } },
    select: { total: true, amountPaid: true, dueDate: true, status: true },
  })
  const outstanding = invoices.reduce((s, i) => s + Math.max(0, n(i.total) - n(i.amountPaid)), 0)
  const overdue = invoices.some((i) => i.dueDate && i.dueDate < new Date() && n(i.total) > n(i.amountPaid))
  if (outstanding > n(account.creditLimit) && overdue) {
    return `This account is over its credit limit (₹${n(account.creditLimit).toLocaleString('en-IN')}) with overdue invoices.`
  }
  return null
}

export async function placeOrderFromQuote(opts: {
  quoteId: bigint
  actorId: bigint
  skipCredit?: boolean
}): Promise<{ orderId: bigint; orderNumber: string; invoiceId?: bigint; invoiceNumber?: string }> {
  const quote = await prisma.quote.findUnique({
    where: { id: opts.quoteId },
    include: { items: true },
  })
  if (!quote) throw new PlaceOrderError('Quote not found', 404)

  const existing = await prisma.order.findFirst({ where: { quoteId: quote.id } })
  if (existing) {
    throw new PlaceOrderError(`This quote is already order ${existing.orderNumber}.`, 409, {
      orderId: Number(existing.id),
    })
  }

  if (quote.approvalStatus === 'pending') {
    throw new PlaceOrderError('This quote is waiting for manager approval.', 409)
  }

  if (!opts.skipCredit) {
    const block = await creditBlocked(quote.accountId)
    if (block) throw new PlaceOrderError(block, 409)
  }

  const contract = await prisma.contract.findFirst({
    where: {
      status: { in: ['signed', 'active', 'sent', 'under_review', 'draft'] },
      OR: [{ quoteId: quote.id }, ...(quote.dealId ? [{ dealId: quote.dealId, quoteId: null }] : [])],
    },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  })

  const order = await prisma.order.create({
    data: {
      orderNumber: 'PENDING',
      accountId: quote.accountId,
      contactId: quote.contactId,
      dealId: quote.dealId,
      quoteId: quote.id,
      contractId: contract?.id ?? null,
      currency: quote.currency,
      ownerId: opts.actorId,
      status: 'confirmed',
    },
  })

  const numbered = await prisma.order.update({
    where: { id: order.id },
    data: { orderNumber: documentNumber('ORD', order.id) },
  })

  await copyLines({ kind: 'quote', id: quote.id }, { kind: 'order', id: order.id })

  const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
  await stock.dispatchLines(
    lines.map((l) => ({ productId: l.productId, quantity: n(l.quantity) })),
    { type: 'order', id: order.id },
    opts.actorId,
  )

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: 'accepted', decidedAt: new Date() },
  })

  if (quote.accountId) {
    await prisma.account.update({
      where: { id: quote.accountId },
      data: { lastOrderedAt: new Date(), status: 'active' },
    })
  }

  let invoiceId: bigint | undefined
  let invoiceNumber: string | undefined
  if (lines.length) {
    const invoice = await prisma.crmInvoice.create({
      data: {
        invoiceNumber: 'PENDING',
        accountId: quote.accountId,
        contactId: quote.contactId,
        dealId: quote.dealId,
        orderId: order.id,
        currency: quote.currency,
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        ownerId: opts.actorId,
        createdById: opts.actorId,
      },
    })
    invoiceNumber = documentNumber('INV', invoice.id)
    await prisma.crmInvoice.update({ where: { id: invoice.id }, data: { invoiceNumber } })
    await copyLines({ kind: 'order', id: order.id }, { kind: 'invoice', id: invoice.id })
    invoiceId = invoice.id
  }

  if (quote.dealId) {
    await activity.recordSafe({
      entityType: 'deal',
      entityId: quote.dealId,
      kind: 'quote',
      subject: `Quote ${quote.quoteNumber} converted to order ${numbered.orderNumber}`,
      actorId: Number(opts.actorId),
      meta: { orderId: Number(order.id), invoiceId: invoiceId ? Number(invoiceId) : undefined },
    })
  }
  if (quote.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: quote.accountId,
      kind: 'system',
      subject: `Order ${numbered.orderNumber} placed`,
      actorId: Number(opts.actorId),
      meta: { orderId: Number(order.id) },
    })
  }

  return {
    orderId: numbered.id,
    orderNumber: numbered.orderNumber,
    invoiceId,
    invoiceNumber,
  }
}

async function copyDealLines(dealId: bigint, orderId: bigint): Promise<number> {
  const lines = await prisma.dealProduct.findMany({ where: { dealId }, orderBy: { sortOrder: 'asc' } })
  if (!lines.length) throw new PlaceOrderError('Add products to the deal first.', 400)

  const productIds = lines.map((l) => l.productId).filter(Boolean) as bigint[]
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, hsnCode: true } })
    : []
  const hsn = new Map(products.map((p) => [String(p.id), p.hsnCode]))

  await prisma.orderItem.createMany({
    data: lines.map((l, i) => ({
      orderId,
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      hsnCode: l.productId ? hsn.get(String(l.productId)) ?? null : null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxPercent: l.taxPercent,
      total: l.total,
      sortOrder: i * 10,
    })),
  })
  await recalc('order', orderId)
  return lines.length
}

/**
 * Won deal → order + invoice, billed to the lead. One live order per deal.
 * Does not reserve stock or check account credit — this path has no company.
 */
export async function placeOrderFromDeal(opts: {
  dealId: bigint
  actorId: bigint
}): Promise<{ orderId: bigint; orderNumber: string; invoiceId?: bigint; invoiceNumber?: string }> {
  const deal = await prisma.deal.findUnique({ where: { id: opts.dealId }, include: { stage: true } })
  if (!deal) throw new PlaceOrderError('Deal not found', 404)
  if (!deal.stage?.isWon) {
    throw new PlaceOrderError('Confirm this deal first, then place the order from its line items.', 400)
  }

  const existing = await prisma.order.findFirst({
    where: { dealId: deal.id, status: { not: 'cancelled' } },
  })
  if (existing) {
    throw new PlaceOrderError(`This deal is already order ${existing.orderNumber}.`, 409, {
      orderId: Number(existing.id),
    })
  }

  const order = await prisma.order.create({
    data: {
      orderNumber: 'PENDING',
      accountId: deal.accountId,
      contactId: deal.primaryContactId,
      dealId: deal.id,
      leadId: deal.leadId,
      currency: deal.currency,
      ownerId: opts.actorId,
      status: 'confirmed',
    },
  })

  const numbered = await prisma.order.update({
    where: { id: order.id },
    data: { orderNumber: documentNumber('ORD', order.id) },
  })

  await copyDealLines(deal.id, order.id)
  const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })

  let invoiceId: bigint | undefined
  let invoiceNumber: string | undefined
  if (lines.length) {
    const invoice = await prisma.crmInvoice.create({
      data: {
        invoiceNumber: 'PENDING',
        accountId: deal.accountId,
        contactId: deal.primaryContactId,
        dealId: deal.id,
        leadId: deal.leadId,
        orderId: order.id,
        currency: deal.currency,
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        ownerId: opts.actorId,
        createdById: opts.actorId,
      },
    })
    invoiceNumber = documentNumber('INV', invoice.id)
    await prisma.crmInvoice.update({ where: { id: invoice.id }, data: { invoiceNumber } })
    await copyLines({ kind: 'order', id: order.id }, { kind: 'invoice', id: invoice.id })
    invoiceId = invoice.id
  }

  if (deal.leadId) {
    await markLeadBySlug(deal.leadId, 'confirmed', opts.actorId, `Order ${numbered.orderNumber} placed`)
  }

  await activity.recordSafe({
    entityType: 'deal',
    entityId: deal.id,
    kind: 'system',
    subject: `Order ${numbered.orderNumber} placed${invoiceNumber ? ` · invoice ${invoiceNumber}` : ''}`,
    actorId: Number(opts.actorId),
    meta: { orderId: Number(order.id), invoiceId: invoiceId ? Number(invoiceId) : undefined },
  })

  return {
    orderId: numbered.id,
    orderNumber: numbered.orderNumber,
    invoiceId,
    invoiceNumber,
  }
}
