// ─────────────────────────────────────────────────────────────────────────────
// The company panel that lives ON the lead.
//
// WHY THIS IS NOT JUST "GO TO THE ACCOUNTS SECTION"
//
// A sales rep works out of the lead list. Making them leave it, find the same
// company again in a separate section, and then come back is friction on the
// one screen they use all day. So the lead page shows the company inline:
// before conversion just its name, and afterwards everything the account has —
// deals, quotes, invoices — without going anywhere.
//
// Mounted under the `accounts` module, which the education vertical leaves off,
// so a Tutelage lead page is completely unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { hasFeature } from '../lib/tenant-context'
import { bigintFix } from '../services/crm/serialize'
import { accountDetail } from '../services/crm/account-summary.service'
import { PROJECT_INCLUDE, serializeProject } from '../services/crm/projects.service'

export const leadBusinessRoutes = new Hono()

leadBusinessRoutes.use('*', authenticate)

/**
 * GET /api/lead-business/:leadId
 *
 * Everything the lead's company panel renders, in one call. Three shapes:
 *
 *   converted: false, business: null   — nothing recorded yet
 *   converted: false, business: {...}  — a company name, not yet an account
 *   converted: true,  account: {...}   — the full account, inline
 *
 * `lead` rides along in all three, so the panel can offer the person's own name
 * as the company to convert into when nobody has typed one — which is the right
 * default whenever somebody is buying for themselves.
 */
leadBusinessRoutes.get('/:leadId', async (c) => {
  const leadId = BigInt(c.req.param('leadId'))

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, email: true, mobile: true },
  })
  if (!lead) return c.json({ error: 'Lead not found' }, 404)

  const business = await prisma.leadBusiness.findUnique({ where: { leadId } })

  // Projects opened from this lead (or from the account it became). Newest
  // first; the panel shows a handful and links to the rest.
  const projects = hasFeature('projects')
    ? await prisma.crmProject.findMany({
        where: {
          trash: 0,
          OR: [{ leadId }, ...(business?.accountId ? [{ accountId: business.accountId }] : [])],
        },
        include: PROJECT_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 8,
      })
    : []

  if (!business?.accountId) {
    return c.json({
      converted: false,
      lead: bigintFix(lead),
      business: business ? bigintFix(business) : null,
      account: null,
      projects: projects.map(serializeProject),
    })
  }

  // Converted: the account page's own payload, assembled by the same function
  // it uses. Not a smaller version of it — a lead and the account it became
  // must not report different figures depending on which page you opened.
  const account = await accountDetail(business.accountId)

  if (!account) {
    // The account was deleted out from under the link. Report it honestly
    // rather than rendering a half-empty panel.
    return c.json({
      converted: false,
      lead: bigintFix(lead),
      business: bigintFix(business),
      account: null,
      projects: projects.map(serializeProject),
      warning: 'This lead was converted, but the account it became no longer exists.',
    })
  }

  const [contacts, deals, quotes, invoices, orders] = await Promise.all([
    prisma.contact.findMany({
      where: { accountId: account.id, trash: 0 },
      orderBy: { role: 'asc' },
      take: 6,
      select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, mobile: true, role: true },
    }),
    hasFeature('deals')
      ? prisma.deal.findMany({
          where: { accountId: account.id, trash: 0 },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: { stage: { select: { name: true, isWon: true, isLost: true } } },
        })
      : [],
    hasFeature('sales_docs')
      ? prisma.quote.findMany({
          where: { accountId: account.id },
          orderBy: { issueDate: 'desc' },
          take: 6,
          select: { id: true, quoteNumber: true, status: true, total: true, currency: true, issueDate: true },
        })
      : [],
    hasFeature('sales_docs')
      ? prisma.crmInvoice.findMany({
          where: { accountId: account.id },
          orderBy: { issueDate: 'desc' },
          take: 6,
          select: {
            id: true, invoiceNumber: true, status: true, total: true,
            amountPaid: true, dueDate: true, currency: true,
          },
        })
      : [],
    hasFeature('sales_docs')
      ? prisma.order.findMany({
          where: { accountId: account.id },
          orderBy: { orderDate: 'desc' },
          take: 6,
          select: { id: true, orderNumber: true, status: true, total: true, currency: true, orderDate: true, deliveryDate: true },
        })
      : [],
  ])

  // ── The money picture, in the order it actually happens.
  //
  //   quoted → ordered → invoiced → received, and what is still outstanding.
  //
  // Rejected and expired quotes are excluded from "quoted": counting a quote
  // the customer turned down as pipeline is how a forecast becomes fiction.
  // Draft and cancelled invoices are excluded from "invoiced" for the same
  // reason — neither is a claim on anybody.
  const num = (v: unknown) => (v == null ? 0 : Number(v))
  const round = (n: number) => Math.round(n * 100) / 100

  const liveQuotes = quotes.filter((q) => !['rejected', 'expired'].includes(q.status))
  const liveInvoices = invoices.filter((i) => !['draft', 'cancelled'].includes(i.status))

  const invoiced = liveInvoices.reduce((t, i) => t + num(i.total), 0)
  const received = liveInvoices.reduce((t, i) => t + num(i.amountPaid), 0)
  const overdueValue = liveInvoices.reduce((t, i) => {
    const balance = num(i.total) - num(i.amountPaid)
    const late = balance > 0 && i.dueDate && new Date(i.dueDate).getTime() < Date.now()
    return t + (late ? balance : 0)
  }, 0)

  const liveOrders = orders.filter((o) => o.status !== 'cancelled')
  const money = {
    quoted: round(liveQuotes.reduce((t, q) => t + num(q.total), 0)),
    quoteCount: liveQuotes.length,
    ordered: round(liveOrders.reduce((t, o) => t + num(o.total), 0)),
    orderCount: liveOrders.length,
    invoiceCount: liveInvoices.length,
    dealCount: deals.length,
    openDeals: deals.filter((d) => !d.stage?.isWon && !d.stage?.isLost).length,
    wonDeals: deals.filter((d) => d.stage?.isWon).length,
    invoiced: round(invoiced),
    received: round(received),
    outstanding: round(invoiced - received),
    overdue: round(overdueValue),
  }

  return c.json({
    converted: true,
    lead: bigintFix(lead),
    money,
    convertedAt: business.convertedAt,
    business: bigintFix(business),
    account,
    projects: projects.map(serializeProject),
    contacts: contacts.map((ct) => ({
      ...bigintFix(ct),
      fullName: [ct.firstName, ct.lastName].filter(Boolean).join(' '),
    })),
    deals: bigintFix(deals),
    quotes: bigintFix(quotes),
    orders: bigintFix(orders),
    invoices: invoices.map((i) => ({
      ...bigintFix(i),
      balance: Number(i.total) - Number(i.amountPaid),
      // Derived, never stored — the same rule the invoice list uses.
      overdue:
        !['paid', 'draft', 'cancelled'].includes(i.status) &&
        !!i.dueDate &&
        new Date(i.dueDate).getTime() < Date.now(),
    })),
  })
})

/**
 * PATCH /api/lead-business/:leadId — record the company details on a lead.
 *
 * Upsert, because a lead that arrived through a website form has no business
 * row until somebody types one; making the client know whether to POST or PATCH
 * would push that bookkeeping into every caller.
 */
leadBusinessRoutes.patch(
  '/:leadId',
  zValidator(
    'json',
    z.object({
      companyName: z.string().max(180).nullish(),
      designation: z.string().max(120).nullish(),
      website: z.string().max(255).nullish(),
      // What they want built. Unbounded description on purpose — a brief is as
      // long as it needs to be, and truncating one silently loses the part a
      // rep will be judged on having read.
      projectTitle: z.string().max(200).nullish(),
      projectDescription: z.string().nullish(),
    }),
  ),
  async (c) => {
    const leadId = BigInt(c.req.param('leadId'))
    const body = c.req.valid('json')

    const lead = await prisma.lead.count({ where: { id: leadId } })
    if (!lead) return c.json({ error: 'Lead not found' }, 404)

    const row = await prisma.leadBusiness.upsert({
      where: { leadId },
      create: { leadId, ...body },
      update: body,
    })

    return c.json(bigintFix(row))
  },
)
