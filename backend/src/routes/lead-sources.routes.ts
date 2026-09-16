// Partner lead-source admin routes — admin-only.
// CRUD over LeadSource + log inspection. API keys are bcrypt-hashed; the plain
// key is returned ONLY at creation or rotation (cannot be retrieved later).
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { hash } from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

export const leadSourcesRoutes = new Hono()
leadSourcesRoutes.use('*', authenticate, adminOnly)

const slugRe = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/

const createSchema = z.object({
  slug: z.string().regex(slugRe, 'slug must be lowercase, 3-60 chars, a-z/0-9/-'),
  name: z.string().min(2).max(120),
  ipAllowlist: z.array(z.string()).optional(),
  defaultDepartmentId: z.number().int().positive().optional(),
  defaultLeadStatus: z.string().max(100).optional(),
  generateHmacSecret: z.boolean().optional(),
})

function generateApiKey(): string {
  // url-safe, 256-bit
  return crypto.randomBytes(32).toString('base64url')
}

function bigintFix<T>(x: T): T {
  return JSON.parse(JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? Number(v) : v)))
}

// GET /api/lead-sources — list all partners
leadSourcesRoutes.get('/', async (c) => {
  const sources = await prisma.leadSource.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, slug: true, name: true, active: true,
      ipAllowlist: true, defaultDepartmentId: true, defaultLeadStatus: true,
      totalLeads: true, lastUsedAt: true, createdAt: true,
      webhookSecret: true, // exposed only as boolean below
    },
  })
  return c.json(bigintFix(sources.map((s) => ({ ...s, hasHmac: !!s.webhookSecret, webhookSecret: undefined }))))
})

// POST /api/lead-sources — create new partner. Returns the plain api key ONCE.
leadSourcesRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json')
  const existing = await prisma.leadSource.findUnique({ where: { slug: body.slug } })
  if (existing) return c.json({ error: 'slug already exists' }, 409)

  const apiKey = generateApiKey()
  const hmacSecret = body.generateHmacSecret ? crypto.randomBytes(32).toString('hex') : null

  const created = await prisma.leadSource.create({
    data: {
      slug: body.slug,
      name: body.name,
      keyHash: await hash(apiKey, 10),
      webhookSecret: hmacSecret,
      ipAllowlist: body.ipAllowlist ?? [],
      defaultDepartmentId: body.defaultDepartmentId ? BigInt(body.defaultDepartmentId) : null,
      defaultLeadStatus: body.defaultLeadStatus,
    },
  })

  return c.json({
    id: created.id,
    slug: created.slug,
    name: created.name,
    apiKey,                      // shown ONCE, never again
    webhookSecret: hmacSecret,   // shown ONCE, never again
    endpoint: `/api/v1/inbound/${created.slug}/lead`,
  }, 201)
})

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  active: z.boolean().optional(),
  ipAllowlist: z.array(z.string()).optional(),
  defaultDepartmentId: z.number().int().positive().nullable().optional(),
  defaultLeadStatus: z.string().max(100).nullable().optional(),
})

// PATCH /api/lead-sources/:id
leadSourcesRoutes.patch('/:id', zValidator('json', patchSchema), async (c) => {
  const id = Number(c.req.param('id'))
  const body = c.req.valid('json')
  try {
    const updated = await prisma.leadSource.update({
      where: { id },
      data: {
        name: body.name,
        active: body.active,
        ipAllowlist: body.ipAllowlist,
        defaultDepartmentId: body.defaultDepartmentId === null ? null
          : body.defaultDepartmentId !== undefined ? BigInt(body.defaultDepartmentId)
          : undefined,
        defaultLeadStatus: body.defaultLeadStatus === null ? null : body.defaultLeadStatus,
      },
    })
    return c.json(bigintFix(updated))
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// POST /api/lead-sources/:id/rotate-key — generates new key, invalidates old.
leadSourcesRoutes.post('/:id/rotate-key', async (c) => {
  const id = Number(c.req.param('id'))
  const apiKey = generateApiKey()
  try {
    await prisma.leadSource.update({
      where: { id },
      data: { keyHash: await hash(apiKey, 10) },
    })
    return c.json({ id, apiKey })
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// DELETE /api/lead-sources/:id — permanently delete lead source.
leadSourcesRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  try {
    await prisma.leadSource.delete({ where: { id } })
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// GET /api/lead-sources/:id/logs?page=1&limit=50&search=xyz
leadSourcesRoutes.get('/:id/logs', async (c) => {
  const id = Number(c.req.param('id'))
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)))
  const search = (c.req.query('search') || '').trim()
  const skip = (page - 1) * limit

  const whereClause: any = { sourceId: id }
  if (search) {
    whereClause.OR = [
      { ip: { contains: search, mode: 'insensitive' } },
      { status: { contains: search, mode: 'insensitive' } },
      { errorMsg: { contains: search, mode: 'insensitive' } },
      { payload: { path: ['name'], string_contains: search } },
      { payload: { path: ['email'], string_contains: search } },
      { payload: { path: ['mobile'], string_contains: search } },
    ]
    if (/^\d+$/.test(search)) {
      whereClause.OR.push({ leadId: BigInt(search) })
    }
  }

  const [total, logs] = await Promise.all([
    prisma.leadIngestionLog.count({ where: whereClause }),
    prisma.leadIngestionLog.findMany({
      where: whereClause,
      orderBy: { receivedAt: 'desc' },
      skip,
      take: limit,
    }),
  ])

  // Gather lead IDs to fetch current lead names
  const leadIds = logs.map((l) => l.leadId).filter((lid): lid is bigint => lid !== null)
  let leadMap = new Map<string, string>()
  if (leadIds.length > 0) {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, name: true },
    })
    leadMap = new Map(leads.map((l) => [l.id.toString(), l.name]))
  }

  const enrichedLogs = logs.map((l) => {
    const payloadName = l.payload && typeof l.payload === 'object' && 'name' in l.payload ? String((l.payload as any).name) : null
    const leadName = (l.leadId ? leadMap.get(l.leadId.toString()) : null) || payloadName || null
    const isSeeded = l.status === 'created' || (l.payload && typeof l.payload === 'object' && (l.payload as any)._seeded === true)
    return {
      ...l,
      leadName,
      isSeeded,
    }
  })

  return c.json(bigintFix({
    logs: enrichedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  }))
})

// POST /api/lead-sources/logs/:logId/seed — seed past rejected duplicate log into CRM
leadSourcesRoutes.post('/logs/:logId/seed', async (c) => {
  const logId = BigInt(c.req.param('logId'))
  const log = await prisma.leadIngestionLog.findUnique({
    where: { id: logId },
    include: { source: true },
  })

  if (!log) {
    return c.json({ error: 'Log not found' }, 404)
  }

  const payload: any = log.payload || {}
  const name = String(payload.name || '').trim().slice(0, 200)
  const email = String(payload.email || '').trim().slice(0, 200)
  const mobile = String(payload.mobile || '').replace(/[^\d+]/g, '').slice(0, 20)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''

  if (!name || (!validEmail && !mobile)) {
    return c.json({ error: 'Log payload is missing valid name and email/mobile' }, 400)
  }

  // Check for existing lead for duplicate tag
  const existing = await prisma.lead.findFirst({
    where: {
      trash: 0,
      OR: [
        ...(validEmail ? [{ email: validEmail }] : []),
        ...(mobile ? [{ mobile }] : []),
      ],
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  })

  const destinationRaw = String(payload.preferredDestination || payload.destination || '').slice(0, 100)
  const courseRaw = String(payload.intrestedCourse || payload.interestedCourse || payload.course || '').slice(0, 100)
  const COURSE_FROM_DESTINATION_SLUGS = new Set(['tutelagestudy', 'mymbbsadmission', 'tutelage-web', 'my-mbbs-admission'])
  let intrestedCourse: string | null = courseRaw || null
  if (!intrestedCourse && destinationRaw && COURSE_FROM_DESTINATION_SLUGS.has(log.source.slug)) {
    intrestedCourse = /mbbs/i.test(destinationRaw) ? destinationRaw : `MBBS in ${destinationRaw}`
  }

  const lead = await prisma.lead.create({
    data: {
      name,
      email: validEmail || null,
      mobile: mobile || null,
      city: String(payload.city || '').slice(0, 100) || null,
      state: String(payload.state || '').slice(0, 100) || null,
      country: String(payload.country || '').slice(0, 100) || null,
      intrestedCourse,
      intrestedUniversity: String(payload.intrestedUniversity || payload.interestedUniversity || '').slice(0, 100) || null,
      preferredDestination: destinationRaw || null,
      neetscore: String(payload.neetscore || '').slice(0, 20) || null,
      neetQualified: String(payload.neetQualified || '').slice(0, 100) || null,
      comment: String(payload.comment || payload.question || payload.message || '').slice(0, 2000) || null,
      source: String(payload.source || '').slice(0, 100) || null,
      sourceUrl: String(payload.sourceUrl || payload.source_url || '').slice(0, 255) || null,
      event: String(payload.event || '').slice(0, 50) || null,
      website: log.source.slug,
      departmentId: log.source.defaultDepartmentId ?? BigInt(2),
      leadStatus: log.source.defaultLeadStatus ?? 'Fresh',
      userId: BigInt(28),
      leadType: 'new',
      isDuplicate: true,
      duplicateOfId: existing ? existing.id : (log.leadId ?? null),
    },
  })

  // Auto-assign counsellors
  const autoUsers = await prisma.user.findMany({
    where: { automaticAsignLead: 1 },
    select: { id: true },
  })
  if (autoUsers.length) {
    await prisma.asignedLead.createMany({
      data: autoUsers.map((u) => ({ stdId: lead.id, clrId: u.id, status: 1 })),
      skipDuplicates: true,
    })
  }

  // Link leadId to log and mark _seeded flag
  const updatedPayload = { ...(typeof payload === 'object' ? payload : {}), _seeded: true }
  await prisma.leadIngestionLog.update({
    where: { id: logId },
    data: { leadId: lead.id, payload: updatedPayload },
  })

  return c.json(bigintFix({ success: true, lead }))
})

// GET /api/lead-sources/:id/stats — counts grouped by status, last 30 days.
leadSourcesRoutes.get('/:id/stats', async (c) => {
  const id = Number(c.req.param('id'))
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const grouped = await prisma.leadIngestionLog.groupBy({
    by: ['status'],
    where: { sourceId: id, receivedAt: { gte: since } },
    _count: { _all: true },
  })
  const total = grouped.reduce((s, g) => s + g._count._all, 0)
  return c.json({ total, byStatus: grouped.map((g) => ({ status: g.status, count: g._count._all })) })
})
