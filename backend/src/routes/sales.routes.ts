// ─────────────────────────────────────────────────────────────────────────────
// The sales document chain.
//
//   Deal ──▶ Quote ──▶ Order ──▶ Invoice ──▶ Payment
//              └─────▶ Contract
//
// Four routers exported from one file because they share the line-item
// endpoints and the same totals service, and splitting them would mean four
// copies of the same twenty lines.
//
// Every link in the chain is optional in both directions — plenty of businesses
// invoice without ever quoting.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'
import * as activity from '../services/crm/activity.service'
import { bigintFix } from '../services/crm/serialize'
import { lineTotal } from '../services/crm/deals.service'
import {
  recalc, copyLines, documentNumber, isOverdue, paidTotal, invoiceStatus,
} from '../services/crm/documents.service'
import { renderQuoteHtml, renderQuoteEmailIntro } from '../services/crm/quote-document'
import { buildQuoteDoc, isQuoteExpired } from '../services/crm/quote-builder'
import { buildQuotePdf } from '../services/crm/quote-pdf'
import { publicQuoteUrl } from '../services/crm/quote-links'
import { buildInvoiceDoc, renderInvoiceHtml, renderInvoiceEmailIntro, buildInvoicePdf, buildContractDoc, renderContractHtml, buildContractPdf, buildDispatchDoc, renderDispatchHtml, buildDispatchPdf } from '../services/crm/document-pdf'
import { placeOrderFromQuote, PlaceOrderError } from '../services/crm/place-order.service'
import * as stock from '../services/crm/stock.service'
import { emailService } from '../services/email.service'
import { notifyFulfillment } from '../services/crm/fulfillment-notify.service'
import { bumpLeadScore, leadIdForQuote } from '../services/crm/sales-events.service'
import { resolvePrice } from '../services/crm/pricing.service'

export const quotesRoutes = new Hono()
export const contractsRoutes = new Hono()
export const ordersRoutes = new Hono()
export const invoicesRoutes = new Hono()

for (const r of [quotesRoutes, contractsRoutes, ordersRoutes, invoicesRoutes]) {
  r.use('*', authenticate)
}

const lineBody = z.object({
  productId: z.number().nullish(),
  name: z.string().min(1).max(180),
  sku: z.string().max(60).nullish(),
  hsnCode: z.string().max(20).nullish(),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().default(0),
  discountPercent: z.number().min(0).max(100).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
})

/** Account names for a page of documents, in one query rather than N. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withAccounts<T extends { accountId: bigint | null; leadId?: bigint | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.accountId).filter(Boolean))] as bigint[]
  const accounts = ids.length
    ? await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : []
  const byId = new Map(accounts.map((a) => [String(a.id), a]))
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))] as bigint[]
  const leads = leadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })
    : []
  const byLead = new Map(leads.map((l) => [String(l.id), l]))
  return rows.map((r) => ({
    ...bigintFix(r),
    account: r.accountId ? (byId.get(String(r.accountId)) ?? null) : null,
    lead: r.leadId ? (byLead.get(String(r.leadId)) ?? null) : null,
  }))
}

// ═══ QUOTES ══════════════════════════════════════════════════════════════════

quotesRoutes.get('/', async (c) => {
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)

  const where = {
    ...(q.status ? { status: { in: q.status.split(',').filter(Boolean) } } : {}),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    ...(q.dealId ? { dealId: BigInt(q.dealId) } : {}),
    ...(q.ownerId ? { ownerId: BigInt(q.ownerId) } : {}),
    ...(q.search ? { quoteNumber: { contains: q.search.trim(), mode: 'insensitive' as const } } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: { issueDate: 'desc' },
      skip,
      take: limit,
      include: { owner: { select: { id: true, name: true } }, _count: { select: { items: true } } },
    }),
    prisma.quote.count({ where }),
  ])

  const list = (await withAccounts(rows)).map((r, i) => ({ ...r, expiredByDate: isQuoteExpired(rows[i]) }))
  return c.json(buildPaginatedResult(list, total, page, limit))
})

// GET /api/quotes/summary/overview — the numbers the Quotes page opens with.
//
// "Awaiting decision" is the figure that matters: money that has been asked
// for and not yet answered. Expiring soon is the subset of it that needs a
// call this week.
quotesRoutes.get('/summary/overview', async (c) => {
  const rows = await prisma.quote.findMany({
    select: { status: true, total: true, validUntil: true, decidedAt: true, sentAt: true },
  })
  const num = (v: unknown) => (v == null ? 0 : Number(v))
  const now = Date.now()
  const week = now + 7 * 86_400_000
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const live = rows.filter((r) => ['sent', 'viewed'].includes(r.status) && !isQuoteExpired(r))
  const expiring = live.filter((r) => r.validUntil && new Date(r.validUntil).getTime() <= week)
  const expired = rows.filter((r) => r.status === 'expired' || isQuoteExpired(r))
  const acceptedMonth = rows.filter((r) => r.status === 'accepted' && r.decidedAt && r.decidedAt >= monthStart)
  const decided = rows.filter((r) => ['accepted', 'rejected'].includes(r.status))
  const won = decided.filter((r) => r.status === 'accepted')

  const sum = (list: typeof rows) => Math.round(list.reduce((t, r) => t + num(r.total), 0) * 100) / 100

  return c.json({
    drafts: { count: rows.filter((r) => r.status === 'draft').length, value: sum(rows.filter((r) => r.status === 'draft')) },
    awaiting: { count: live.length, value: sum(live) },
    expiringSoon: { count: expiring.length, value: sum(expiring) },
    expired: { count: expired.length, value: sum(expired) },
    acceptedThisMonth: { count: acceptedMonth.length, value: sum(acceptedMonth) },
    acceptRate: decided.length ? Math.round((won.length / decided.length) * 100) : null,
  })
})

// GET /api/quotes/:id/document — the printable/emailable document itself.
//
// Returns HTML, not JSON: it is the same markup the customer receives, so the
// preview cannot drift from what was sent. The browser's Print → Save as PDF
// produces the file when somebody needs one.
quotesRoutes.get('/:id/document', async (c) => {
  const doc = await buildQuoteDoc(BigInt(c.req.param('id')))
  if (!doc) return c.json({ error: 'Quote not found' }, 404)
  return c.html(renderQuoteHtml(doc))
})

// GET /api/quotes/:id/pdf — the same document as a file.
quotesRoutes.get('/:id/pdf', async (c) => {
  const doc = await buildQuoteDoc(BigInt(c.req.param('id')))
  if (!doc) return c.json({ error: 'Quote not found' }, 404)
  const pdf = await buildQuotePdf(doc)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="${doc.quoteNumber}.pdf"`)
  return c.body(new Uint8Array(pdf))
})

// POST /api/quotes/:id/revise — a fresh draft carrying everything across.
//
// A customer who wants two lines changed does not want a quote that reads
// "accepted" with different numbers to the ones they saw. So the original is
// left as it stands, marked superseded (`expired`), and the revision starts as
// a new draft with the same lines, terms and recipient — edit, then send.
quotesRoutes.post('/:id/revise', async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  const quote = await prisma.quote.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
  if (!quote) return c.json({ error: 'Quote not found' }, 404)

  const converted = await prisma.order.count({ where: { quoteId: id } })
  if (converted) return c.json({ error: 'This quote already became an order. Raise a new quote instead.' }, 409)

  const created = await prisma.quote.create({
    data: {
      quoteNumber: 'PENDING',
      version: quote.version + 1,
      parentQuoteId: quote.parentQuoteId ?? quote.id,
      accountId: quote.accountId,
      contactId: quote.contactId,
      dealId: quote.dealId,
      currency: quote.currency,
      validUntil: null,
      paymentTerms: quote.paymentTerms,
      deliveryTerms: quote.deliveryTerms,
      notes: quote.notes,
      ownerId: quote.ownerId ?? BigInt(user.userId),
      createdById: BigInt(user.userId),
    },
  })
  const revision = await prisma.quote.update({
    where: { id: created.id },
    data: { quoteNumber: documentNumber('QUO', created.id) },
  })

  if (quote.items.length) {
    await prisma.quoteItem.createMany({
      data: quote.items.map((l, i) => ({
        quoteId: created.id,
        productId: l.productId,
        name: l.name,
        sku: l.sku,
        hsnCode: l.hsnCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxPercent: l.taxPercent,
        total: l.total,
        sortOrder: i * 10,
      })),
    })
    await recalc('quote', created.id)
  }

  // The old one is no longer the offer on the table.
  if (!['accepted', 'rejected'].includes(quote.status)) {
    await prisma.quote.update({
      where: { id },
      data: {
        status: 'expired',
        notes: [quote.notes, `Superseded by ${revision.quoteNumber}.`].filter(Boolean).join('\n'),
      },
    })
  }

  if (quote.dealId) {
    await activity.recordSafe({
      entityType: 'deal',
      entityId: quote.dealId,
      kind: 'quote',
      subject: `Quote ${quote.quoteNumber} revised as ${revision.quoteNumber}`,
      actorId: user.userId,
      meta: { quoteId: Number(created.id), supersedes: Number(id) },
    })
  }

  return c.json(bigintFix(revision), 201)
})

// POST /api/quotes/:id/send — actually deliver it.
quotesRoutes.post(
  '/:id/send',
  zValidator(
    'json',
    z.object({
      to: z.string().email().optional(),
      cc: z.string().optional(),
      subject: z.string().max(200).optional(),
      message: z.string().max(4000).nullish(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')

    const doc = await buildQuoteDoc(id)
    if (!doc) return c.json({ error: 'Quote not found' }, 404)

    if (!doc.items.length) {
      return c.json({ error: 'This quote has no line items — there is nothing to send.' }, 400)
    }

    const to = body.to || doc.to.email
    if (!to) {
      return c.json(
        { error: 'No email address. Add one to the contact or the account, or type one in.' },
        400,
      )
    }

    const subject = body.subject || `Quotation ${doc.quoteNumber} from ${doc.from.name}`

    // The link is what turns "did they see it?" into a timestamp and "are they
    // going ahead?" into a click — see quote-links.ts. Absent when APP_URL is
    // not configured, in which case the mail is exactly what it was before.
    const link = publicQuoteUrl(id)
    const linkHtml = link
      ? `<div style="max-width:760px;margin:0 auto 18px auto;padding:0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
           <a href="${link}" style="display:inline-block;padding:11px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">View &amp; accept online</a>
           <span style="margin-left:12px;font-size:12px;color:#64748b">A PDF copy is attached.</span>
         </div>`
      : ''
    const html = renderQuoteEmailIntro(doc, body.message) + linkHtml + renderQuoteHtml(doc)

    let pdf: Buffer | null = null
    try {
      pdf = await buildQuotePdf(doc)
    } catch (err) {
      // A PDF that fails to render must not stop the quote going out; the
      // HTML body is the document too.
      console.error('[quotes] pdf render failed for', doc.quoteNumber, err)
    }

    try {
      await emailService.send({
        to,
        cc: body.cc ? body.cc.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
        subject,
        html,
        // The display name is the CUSTOMER's company, not the platform's.
        fromName: doc.from.name,
        replyTo: doc.from.email || undefined,
        attachments: pdf ? [{ filename: `${doc.quoteNumber}.pdf`, content: pdf, contentType: 'application/pdf' }] : undefined,
      })
    } catch (err) {
      // A failed send must not leave the quote marked sent — that is how a rep
      // ends up believing a customer has a quote they never received.
      return c.json(
        { error: `Could not send: ${err instanceof Error ? err.message : 'mail server rejected it'}` },
        502,
      )
    }

    const quote = await prisma.quote.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
    })
    await bumpLeadScore(await leadIdForQuote(quote), 10, `quote ${quote.quoteNumber} sent`)

    if (!quote.reservedUntil) {
      const items = await prisma.quoteItem.findMany({ where: { quoteId: id } })
      try {
        await stock.reserveLines(
          items.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
          { type: 'quote', id },
          BigInt(user.userId),
        )
        await prisma.quote.update({
          where: { id },
          data: { reservedUntil: new Date(Date.now() + 48 * 3600 * 1000) },
        })
      } catch (err) {
        console.error('[quotes] reserve failed', err)
      }
    }

    // Only when the quote actually belongs to a deal. `?? 0` here would write a
    // timeline row against deal zero — a row nothing will ever read again, and
    // exactly what entityExists() exists to prevent elsewhere.
    if (quote.dealId) {
      await activity.recordSafe({
        entityType: 'deal',
        entityId: quote.dealId,
        kind: 'quote',
        subject: `Quote ${quote.quoteNumber} emailed to ${to}`,
        actorId: user.userId,
        meta: { quoteId: Number(id), to },
      })
    }
    if (quote.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: quote.accountId,
        kind: 'email',
        subject: `Quote ${quote.quoteNumber} sent`,
        body: body.message ?? null,
        actorId: user.userId,
        meta: { quoteId: Number(id), to },
      })
    }

    return c.json({ success: true, to, sentAt: quote.sentAt })
  },
)

quotesRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      owner: { select: { id: true, name: true } },
      orders: { select: { id: true, orderNumber: true, status: true } },
    },
  })
  if (!quote) return c.json({ error: 'Quote not found' }, 404)

  const [account, contact, deal, invoices] = await Promise.all([
    quote.accountId
      ? prisma.account.findUnique({
          where: { id: quote.accountId },
          select: { id: true, name: true, email: true },
        })
      : null,
    // The send dialog pre-fills from this; without it a rep retypes the address
    // they already stored, every time.
    quote.contactId
      ? prisma.contact.findUnique({
          where: { id: quote.contactId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : null,
    quote.dealId
      ? prisma.deal.findUnique({ where: { id: quote.dealId }, select: { id: true, name: true, dealNumber: true } })
      : null,
    // What happened after: the invoices raised off the order this became.
    quote.orders.length
      ? prisma.crmInvoice.findMany({
          where: { orderId: { in: quote.orders.map((o) => o.id) } },
          select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true },
        })
      : [],
  ])

  return c.json({
    ...bigintFix(quote),
    account,
    deal: deal ? bigintFix(deal) : null,
    contact: contact
      ? {
          id: Number(contact.id),
          name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
          email: contact.email,
        }
      : null,
    /** Where a send would go by default: the contact, else the account. */
    defaultRecipient: contact?.email || account?.email || null,
    /** Derived on read — see isQuoteExpired. */
    expiredByDate: isQuoteExpired(quote),
    /** The customer's no-login page. Null until APP_URL is configured. */
    publicUrl: publicQuoteUrl(id),
    invoices: bigintFix(invoices),
  })
})

const quoteBody = z.object({
  accountId: z.number().nullish(),
  contactId: z.number().nullish(),
  dealId: z.number().nullish(),
  validUntil: z.string().nullish(),
  paymentTerms: z.string().max(255).nullish(),
  deliveryTerms: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  /** Seed the lines from a deal's products, so nobody retypes them. */
  copyFromDealId: z.number().nullish(),
})

quotesRoutes.post('/', zValidator('json', quoteBody), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const quote = await prisma.quote.create({
    data: {
      quoteNumber: 'PENDING',
      accountId: body.accountId ? BigInt(body.accountId) : null,
      contactId: body.contactId ? BigInt(body.contactId) : null,
      dealId: body.dealId ? BigInt(body.dealId) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      paymentTerms: body.paymentTerms ?? null,
      deliveryTerms: body.deliveryTerms ?? null,
      notes: body.notes ?? null,
      ownerId: BigInt(user.userId),
      createdById: BigInt(user.userId),
    },
  })

  const numbered = await prisma.quote.update({
    where: { id: quote.id },
    data: { quoteNumber: documentNumber('QUO', quote.id) },
  })

  // Carry the deal's line items across, priced as they stand on the deal.
  if (body.copyFromDealId) {
    const lines = await prisma.dealProduct.findMany({
      where: { dealId: BigInt(body.copyFromDealId) },
      orderBy: { sortOrder: 'asc' },
    })
    if (lines.length) {
      await prisma.quoteItem.createMany({
        data: lines.map((l, i) => ({
          quoteId: quote.id,
          productId: l.productId,
          name: l.name,
          sku: l.sku,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxPercent: l.taxPercent,
          total: l.total,
          sortOrder: i * 10,
        })),
      })
      await recalc('quote', quote.id)
    }
  }

  if (quote.dealId) {
    await activity.recordSafe({
      entityType: 'deal',
      entityId: quote.dealId,
      kind: 'quote',
      subject: `Quote ${numbered.quoteNumber} created`,
      actorId: user.userId,
      meta: { quoteId: Number(quote.id) },
    })
  }

  return c.json(bigintFix(numbered), 201)
})

quotesRoutes.patch('/:id', zValidator('json', quoteBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = c.req.valid('json')
  const row = await prisma.quote.update({
    where: { id },
    data: {
      ...(body.accountId !== undefined ? { accountId: body.accountId ? BigInt(body.accountId) : null } : {}),
      ...(body.contactId !== undefined ? { contactId: body.contactId ? BigInt(body.contactId) : null } : {}),
      ...(body.validUntil !== undefined
        ? { validUntil: body.validUntil ? new Date(body.validUntil) : null }
        : {}),
      ...(body.paymentTerms !== undefined ? { paymentTerms: body.paymentTerms } : {}),
      ...(body.deliveryTerms !== undefined ? { deliveryTerms: body.deliveryTerms } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  })
  return c.json(bigintFix(row))
})

// POST /api/quotes/:id/status — the document's lifecycle, kept off the general
// PATCH because each transition stamps a different timestamp.
quotesRoutes.post(
  '/:id/status',
  zValidator('json', z.object({ status: z.enum(['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired']) })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const { status } = c.req.valid('json')
    const user = c.get('user')

    const quote = await prisma.quote.findUnique({ where: { id } })
    if (!quote) return c.json({ error: 'Quote not found' }, 404)

    const row = await prisma.quote.update({
      where: { id },
      data: {
        status,
        ...(status === 'sent' && !quote.sentAt ? { sentAt: new Date() } : {}),
        ...(status === 'viewed' && !quote.viewedAt ? { viewedAt: new Date() } : {}),
        ...(status === 'accepted' || status === 'rejected' || status === 'expired' ? { decidedAt: new Date() } : {}),
      },
    })

    if ((status === 'rejected' || status === 'expired') && quote.reservedUntil) {
      const items = await prisma.quoteItem.findMany({ where: { quoteId: id } })
      await stock.releaseLines(
        items.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        { type: 'quote', id },
        BigInt(user.userId),
      )
      await prisma.quote.update({ where: { id }, data: { reservedUntil: null } })
    }

    if (quote.dealId) {
      await activity.recordSafe({
        entityType: 'deal',
        entityId: quote.dealId,
        kind: 'quote',
        subject: `Quote ${quote.quoteNumber} ${status}`,
        actorId: user.userId,
      })
    }

    return c.json(bigintFix(row))
  },
)

// POST /api/quotes/:id/convert — accepted quote → order, lines and all.
quotesRoutes.post('/:id/convert', async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  try {
    const result = await placeOrderFromQuote({ quoteId: id, actorId: BigInt(user.userId) })
    const order = await prisma.order.findUnique({ where: { id: result.orderId } })
    return c.json(bigintFix({ ...order, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber }), 201)
  } catch (err) {
    if (err instanceof PlaceOrderError) {
      return c.json({ error: err.message, ...err.extra }, err.status as 400)
    }
    throw err
  }
})

quotesRoutes.delete('/:id', adminOnly, async (c) => {
  await prisma.quote.delete({ where: { id: BigInt(c.req.param('id')) } })
  return c.json({ success: true })
})

// ── Quote lines
quotesRoutes.post('/:id/items', zValidator('json', lineBody), async (c) => {
  const quoteId = BigInt(c.req.param('id'))
  const body = c.req.valid('json')
  const count = await prisma.quoteItem.count({ where: { quoteId } })
  let unitPrice = body.unitPrice
  if (body.productId && !unitPrice) {
    const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { accountId: true } })
    const priced = await resolvePrice(BigInt(body.productId), body.quantity, quote?.accountId)
    unitPrice = priced.unitPrice
  }
  const pricedLine = { ...body, unitPrice }

  const row = await prisma.quoteItem.create({
    data: {
      quoteId,
      productId: body.productId ? BigInt(body.productId) : null,
      name: body.name,
      sku: body.sku ?? null,
      hsnCode: body.hsnCode ?? null,
      quantity: body.quantity,
      unitPrice,
      discountPercent: body.discountPercent,
      taxPercent: body.taxPercent,
      total: lineTotal(pricedLine),
      sortOrder: count * 10,
    },
  })
  await recalc('quote', quoteId)
  return c.json(bigintFix(row), 201)
})

quotesRoutes.delete('/:quoteId/items/:itemId', async (c) => {
  await prisma.quoteItem.delete({ where: { id: BigInt(c.req.param('itemId')) } })
  await recalc('quote', BigInt(c.req.param('quoteId')))
  return c.json({ success: true })
})

// PATCH /api/quotes/:quoteId/items/:itemId — change a line in place.
//
// Adding a wrong line and deleting it was the only way to fix a typo in a
// quantity. The total is recomputed from the merged line, never trusted.
quotesRoutes.patch('/:quoteId/items/:itemId', zValidator('json', lineBody.partial()), async (c) => {
  const quoteId = BigInt(c.req.param('quoteId'))
  const itemId = BigInt(c.req.param('itemId'))
  const body = c.req.valid('json')
  const existing = await prisma.quoteItem.findFirst({ where: { id: itemId, quoteId } })
  if (!existing) return c.json({ error: 'Line not found' }, 404)
  const merged = {
    quantity: body.quantity ?? Number(existing.quantity),
    unitPrice: body.unitPrice ?? Number(existing.unitPrice),
    discountPercent: body.discountPercent ?? Number(existing.discountPercent),
    taxPercent: body.taxPercent ?? Number(existing.taxPercent),
  }
  const row = await prisma.quoteItem.update({
    where: { id: itemId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sku !== undefined ? { sku: body.sku } : {}),
      ...merged,
      total: lineTotal(merged),
    },
  })
  await recalc('quote', quoteId)
  return c.json(bigintFix(row))
})

// ═══ CONTRACTS ═══════════════════════════════════════════════════════════════

contractsRoutes.get('/', async (c) => {
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)

  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    // Everything up for renewal in the next N days — the one query a renewals
    // desk actually runs.
    ...(q.renewingWithinDays
      ? {
          renewalDate: {
            gte: new Date(),
            lte: new Date(Date.now() + Number(q.renewingWithinDays) * 86_400_000),
          },
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { owner: { select: { id: true, name: true } } },
    }),
    prisma.contract.count({ where }),
  ])

  return c.json(buildPaginatedResult(await withAccounts(rows), total, page, limit))
})

const contractBody = z.object({
  title: z.string().min(1).max(200),
  accountId: z.number().nullish(),
  dealId: z.number().nullish(),
  quoteId: z.number().nullish(),
  type: z.string().max(60).nullish(),
  status: z.string().max(20).optional(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  renewalDate: z.string().nullish(),
  value: z.number().nullish(),
  paymentTerms: z.string().max(255).nullish(),
  signedBy: z.string().max(150).nullish(),
  documentUrl: z.string().max(500).nullish(),
  notes: z.string().nullish(),
})

contractsRoutes.post('/', zValidator('json', contractBody), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const contract = await prisma.contract.create({
    data: {
      contractNumber: 'PENDING',
      title: body.title,
      accountId: body.accountId ? BigInt(body.accountId) : null,
      dealId: body.dealId ? BigInt(body.dealId) : null,
      quoteId: body.quoteId ? BigInt(body.quoteId) : null,
      type: body.type ?? null,
      status: body.status ?? 'draft',
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      renewalDate: body.renewalDate ? new Date(body.renewalDate) : null,
      value: body.value ?? null,
      paymentTerms: body.paymentTerms ?? null,
      signedBy: body.signedBy ?? null,
      documentUrl: body.documentUrl ?? null,
      notes: body.notes ?? null,
      ownerId: BigInt(user.userId),
    },
  })

  const numbered = await prisma.contract.update({
    where: { id: contract.id },
    data: { contractNumber: documentNumber('CON', contract.id) },
  })

  if (contract.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: contract.accountId,
      kind: 'system',
      subject: `Contract ${numbered.contractNumber}: ${contract.title}`,
      actorId: user.userId,
    })
  }

  return c.json(bigintFix(numbered), 201)
})

// GET /api/contracts/:id/document — the contract as HTML (preview / print).
contractsRoutes.get('/:id/document', async (c) => {
  const doc = await buildContractDoc(BigInt(c.req.param('id')))
  if (!doc) return c.json({ error: 'Contract not found' }, 404)
  return c.html(renderContractHtml(doc))
})

// GET /api/contracts/:id/pdf
contractsRoutes.get('/:id/pdf', async (c) => {
  const doc = await buildContractDoc(BigInt(c.req.param('id')))
  if (!doc) return c.json({ error: 'Contract not found' }, 404)
  const pdf = await buildContractPdf(doc)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="${doc.contractNumber}.pdf"`)
  return c.body(new Uint8Array(pdf))
})

// POST /api/contracts/:id/send — email it with the PDF attached; marks sent.
contractsRoutes.post(
  '/:id/send',
  zValidator('json', z.object({ to: z.string().email().optional(), cc: z.string().optional(), subject: z.string().max(200).optional(), message: z.string().max(4000).nullish() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')
    const contract = await prisma.contract.findUnique({ where: { id } })
    if (!contract) return c.json({ error: 'Contract not found' }, 404)
    const doc = await buildContractDoc(id)
    if (!doc) return c.json({ error: 'Contract not found' }, 404)
    const to = body.to || doc.to.email
    if (!to) return c.json({ error: 'No email address on the account. Type one in.' }, 400)

    const subject = body.subject || `${doc.type || 'Agreement'} ${doc.contractNumber}: ${doc.title}`
    const intro = body.message?.trim()
      ? `<p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${body.message.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`
      : `<p style="font-size:14px;line-height:1.7">Hello,<br><br>Please find <strong>${doc.contractNumber}</strong> — ${doc.title} — attached for your review and signature. Reply to this email with any questions.</p>`
    let pdf: Buffer | null = null
    try {
      pdf = await buildContractPdf(doc)
    } catch (err) {
      console.error('[contracts] pdf render failed for', doc.contractNumber, err)
    }
    try {
      await emailService.send({
        to,
        cc: body.cc ? body.cc.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
        subject,
        html: `<div style="max-width:760px;margin:0 auto;padding:0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">${intro}</div>` + renderContractHtml(doc),
        fromName: doc.from.name,
        replyTo: doc.from.email || undefined,
        attachments: pdf ? [{ filename: `${doc.contractNumber}.pdf`, content: pdf, contentType: 'application/pdf' }] : undefined,
      })
    } catch (err) {
      return c.json({ error: `Could not send: ${err instanceof Error ? err.message : 'mail server rejected it'}` }, 502)
    }
    if (['draft'].includes(contract.status)) {
      await prisma.contract.update({ where: { id }, data: { status: 'sent' } })
    }
    const subjectLine = `Contract ${contract.contractNumber} emailed to ${to}`
    if (contract.dealId) await activity.recordSafe({ entityType: 'deal', entityId: contract.dealId, kind: 'email', subject: subjectLine, actorId: user.userId, meta: { contractId: Number(id), to } })
    if (contract.accountId) await activity.recordSafe({ entityType: 'account', entityId: contract.accountId, kind: 'email', subject: subjectLine, body: body.message ?? null, actorId: user.userId, meta: { contractId: Number(id), to } })
    return c.json({ success: true, to })
  },
)

// GET /api/contracts/:id — the contract with its neighbours in the chain.
contractsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { owner: { select: { id: true, name: true } } },
  })
  if (!contract) return c.json({ error: 'Contract not found' }, 404)

  const [account, quote, deal, orders] = await Promise.all([
    contract.accountId ? prisma.account.findUnique({ where: { id: contract.accountId }, select: { id: true, name: true, email: true } }) : null,
    contract.quoteId ? prisma.quote.findUnique({ where: { id: contract.quoteId }, select: { id: true, quoteNumber: true, status: true, total: true } }) : null,
    contract.dealId ? prisma.deal.findUnique({ where: { id: contract.dealId }, select: { id: true, name: true, dealNumber: true } }) : null,
    prisma.order.findMany({ where: { contractId: id }, select: { id: true, orderNumber: true, status: true, total: true } }),
  ])

  return c.json({ ...bigintFix(contract), account, quote: bigintFix(quote), deal: bigintFix(deal), orders: bigintFix(orders) })
})

// POST /api/contracts/from-quote/:quoteId — draw the contract up from the quote.
//
// Title, value, terms, account and deal all come across; the contract points
// back at the quote so the chain can be walked either way. A second call for
// the same quote returns the existing contract rather than a duplicate.
contractsRoutes.post(
  '/from-quote/:quoteId',
  zValidator('json', z.object({ title: z.string().max(200).optional(), type: z.string().max(60).nullish(), startDate: z.string().nullish(), endDate: z.string().nullish() }).optional()),
  async (c) => {
    const quoteId = BigInt(c.req.param('quoteId'))
    const user = c.get('user')
    const body = c.req.valid('json') ?? {}

    const quote = await prisma.quote.findUnique({ where: { id: quoteId } })
    if (!quote) return c.json({ error: 'Quote not found' }, 404)

    const existing = await prisma.contract.findFirst({ where: { quoteId }, select: { id: true, contractNumber: true } })
    if (existing) return c.json({ error: `This quote already has contract ${existing.contractNumber}.`, contractId: Number(existing.id) }, 409)

    const [deal, account] = await Promise.all([
      quote.dealId ? prisma.deal.findUnique({ where: { id: quote.dealId }, select: { name: true } }) : null,
      quote.accountId ? prisma.account.findUnique({ where: { id: quote.accountId }, select: { name: true } }) : null,
    ])

    const created = await prisma.contract.create({
      data: {
        contractNumber: 'PENDING',
        title: body.title?.trim() || deal?.name || `${account?.name ?? 'Customer'} — ${quote.quoteNumber}`,
        accountId: quote.accountId,
        dealId: quote.dealId,
        quoteId,
        type: body.type ?? null,
        status: 'draft',
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        value: quote.total,
        currency: quote.currency,
        paymentTerms: quote.paymentTerms,
        notes: quote.deliveryTerms ? `Delivery: ${quote.deliveryTerms}` : null,
        ownerId: quote.ownerId ?? BigInt(user.userId),
      },
    })
    const numbered = await prisma.contract.update({ where: { id: created.id }, data: { contractNumber: documentNumber('CON', created.id) } })

    if (quote.dealId) {
      await activity.recordSafe({ entityType: 'deal', entityId: quote.dealId, kind: 'system', subject: `Contract ${numbered.contractNumber} drawn up from ${quote.quoteNumber}`, actorId: user.userId, meta: { contractId: Number(created.id), quoteId: Number(quoteId) } })
    }
    if (quote.accountId) {
      await activity.recordSafe({ entityType: 'account', entityId: quote.accountId, kind: 'system', subject: `Contract ${numbered.contractNumber}: ${numbered.title}`, actorId: user.userId, meta: { contractId: Number(created.id) } })
    }
    return c.json(bigintFix(numbered), 201)
  },
)

// POST /api/contracts/:id/status — the lifecycle, with its stamps.
contractsRoutes.post(
  '/:id/status',
  zValidator('json', z.object({ status: z.enum(['draft', 'sent', 'under_review', 'signed', 'active', 'expired', 'terminated']), signedBy: z.string().max(150).nullish() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const { status, signedBy } = c.req.valid('json')
    const contract = await prisma.contract.findUnique({ where: { id } })
    if (!contract) return c.json({ error: 'Contract not found' }, 404)

    const row = await prisma.contract.update({
      where: { id },
      data: {
        status,
        ...(status === 'signed' && !contract.signedAt ? { signedAt: new Date() } : {}),
        ...(signedBy !== undefined && signedBy !== null ? { signedBy } : {}),
        // Going live without a start date means it started today.
        ...(status === 'active' && !contract.startDate ? { startDate: new Date() } : {}),
      },
    })

    const subject = `Contract ${contract.contractNumber} ${status.replace(/_/g, ' ')}${signedBy ? ` by ${signedBy}` : ''}`
    if (contract.dealId) await activity.recordSafe({ entityType: 'deal', entityId: contract.dealId, kind: 'system', subject, actorId: user.userId, meta: { contractId: Number(id), status } })
    if (contract.accountId) await activity.recordSafe({ entityType: 'account', entityId: contract.accountId, kind: 'system', subject, actorId: user.userId, meta: { contractId: Number(id), status } })
    return c.json(bigintFix(row))
  },
)

contractsRoutes.patch('/:id', zValidator('json', contractBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = c.req.valid('json')

  const row = await prisma.contract.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.quoteId !== undefined ? { quoteId: body.quoteId ? BigInt(body.quoteId) : null } : {}),
      ...(body.dealId !== undefined ? { dealId: body.dealId ? BigInt(body.dealId) : null } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      // Stamped when the status first says signed, so "when did they sign?" is
      // answerable without reading an audit log.
      ...(body.status === 'signed' ? { signedAt: new Date() } : {}),
      ...(body.startDate !== undefined
        ? { startDate: body.startDate ? new Date(body.startDate) : null }
        : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate ? new Date(body.endDate) : null } : {}),
      ...(body.renewalDate !== undefined
        ? { renewalDate: body.renewalDate ? new Date(body.renewalDate) : null }
        : {}),
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.paymentTerms !== undefined ? { paymentTerms: body.paymentTerms } : {}),
      ...(body.signedBy !== undefined ? { signedBy: body.signedBy } : {}),
      ...(body.documentUrl !== undefined ? { documentUrl: body.documentUrl } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  })
  return c.json(bigintFix(row))
})

contractsRoutes.delete('/:id', adminOnly, async (c) => {
  await prisma.contract.delete({ where: { id: BigInt(c.req.param('id')) } })
  return c.json({ success: true })
})

// ═══ ORDERS ══════════════════════════════════════════════════════════════════

ordersRoutes.get('/', async (c) => {
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)

  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    ...(q.dealId ? { dealId: BigInt(q.dealId) } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { orderDate: 'desc' },
      skip,
      take: limit,
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { items: true, invoices: true } },
      },
    }),
    prisma.order.count({ where }),
  ])

  return c.json(buildPaginatedResult(await withAccounts(rows), total, page, limit))
})

ordersRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      owner: { select: { id: true, name: true } },
      quote: { select: { id: true, quoteNumber: true, status: true, total: true } },
      invoices: { select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true, dueDate: true } },
      shipments: { include: { items: true }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!order) return c.json({ error: 'Order not found' }, 404)

  const [account, contact, contract, deal, lead] = await Promise.all([
    order.accountId ? prisma.account.findUnique({ where: { id: order.accountId }, select: { id: true, name: true, email: true } }) : null,
    order.contactId ? prisma.contact.findUnique({ where: { id: order.contactId }, select: { id: true, firstName: true, lastName: true, email: true } }) : null,
    order.contractId ? prisma.contract.findUnique({ where: { id: order.contractId }, select: { id: true, contractNumber: true, title: true, status: true } }) : null,
    order.dealId ? prisma.deal.findUnique({ where: { id: order.dealId }, select: { id: true, name: true, dealNumber: true } }) : null,
    order.leadId ? prisma.lead.findUnique({ where: { id: order.leadId }, select: { id: true, name: true, email: true, mobile: true } }) : null,
  ])

  return c.json({
    ...bigintFix(order),
    account,
    lead: lead ? bigintFix(lead) : null,
    contact: contact ? { id: Number(contact.id), name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), email: contact.email } : null,
    contract: bigintFix(contract),
    deal: bigintFix(deal),
    invoices: order.invoices.map((i) => ({ ...bigintFix(i), balance: Number(i.total) - Number(i.amountPaid), overdue: isOverdue(i) })),
  })
})

// POST /api/orders/:id/contract — draw a contract up from an order (for a
// business that skipped the quote). Points the order at it.
ordersRoutes.post(
  '/:id/contract',
  zValidator('json', z.object({ title: z.string().max(200).optional(), type: z.string().max(60).nullish() }).optional()),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json') ?? {}
    const order = await prisma.order.findUnique({ where: { id } })
    if (!order) return c.json({ error: 'Order not found' }, 404)
    if (order.contractId) {
      const existing = await prisma.contract.findUnique({ where: { id: order.contractId }, select: { contractNumber: true } })
      return c.json({ error: `This order is already under contract ${existing?.contractNumber ?? ''}.`, contractId: Number(order.contractId) }, 409)
    }
    const [deal, account] = await Promise.all([
      order.dealId ? prisma.deal.findUnique({ where: { id: order.dealId }, select: { name: true } }) : null,
      order.accountId ? prisma.account.findUnique({ where: { id: order.accountId }, select: { name: true } }) : null,
    ])
    const created = await prisma.contract.create({
      data: {
        contractNumber: 'PENDING',
        title: body.title?.trim() || deal?.name || `${account?.name ?? 'Customer'} — ${order.orderNumber}`,
        accountId: order.accountId,
        dealId: order.dealId,
        quoteId: order.quoteId,
        type: body.type ?? null,
        status: 'draft',
        value: order.total,
        currency: order.currency,
        ownerId: order.ownerId ?? BigInt(user.userId),
      },
    })
    const numbered = await prisma.contract.update({ where: { id: created.id }, data: { contractNumber: documentNumber('CON', created.id) } })
    await prisma.order.update({ where: { id }, data: { contractId: created.id } })
    if (order.dealId) await activity.recordSafe({ entityType: 'deal', entityId: order.dealId, kind: 'system', subject: `Contract ${numbered.contractNumber} drawn up from ${order.orderNumber}`, actorId: user.userId, meta: { contractId: Number(created.id) } })
    return c.json(bigintFix(numbered), 201)
  },
)

ordersRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      accountId: z.number().nullish(),
      contactId: z.number().nullish(),
      dealId: z.number().nullish(),
      contractId: z.number().nullish(),
      deliveryDate: z.string().nullish(),
      notes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    // An order raised under a contract inherits the contract's account and
    // deal, so a rep starting from the contract page types nothing twice.
    const contract = body.contractId ? await prisma.contract.findUnique({ where: { id: BigInt(body.contractId) } }) : null

    const order = await prisma.order.create({
      data: {
        orderNumber: 'PENDING',
        accountId: body.accountId ? BigInt(body.accountId) : (contract?.accountId ?? null),
        contactId: body.contactId ? BigInt(body.contactId) : null,
        dealId: body.dealId ? BigInt(body.dealId) : (contract?.dealId ?? null),
        quoteId: contract?.quoteId ?? null,
        contractId: contract?.id ?? null,
        currency: contract?.currency ?? 'INR',
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
        notes: body.notes ?? null,
        ownerId: BigInt(user.userId),
      },
    })

    // Lines from the contract's quote, when there is one — the contract was
    // signed on those prices.
    if (contract?.quoteId) {
      await copyLines({ kind: 'quote', id: contract.quoteId }, { kind: 'order', id: order.id })
    }

    const numbered = await prisma.order.update({
      where: { id: order.id },
      data: { orderNumber: documentNumber('ORD', order.id) },
    })
    return c.json(bigintFix(numbered), 201)
  },
)

ordersRoutes.patch(
  '/:id',
  zValidator(
    'json',
    z.object({
      status: z.string().max(24).optional(),
      deliveryDate: z.string().nullish(),
      notes: z.string().nullish(),
      contractId: z.number().nullish(),
      contactId: z.number().nullish(),
      courier: z.string().max(80).nullish(),
      trackingNumber: z.string().max(80).nullish(),
      podNotes: z.string().nullish(),
      podUrl: z.string().max(500).nullish(),
      promisedDate: z.string().nullish(),
      isSample: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')
    const existing = await prisma.order.findUnique({ where: { id }, include: { items: true } })
    if (!existing) return c.json({ error: 'Order not found' }, 404)

    const status = body.status
    const now = new Date()
    const row = await prisma.order.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(body.contractId !== undefined ? { contractId: body.contractId ? BigInt(body.contractId) : null } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId ? BigInt(body.contactId) : null } : {}),
        ...(body.deliveryDate !== undefined
          ? { deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null }
          : {}),
        ...(body.promisedDate !== undefined
          ? { promisedDate: body.promisedDate ? new Date(body.promisedDate) : null }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.courier !== undefined ? { courier: body.courier } : {}),
        ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber } : {}),
        ...(body.podNotes !== undefined ? { podNotes: body.podNotes } : {}),
        ...(body.podUrl !== undefined ? { podUrl: body.podUrl } : {}),
        ...(body.isSample !== undefined ? { isSample: body.isSample } : {}),
        ...(status === 'packed' && !existing.packedAt ? { packedAt: now } : {}),
        ...(status === 'out_for_delivery' && !existing.shippedAt ? { shippedAt: now } : {}),
        ...(status === 'delivered' && !existing.deliveredAt ? { deliveredAt: now } : {}),
      },
    })

    if (status === 'cancelled' && existing.status !== 'cancelled') {
      await stock.returnLines(
        existing.items.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        { type: 'order', id },
        BigInt(c.get('user').userId),
      )
    }

    if (status && status !== existing.status && existing.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: existing.accountId,
        kind: 'system',
        subject: `Order ${existing.orderNumber} → ${status.replace(/_/g, ' ')}`,
        actorId: c.get('user').userId,
        meta: { orderId: Number(id), trackingNumber: row.trackingNumber },
      })
    }

    if (status && status !== existing.status && ['packed', 'out_for_delivery', 'delivered'].includes(status)) {
      await notifyFulfillment(id, status)
    }

    return c.json(bigintFix(row))
  },
)

// DELETE /api/orders/:id
//
// Hard delete: an order is paperwork, not a record of money moved — that is the
// invoice. Refused while an invoice exists against it, because deleting the
// order would leave the invoice referencing something that is gone.
ordersRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))

  const invoices = await prisma.crmInvoice.count({ where: { orderId: id } })
  if (invoices > 0) {
    return c.json(
      {
        error: `This order has ${invoices} invoice${invoices === 1 ? '' : 's'} against it. Delete ${invoices === 1 ? 'that' : 'those'} first.`,
      },
      409,
    )
  }

  // Items go with it via the cascade on the relation.
  await prisma.order.delete({ where: { id } })
  return c.json({ success: true })
})

ordersRoutes.post('/:id/items', zValidator('json', lineBody), async (c) => {
  const orderId = BigInt(c.req.param('id'))
  const body = c.req.valid('json')
  const count = await prisma.orderItem.count({ where: { orderId } })

  const row = await prisma.orderItem.create({
    data: {
      orderId,
      productId: body.productId ? BigInt(body.productId) : null,
      name: body.name,
      sku: body.sku ?? null,
      hsnCode: body.hsnCode ?? null,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      discountPercent: body.discountPercent,
      taxPercent: body.taxPercent,
      total: lineTotal(body),
      sortOrder: count * 10,
    },
  })
  await recalc('order', orderId)
  return c.json(bigintFix(row), 201)
})

ordersRoutes.patch('/:orderId/items/:itemId', zValidator('json', lineBody.partial()), async (c) => {
  const orderId = BigInt(c.req.param('orderId'))
  const itemId = BigInt(c.req.param('itemId'))
  const body = c.req.valid('json')
  const existing = await prisma.orderItem.findFirst({ where: { id: itemId, orderId } })
  if (!existing) return c.json({ error: 'Line not found' }, 404)
  const merged = {
    quantity: body.quantity ?? Number(existing.quantity),
    unitPrice: body.unitPrice ?? Number(existing.unitPrice),
    discountPercent: body.discountPercent ?? Number(existing.discountPercent),
    taxPercent: body.taxPercent ?? Number(existing.taxPercent),
  }
  const row = await prisma.orderItem.update({
    where: { id: itemId },
    data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.sku !== undefined ? { sku: body.sku } : {}), ...merged, total: lineTotal(merged) },
  })
  await recalc('order', orderId)
  return c.json(bigintFix(row))
})

ordersRoutes.delete('/:orderId/items/:itemId', async (c) => {
  await prisma.orderItem.delete({ where: { id: BigInt(c.req.param('itemId')) } })
  await recalc('order', BigInt(c.req.param('orderId')))
  return c.json({ success: true })
})

ordersRoutes.get('/:id/challan', async (c) => {
  const doc = await buildDispatchDoc(BigInt(c.req.param('id')), 'challan')
  if (!doc) return c.json({ error: 'Order not found' }, 404)
  if (c.req.query('format') === 'html') return c.html(renderDispatchHtml(doc))
  const pdf = await buildDispatchPdf(doc)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${doc.number}.pdf"`)
  return c.body(new Uint8Array(pdf))
})

ordersRoutes.get('/:id/packing-list', async (c) => {
  const doc = await buildDispatchDoc(BigInt(c.req.param('id')), 'packing')
  if (!doc) return c.json({ error: 'Order not found' }, 404)
  if (c.req.query('format') === 'html') return c.html(renderDispatchHtml(doc))
  const pdf = await buildDispatchPdf(doc)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${doc.number}.pdf"`)
  return c.body(new Uint8Array(pdf))
})

// POST /api/orders/:id/invoice — raise an invoice for the whole order.
ordersRoutes.post('/:id/invoice', async (c) => {
  const orderId = BigInt(c.req.param('id'))
  const user = c.get('user')

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) return c.json({ error: 'Order not found' }, 404)

  // The same guard quote→order already had, and this endpoint did not: the UI
  // hides the button after the first invoice, but a second POST went straight
  // through and billed the order twice. Found in live data — one order with two
  // invoices against it.
  //
  // Cancelled invoices do not block a re-issue; that is the legitimate reason
  // to invoice the same order again.
  const existing = await prisma.crmInvoice.findFirst({
    where: { orderId, status: { not: 'cancelled' } },
    select: { id: true, invoiceNumber: true },
  })
  if (existing) {
    return c.json(
      {
        error: `This order is already on invoice ${existing.invoiceNumber}. Cancel that one first if you need to re-issue it.`,
        invoiceId: Number(existing.id),
      },
      409,
    )
  }

  // An order with no lines produces a zero-value invoice, which is never what
  // anybody meant — it is an order somebody forgot to fill in.
  const lineCount = await prisma.orderItem.count({ where: { orderId } })
  if (lineCount === 0) {
    return c.json(
      { error: 'This order has no line items, so an invoice for it would be for zero. Add lines first.' },
      400,
    )
  }

  const invoice = await prisma.crmInvoice.create({
    data: {
      invoiceNumber: 'PENDING',
      accountId: order.accountId,
      contactId: order.contactId,
      dealId: order.dealId,
      leadId: order.leadId,
      orderId: order.id,
      currency: order.currency,
      // 30 days is the ordinary default; the invoice screen can change it.
      dueDate: new Date(Date.now() + 30 * 86_400_000),
      ownerId: BigInt(user.userId),
      createdById: BigInt(user.userId),
    },
  })

  const numbered = await prisma.crmInvoice.update({
    where: { id: invoice.id },
    data: { invoiceNumber: documentNumber('INV', invoice.id) },
  })

  await copyLines({ kind: 'order', id: orderId }, { kind: 'invoice', id: invoice.id })

  if (order.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: order.accountId,
      kind: 'system',
      subject: `Invoice ${numbered.invoiceNumber} raised`,
      actorId: user.userId,
      meta: { invoiceId: Number(invoice.id) },
    })
  }

  return c.json(bigintFix(numbered), 201)
})

ordersRoutes.post(
  '/:id/return',
  zValidator(
    'json',
    z.object({
      reason: z.string().max(40).optional(),
      notes: z.string().nullish(),
      items: z.array(z.object({ productId: z.number().nullish(), name: z.string(), sku: z.string().nullish(), quantity: z.number().positive(), unitPrice: z.number(), taxPercent: z.number().optional() })).optional(),
    }),
  ),
  async (c) => {
    const orderId = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, invoices: true } })
    if (!order) return c.json({ error: 'Order not found' }, 404)
    if (order.status !== 'delivered') return c.json({ error: 'Returns are only for delivered orders.' }, 409)

    const lines = body.items?.length
      ? body.items
      : order.items.map((l) => ({
          productId: l.productId ? Number(l.productId) : null,
          name: l.name,
          sku: l.sku,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxPercent: Number(l.taxPercent),
        }))

    const note = await prisma.creditNote.create({
      data: {
        creditNoteNumber: 'PENDING',
        accountId: order.accountId,
        orderId: order.id,
        invoiceId: order.invoices[0]?.id ?? null,
        reason: body.reason ?? 'return',
        notes: body.notes ?? null,
        currency: order.currency,
      },
    })
    const numbered = documentNumber('CN', note.id)
    await prisma.creditNote.update({ where: { id: note.id }, data: { creditNoteNumber: numbered } })

    let subtotal = 0
    let tax = 0
    for (const l of lines) {
      const lineTax = (l.quantity * l.unitPrice * (l.taxPercent || 0)) / 100
      const total = l.quantity * l.unitPrice + lineTax
      subtotal += l.quantity * l.unitPrice
      tax += lineTax
      await prisma.creditNoteItem.create({
        data: {
          creditNoteId: note.id,
          productId: l.productId ? BigInt(l.productId) : null,
          name: l.name,
          sku: l.sku ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxPercent: l.taxPercent ?? 0,
          total,
        },
      })
    }
    await prisma.creditNote.update({
      where: { id: note.id },
      data: { subtotal, tax, total: subtotal + tax },
    })

    await stock.returnLines(
      lines.map((l) => ({ productId: l.productId ? BigInt(l.productId) : null, quantity: l.quantity })),
      { type: 'credit_note', id: note.id },
      BigInt(user.userId),
    )

    if (order.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: order.accountId,
        kind: 'system',
        subject: `Return ${numbered} against ${order.orderNumber}`,
        actorId: user.userId,
      })
    }

    const saved = await prisma.creditNote.findUnique({ where: { id: note.id }, include: { items: true } })
    return c.json(bigintFix(saved), 201)
  },
)

// ═══ INVOICES & PAYMENTS ═════════════════════════════════════════════════════

invoicesRoutes.get('/', async (c) => {
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)

  const where = {
    ...(q.status && q.status !== 'overdue' ? { status: q.status } : {}),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    // Overdue is a derived state, so it filters on the two facts behind it
    // rather than on a stored flag that a nightly job might not have updated.
    ...(q.status === 'overdue'
      ? { status: { in: ['sent', 'partial'] }, dueDate: { lt: new Date() } }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.crmInvoice.findMany({
      where,
      orderBy: { issueDate: 'desc' },
      skip,
      take: limit,
      include: { owner: { select: { id: true, name: true } } },
    }),
    prisma.crmInvoice.count({ where }),
  ])

  const withAcc = await withAccounts(rows)
  return c.json(
    buildPaginatedResult(
      withAcc.map((r, i) => ({
        ...r,
        overdue: isOverdue(rows[i]),
        balance: Number(rows[i].total) - Number(rows[i].amountPaid),
      })),
      total,
      page,
      limit,
    ),
  )
})

// GET /api/invoices/summary/ageing — outstanding money by how late it is.
invoicesRoutes.get('/summary/ageing', async (c) => {
  const rows = await prisma.crmInvoice.findMany({
    where: { status: { in: ['sent', 'partial'] } },
    select: { total: true, amountPaid: true, dueDate: true },
  })

  const buckets = { current: 0, days30: 0, days60: 0, days90: 0, older: 0 }
  let outstanding = 0

  for (const r of rows) {
    const balance = Number(r.total) - Number(r.amountPaid)
    if (balance <= 0) continue
    outstanding += balance

    const late = r.dueDate ? Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86_400_000) : 0
    if (late <= 0) buckets.current += balance
    else if (late <= 30) buckets.days30 += balance
    else if (late <= 60) buckets.days60 += balance
    else if (late <= 90) buckets.days90 += balance
    else buckets.older += balance
  }

  const round = (n: number) => Math.round(n * 100) / 100
  return c.json({
    outstanding: round(outstanding),
    buckets: {
      current: round(buckets.current),
      days30: round(buckets.days30),
      days60: round(buckets.days60),
      days90: round(buckets.days90),
      older: round(buckets.older),
    },
  })
})

// GET /api/invoices/:id/document — the invoice as HTML (preview / print).
invoicesRoutes.get('/:id/document', async (c) => {
  const doc = await buildInvoiceDoc(BigInt(c.req.param('id')))
  if (!doc) return c.json({ error: 'Invoice not found' }, 404)
  return c.html(renderInvoiceHtml(doc))
})

// GET /api/invoices/:id/pdf
invoicesRoutes.get('/:id/pdf', async (c) => {
  const doc = await buildInvoiceDoc(BigInt(c.req.param('id')))
  if (!doc) return c.json({ error: 'Invoice not found' }, 404)
  const pdf = await buildInvoicePdf(doc)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="${doc.invoiceNumber}.pdf"`)
  return c.body(new Uint8Array(pdf))
})

// POST /api/invoices/:id/send — email it with the PDF attached.
//
// A failed send leaves the status alone, same rule as quotes: a rep who
// believes a customer has an invoice they never received will chase a payment
// that was never asked for.
invoicesRoutes.post(
  '/:id/send',
  zValidator('json', z.object({ to: z.string().email().optional(), cc: z.string().optional(), subject: z.string().max(200).optional(), message: z.string().max(4000).nullish() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')
    const doc = await buildInvoiceDoc(id)
    if (!doc) return c.json({ error: 'Invoice not found' }, 404)
    if (!doc.items.length) return c.json({ error: 'This invoice has no line items — there is nothing to bill.' }, 400)
    const to = body.to || doc.to.email
    if (!to) return c.json({ error: 'No email address. Add one to the lead, or type one in.' }, 400)

    const subject = body.subject || `Invoice ${doc.invoiceNumber} from ${doc.from.name}`
    let pdf: Buffer | null = null
    try {
      pdf = await buildInvoicePdf(doc)
    } catch (err) {
      console.error('[invoices] pdf render failed for', doc.invoiceNumber, err)
    }
    try {
      await emailService.send({
        to,
        cc: body.cc ? body.cc.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
        subject,
        html: renderInvoiceEmailIntro(doc, body.message) + renderInvoiceHtml(doc),
        fromName: doc.from.name,
        replyTo: doc.from.email || undefined,
        attachments: pdf ? [{ filename: `${doc.invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }] : undefined,
      })
    } catch (err) {
      return c.json({ error: `Could not send: ${err instanceof Error ? err.message : 'mail server rejected it'}` }, 502)
    }

    const invoice = await prisma.crmInvoice.findUnique({ where: { id } })
    const updated = await prisma.crmInvoice.update({
      where: { id },
      data: {
        sentAt: new Date(),
        // A draft becomes sent; a partial / paid one keeps its money status.
        ...(invoice?.status === 'draft' ? { status: 'sent' } : {}),
      },
    })
    const line = `Invoice ${updated.invoiceNumber} emailed to ${to}`
    if (updated.dealId) await activity.recordSafe({ entityType: 'deal', entityId: updated.dealId, kind: 'email', subject: line, actorId: user.userId, meta: { invoiceId: Number(id), to } })
    if (updated.accountId) await activity.recordSafe({ entityType: 'account', entityId: updated.accountId, kind: 'email', subject: line, body: body.message ?? null, actorId: user.userId, meta: { invoiceId: Number(id), to } })
    return c.json({ success: true, to, sentAt: updated.sentAt })
  },
)

invoicesRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const invoice = await prisma.crmInvoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paymentDate: 'desc' }, include: { recordedBy: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true, quoteId: true, contractId: true } },
    },
  })
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

  const [account, deal, quote, contract, lead] = await Promise.all([
    invoice.accountId
      ? prisma.account.findUnique({
          where: { id: invoice.accountId },
          select: { id: true, name: true, gstin: true, email: true },
        })
      : null,
    invoice.dealId ? prisma.deal.findUnique({ where: { id: invoice.dealId }, select: { id: true, name: true, dealNumber: true } }) : null,
    invoice.order?.quoteId ? prisma.quote.findUnique({ where: { id: invoice.order.quoteId }, select: { id: true, quoteNumber: true, status: true } }) : null,
    invoice.order?.contractId ? prisma.contract.findUnique({ where: { id: invoice.order.contractId }, select: { id: true, contractNumber: true, title: true, status: true } }) : null,
    invoice.leadId ? prisma.lead.findUnique({ where: { id: invoice.leadId }, select: { id: true, name: true, email: true, mobile: true } }) : null,
  ])

  return c.json({
    ...bigintFix(invoice),
    account,
    lead: lead ? bigintFix(lead) : null,
    deal: bigintFix(deal),
    quote: bigintFix(quote),
    contract: bigintFix(contract),
    overdue: isOverdue(invoice),
    balance: Number(invoice.total) - Number(invoice.amountPaid),
  })
})

invoicesRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      accountId: z.number().nullish(),
      dealId: z.number().nullish(),
      dueDate: z.string().nullish(),
      terms: z.string().max(255).nullish(),
      notes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const invoice = await prisma.crmInvoice.create({
      data: {
        invoiceNumber: 'PENDING',
        accountId: body.accountId ? BigInt(body.accountId) : null,
        dealId: body.dealId ? BigInt(body.dealId) : null,
        dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 30 * 86_400_000),
        terms: body.terms ?? null,
        notes: body.notes ?? null,
        ownerId: BigInt(user.userId),
        createdById: BigInt(user.userId),
      },
    })

    const numbered = await prisma.crmInvoice.update({
      where: { id: invoice.id },
      data: { invoiceNumber: documentNumber('INV', invoice.id) },
    })
    return c.json(bigintFix(numbered), 201)
  },
)

invoicesRoutes.patch(
  '/:id',
  zValidator(
    'json',
    z.object({
      status: z.enum(['draft', 'sent', 'partial', 'paid', 'cancelled']).optional(),
      dueDate: z.string().nullish(),
      terms: z.string().max(255).nullish(),
      notes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')

    const row = await prisma.crmInvoice.update({
      where: { id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.status === 'sent' ? { sentAt: new Date() } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? new Date(body.dueDate) : null } : {}),
        ...(body.terms !== undefined ? { terms: body.terms } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    })
    return c.json(bigintFix(row))
  },
)

// DELETE /api/invoices/:id
//
// An invoice with payments against it is a financial record, and deleting it
// destroys the only trace that money arrived. Cancelling keeps the number and
// the audit trail, which is what accounting actually wants — so payments block
// the delete unless somebody explicitly forces it.
invoicesRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))

  const payments = await prisma.crmPayment.count({ where: { invoiceId: id } })
  if (payments > 0 && c.req.query('force') !== '1') {
    return c.json(
      {
        error:
          `This invoice has ${payments} payment${payments === 1 ? '' : 's'} recorded against it. ` +
          'Cancel it instead — that keeps the number and the record of what was received. ' +
          'Repeat with ?force=1 only if it was raised in error.',
        paymentCount: payments,
      },
      409,
    )
  }

  // Items and payments both cascade off the invoice.
  await prisma.crmInvoice.delete({ where: { id } })
  return c.json({ success: true, deletedPayments: payments })
})

invoicesRoutes.post('/:id/items', zValidator('json', lineBody), async (c) => {
  const invoiceId = BigInt(c.req.param('id'))
  const body = c.req.valid('json')
  const count = await prisma.crmInvoiceItem.count({ where: { invoiceId } })

  const row = await prisma.crmInvoiceItem.create({
    data: {
      invoiceId,
      productId: body.productId ? BigInt(body.productId) : null,
      name: body.name,
      sku: body.sku ?? null,
      hsnCode: body.hsnCode ?? null,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      discountPercent: body.discountPercent,
      taxPercent: body.taxPercent,
      total: lineTotal(body),
      sortOrder: count * 10,
    },
  })
  await recalc('invoice', invoiceId)
  return c.json(bigintFix(row), 201)
})

invoicesRoutes.patch('/:invoiceId/items/:itemId', zValidator('json', lineBody.partial()), async (c) => {
  const invoiceId = BigInt(c.req.param('invoiceId'))
  const itemId = BigInt(c.req.param('itemId'))
  const body = c.req.valid('json')
  const existing = await prisma.crmInvoiceItem.findFirst({ where: { id: itemId, invoiceId } })
  if (!existing) return c.json({ error: 'Line not found' }, 404)
  const merged = {
    quantity: body.quantity ?? Number(existing.quantity),
    unitPrice: body.unitPrice ?? Number(existing.unitPrice),
    discountPercent: body.discountPercent ?? Number(existing.discountPercent),
    taxPercent: body.taxPercent ?? Number(existing.taxPercent),
  }
  const row = await prisma.crmInvoiceItem.update({
    where: { id: itemId },
    data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.sku !== undefined ? { sku: body.sku } : {}), ...merged, total: lineTotal(merged) },
  })
  await recalc('invoice', invoiceId)
  return c.json(bigintFix(row))
})

invoicesRoutes.delete('/:invoiceId/items/:itemId', async (c) => {
  await prisma.crmInvoiceItem.delete({ where: { id: BigInt(c.req.param('itemId')) } })
  await recalc('invoice', BigInt(c.req.param('invoiceId')))
  return c.json({ success: true })
})

// ── Payments
invoicesRoutes.post(
  '/:id/payments',
  zValidator(
    'json',
    z.object({
      amount: z.number().positive(),
      paymentDate: z.string(),
      mode: z.string().max(24).default('bank_transfer'),
      transactionId: z.string().max(120).nullish(),
      bank: z.string().max(120).nullish(),
      reference: z.string().max(255).nullish(),
      notes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const invoiceId = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')

    const invoice = await prisma.crmInvoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

    // Overpayment is almost always a typo, and it silently corrupts every
    // outstanding-balance report until somebody notices.
    const already = await paidTotal(invoiceId)
    const balance = Number(invoice.total) - already
    if (body.amount > balance + 0.01) {
      return c.json(
        {
          error: `That is more than the ${balance.toFixed(2)} outstanding on this invoice.`,
          balance,
        },
        400,
      )
    }

    const payment = await prisma.crmPayment.create({
      data: {
        invoiceId,
        amount: body.amount,
        paymentDate: new Date(body.paymentDate),
        mode: body.mode,
        transactionId: body.transactionId ?? null,
        bank: body.bank ?? null,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        recordedById: BigInt(user.userId),
      },
    })

    const paid = await paidTotal(invoiceId)
    await prisma.crmInvoice.update({
      where: { id: invoiceId },
      data: { amountPaid: paid, status: invoiceStatus(invoice.status, Number(invoice.total), paid) },
    })

    if (invoice.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: invoice.accountId,
        kind: 'payment',
        subject: `Payment received on ${invoice.invoiceNumber}`,
        actorId: user.userId,
        meta: { amount: body.amount, invoiceId: Number(invoiceId) },
      })
    }
    await bumpLeadScore(await leadIdForQuote({ dealId: invoice.dealId }), 15, `payment on ${invoice.invoiceNumber}`)

    return c.json(bigintFix(payment), 201)
  },
)

invoicesRoutes.delete('/:invoiceId/payments/:paymentId', adminOnly, async (c) => {
  const invoiceId = BigInt(c.req.param('invoiceId'))
  await prisma.crmPayment.delete({ where: { id: BigInt(c.req.param('paymentId')) } })

  const invoice = await prisma.crmInvoice.findUnique({ where: { id: invoiceId } })
  if (invoice) {
    const paid = await paidTotal(invoiceId)
    await prisma.crmInvoice.update({
      where: { id: invoiceId },
      data: { amountPaid: paid, status: invoiceStatus(invoice.status, Number(invoice.total), paid) },
    })
  }
  return c.json({ success: true })
})
