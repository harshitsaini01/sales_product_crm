// ─────────────────────────────────────────────────────────────────────────────
// Pipelines, their stages, lost reasons and the product catalogue.
//
// All config an admin edits, all rows rather than enums, so renaming a stage or
// adding a lost reason is a click and never a migration. Reads are open to
// every signed-in user (the board needs them); writes are adminOnly.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly, authorize } from '../middleware/rbac'
import { bigintFix } from '../services/crm/serialize'
import * as stock from '../services/crm/stock.service'
import { uploadSingle, storedUploadPath } from '../middleware/upload'

export const pipelinesRoutes = new Hono()
export const productsRoutes = new Hono()

pipelinesRoutes.use('*', authenticate)
productsRoutes.use('*', authenticate)

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)

// ─── PIPELINES ────────────────────────────────────────────────────────────────

pipelinesRoutes.get('/', async (c) => {
  const rows = await prisma.pipeline.findMany({
    where: c.req.query('all') === '1' ? {} : { active: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    include: {
      stages: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
      _count: { select: { deals: true } },
    },
  })
  return c.json(
    rows.map((p) => ({ ...bigintFix(p), id: Number(p.id), dealCount: p._count.deals })),
  )
})

pipelinesRoutes.post(
  '/',
  adminOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100),
      isDefault: z.boolean().optional(),
      /** Created with the pipeline: a pipeline with no stages has no board. */
      stages: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            probability: z.number().int().min(0).max(100).default(0),
            isWon: z.boolean().optional(),
            isLost: z.boolean().optional(),
          }),
        )
        .min(1),
    }),
  ),
  async (c) => {
    const { name, isDefault, stages } = c.req.valid('json')
    const slug = slugify(name)

    const clash = await prisma.pipeline.findUnique({ where: { slug } })
    if (clash) return c.json({ error: `A pipeline called "${name}" already exists.` }, 409)

    // Exactly one default, or new deals land somewhere unpredictable.
    if (isDefault) await prisma.pipeline.updateMany({ data: { isDefault: false } })

    const pipeline = await prisma.pipeline.create({
      data: {
        name,
        slug,
        isDefault: isDefault ?? (await prisma.pipeline.count()) === 0,
        stages: {
          create: stages.map((s, i) => ({
            name: s.name,
            slug: slugify(s.name),
            probability: s.probability,
            sortOrder: i * 10,
            isWon: s.isWon ?? false,
            isLost: s.isLost ?? false,
          })),
        },
      },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    })

    return c.json(bigintFix(pipeline), 201)
  },
)

pipelinesRoutes.patch(
  '/:id',
  adminOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100).optional(),
      isDefault: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')

    if (body.isDefault) await prisma.pipeline.updateMany({ data: { isDefault: false } })

    const row = await prisma.pipeline.update({ where: { id }, data: body })
    return c.json(bigintFix(row))
  },
)

// ─── STAGES ───────────────────────────────────────────────────────────────────

pipelinesRoutes.post(
  '/:id/stages',
  adminOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100),
      probability: z.number().int().min(0).max(100).default(0),
      isWon: z.boolean().optional(),
      isLost: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const pipelineId = BigInt(c.req.param('id'))
    const body = c.req.valid('json')

    const last = await prisma.pipelineStage.findFirst({
      where: { pipelineId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const row = await prisma.pipelineStage.create({
      data: {
        pipelineId,
        name: body.name,
        slug: slugify(body.name),
        probability: body.probability,
        sortOrder: (last?.sortOrder ?? 0) + 10,
        isWon: body.isWon ?? false,
        isLost: body.isLost ?? false,
      },
    })
    return c.json(bigintFix(row), 201)
  },
)

pipelinesRoutes.patch(
  '/:pipelineId/stages/:stageId',
  adminOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100).optional(),
      probability: z.number().int().min(0).max(100).optional(),
      sortOrder: z.number().int().optional(),
      isWon: z.boolean().optional(),
      isLost: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('stageId'))
    const body = c.req.valid('json')
    // The slug is left alone on rename: it is the stable key, and renaming
    // "Demo" to "Discovery" should not orphan anything keyed on it.
    const row = await prisma.pipelineStage.update({ where: { id }, data: body })
    return c.json(bigintFix(row))
  },
)

// DELETE a stage — refused while deals are sitting in it, because deleting it
// would leave those deals pointing at a stage that no longer exists and they
// would vanish from every board.
pipelinesRoutes.delete('/:pipelineId/stages/:stageId', adminOnly, async (c) => {
  const id = BigInt(c.req.param('stageId'))
  const inUse = await prisma.deal.count({ where: { stageId: id, trash: 0 } })

  if (inUse > 0) {
    return c.json(
      {
        error:
          `${inUse} deal${inUse === 1 ? ' is' : 's are'} in this stage. Move them first, or ` +
          'switch the stage off instead — that hides it and keeps everything where it is.',
        dealCount: inUse,
      },
      409,
    )
  }

  await prisma.pipelineStage.delete({ where: { id } })
  return c.json({ success: true })
})

// ─── LOST REASONS ────────────────────────────────────────────────────────────

pipelinesRoutes.get('/lost-reasons', async (c) => {
  const rows = await prisma.lostReason.findMany({
    where: c.req.query('all') === '1' ? {} : { active: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  })
  return c.json(bigintFix(rows))
})

pipelinesRoutes.post(
  '/lost-reasons',
  adminOnly,
  zValidator('json', z.object({ name: z.string().min(1).max(120) })),
  async (c) => {
    const { name } = c.req.valid('json')
    const row = await prisma.lostReason.upsert({
      where: { slug: slugify(name) },
      create: { name: name.trim(), slug: slugify(name) },
      update: { active: true },
    })
    return c.json(bigintFix(row), 201)
  },
)

// ─── PRODUCTS ────────────────────────────────────────────────────────────────

productsRoutes.get('/', async (c) => {
  const q = c.req.query()
  const stockStatus = q.stockStatus
  const rows = await prisma.product.findMany({
    where: {
      ...(q.all === '1' ? {} : { active: true }),
      ...(q.collection ? { collection: q.collection } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search.trim(), mode: 'insensitive' as const } },
              { sku: { contains: q.search.trim(), mode: 'insensitive' as const } },
              { hsnCode: { contains: q.search.trim(), mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: { kitComponents: { include: { component: { select: { id: true, name: true, sku: true } } } } },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    take: 500,
  })
  let out = rows.map((r) => stock.serializeProduct(r))
  if (stockStatus === 'in_stock' || stockStatus === 'low_stock' || stockStatus === 'out_of_stock') {
    out = out.filter((p) => p.stockStatus === stockStatus)
  }
  return c.json(bigintFix(out))
})

const productBody = z.object({
  name: z.string().min(1).max(180),
  sku: z.string().max(60).nullish(),
  barcode: z.string().max(60).nullish(),
  category: z.string().max(80).nullish(),
  collection: z.string().max(80).nullish(),
  brand: z.string().max(80).nullish(),
  description: z.string().nullish(),
  shortDescription: z.string().max(280).nullish(),
  imageUrl: z.string().nullish(),
  videoUrl: z.string().max(500).nullish(),
  unit: z.string().max(20).optional(),
  hsnCode: z.string().max(20).nullish(),
  costPrice: z.number().nullish(),
  unitPrice: z.number().nullish(),
  minSellingPrice: z.number().nullish(),
  currency: z.string().max(10).optional(),
  taxPercent: z.number().min(0).max(100).nullish(),
  stockQuantity: z.number().nullish(),
  minStockLevel: z.number().nullish(),
  allowBackorder: z.boolean().optional(),
  isKit: z.boolean().optional(),
  active: z.boolean().optional(),
})

productsRoutes.post('/', adminOnly, zValidator('json', productBody), async (c) => {
  const body = c.req.valid('json')

  if (body.sku) {
    const clash = await prisma.product.findUnique({ where: { sku: body.sku } })
    if (clash) return c.json({ error: `SKU "${body.sku}" is already used by ${clash.name}.` }, 409)
  }

  const { stockQuantity, ...rest } = body
  const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null))
  const row = await prisma.product.create({
    data: {
      ...data,
      name: body.name,
      sku: body.sku || null,
    },
  })
  if (stockQuantity && stockQuantity > 0) {
    await stock.move({
      productId: row.id,
      quantity: stockQuantity,
      movementType: stock.MOVEMENT.RESTOCK,
      notes: 'Opening stock',
      createdById: BigInt(c.get('user').userId),
    })
  }
  return c.json(bigintFix(stock.serializeProduct(row)), 201)
})

productsRoutes.patch('/:id', adminOnly, zValidator('json', productBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = c.req.valid('json')
  const { stockQuantity: _ignore, ...rest } = body
  const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null))
  const row = await prisma.product.update({ where: { id }, data })
  return c.json(bigintFix(stock.serializeProduct(row)))
})

productsRoutes.post('/:id/image', adminOnly, uploadSingle('image'), async (c) => {
  const id = BigInt(c.req.param('id'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incoming = (c.env as any)?.incoming as any
  const file = (incoming?.file ?? incoming?.files?.image?.[0] ?? incoming?.files?.[0]) as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No image uploaded' }, 400)
  if (file.mimetype && !file.mimetype.startsWith('image/')) {
    return c.json({ error: 'Only image files are allowed' }, 400)
  }
  const imageUrl = storedUploadPath(file)
  const row = await prisma.product.update({ where: { id }, data: { imageUrl } })
  return c.json(bigintFix(stock.serializeProduct(row)))
})

productsRoutes.get('/:id/stock-history', async (c) => {
  const id = BigInt(c.req.param('id'))
  const rows = await prisma.stockMovement.findMany({
    where: { productId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return c.json(bigintFix(rows))
})

productsRoutes.post(
  '/:id/adjust-stock',
  authorize('admin', 'sub-admin', 'warehouse'),
  zValidator(
    'json',
    z.object({
      quantity: z.number(),
      movementType: z.enum(['RESTOCK', 'ADJUSTMENT', 'RETURN', 'SAMPLE']).default('RESTOCK'),
      notes: z.string().nullish(),
    }),
  ),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')
    await stock.move({
      productId: id,
      quantity: body.quantity,
      movementType: body.movementType,
      notes: body.notes,
      createdById: BigInt(c.get('user').userId),
      referenceType: 'manual',
    })
    const row = await prisma.product.findUnique({ where: { id } })
    return c.json(bigintFix(row ? stock.serializeProduct(row) : row))
  },
)

// Retire rather than delete: deal lines copy the name and price at the time
// they were added, so an old deal reads correctly either way — but a deleted
// product would break the reporting join that ties revenue back to a SKU.
productsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.product.update({ where: { id }, data: { active: false } })
  return c.json({ success: true, retired: true })
})
