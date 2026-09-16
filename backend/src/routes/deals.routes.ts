// ─────────────────────────────────────────────────────────────────────────────
// Deals, pipelines and the board.
//
//   GET  /deals              list / filter
//   GET  /deals/board        the Kanban: stages with their deals and totals
//   GET  /deals/forecast     weighted pipeline, win rate, average cycle
//   POST /deals/:id/stage    move a card (the one write the board makes)
//
// Mounted only when the `deals` module is on, which the education vertical
// leaves off.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'
import * as activity from '../services/crm/activity.service'
import * as customFields from '../services/crm/custom-fields.service'
import { bigintFix } from '../services/crm/serialize'
import { lineTotal, serializeDeal } from '../services/crm/deals.service'
import { placeOrderFromDeal, PlaceOrderError } from '../services/crm/place-order.service'
import { markLeadBySlug } from '../services/leads/lifecycle.service'

export const dealsRoutes = new Hono()

dealsRoutes.use('*', authenticate)

function scopeFor(user: { userId: number; role: string; roles: string[] }) {
  const privileged = ['admin', 'sub-admin', 'sales-head']
  const isPrivileged = privileged.includes(user.role) || user.roles.some((r) => privileged.includes(r))
  return isPrivileged ? {} : { ownerId: BigInt(user.userId) }
}

const dealBody = z.object({
  name: z.string().min(1).max(200),
  accountId: z.number().nullish(),
  primaryContactId: z.number().nullish(),
  leadId: z.number().nullish(),
  pipelineId: z.number().optional(),
  stageId: z.number().optional(),
  ownerId: z.number().nullish(),
  value: z.number().nullish(),
  currency: z.string().max(10).optional(),
  probability: z.number().int().min(0).max(100).nullish(),
  expectedCloseDate: z.string().nullish(),
  source: z.string().max(100).nullish(),
  campaign: z.string().max(255).nullish(),
  nextStep: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  customFields: z.record(z.unknown()).optional(),
  products: z
    .array(
      z.object({
        productId: z.number(),
        quantity: z.number().positive().default(1),
      }),
    )
    .optional(),
})

async function leadsByIds(ids: (bigint | null | undefined)[]) {
  const leadIds = [...new Set(ids.filter(Boolean))] as bigint[]
  if (!leadIds.length) return new Map<string, { id: bigint; name: string }>()
  const rows = await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })
  return new Map(rows.map((l) => [String(l.id), l]))
}

/** The pipeline a deal lands in when the caller does not name one. */
async function defaultPipeline() {
  return (
    (await prisma.pipeline.findFirst({ where: { isDefault: true, active: true } })) ??
    (await prisma.pipeline.findFirst({ where: { active: true }, orderBy: { priority: 'asc' } }))
  )
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

dealsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)

  const where = {
    trash: 0,
    ...scopeFor(user),
    ...(q.pipelineId ? { pipelineId: BigInt(q.pipelineId) } : {}),
    ...(q.stageId ? { stageId: BigInt(q.stageId) } : {}),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    ...(q.leadId ? { leadId: BigInt(q.leadId) } : {}),
    ...(q.ownerId ? { ownerId: BigInt(q.ownerId) } : {}),
    ...(q.search ? { name: { contains: q.search.trim(), mode: 'insensitive' as const } } : {}),
    // `open=1` is the default view a rep wants: everything still winnable.
    ...(q.open === '1' ? { stage: { isWon: false, isLost: false } } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir === 'asc' ? 'asc' : 'desc' },
      skip,
      take: limit,
      include: {
        stage: { select: { id: true, name: true, probability: true, isWon: true, isLost: true } },
        pipeline: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
    }),
    prisma.deal.count({ where }),
  ])

  // The account name is what a rep scans the list for, but Deal has no Prisma
  // relation to Account (the FK exists; the relation was left off to keep the
  // Account model's back-reference list short). One extra query beats N.
  const accountIds = [...new Set(rows.map((d) => d.accountId).filter(Boolean))] as bigint[]
  const accounts = accountIds.length
    ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
    : []
  const byId = new Map(accounts.map((a) => [String(a.id), a]))
  const byLead = await leadsByIds(rows.map((d) => d.leadId))

  return c.json(
    buildPaginatedResult(
      rows.map((d) => serializeDeal(d, byId.get(String(d.accountId)), byLead.get(String(d.leadId)))),
      total,
      page,
      limit,
    ),
  )
})

// ─── THE BOARD ────────────────────────────────────────────────────────────────

// GET /api/deals/board?pipelineId=1
//
// Stages with their cards and per-column totals, in one response — a board that
// fired one request per column would flicker into place a column at a time.
dealsRoutes.get('/board', async (c) => {
  const user = c.get('user')
  const q = c.req.query()

  const pipeline = q.pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: BigInt(q.pipelineId) } })
    : await defaultPipeline()

  if (!pipeline) {
    return c.json({ error: 'No pipeline has been set up yet.', pipeline: null, stages: [] }, 404)
  }

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: pipeline.id, active: true },
    orderBy: { sortOrder: 'asc' },
  })

  const deals = await prisma.deal.findMany({
    where: {
      trash: 0,
      pipelineId: pipeline.id,
      ...scopeFor(user),
      ...(q.ownerId ? { ownerId: BigInt(q.ownerId) } : {}),
      ...(q.mine === '1' ? { ownerId: BigInt(user.userId) } : {}),
      ...(q.search?.trim()
        ? { OR: [{ name: { contains: q.search.trim(), mode: 'insensitive' as const } }, { dealNumber: { contains: q.search.trim().toUpperCase() } }] }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      stage: { select: { id: true, name: true, probability: true, isWon: true, isLost: true } },
      owner: { select: { id: true, name: true } },
    },
    // A board is for working, not archaeology. Beyond this the list view with
    // its filters is the right tool, and rendering 5,000 cards helps nobody.
    take: 500,
  })

  const accountIds = [...new Set(deals.map((d) => d.accountId).filter(Boolean))] as bigint[]
  const accounts = accountIds.length
    ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
    : []
  const byAccount = new Map(accounts.map((a) => [String(a.id), a]))
  const byLead = await leadsByIds(deals.map((d) => d.leadId))

  // When each deal was last touched — the board's staleness signal. One
  // grouped query for the whole board rather than one per card.
  const lastTouch = deals.length
    ? await prisma.activity.groupBy({
        by: ['entityId'],
        where: { entityType: 'deal', entityId: { in: deals.map((d) => d.id) } },
        _max: { occurredAt: true },
      })
    : []
  const touchedAt = new Map(lastTouch.map((r) => [String(r.entityId), r._max.occurredAt]))

  const byStage = new Map<string, (ReturnType<typeof serializeDeal> & { lastActivityAt: string | null })[]>()
  for (const d of deals) {
    const key = String(d.stageId)
    if (!byStage.has(key)) byStage.set(key, [])
    const last = touchedAt.get(String(d.id)) ?? d.updatedAt
    byStage.get(key)!.push({
      ...serializeDeal(d, byAccount.get(String(d.accountId)), byLead.get(String(d.leadId))),
      lastActivityAt: last ? new Date(last).toISOString() : null,
    })
  }

  return c.json({
    pipeline: { id: Number(pipeline.id), name: pipeline.name },
    stages: stages.map((s) => {
      const cards = byStage.get(String(s.id)) ?? []
      const value = cards.reduce((sum, d) => sum + (d.value ?? 0), 0)
      return {
        id: Number(s.id),
        name: s.name,
        probability: s.probability,
        isWon: s.isWon,
        isLost: s.isLost,
        count: cards.length,
        value,
        /** What the forecast counts this column as. */
        weightedValue: Math.round((value * s.probability) / 100),
        deals: cards,
      }
    }),
  })
})

// ─── FORECAST ─────────────────────────────────────────────────────────────────

// GET /api/deals/forecast
dealsRoutes.get('/forecast', async (c) => {
  const user = c.get('user')
  const q = c.req.query()

  const pipeline = q.pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: BigInt(q.pipelineId) } })
    : await defaultPipeline()
  if (!pipeline) return c.json({ error: 'No pipeline has been set up yet.' }, 404)

  const deals = await prisma.deal.findMany({
    where: { trash: 0, pipelineId: pipeline.id, ...scopeFor(user) },
    include: { stage: { select: { probability: true, isWon: true, isLost: true } } },
  })

  const open = deals.filter((d) => !d.stage.isWon && !d.stage.isLost)
  const won = deals.filter((d) => d.stage.isWon)
  const lost = deals.filter((d) => d.stage.isLost)

  const val = (d: (typeof deals)[number]) => (d.value == null ? 0 : Number(d.value))
  const sum = (list: typeof deals) => list.reduce((t, d) => t + val(d), 0)

  // A deal's own probability wins over its stage's when a rep has set one.
  const weighted = open.reduce(
    (t, d) => t + (val(d) * (d.probability ?? d.stage.probability)) / 100,
    0,
  )

  // Only closed deals have a cycle. Averaging over open ones would make the
  // number fall every time somebody opens a deal, which is backwards.
  const closed = [...won, ...lost].filter((d) => d.actualCloseDate)
  const cycleDays = closed.length
    ? Math.round(
        closed.reduce(
          (t, d) =>
            t + (new Date(d.actualCloseDate!).getTime() - new Date(d.createdAt).getTime()) / 86_400_000,
          0,
        ) / closed.length,
      )
    : null

  const decided = won.length + lost.length

  return c.json({
    pipeline: { id: Number(pipeline.id), name: pipeline.name },
    openCount: open.length,
    openValue: sum(open),
    weightedValue: Math.round(weighted),
    wonCount: won.length,
    wonValue: sum(won),
    lostCount: lost.length,
    lostValue: sum(lost),
    /** Of the deals that reached a decision — open ones have not lost yet. */
    winRate: decided ? Math.round((won.length / decided) * 100) : null,
    averageDealSize: won.length ? Math.round(sum(won) / won.length) : null,
    averageCycleDays: cycleDays,
  })
})

// ─── ONE DEAL ────────────────────────────────────────────────────────────────

dealsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      stage: true,
      pipeline: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      lostReason: { select: { id: true, name: true } },
      products: { orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!deal) return c.json({ error: 'Deal not found' }, 404)

  const [account, contact, fields, lead, quotes, orders, invoices, stageMoves] = await Promise.all([
    deal.accountId
      ? prisma.account.findUnique({ where: { id: deal.accountId }, select: { id: true, name: true, email: true, phone: true } })
      : null,
    deal.primaryContactId
      ? prisma.contact.findUnique({
          where: { id: deal.primaryContactId },
          select: { id: true, firstName: true, lastName: true, email: true, mobile: true },
        })
      : null,
    customFields.valuesFor('deal', id, { stage: deal.stage.slug }),
    deal.leadId ? prisma.lead.findUnique({ where: { id: deal.leadId }, select: { id: true, name: true } }) : null,
    prisma.quote.findMany({
      where: { dealId: id },
      orderBy: { issueDate: 'desc' },
      select: { id: true, quoteNumber: true, status: true, total: true, currency: true, issueDate: true, validUntil: true, sentAt: true, viewedAt: true, decidedAt: true },
    }),
    prisma.order.findMany({
      where: { dealId: id },
      orderBy: { orderDate: 'desc' },
      select: { id: true, orderNumber: true, status: true, total: true, currency: true, orderDate: true, quoteId: true },
    }),
    prisma.crmInvoice.findMany({
      where: { dealId: id },
      orderBy: { issueDate: 'desc' },
      select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true, currency: true, issueDate: true, dueDate: true, orderId: true },
    }),
    // Every stage move, oldest first — the deal's own history, and where
    // "how long has it sat here?" comes from.
    prisma.activity.findMany({
      where: { entityType: 'deal', entityId: id, kind: 'stage_change' },
      orderBy: { occurredAt: 'asc' },
      select: { subject: true, occurredAt: true, meta: true, actor: { select: { name: true } } },
    }),
  ])

  const num = (v: unknown) => (v == null ? 0 : Number(v))
  const enteredStageAt = stageMoves.length ? stageMoves[stageMoves.length - 1].occurredAt : deal.createdAt
  const daysInStage = Math.floor((Date.now() - new Date(enteredStageAt).getTime()) / 86_400_000)

  const liveInvoices = invoices.filter((i) => !['draft', 'cancelled'].includes(i.status))
  const chain = {
    quotes: bigintFix(quotes),
    orders: bigintFix(orders),
    invoices: invoices.map((i) => ({
      ...bigintFix(i),
      balance: Math.round((num(i.total) - num(i.amountPaid)) * 100) / 100,
      overdue: !['paid', 'draft', 'cancelled'].includes(i.status) && !!i.dueDate && new Date(i.dueDate).getTime() < Date.now(),
    })),
    quoted: quotes.filter((q) => !['rejected', 'expired'].includes(q.status)).reduce((t, q) => t + num(q.total), 0),
    ordered: orders.filter((o) => o.status !== 'cancelled').reduce((t, o) => t + num(o.total), 0),
    invoiced: liveInvoices.reduce((t, i) => t + num(i.total), 0),
    received: liveInvoices.reduce((t, i) => t + num(i.amountPaid), 0),
    /** The accepted quote with no order yet — the one "Convert" should act on. */
    acceptedQuoteId: (() => {
      const converted = new Set(orders.map((o) => String(o.quoteId)))
      const q = quotes.find((x) => x.status === 'accepted' && !converted.has(String(x.id)))
      return q ? Number(q.id) : null
    })(),
    /** An order with no invoice yet — the one "Raise invoice" should act on. */
    uninvoicedOrderId: (() => {
      const invoiced = new Set(invoices.map((i) => String(i.orderId)))
      const o = orders.find((x) => x.status !== 'cancelled' && !invoiced.has(String(x.id)))
      return o ? Number(o.id) : null
    })(),
  }

  return c.json({
    ...serializeDeal(deal, account ?? undefined),
    accountDetail: account ? bigintFix(account) : null,
    lead: lead ? bigintFix(lead) : null,
    daysInStage,
    enteredStageAt,
    stageHistory: stageMoves.map((m) => ({
      subject: m.subject,
      at: m.occurredAt,
      by: m.actor?.name ?? null,
      meta: m.meta,
    })),
    chain,
    contact: contact
      ? {
          id: Number(contact.id),
          name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
          email: contact.email,
          mobile: contact.mobile,
        }
      : null,
    products: bigintFix(deal.products),
    customFields: bigintFix(fields),
  })
})

// ─── CREATE / UPDATE ─────────────────────────────────────────────────────────

dealsRoutes.post('/', zValidator('json', dealBody), async (c) => {
  const user = c.get('user')
  const { customFields: cf, products: productPicks, ...body } = c.req.valid('json')

  const pipeline = body.pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: BigInt(body.pipelineId) } })
    : await defaultPipeline()
  if (!pipeline) {
    return c.json({ error: 'No pipeline has been set up yet. Create one under Settings first.' }, 400)
  }

  // Without a stage there is no board column to draw the card in, so fall back
  // to the pipeline's first — never leave a deal unplaced.
  const stage = body.stageId
    ? await prisma.pipelineStage.findUnique({ where: { id: BigInt(body.stageId) } })
    : await prisma.pipelineStage.findFirst({
        where: { pipelineId: pipeline.id, active: true },
        orderBy: { sortOrder: 'asc' },
      })
  if (!stage) return c.json({ error: 'That pipeline has no stages.' }, 400)

  const deal = await prisma.deal.create({
    data: {
      name: body.name,
      accountId: body.accountId ? BigInt(body.accountId) : null,
      primaryContactId: body.primaryContactId ? BigInt(body.primaryContactId) : null,
      leadId: body.leadId ? BigInt(body.leadId) : null,
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: BigInt(body.ownerId ?? user.userId),
      value: body.value ?? null,
      currency: body.currency ?? 'INR',
      probability: body.probability ?? null,
      expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
      source: body.source ?? null,
      campaign: body.campaign ?? null,
      nextStep: body.nextStep ?? null,
      notes: body.notes ?? null,
      createdById: BigInt(user.userId),
    },
  })

  await prisma.deal.update({
    where: { id: deal.id },
    data: { dealNumber: `DEAL-${String(deal.id).padStart(6, '0')}` },
  })

  if (productPicks?.length) {
    const catalog = await prisma.product.findMany({
      where: { id: { in: productPicks.map((p) => BigInt(p.productId)) } },
    })
    const byId = new Map(catalog.map((p) => [String(p.id), p]))
    await prisma.dealProduct.createMany({
      data: productPicks.flatMap((pick, i) => {
        const p = byId.get(String(pick.productId))
        if (!p) return []
        const quantity = pick.quantity ?? 1
        const taxPercent = p.taxPercent == null ? 18 : Number(p.taxPercent)
        const unitPrice = Number(p.unitPrice ?? 0)
        return [{
          dealId: deal.id,
          productId: p.id,
          name: p.name,
          sku: p.sku,
          quantity,
          unitPrice,
          discountPercent: 0,
          taxPercent,
          total: lineTotal({ quantity, unitPrice, discountPercent: 0, taxPercent }),
          sortOrder: i * 10,
        }]
      }),
    })
    await syncDealValue(deal.id)
  }

  if (cf) await customFields.saveValues('deal', deal.id, cf)

  await activity.recordSafe({
    entityType: 'deal',
    entityId: deal.id,
    kind: 'system',
    subject: `Deal opened in ${stage.name}`,
    actorId: user.userId,
  })
  // Also on the account, so its timeline shows the opportunity opening without
  // anybody having to go looking for it.
  if (deal.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: deal.accountId,
      kind: 'system',
      subject: `Deal opened: ${deal.name}`,
      actorId: user.userId,
      meta: { dealId: Number(deal.id), value: body.value ?? null },
    })
  }

  const lead = deal.leadId ? (await leadsByIds([deal.leadId])).get(String(deal.leadId)) : undefined
  return c.json(serializeDeal({ ...deal, stage }, undefined, lead), 201)
})

dealsRoutes.patch('/:id', zValidator('json', dealBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  const { customFields: cf, ...body } = c.req.valid('json')

  const before = await prisma.deal.findUnique({ where: { id } })
  if (!before) return c.json({ error: 'Deal not found' }, 404)

  const deal = await prisma.deal.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.accountId !== undefined
        ? { accountId: body.accountId ? BigInt(body.accountId) : null }
        : {}),
      ...(body.primaryContactId !== undefined
        ? { primaryContactId: body.primaryContactId ? BigInt(body.primaryContactId) : null }
        : {}),
      ...(body.leadId !== undefined ? { leadId: body.leadId ? BigInt(body.leadId) : null } : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId ? BigInt(body.ownerId) : null } : {}),
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.probability !== undefined ? { probability: body.probability } : {}),
      ...(body.expectedCloseDate !== undefined
        ? { expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null }
        : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.campaign !== undefined ? { campaign: body.campaign } : {}),
      ...(body.nextStep !== undefined ? { nextStep: body.nextStep } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
    include: { stage: true },
  })

  if (cf) await customFields.saveValues('deal', id, cf)

  // Value changes go on the timeline — a deal quietly halving in size between
  // two forecast meetings is exactly what a manager needs to be able to find.
  if (body.value !== undefined && String(before.value ?? '') !== String(deal.value ?? '')) {
    await activity.recordSafe({
      entityType: 'deal',
      entityId: id,
      kind: 'system',
      subject: `Value changed: ${before.value ?? '—'} → ${deal.value ?? '—'}`,
      actorId: user.userId,
      meta: { from: before.value ? Number(before.value) : null, to: deal.value ? Number(deal.value) : null },
    })
  }

  return c.json(serializeDeal(deal))
})

// ─── MOVING A CARD ───────────────────────────────────────────────────────────

// POST /api/deals/:id/stage
//
// The one write the board makes, and deliberately its own endpoint rather than
// a field on PATCH: moving a deal has consequences a generic update should not
// silently trigger — it stamps the close date, demands a reason on loss, and
// always writes to the timeline.
dealsRoutes.post(
  '/:id/stage',
  zValidator(
    'json',
    z.object({
      stageId: z.number(),
      lostReasonId: z.number().nullish(),
      lostNotes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const { stageId, lostReasonId, lostNotes } = c.req.valid('json')

    const deal = await prisma.deal.findUnique({ where: { id }, include: { stage: true } })
    if (!deal) return c.json({ error: 'Deal not found' }, 404)

    const stage = await prisma.pipelineStage.findUnique({ where: { id: BigInt(stageId) } })
    if (!stage) return c.json({ error: 'Stage not found' }, 404)
    if (String(stage.pipelineId) !== String(deal.pipelineId)) {
      return c.json({ error: 'That stage belongs to a different pipeline.' }, 400)
    }

    // "Why did we lose?" is unanswerable a month later if it is optional now.
    if (stage.isLost && !lostReasonId) {
      return c.json({ error: 'Pick a reason before marking a deal lost.' }, 400)
    }

    const terminal = stage.isWon || stage.isLost

    const updated = await prisma.deal.update({
      where: { id },
      data: {
        stageId: stage.id,
        // Stamped on the way in and cleared on the way back out, so a deal
        // dragged out of Won by mistake does not keep a close date it no longer
        // has.
        actualCloseDate: terminal ? (deal.actualCloseDate ?? new Date()) : null,
        lostReasonId: stage.isLost && lostReasonId ? BigInt(lostReasonId) : null,
        lostNotes: stage.isLost ? (lostNotes ?? null) : null,
      },
      include: { stage: true },
    })

    await activity.recordSafe({
      entityType: 'deal',
      entityId: id,
      kind: 'stage_change',
      subject: `${deal.stage.name} → ${stage.name}`,
      actorId: user.userId,
      meta: { from: deal.stage.name, to: stage.name, isWon: stage.isWon, isLost: stage.isLost },
    })

    // Won and lost are account-level news; the intermediate shuffling is not.
    if (terminal && deal.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: deal.accountId,
        kind: 'stage_change',
        subject: `Deal ${stage.isWon ? 'won' : 'lost'}: ${deal.name}`,
        actorId: user.userId,
        meta: { dealId: Number(id), value: deal.value ? Number(deal.value) : null },
      })
    }

    if (stage.isLost && deal.leadId) {
      await markLeadBySlug(deal.leadId, 'lost', BigInt(user.userId), `Deal lost: ${deal.name}`)
    }

    return c.json(serializeDeal(updated))
  },
)

dealsRoutes.post('/:id/place-order', async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  try {
    const result = await placeOrderFromDeal({ dealId: id, actorId: BigInt(user.userId) })
    return c.json(
      {
        orderId: Number(result.orderId),
        orderNumber: result.orderNumber,
        invoiceId: result.invoiceId ? Number(result.invoiceId) : null,
        invoiceNumber: result.invoiceNumber ?? null,
      },
      201,
    )
  } catch (err) {
    if (err instanceof PlaceOrderError) {
      return c.json({ error: err.message, ...err.extra }, err.status as 400)
    }
    throw err
  }
})

dealsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.deal.update({ where: { id }, data: { trash: 1 } })
  return c.json({ success: true })
})

// ─── LINE ITEMS ──────────────────────────────────────────────────────────────

const lineBody = z.object({
  productId: z.number().nullish(),
  name: z.string().min(1).max(180),
  sku: z.string().max(60).nullish(),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().default(0),
  discountPercent: z.number().min(0).max(100).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
})

dealsRoutes.post('/:id/products', zValidator('json', lineBody), async (c) => {
  const dealId = BigInt(c.req.param('id'))
  const body = c.req.valid('json')

  const count = await prisma.dealProduct.count({ where: { dealId } })

  const row = await prisma.dealProduct.create({
    data: {
      dealId,
      productId: body.productId ? BigInt(body.productId) : null,
      name: body.name,
      sku: body.sku ?? null,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      discountPercent: body.discountPercent,
      taxPercent: body.taxPercent,
      total: lineTotal(body),
      sortOrder: count * 10,
    },
  })

  await syncDealValue(dealId)
  return c.json(bigintFix(row), 201)
})

dealsRoutes.patch('/:dealId/products/:lineId', zValidator('json', lineBody.partial()), async (c) => {
  const dealId = BigInt(c.req.param('dealId'))
  const id = BigInt(c.req.param('lineId'))
  const body = c.req.valid('json')

  const existing = await prisma.dealProduct.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Line not found' }, 404)

  const merged = {
    quantity: body.quantity ?? Number(existing.quantity),
    unitPrice: body.unitPrice ?? Number(existing.unitPrice),
    discountPercent: body.discountPercent ?? Number(existing.discountPercent),
    taxPercent: body.taxPercent ?? Number(existing.taxPercent),
  }

  const row = await prisma.dealProduct.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sku !== undefined ? { sku: body.sku } : {}),
      ...merged,
      total: lineTotal(merged),
    },
  })

  await syncDealValue(dealId)
  return c.json(bigintFix(row))
})

dealsRoutes.delete('/:dealId/products/:lineId', async (c) => {
  const dealId = BigInt(c.req.param('dealId'))
  await prisma.dealProduct.delete({ where: { id: BigInt(c.req.param('lineId')) } })
  await syncDealValue(dealId)
  return c.json({ success: true })
})

/**
 * Keep `Deal.value` equal to the sum of its lines.
 *
 * Only once a deal HAS lines. A deal priced as a single number — which is most
 * of them early on — must keep the number somebody typed, so an empty line list
 * leaves the value alone rather than zeroing it.
 */
async function syncDealValue(dealId: bigint): Promise<void> {
  const lines = await prisma.dealProduct.findMany({ where: { dealId }, select: { total: true } })
  if (!lines.length) return
  const total = lines.reduce((sum, l) => sum + Number(l.total), 0)
  await prisma.deal.update({ where: { id: dealId }, data: { value: total } })
}
