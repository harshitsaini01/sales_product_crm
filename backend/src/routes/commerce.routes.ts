// Cadences, price lists, approvals, cockpit, dispatcher, dunning.

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly, salesHeadAndAbove } from '../middleware/rbac'
import { bigintFix } from '../services/crm/serialize'
import { dispatchSalesEvents } from '../services/crm/sales-events.service'
import { documentNumber } from '../services/crm/documents.service'
import * as stock from '../services/crm/stock.service'
import * as activity from '../services/crm/activity.service'
import * as pricing from '../services/crm/pricing.service'
import { notifyFulfillment } from '../services/crm/fulfillment-notify.service'

export const commerceRoutes = new Hono()
commerceRoutes.use('*', authenticate)

const n = (v: unknown) => (v == null ? 0 : Number(v))
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item'

// ═══ CADENCES ════════════════════════════════════════════════════════════════

commerceRoutes.get('/cadences', async (c) => {
  const rows = await prisma.cadence.findMany({
    include: { steps: { orderBy: { sortOrder: 'asc' } }, _count: { select: { enrollments: true } } },
    orderBy: { name: 'asc' },
  })
  return c.json(bigintFix(rows))
})

commerceRoutes.post(
  '/cadences',
  adminOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).nullish(),
      steps: z.array(z.object({
        dayOffset: z.number().int().min(0),
        channel: z.enum(['email', 'whatsapp', 'call', 'task']),
        eventKey: z.string().max(40).nullish(),
        subject: z.string().max(200).nullish(),
        body: z.string().max(4000).nullish(),
      })).default([]),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json')
    const row = await prisma.cadence.create({
      data: {
        name: body.name,
        slug: slugify(body.name) + '-' + Date.now().toString(36),
        description: body.description ?? null,
        steps: {
          create: body.steps.map((s, i) => ({
            dayOffset: s.dayOffset,
            sortOrder: i,
            channel: s.channel,
            eventKey: s.eventKey ?? null,
            subject: s.subject ?? null,
            body: s.body ?? null,
          })),
        },
      },
      include: { steps: true },
    })
    return c.json(bigintFix(row), 201)
  },
)

commerceRoutes.patch(
  '/cadences/:id',
  adminOnly,
  zValidator('json', z.object({ name: z.string().min(1).max(120).optional(), active: z.boolean().optional(), description: z.string().nullish() })),
  async (c) => {
    const row = await prisma.cadence.update({
      where: { id: BigInt(c.req.param('id')) },
      data: c.req.valid('json'),
    })
    return c.json(bigintFix(row))
  },
)

commerceRoutes.post(
  '/cadences/:id/enroll',
  zValidator('json', z.object({ leadId: z.number().int() })),
  async (c) => {
    const cadenceId = BigInt(c.req.param('id'))
    const { leadId } = c.req.valid('json')
    const cadence = await prisma.cadence.findUnique({
      where: { id: cadenceId },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!cadence || !cadence.active) return c.json({ error: 'Cadence not found' }, 404)
    const first = cadence.steps[0]
    const row = await prisma.cadenceEnrollment.create({
      data: {
        cadenceId,
        leadId: BigInt(leadId),
        stepIndex: 0,
        nextAt: first ? new Date(Date.now() + first.dayOffset * 86_400_000) : null,
      },
    })
    return c.json(bigintFix(row), 201)
  },
)

// ═══ PRICE LISTS ═════════════════════════════════════════════════════════════

commerceRoutes.get('/price-lists', async (c) => {
  const rows = await prisma.priceList.findMany({
    include: { items: true, _count: { select: { accounts: true } } },
    orderBy: { name: 'asc' },
  })
  return c.json(bigintFix(rows))
})

commerceRoutes.post(
  '/price-lists',
  adminOnly,
  zValidator('json', z.object({
    name: z.string().min(1).max(120),
    kind: z.enum(['retail', 'dealer', 'key_account']).default('retail'),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const row = await prisma.priceList.create({
      data: { name: body.name, slug: slugify(body.name) + '-' + Date.now().toString(36), kind: body.kind },
    })
    return c.json(bigintFix(row), 201)
  },
)

commerceRoutes.post(
  '/price-lists/:id/items',
  adminOnly,
  zValidator('json', z.object({
    productId: z.number().int(),
    unitPrice: z.number(),
    minQty: z.number().positive().default(1),
    minSellingPrice: z.number().nullish(),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const row = await prisma.priceListItem.create({
      data: {
        priceListId: BigInt(c.req.param('id')),
        productId: BigInt(body.productId),
        unitPrice: body.unitPrice,
        minQty: body.minQty,
        minSellingPrice: body.minSellingPrice ?? null,
      },
    })
    return c.json(bigintFix(row), 201)
  },
)

// ═══ APPROVALS ═══════════════════════════════════════════════════════════════

commerceRoutes.get('/approvals', async (c) => {
  const status = c.req.query('status') || 'pending'
  const rows = await prisma.salesApproval.findMany({
    where: { status },
    include: {
      account: { select: { id: true, name: true } },
      quote: { select: { id: true, quoteNumber: true, total: true, status: true } },
      decidedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  return c.json(bigintFix(rows))
})

commerceRoutes.post(
  '/approvals/:id/decide',
  salesHeadAndAbove,
  zValidator('json', z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().max(500).nullish() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const user = c.get('user')
    const { status, reason } = c.req.valid('json')
    const existing = await prisma.salesApproval.findUnique({ where: { id } })
    if (!existing) return c.json({ error: 'Approval not found' }, 404)
    if (existing.status !== 'pending') return c.json({ error: 'Already decided' }, 409)

    const row = await prisma.salesApproval.update({
      where: { id },
      data: { status, reason: reason ?? existing.reason, decidedById: BigInt(user.userId), decidedAt: new Date() },
    })
    if (existing.quoteId) {
      await prisma.quote.update({
        where: { id: existing.quoteId },
        data: { approvalStatus: status, ...(status === 'rejected' ? { status: 'rejected', decidedAt: new Date() } : {}) },
      })
    }
    return c.json(bigintFix(row))
  },
)

commerceRoutes.post(
  '/quotes/:id/request-approval',
  zValidator('json', z.object({
    kind: z.enum(['discount', 'credit', 'below_floor', 'free_shipping']).default('discount'),
    requestedPct: z.number().nullish(),
    reason: z.string().max(500).nullish(),
  })),
  async (c) => {
    const quoteId = BigInt(c.req.param('id'))
    const quote = await prisma.quote.findUnique({ where: { id: quoteId } })
    if (!quote) return c.json({ error: 'Quote not found' }, 404)
    const body = c.req.valid('json')
    const row = await prisma.salesApproval.create({
      data: {
        entityType: 'quote',
        entityId: quoteId,
        accountId: quote.accountId,
        quoteId,
        kind: body.kind,
        requestedPct: body.requestedPct ?? null,
        reason: body.reason ?? null,
      },
    })
    await prisma.quote.update({ where: { id: quoteId }, data: { approvalStatus: 'pending', status: 'pending_approval' } })
    return c.json(bigintFix(row), 201)
  },
)

// ═══ STOCK TRANSFER ══════════════════════════════════════════════════════════

commerceRoutes.post(
  '/stock/transfer',
  zValidator('json', z.object({
    productId: z.number().int(),
    fromBranchId: z.number().int(),
    toBranchId: z.number().int(),
    quantity: z.number().positive(),
    notes: z.string().max(255).nullish(),
  })),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    await stock.move({
      productId: BigInt(body.productId),
      quantity: body.quantity,
      movementType: 'TRANSFER',
      branchId: BigInt(body.fromBranchId),
      notes: `Transfer to branch ${body.toBranchId}${body.notes ? `: ${body.notes}` : ''}`,
      createdById: BigInt(user.userId),
    })
    await stock.move({
      productId: BigInt(body.productId),
      quantity: body.quantity,
      movementType: 'RESTOCK',
      branchId: BigInt(body.toBranchId),
      notes: `Transfer from branch ${body.fromBranchId}`,
      createdById: BigInt(user.userId),
    })
    return c.json({ ok: true })
  },
)

// ═══ DUNNING ═════════════════════════════════════════════════════════════════

commerceRoutes.post('/dunning/:invoiceId', async (c) => {
  const id = BigInt(c.req.param('invoiceId'))
  const inv = await prisma.crmInvoice.findUnique({ where: { id } })
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  if (inv.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: inv.accountId,
      kind: 'system',
      subject: `Dunning reminder for ${inv.invoiceNumber}`,
      meta: { invoiceId: Number(id), total: n(inv.total), amountPaid: n(inv.amountPaid) },
    })
  }
  return c.json({ ok: true, invoiceNumber: inv.invoiceNumber })
})

// ═══ COCKPIT ═════════════════════════════════════════════════════════════════

commerceRoutes.get('/cockpit', async (c) => {
  const now = new Date()
  const [
    quotes,
    orders,
    invoices,
    products,
    approvals,
    creditNotes,
    low,
  ] = await Promise.all([
    prisma.quote.groupBy({ by: ['status'], _count: true, _sum: { total: true } }),
    prisma.order.groupBy({ by: ['status'], _count: true }),
    prisma.crmInvoice.findMany({
      where: { status: { in: ['sent', 'partial', 'paid'] } },
      select: { total: true, amountPaid: true, dueDate: true, status: true },
    }),
    prisma.product.findMany({
      where: { active: true },
      select: { stockQuantity: true, reservedQuantity: true, minStockLevel: true, unitPrice: true },
    }),
    prisma.salesApproval.count({ where: { status: 'pending' } }),
    prisma.creditNote.count(),
    prisma.product.count({
      where: { active: true },
    }),
  ])

  let outstanding = 0
  let overdue = 0
  let collected = 0
  for (const i of invoices) {
    collected += n(i.amountPaid)
    const bal = n(i.total) - n(i.amountPaid)
    if (bal > 0) {
      outstanding += bal
      if (i.dueDate && i.dueDate < now) overdue += bal
    }
  }

  let lowStock = 0
  let stockValue = 0
  for (const p of products) {
    const onHand = n(p.stockQuantity)
    const reserved = n(p.reservedQuantity)
    if (stock.stockStatus(onHand, reserved, n(p.minStockLevel)) !== 'in_stock') lowStock++
    stockValue += onHand * n(p.unitPrice)
  }

  return c.json({
    quotes: quotes.map((q) => ({ status: q.status, count: q._count, value: n(q._sum.total) })),
    orders: orders.map((o) => ({ status: o.status, count: o._count })),
    outstanding: Math.round(outstanding * 100) / 100,
    overdue: Math.round(overdue * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    pendingApprovals: approvals,
    returns: creditNotes,
    skuCount: low,
    lowStock,
    stockValue: Math.round(stockValue * 100) / 100,
  })
})

commerceRoutes.post('/dispatcher/run', adminOnly, async (c) => {
  const result = await dispatchSalesEvents()
  return c.json(result)
})

commerceRoutes.post(
  '/credit-notes',
  zValidator('json', z.object({
    orderId: z.number().int().optional(),
    invoiceId: z.number().int().optional(),
    accountId: z.number().int().optional(),
    reason: z.string().max(40).nullish(),
    notes: z.string().max(500).nullish(),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const created = await prisma.creditNote.create({
      data: {
        creditNoteNumber: 'PENDING',
        orderId: body.orderId ? BigInt(body.orderId) : null,
        invoiceId: body.invoiceId ? BigInt(body.invoiceId) : null,
        accountId: body.accountId ? BigInt(body.accountId) : null,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
      },
    })
    const numbered = await prisma.creditNote.update({
      where: { id: created.id },
      data: { creditNoteNumber: documentNumber('CN', created.id) },
    })
    return c.json(bigintFix(numbered), 201)
  },
)

// ═══ KITS ════════════════════════════════════════════════════════════════════

commerceRoutes.get('/products/:id/kit-items', async (c) => {
  const kitId = BigInt(c.req.param('id'))
  const rows = await prisma.productKitItem.findMany({
    where: { kitId },
    include: { component: { select: { id: true, name: true, sku: true, stockQuantity: true, reservedQuantity: true } } },
  })
  return c.json(bigintFix(rows.map((r) => ({
    ...r,
    component: r.component ? stock.serializeProduct(r.component) : r.component,
  }))))
})

commerceRoutes.put(
  '/products/:id/kit-items',
  adminOnly,
  zValidator(
    'json',
    z.object({
      items: z.array(z.object({
        componentId: z.number().int(),
        quantity: z.number().positive(),
      })),
    }),
  ),
  async (c) => {
    const kitId = BigInt(c.req.param('id'))
    const { items } = c.req.valid('json')
    if (items.some((i) => BigInt(i.componentId) === kitId)) {
      return c.json({ error: 'A kit cannot contain itself.' }, 400)
    }
    await prisma.$transaction([
      prisma.productKitItem.deleteMany({ where: { kitId } }),
      ...(items.length
        ? [
            prisma.productKitItem.createMany({
              data: items.map((i) => ({
                kitId,
                componentId: BigInt(i.componentId),
                quantity: i.quantity,
              })),
            }),
            prisma.product.update({ where: { id: kitId }, data: { isKit: true } }),
          ]
        : [prisma.product.update({ where: { id: kitId }, data: { isKit: false } })]),
    ])
    const rows = await prisma.productKitItem.findMany({
      where: { kitId },
      include: { component: { select: { id: true, name: true, sku: true } } },
    })
    return c.json(bigintFix(rows))
  },
)

commerceRoutes.get('/products/:id/price', async (c) => {
  const productId = BigInt(c.req.param('id'))
  const qty = Number(c.req.query('qty') || 1)
  const accountId = c.req.query('accountId') ? BigInt(c.req.query('accountId')!) : null
  const priced = await pricing.resolvePrice(productId, qty, accountId)
  return c.json(priced)
})

commerceRoutes.get('/stock/branches', async (c) => {
  const productId = c.req.query('productId')
  const rows = await prisma.productBranchStock.findMany({
    where: productId ? { productId: BigInt(productId) } : {},
    take: 500,
  })
  const branchIds = [...new Set(rows.map((r) => Number(r.branchId)))]
  const branches = branchIds.length
    ? await prisma.branch.findMany({ where: { id: { in: branchIds.map((id) => BigInt(id)) } }, select: { id: true, name: true } })
    : []
  const byId = new Map(branches.map((b) => [String(b.id), b.name]))
  return c.json(bigintFix(rows.map((r) => ({
    ...r,
    available: stock.atp(Number(r.stockQuantity), Number(r.reservedQuantity)),
    branchName: byId.get(String(r.branchId)) ?? null,
  }))))
})

commerceRoutes.get('/next-best/:accountId', async (c) => {
  const rows = await pricing.nextBestSkus(BigInt(c.req.param('accountId')))
  return c.json(rows)
})

commerceRoutes.get('/sla', async (c) => {
  const hours = Number(
    (await prisma.systemSetting.findUnique({ where: { key: 'first_response_hours' } }))?.value || 4,
  )
  const cutoff = new Date(Date.now() - hours * 3600_000)
  const breached = await prisma.lead.findMany({
    where: {
      trash: 0,
      called: { not: 1 },
      wapp: { not: 1 },
      createdAt: { lt: cutoff },
    },
    select: { id: true, name: true, mobile: true, email: true, createdAt: true, userId: true },
    orderBy: { createdAt: 'asc' },
    take: 80,
  })
  return c.json({
    hours,
    breached: breached.map((l) => ({
      id: Number(l.id),
      name: l.name,
      mobile: l.mobile,
      email: l.email,
      createdAt: l.createdAt,
      hoursLate: Math.round((Date.now() - l.createdAt.getTime()) / 3600_000) - hours,
      ownerId: l.userId ? Number(l.userId) : null,
    })),
  })
})

commerceRoutes.post(
  '/field/check-in',
  zValidator(
    'json',
    z.object({
      accountId: z.number().int(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      notes: z.string().max(500).nullish(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    await activity.recordSafe({
      entityType: 'account',
      entityId: BigInt(body.accountId),
      kind: 'meeting',
      subject: 'Beat check-in',
      body: body.notes ?? null,
      actorId: user.userId,
      meta: { lat: body.lat, lng: body.lng, kind: 'check_in' },
    })
    return c.json({ ok: true })
  },
)

commerceRoutes.post(
  '/field/sample',
  zValidator(
    'json',
    z.object({
      productId: z.number().int(),
      quantity: z.number().positive().default(1),
      accountId: z.number().int().optional(),
      branchId: z.number().int().optional(),
      notes: z.string().max(255).nullish(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    await stock.move({
      productId: BigInt(body.productId),
      quantity: body.quantity,
      movementType: stock.MOVEMENT.SAMPLE,
      branchId: body.branchId ? BigInt(body.branchId) : null,
      notes: body.notes ?? 'Sample bag',
      createdById: BigInt(user.userId),
      referenceType: body.accountId ? 'account' : 'sample',
      referenceId: body.accountId ? BigInt(body.accountId) : null,
    })
    if (body.accountId) {
      await activity.recordSafe({
        entityType: 'account',
        entityId: BigInt(body.accountId),
        kind: 'system',
        subject: `Sample issued × ${body.quantity}`,
        actorId: user.userId,
        meta: { productId: body.productId, quantity: body.quantity },
      })
    }
    return c.json({ ok: true })
  },
)

commerceRoutes.get('/orders/:id/shipments', async (c) => {
  const rows = await prisma.shipment.findMany({
    where: { orderId: BigInt(c.req.param('id')) },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  })
  return c.json(bigintFix(rows))
})

commerceRoutes.post(
  '/orders/:id/shipments',
  zValidator(
    'json',
    z.object({
      courier: z.string().max(80).nullish(),
      trackingNumber: z.string().max(80).nullish(),
      eta: z.string().nullish(),
      notes: z.string().nullish(),
      items: z.array(z.object({
        productId: z.number().int().optional(),
        name: z.string().min(1).max(180),
        sku: z.string().max(60).nullish(),
        quantity: z.number().positive(),
      })).min(1),
    }),
  ),
  async (c) => {
    const orderId = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } })
    if (!order) return c.json({ error: 'Order not found' }, 404)

    const created = await prisma.shipment.create({
      data: {
        orderId,
        accountId: order.accountId,
        shipmentNumber: 'PENDING',
        status: 'packed',
        courier: body.courier ?? order.courier,
        trackingNumber: body.trackingNumber ?? order.trackingNumber,
        eta: body.eta ? new Date(body.eta) : null,
        notes: body.notes ?? null,
        packedAt: new Date(),
        createdById: BigInt(user.userId),
        items: {
          create: body.items.map((i) => ({
            productId: i.productId ? BigInt(i.productId) : null,
            name: i.name,
            sku: i.sku ?? null,
            quantity: i.quantity,
          })),
        },
      },
      include: { items: true },
    })
    const numbered = await prisma.shipment.update({
      where: { id: created.id },
      data: { shipmentNumber: documentNumber('SHP', created.id) },
    })

    const existing = await prisma.shipmentItem.findMany({
      where: { shipment: { orderId, status: { not: 'cancelled' } } },
    })
    const shipped = new Map<string, number>()
    for (const i of existing) {
      const key = i.productId ? `p:${i.productId}` : `n:${i.name}`
      shipped.set(key, (shipped.get(key) ?? 0) + Number(i.quantity))
    }
    const remaining = order.items.reduce((sum, l) => {
      const key = l.productId ? `p:${l.productId}` : `n:${l.name}`
      return sum + Math.max(0, Number(l.quantity) - (shipped.get(key) ?? 0))
    }, 0)

    if (remaining <= 0 && order.status === 'confirmed') {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'packed',
          packedAt: order.packedAt ?? new Date(),
          courier: body.courier ?? order.courier,
          trackingNumber: body.trackingNumber ?? order.trackingNumber,
        },
      })
      await notifyFulfillment(orderId, 'packed')
    }

    return c.json(bigintFix({ ...numbered, items: created.items, remaining }), 201)
  },
)

commerceRoutes.patch(
  '/shipments/:id',
  zValidator(
    'json',
    z.object({
      status: z.enum(['packed', 'out_for_delivery', 'delivered', 'cancelled']).optional(),
      courier: z.string().max(80).nullish(),
      trackingNumber: z.string().max(80).nullish(),
      podUrl: z.string().max(500).nullish(),
      podNotes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')
    const existing = await prisma.shipment.findUnique({ where: { id } })
    if (!existing) return c.json({ error: 'Shipment not found' }, 404)
    const now = new Date()
    const row = await prisma.shipment.update({
      where: { id },
      data: {
        ...body,
        ...(body.status === 'out_for_delivery' && !existing.shippedAt ? { shippedAt: now } : {}),
        ...(body.status === 'delivered' && !existing.deliveredAt ? { deliveredAt: now } : {}),
      },
    })
    if (body.status && body.status !== existing.status) {
      await notifyFulfillment(existing.orderId, body.status)
    }
    return c.json(bigintFix(row))
  },
)
