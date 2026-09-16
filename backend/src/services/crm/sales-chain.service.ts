// ─────────────────────────────────────────────────────────────────────────────
// The sales chain, resolved from any link in it.
//
//   Deal ──▶ Quote ──▶ Contract ──▶ Order ──▶ Invoice ──▶ Payment
//
// Every document page used to show only its own row and one link up. Asked
// "where does this stand?" a rep opened four list pages and reconciled them by
// hand. This answers it once: hand it ANY id — a deal, a quote, a contract, an
// order, an invoice — and it returns the whole family, the money at each step,
// and the single next action the chain is waiting for.
//
// MEMBERSHIP. Everything sharing the deal belongs together. A document with no
// deal (plenty of businesses invoice without ever quoting) is walked by its
// explicit links instead: quote → contracts by quote_id → orders by quote_id →
// invoices by order_id, and back up the same way.
//
// The "next" rule lives HERE and nowhere else, so the deal page, the lead
// panel, the document pages and the Sales Desk cannot disagree about it.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import { hasFeature } from '../../lib/tenant-context'
import { isQuoteExpired } from './quote-builder'
import { isOverdue } from './documents.service'

export type ChainRef =
  | { deal: bigint }
  | { quote: bigint }
  | { contract: bigint }
  | { order: bigint }
  | { invoice: bigint }

const num = (v: unknown) => (v == null ? 0 : Number(v))
const round = (n: number) => Math.round(n * 100) / 100

export interface NextAction {
  key:
    | 'send_quote'
    | 'follow_up_quote'
    | 'convert_quote'
    | 'draw_contract'
    | 'send_contract'
    | 'chase_signature'
    | 'raise_order'
    | 'raise_invoice'
    | 'send_invoice'
    | 'chase_overdue'
    | 'record_payment'
    | 'raise_quote'
    | 'revise_quote'
    | 'none'
  label: string
  hint: string
  tone: 'primary' | 'good' | 'warn' | 'muted'
  /** The document the action is about, so a UI can link or act on it. */
  target: { kind: 'deal' | 'quote' | 'contract' | 'order' | 'invoice'; id: number } | null
}

/**
 * Find the root of the family, then load every member.
 */
export async function resolveChain(ref: ChainRef) {
  // ── 1. Work out the deal (and account) this belongs to, plus the seed ids
  //       for a chain that has no deal.
  let dealId: bigint | null = null
  let accountId: bigint | null = null
  let quoteIds = new Set<string>()
  let contractIds = new Set<string>()
  let orderIds = new Set<string>()
  let invoiceIds = new Set<string>()

  if ('deal' in ref) {
    const d = await prisma.deal.findUnique({ where: { id: ref.deal }, select: { id: true, accountId: true } })
    if (!d) return null
    dealId = d.id
    accountId = d.accountId
  } else if ('quote' in ref) {
    const q = await prisma.quote.findUnique({ where: { id: ref.quote }, select: { id: true, dealId: true, accountId: true } })
    if (!q) return null
    dealId = q.dealId
    accountId = q.accountId
    quoteIds.add(String(q.id))
  } else if ('contract' in ref) {
    const ct = await prisma.contract.findUnique({ where: { id: ref.contract }, select: { id: true, dealId: true, accountId: true, quoteId: true } })
    if (!ct) return null
    dealId = ct.dealId
    accountId = ct.accountId
    contractIds.add(String(ct.id))
    if (ct.quoteId) quoteIds.add(String(ct.quoteId))
  } else if ('order' in ref) {
    const o = await prisma.order.findUnique({ where: { id: ref.order }, select: { id: true, dealId: true, accountId: true, quoteId: true, contractId: true } })
    if (!o) return null
    dealId = o.dealId
    accountId = o.accountId
    orderIds.add(String(o.id))
    if (o.quoteId) quoteIds.add(String(o.quoteId))
    if (o.contractId) contractIds.add(String(o.contractId))
  } else {
    const inv = await prisma.crmInvoice.findUnique({ where: { id: ref.invoice }, select: { id: true, dealId: true, accountId: true, orderId: true } })
    if (!inv) return null
    dealId = inv.dealId
    accountId = inv.accountId
    invoiceIds.add(String(inv.id))
    if (inv.orderId) orderIds.add(String(inv.orderId))
  }

  // ── 2. Load the family.
  const big = (set: Set<string>) => [...set].map((x) => BigInt(x))

  const [deal, account] = await Promise.all([
    dealId
      ? prisma.deal.findUnique({
          where: { id: dealId },
          include: { stage: { select: { id: true, name: true, isWon: true, isLost: true, probability: true } }, owner: { select: { id: true, name: true } } },
        })
      : null,
    accountId ? prisma.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, email: true, phone: true } }) : null,
  ])

  // With a deal, membership is "same deal". Without, follow the links out from
  // the seed in both directions until nothing new appears (two passes suffice:
  // the graph is a straight line).
  let quotes = await prisma.quote.findMany({
    where: dealId ? { dealId } : { id: { in: big(quoteIds) } },
    orderBy: { issueDate: 'desc' },
    select: { id: true, quoteNumber: true, status: true, total: true, currency: true, issueDate: true, validUntil: true, sentAt: true, viewedAt: true, decidedAt: true, dealId: true },
  })
  if (!dealId) {
    // Orders seeded by an invoice may point at quotes we have not loaded yet.
    const seedOrders = orderIds.size ? await prisma.order.findMany({ where: { id: { in: big(orderIds) } }, select: { quoteId: true, contractId: true } }) : []
    for (const o of seedOrders) {
      if (o.quoteId) quoteIds.add(String(o.quoteId))
      if (o.contractId) contractIds.add(String(o.contractId))
    }
    const seedContracts = contractIds.size ? await prisma.contract.findMany({ where: { id: { in: big(contractIds) } }, select: { quoteId: true } }) : []
    for (const ct of seedContracts) if (ct.quoteId) quoteIds.add(String(ct.quoteId))
    if (quoteIds.size) {
      quotes = await prisma.quote.findMany({
        where: { id: { in: big(quoteIds) } },
        orderBy: { issueDate: 'desc' },
        select: { id: true, quoteNumber: true, status: true, total: true, currency: true, issueDate: true, validUntil: true, sentAt: true, viewedAt: true, decidedAt: true, dealId: true },
      })
    }
  }
  quoteIds = new Set(quotes.map((q) => String(q.id)))

  const contracts = await prisma.contract.findMany({
    where: dealId
      ? { dealId }
      : { OR: [{ id: { in: big(contractIds) } }, ...(quoteIds.size ? [{ quoteId: { in: big(quoteIds) } }] : [])] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, contractNumber: true, title: true, status: true, value: true, currency: true, quoteId: true, startDate: true, endDate: true, renewalDate: true, signedAt: true, signedBy: true, documentUrl: true },
  })
  contractIds = new Set(contracts.map((c) => String(c.id)))

  const orders = await prisma.order.findMany({
    where: dealId
      ? { dealId }
      : {
          OR: [
            { id: { in: big(orderIds) } },
            ...(quoteIds.size ? [{ quoteId: { in: big(quoteIds) } }] : []),
            ...(contractIds.size ? [{ contractId: { in: big(contractIds) } }] : []),
          ],
        },
    orderBy: { orderDate: 'desc' },
    select: { id: true, orderNumber: true, status: true, total: true, currency: true, orderDate: true, deliveryDate: true, quoteId: true, contractId: true },
  })
  orderIds = new Set(orders.map((o) => String(o.id)))

  const invoices = await prisma.crmInvoice.findMany({
    where: dealId ? { dealId } : { OR: [{ id: { in: big(invoiceIds) } }, ...(orderIds.size ? [{ orderId: { in: big(orderIds) } }] : [])] },
    orderBy: { issueDate: 'desc' },
    select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true, currency: true, issueDate: true, dueDate: true, orderId: true, sentAt: true },
  })
  invoiceIds = new Set(invoices.map((i) => String(i.id)))

  const payments = invoiceIds.size
    ? await prisma.crmPayment.findMany({
        where: { invoiceId: { in: big(invoiceIds) } },
        orderBy: { paymentDate: 'desc' },
        select: { id: true, invoiceId: true, amount: true, paymentDate: true, mode: true, reference: true },
      })
    : []

  const projectCount = hasFeature('projects') && dealId ? await prisma.crmProject.count({ where: { dealId, trash: 0 } }) : 0

  // ── 3. Shape it.
  const liveQuotes = quotes.filter((q) => !['rejected', 'expired'].includes(q.status) && !isQuoteExpired(q))
  const liveContracts = contracts.filter((c) => !['expired', 'terminated'].includes(c.status))
  const liveOrders = orders.filter((o) => o.status !== 'cancelled')
  const liveInvoices = invoices.filter((i) => !['draft', 'cancelled'].includes(i.status))

  const totals = {
    dealValue: deal?.value != null ? num(deal.value) : null,
    quoted: round(liveQuotes.reduce((t, q) => t + num(q.total), 0)),
    contracted: round(liveContracts.reduce((t, c) => t + num(c.value), 0)),
    ordered: round(liveOrders.reduce((t, o) => t + num(o.total), 0)),
    invoiced: round(liveInvoices.reduce((t, i) => t + num(i.total), 0)),
    received: round(liveInvoices.reduce((t, i) => t + num(i.amountPaid), 0)),
    outstanding: 0,
    overdue: 0,
  }
  totals.outstanding = round(totals.invoiced - totals.received)
  totals.overdue = round(
    invoices.filter((i) => isOverdue(i)).reduce((t, i) => t + (num(i.total) - num(i.amountPaid)), 0),
  )

  const convertedQuoteIds = new Set(orders.map((o) => String(o.quoteId)))
  const contractedQuoteIds = new Set(contracts.map((c) => String(c.quoteId)))
  const invoicedOrderIds = new Set(invoices.filter((i) => i.status !== 'cancelled').map((i) => String(i.orderId)))
  const orderedContractIds = new Set(orders.map((o) => String(o.contractId)))

  const acceptedUnconverted = quotes.find((q) => q.status === 'accepted' && !convertedQuoteIds.has(String(q.id)))
  const signedWithoutOrder = contracts.find((c) => ['signed', 'active'].includes(c.status) && !orderedContractIds.has(String(c.id)) && !(c.quoteId && convertedQuoteIds.has(String(c.quoteId))))
  const uninvoicedOrder = liveOrders.find((o) => !invoicedOrderIds.has(String(o.id)))
  const draftContract = contracts.find((c) => c.status === 'draft')
  const sentContract = contracts.find((c) => ['sent', 'under_review'].includes(c.status))
  const overdueInvoice = invoices.find((i) => isOverdue(i))
  const draftInvoice = invoices.find((i) => i.status === 'draft')
  const openInvoice = invoices.find((i) => ['sent', 'partial'].includes(i.status))
  const draftQuote = quotes.find((q) => q.status === 'draft')
  const awaitingQuote = liveQuotes.find((q) => ['sent', 'viewed'].includes(q.status))

  // The one thing the chain is waiting for, in chain order: money first
  // (overdue), then whatever is closest to money.
  let next: NextAction
  if (overdueInvoice) {
    next = { key: 'chase_overdue', label: 'Chase the overdue invoice', hint: `${overdueInvoice.invoiceNumber} is past due.`, tone: 'warn', target: { kind: 'invoice', id: Number(overdueInvoice.id) } }
  } else if (acceptedUnconverted) {
    next = { key: 'convert_quote', label: 'Convert the accepted quote to an order', hint: `${acceptedUnconverted.quoteNumber} was accepted — book it.`, tone: 'good', target: { kind: 'quote', id: Number(acceptedUnconverted.id) } }
  } else if (signedWithoutOrder) {
    next = { key: 'raise_order', label: 'Raise the order for the signed contract', hint: `${signedWithoutOrder.contractNumber} is signed and has no order.`, tone: 'good', target: { kind: 'contract', id: Number(signedWithoutOrder.id) } }
  } else if (uninvoicedOrder) {
    next = { key: 'raise_invoice', label: 'Raise the invoice', hint: `${uninvoicedOrder.orderNumber} has no invoice yet.`, tone: 'primary', target: { kind: 'order', id: Number(uninvoicedOrder.id) } }
  } else if (draftInvoice) {
    next = { key: 'send_invoice', label: 'Send the invoice', hint: `${draftInvoice.invoiceNumber} is still a draft.`, tone: 'primary', target: { kind: 'invoice', id: Number(draftInvoice.id) } }
  } else if (openInvoice) {
    next = { key: 'record_payment', label: 'Record the payment', hint: `${openInvoice.invoiceNumber} is awaiting money.`, tone: 'primary', target: { kind: 'invoice', id: Number(openInvoice.id) } }
  } else if (sentContract) {
    next = { key: 'chase_signature', label: 'Chase the signature', hint: `${sentContract.contractNumber} is with the customer.`, tone: 'primary', target: { kind: 'contract', id: Number(sentContract.id) } }
  } else if (draftContract) {
    next = { key: 'send_contract', label: 'Send the contract', hint: `${draftContract.contractNumber} is still a draft.`, tone: 'primary', target: { kind: 'contract', id: Number(draftContract.id) } }
  } else if (draftQuote) {
    next = { key: 'send_quote', label: 'Send the quote', hint: `${draftQuote.quoteNumber} is not an offer until it leaves.`, tone: 'primary', target: { kind: 'quote', id: Number(draftQuote.id) } }
  } else if (awaitingQuote) {
    next = { key: 'follow_up_quote', label: 'Follow up on the quote', hint: `${awaitingQuote.quoteNumber} is sent, no decision yet.`, tone: 'primary', target: { kind: 'quote', id: Number(awaitingQuote.id) } }
  } else if (!quotes.length && deal && !deal.stage.isLost) {
    next = { key: 'raise_quote', label: 'Raise the first quote', hint: 'Nothing has been priced yet.', tone: 'primary', target: { kind: 'deal', id: Number(deal.id) } }
  } else if (quotes.length && !liveQuotes.length && !orders.length) {
    next = { key: 'revise_quote', label: 'Raise a fresh quote', hint: 'Every quote so far was declined or expired.', tone: 'primary', target: quotes[0] ? { kind: 'quote', id: Number(quotes[0].id) } : null }
  } else if (totals.invoiced > 0 && totals.outstanding <= 0) {
    next = { key: 'none', label: 'All settled', hint: 'Everything invoiced has been paid.', tone: 'muted', target: null }
  } else {
    next = { key: 'none', label: 'Nothing waiting', hint: '', tone: 'muted', target: null }
  }

  return {
    deal: deal
      ? {
          id: Number(deal.id),
          dealNumber: deal.dealNumber,
          name: deal.name,
          value: deal.value != null ? Number(deal.value) : null,
          currency: deal.currency,
          stage: { id: Number(deal.stage.id), name: deal.stage.name, isWon: deal.stage.isWon, isLost: deal.stage.isLost, probability: deal.stage.probability },
          owner: deal.owner ? { id: Number(deal.owner.id), name: deal.owner.name } : null,
          expectedCloseDate: deal.expectedCloseDate,
        }
      : null,
    account: account ? { id: Number(account.id), name: account.name, email: account.email, phone: account.phone } : null,
    quotes: quotes.map((q) => ({
      ...q,
      id: Number(q.id),
      dealId: q.dealId ? Number(q.dealId) : null,
      total: num(q.total),
      expiredByDate: isQuoteExpired(q),
      converted: convertedQuoteIds.has(String(q.id)),
      contracted: contractedQuoteIds.has(String(q.id)),
    })),
    contracts: contracts.map((c) => ({
      ...c,
      id: Number(c.id),
      quoteId: c.quoteId ? Number(c.quoteId) : null,
      value: c.value != null ? Number(c.value) : null,
      ordered: orderedContractIds.has(String(c.id)),
    })),
    orders: orders.map((o) => ({
      ...o,
      id: Number(o.id),
      quoteId: o.quoteId ? Number(o.quoteId) : null,
      contractId: o.contractId ? Number(o.contractId) : null,
      total: num(o.total),
      invoiced: invoicedOrderIds.has(String(o.id)),
    })),
    invoices: invoices.map((i) => ({
      ...i,
      id: Number(i.id),
      orderId: i.orderId ? Number(i.orderId) : null,
      total: num(i.total),
      amountPaid: num(i.amountPaid),
      balance: round(num(i.total) - num(i.amountPaid)),
      overdue: isOverdue(i),
    })),
    payments: payments.map((p) => ({ ...p, id: Number(p.id), invoiceId: Number(p.invoiceId), amount: num(p.amount) })),
    projectCount,
    totals,
    next,
    // Kept for the older SalesChain strip, which reads these two directly.
    acceptedQuoteId: acceptedUnconverted ? Number(acceptedUnconverted.id) : null,
    uninvoicedOrderId: uninvoicedOrder ? Number(uninvoicedOrder.id) : null,
  }
}

export type SalesChain = NonNullable<Awaited<ReturnType<typeof resolveChain>>>

/**
 * Everything across the whole book that is waiting on somebody — the Sales
 * Desk's lists. Each list is the same rule the chain uses, applied broadly.
 */
export async function attention() {
  const now = new Date()
  const in7 = new Date(now.getTime() + 7 * 86_400_000)
  const in90 = new Date(now.getTime() + 90 * 86_400_000)

  const [acceptedQuotes, ordersAll, signedContracts, invoicesOpen, quotesLive, contractsRenewing] = await Promise.all([
    prisma.quote.findMany({ where: { status: 'accepted' }, select: { id: true, quoteNumber: true, total: true, accountId: true, decidedAt: true, dealId: true } }),
    prisma.order.findMany({ where: { status: { not: 'cancelled' } }, select: { id: true, orderNumber: true, total: true, accountId: true, quoteId: true, contractId: true, orderDate: true, status: true } }),
    prisma.contract.findMany({ where: { status: { in: ['signed', 'active'] } }, select: { id: true, contractNumber: true, title: true, value: true, accountId: true, quoteId: true, signedAt: true } }),
    prisma.crmInvoice.findMany({ where: { status: { in: ['sent', 'partial', 'draft'] } }, select: { id: true, invoiceNumber: true, total: true, amountPaid: true, dueDate: true, accountId: true, status: true } }),
    prisma.quote.findMany({ where: { status: { in: ['sent', 'viewed'] } }, select: { id: true, quoteNumber: true, total: true, accountId: true, validUntil: true, sentAt: true, status: true } }),
    prisma.contract.findMany({ where: { renewalDate: { gte: now, lte: in90 }, status: { in: ['signed', 'active'] } }, select: { id: true, contractNumber: true, title: true, value: true, accountId: true, renewalDate: true } }),
  ])

  const invoicedOrderIds = new Set((await prisma.crmInvoice.findMany({ where: { status: { not: 'cancelled' } }, select: { orderId: true } })).map((i) => String(i.orderId)))
  const convertedQuoteIds = new Set(ordersAll.map((o) => String(o.quoteId)))
  const orderedContractIds = new Set(ordersAll.map((o) => String(o.contractId)))

  const accountIds = new Set<string>()
  for (const r of [...acceptedQuotes, ...ordersAll, ...signedContracts, ...invoicesOpen, ...quotesLive, ...contractsRenewing]) if (r.accountId) accountIds.add(String(r.accountId))
  const accounts = accountIds.size ? await prisma.account.findMany({ where: { id: { in: [...accountIds].map((x) => BigInt(x)) } }, select: { id: true, name: true } }) : []
  const acc = new Map(accounts.map((a) => [String(a.id), a.name]))
  const withAcc = <T extends { accountId: bigint | null }>(r: T) => ({ ...r, accountName: r.accountId ? acc.get(String(r.accountId)) ?? null : null })

  const overdue = invoicesOpen.filter((i) => i.status !== 'draft' && isOverdue(i))
  const fix = <T extends object>(rows: T[]) => rows.map((r) => JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))))

  return {
    quotesToConvert: fix(acceptedQuotes.filter((q) => !convertedQuoteIds.has(String(q.id))).map(withAcc)),
    contractsWithoutOrder: fix(signedContracts.filter((c) => !orderedContractIds.has(String(c.id)) && !(c.quoteId && convertedQuoteIds.has(String(c.quoteId)))).map(withAcc)),
    ordersToInvoice: fix(ordersAll.filter((o) => !invoicedOrderIds.has(String(o.id))).map(withAcc)),
    invoicesOverdue: fix(overdue.map((i) => ({ ...withAcc(i), balance: round(num(i.total) - num(i.amountPaid)) }))),
    invoicesDraft: fix(invoicesOpen.filter((i) => i.status === 'draft').map(withAcc)),
    quotesExpiring: fix(quotesLive.filter((q) => q.validUntil && q.validUntil <= in7 && !isQuoteExpired(q)).map(withAcc)),
    quotesAwaiting: fix(quotesLive.filter((q) => !isQuoteExpired(q)).map(withAcc)),
    contractsRenewing: fix(contractsRenewing.map(withAcc)),
    funnel: {
      quotedLive: round(quotesLive.filter((q) => !isQuoteExpired(q)).reduce((t, q) => t + num(q.total), 0)),
      accepted: round(acceptedQuotes.reduce((t, q) => t + num(q.total), 0)),
      contracted: round(signedContracts.reduce((t, c) => t + num(c.value), 0)),
      ordered: round(ordersAll.reduce((t, o) => t + num(o.total), 0)),
      invoiced: round(invoicesOpen.filter((i) => i.status !== 'draft').reduce((t, i) => t + num(i.total), 0)),
      outstanding: round(invoicesOpen.filter((i) => i.status !== 'draft').reduce((t, i) => t + (num(i.total) - num(i.amountPaid)), 0)),
      overdue: round(overdue.reduce((t, i) => t + (num(i.total) - num(i.amountPaid)), 0)),
    },
  }
}
