import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { bigintFix } from '../utils/bigint-fix'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'

export const b2bRoutes = new Hono()

b2bRoutes.use('*', authenticate)

// ─── CSV template (admin convenience) ────────────────────────────────────────
b2bRoutes.get('/template.csv', adminOnly, (c) => {
  const csv = 'Name,Email,Phone,State\nAcme Corp,info@acme.com,9876543210,Maharashtra\n'
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="b2b_contacts_template.csv"',
    },
  })
})

// ─── List contacts (admin only — B2B is admin-curated) ──────────────────────
b2bRoutes.get('/contacts', adminOnly, async (c) => {
  const { page, limit, skip } = parsePagination({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  })
  const search = c.req.query('search')?.trim()
  const state = c.req.query('state')
  const uploadBatch = c.req.query('uploadBatch')
  const source = c.req.query('source')
  const campaignStatus = c.req.query('campaignStatus') // pending | assigned | called

  const where: Prisma.B2bContactWhereInput = {}
  if (search) {
    const last10 = search.replace(/\D/g, '').slice(-10)
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      ...(last10 ? [{ phone: { contains: last10 } }] : []),
    ]
  }
  if (state) where.state = state
  if (uploadBatch) where.uploadBatch = uploadBatch
  if (source) where.source = source

  if (campaignStatus === 'pending') {
    where.campaignContacts = { none: {} }
  } else if (campaignStatus === 'assigned') {
    where.campaignContacts = { some: { status: { in: ['pending', 'dialing'] } } }
  } else if (campaignStatus === 'called') {
    where.campaignContacts = { some: { status: { in: ['connected', 'no_answer', 'busy', 'declined', 'failed', 'completed'] } } }
  }

  const [data, total] = await Promise.all([
    prisma.b2bContact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        _count: { select: { campaignContacts: true } },
      },
    }),
    prisma.b2bContact.count({ where }),
  ])

  return c.json(bigintFix(buildPaginatedResult(data, total, page, limit)))
})

// ─── Stats: counts by state + recent upload batches ──────────────────────────
b2bRoutes.get('/stats', adminOnly, async (c) => {
  const [total, byState, batches] = await Promise.all([
    prisma.b2bContact.count(),
    prisma.b2bContact.groupBy({
      by: ['state'],
      _count: { _all: true },
      orderBy: { _count: { state: 'desc' } },
      take: 30,
    }),
    prisma.b2bContact.groupBy({
      by: ['uploadBatch', 'source'],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: 20,
    }),
  ])

  return c.json({
    total,
    byState: byState.map((g) => ({ state: g.state, count: g._count._all })),
    batches: batches.map((g) => ({
      uploadBatch: g.uploadBatch,
      source: g.source,
      count: g._count._all,
      uploadedAt: g._max.createdAt?.toISOString(),
    })),
  })
})

// ─── Distinct states (for filter dropdowns) ─────────────────────────────────
b2bRoutes.get('/states', adminOnly, async (c) => {
  const rows = await prisma.b2bContact.findMany({
    where: { state: { not: null } },
    select: { state: true },
    distinct: ['state'],
    orderBy: { state: 'asc' },
  })
  return c.json(rows.map((r) => r.state).filter(Boolean))
})

// ─── Bulk import (frontend parses CSV/XLSX → POST JSON) ─────────────────────
const importSchema = z.object({
  source: z.enum(['csv', 'xlsx', 'api']).default('csv'),
  contacts: z
    .array(
      z.object({
        name: z.string().min(1).max(150),
        email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
        phone: z.string().min(6).max(32),
        state: z.string().max(80).optional().or(z.literal('').transform(() => undefined)),
      })
    )
    .min(1)
    .max(50000),
})

function normalizePhone(raw: string): string {
  // keep digits + optional leading +. Strip everything else.
  const cleaned = raw.replace(/[^\d+]/g, '')
  return cleaned
}

b2bRoutes.post('/import', adminOnly, zValidator('json', importSchema), async (c) => {
  const { userId } = c.get('user')
  const { source, contacts } = c.req.valid('json')
  const uploadBatch = randomUUID()

  // Within-batch dedupe by last-10 digits
  const seen = new Set<string>()
  const rows: Prisma.B2bContactCreateManyInput[] = []
  let skipped = 0
  for (const ctc of contacts) {
    const phone = normalizePhone(ctc.phone)
    const last10 = phone.replace(/\D/g, '').slice(-10)
    if (!last10 || last10.length < 6) {
      skipped++
      continue
    }
    if (seen.has(last10)) {
      skipped++
      continue
    }
    seen.add(last10)
    rows.push({
      name: ctc.name.trim(),
      email: ctc.email?.trim() || null,
      phone,
      state: ctc.state?.trim() || null,
      uploadBatch,
      source,
      uploadedBy: BigInt(userId),
    })
  }

  if (rows.length === 0) {
    return c.json({ error: 'No valid contacts in payload', inserted: 0, skipped }, 400)
  }

  const result = await prisma.b2bContact.createMany({ data: rows })
  return c.json({
    inserted: result.count,
    skipped,
    uploadBatch,
  }, 201)
})

// ─── Single delete (admin only) ─────────────────────────────────────────────
b2bRoutes.delete('/contacts/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  // Refuse if referenced by an active campaign
  const refs = await prisma.autoDialerCampaignContact.count({
    where: { b2bContactId: id, status: { in: ['pending', 'dialing'] } },
  })
  if (refs > 0) {
    return c.json({ error: 'Contact is queued in an active campaign' }, 409)
  }
  await prisma.b2bContact.delete({ where: { id } })
  return c.json({ message: 'Contact deleted' })
})

// ─── Bulk delete by batch ───────────────────────────────────────────────────
b2bRoutes.delete('/batches/:batch', adminOnly, async (c) => {
  const batch = c.req.param('batch')
  // Refuse if any contact in batch is active in a campaign
  const refs = await prisma.autoDialerCampaignContact.count({
    where: {
      b2bContact: { uploadBatch: batch },
      status: { in: ['pending', 'dialing'] },
    },
  })
  if (refs > 0) {
    return c.json({ error: 'Batch has contacts queued in an active campaign' }, 409)
  }
  const result = await prisma.b2bContact.deleteMany({ where: { uploadBatch: batch } })
  return c.json({ deleted: result.count })
})

// ─── DND toggle ────────────────────────────────────────────────────────────
b2bRoutes.patch('/contacts/:id/dnd', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = (await c.req.json().catch(() => ({}))) as { dnd?: boolean }
  const updated = await prisma.b2bContact.update({
    where: { id },
    data: { dndFlag: !!body.dnd },
  })
  return c.json(bigintFix(updated))
})
