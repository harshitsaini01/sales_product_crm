// ─────────────────────────────────────────────────────────────────────────────
// The customer's view of a quote — no login.
//
//   GET  /api/public/quotes/:token?t=<slug>            the document + Accept / Decline
//   POST /api/public/quotes/:token/decision?t=<slug>   the customer's answer
//
// Opening the page stamps `viewedAt` and flips a sent quote to `viewed`, which
// is the "did they even look at it?" a rep otherwise has to phone to find out.
// A decision stamps `decidedAt`, sets the status, and lands on the deal's and
// account's timelines so the rep sees it without refreshing the quote.
//
// Mounted under publicTenantMiddleware (the customer comes from `t=`), and
// behind requireFeature('sales_docs') so a customer without the module has no
// public surface here at all.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { verifyQuoteToken } from '../services/crm/quote-links'
import { buildQuoteDoc, isQuoteExpired } from '../services/crm/quote-builder'
import { renderQuoteHtml } from '../services/crm/quote-document'
import * as activity from '../services/crm/activity.service'
import { placeOrderFromQuote, PlaceOrderError } from '../services/crm/place-order.service'
import { bumpLeadScore, leadIdForQuote } from '../services/crm/sales-events.service'

export const publicQuotesRoutes = new Hono()

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The bar above the document: where it stands, and the two buttons. */
function decisionBar(opts: {
  status: string
  expired: boolean
  decidedAt: Date | null
  action: string
  message?: string | null
}): string {
  const { status, expired, decidedAt, action, message } = opts
  const box = (inner: string, tone: string) =>
    `<div style="max-width:760px;margin:0 auto 16px auto;padding:16px 20px;border-radius:10px;border:1px solid ${tone};background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;color:#0f172a" class="no-print">${inner}</div>`

  if (message) return box(`<strong>${esc(message)}</strong>`, '#a7f3d0')

  if (status === 'accepted') {
    return box(`<strong style="color:#047857">Accepted</strong>${decidedAt ? ` on ${decidedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}. Thank you — your order is being prepared.`, '#a7f3d0')
  }
  if (status === 'countered') {
    return box(`<strong style="color:#b45309">Counter received.</strong> Our team will come back with a revised quotation.`, '#fde68a')
  }
  if (status === 'rejected') {
    return box(`<strong style="color:#b91c1c">Declined</strong>${decidedAt ? ` on ${decidedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}. If anything changes, reply to the email this came with.`, '#fecaca')
  }
  if (expired || status === 'expired') {
    return box(`<strong style="color:#b45309">This quotation has expired.</strong> Reply to the email it came with and we will send a fresh one.`, '#fde68a')
  }

  return box(
    `<form method="post" action="${esc(action)}" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span style="flex:1;min-width:220px">Please review the quotation below.</span>
      <input name="name" placeholder="Your name" required maxlength="120" style="padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;min-width:170px">
      <input name="note" placeholder="A note for us (optional)" maxlength="500" style="padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;min-width:220px">
      <button name="decision" value="accept" style="padding:10px 18px;border:0;border-radius:8px;background:#059669;color:#fff;font-weight:600;font-size:14px;cursor:pointer">Accept &amp; place order</button>
      <button name="decision" value="counter" style="padding:10px 14px;border:1px solid #c4b5fd;border-radius:8px;background:#fff;color:#5b21b6;font-weight:600;font-size:14px;cursor:pointer">Counter</button>
      <button name="decision" value="reject" style="padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font-weight:600;font-size:14px;cursor:pointer">Decline</button>
    </form>`,
    '#c7d2fe',
  )
}

function page(bar: string, documentHtml: string): string {
  // The document is a full HTML page of its own; drop the bar in right after
  // <body ...> so it sits above the sheet and prints away with .no-print.
  return documentHtml.replace(/<body([^>]*)>/i, (m) => `${m}\n${bar}`)
}

async function load(token: string) {
  const id = verifyQuoteToken(token)
  if (!id) return null
  const quote = await prisma.quote.findUnique({ where: { id } })
  if (!quote) return null
  return quote
}

publicQuotesRoutes.get('/:token', async (c) => {
  const quote = await load(c.req.param('token'))
  if (!quote) return c.text('This link is not valid.', 404)

  // The first open of a sent quote is news worth keeping.
  if (quote.status === 'sent' || !quote.viewedAt) {
    const now = new Date()
    await prisma.quote.update({
      where: { id: quote.id },
      data: {
        ...(quote.viewedAt ? {} : { viewedAt: now }),
        ...(quote.status === 'sent' ? { status: 'viewed' } : {}),
      },
    })
    if (!quote.viewedAt) {
      if (quote.dealId) {
        await activity.recordSafe({ entityType: 'deal', entityId: quote.dealId, kind: 'quote', subject: `Quote ${quote.quoteNumber} opened by the customer`, meta: { quoteId: Number(quote.id) } })
      }
      if (quote.accountId) {
        await activity.recordSafe({ entityType: 'account', entityId: quote.accountId, kind: 'quote', subject: `Quote ${quote.quoteNumber} opened by the customer`, meta: { quoteId: Number(quote.id) } })
      }
      const leadId = await leadIdForQuote(quote)
      await bumpLeadScore(leadId, 5, `quote ${quote.quoteNumber} viewed`)
    }
  }

  const doc = await buildQuoteDoc(quote.id)
  if (!doc) return c.text('This link is not valid.', 404)

  const slug = c.req.query('t')
  const action = `${new URL(c.req.url).pathname}/decision${slug ? `?t=${encodeURIComponent(slug)}` : ''}`
  const bar = decisionBar({
    status: quote.status === 'sent' ? 'viewed' : quote.status,
    expired: isQuoteExpired(quote),
    decidedAt: quote.decidedAt,
    action,
    message: c.req.query('done') === 'accept'
      ? 'Thank you — your order has been placed and an invoice is on its way.'
      : c.req.query('done') === 'reject'
        ? 'Noted — we have recorded that you are not going ahead.'
        : c.req.query('done') === 'counter'
          ? 'Thanks — we have your counter. A revised quote will follow.'
          : null,
  })
  return c.html(page(bar, renderQuoteHtml(doc)))
})

publicQuotesRoutes.post('/:token/decision', async (c) => {
  const quote = await load(c.req.param('token'))
  if (!quote) return c.text('This link is not valid.', 404)

  const form = await c.req.parseBody()
  const decision = String(form.decision ?? '')
  const name = String(form.name ?? '').trim().slice(0, 120)
  const note = String(form.note ?? '').trim().slice(0, 500)
  if (!['accept', 'reject', 'counter'].includes(decision)) return c.text('Bad request', 400)

  // A decided quote stays decided. A second click on a stale tab must not
  // flip an acceptance to a rejection.
  if (['accepted', 'rejected'].includes(quote.status)) {
    return c.redirect(`${new URL(c.req.url).pathname.replace(/\/decision$/, '')}${c.req.query('t') ? `?t=${encodeURIComponent(c.req.query('t')!)}` : ''}`)
  }
  if (isQuoteExpired(quote) && decision === 'accept') {
    return c.text('This quotation has expired and can no longer be accepted. Please ask for a fresh one.', 410)
  }

  if (decision === 'counter') {
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: 'countered', counterNotes: note || null, viewedAt: quote.viewedAt ?? new Date() },
    })
    if (quote.dealId) {
      await activity.recordSafe({ entityType: 'deal', entityId: quote.dealId, kind: 'quote', subject: `Quote ${quote.quoteNumber} countered by the customer`, body: note || null })
    }
    if (quote.accountId) {
      await activity.recordSafe({ entityType: 'account', entityId: quote.accountId, kind: 'quote', subject: `Quote ${quote.quoteNumber} countered`, body: note || null })
    }
    await bumpLeadScore(await leadIdForQuote(quote), 6, `quote ${quote.quoteNumber} countered`)
    const slug = c.req.query('t')
    const back = new URL(c.req.url).pathname.replace(/\/decision$/, '')
    return c.redirect(`${back}?${slug ? `t=${encodeURIComponent(slug)}&` : ''}done=counter`)
  }

  if (decision === 'reject') {
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: 'rejected', decidedAt: new Date(), viewedAt: quote.viewedAt ?? new Date() },
    })
    if (quote.reservedUntil) {
      const items = await prisma.quoteItem.findMany({ where: { quoteId: quote.id } })
      const { releaseLines } = await import('../services/crm/stock.service')
      await releaseLines(
        items.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        { type: 'quote', id: quote.id },
      )
      await prisma.quote.update({ where: { id: quote.id }, data: { reservedUntil: null } })
    }
  } else {
    try {
      await placeOrderFromQuote({
        quoteId: quote.id,
        actorId: quote.ownerId ?? BigInt(1),
      })
    } catch (err) {
      if (err instanceof PlaceOrderError) return c.text(err.message, err.status as 400)
      throw err
    }
  }

  const status = decision === 'accept' ? 'accepted' : 'rejected'
  const subject = `Quote ${quote.quoteNumber} ${status} by the customer${name ? ` (${name})` : ''}`
  const body = note || null
  if (quote.dealId) {
    await activity.recordSafe({ entityType: 'deal', entityId: quote.dealId, kind: 'quote', subject, body, meta: { quoteId: Number(quote.id), decision: status, name } })
  }
  if (quote.accountId) {
    await activity.recordSafe({ entityType: 'account', entityId: quote.accountId, kind: 'quote', subject, body, meta: { quoteId: Number(quote.id), decision: status, name } })
  }
  await bumpLeadScore(await leadIdForQuote(quote), decision === 'accept' ? 20 : -4, `quote ${quote.quoteNumber} ${status}`)

  const slug = c.req.query('t')
  const back = new URL(c.req.url).pathname.replace(/\/decision$/, '')
  return c.redirect(`${back}?${slug ? `t=${encodeURIComponent(slug)}&` : ''}done=${decision}`)
})
