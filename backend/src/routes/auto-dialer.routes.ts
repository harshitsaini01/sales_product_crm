import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { createMiddleware } from 'hono/factory'
import { prisma } from '../lib/prisma'
import { authenticateAny } from '../middleware/auth'
import { authenticateMobile } from '../middleware/mobile-auth'
import { adminOnly } from '../middleware/rbac'
import { bigintFix } from '../utils/bigint-fix'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'

export const autoDialerRoutes = new Hono()

// ─── Recordings: multer for campaign audio (separate from call recordings) ──
const REC_DIR = path.join(process.cwd(), 'uploads', 'campaign-recordings')
if (!fs.existsSync(REC_DIR)) fs.mkdirSync(REC_DIR, { recursive: true })

const recStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any)._userId || 'unknown'
    const ym = new Date().toISOString().slice(0, 7)
    const dir = path.join(REC_DIR, String(userId), ym)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3'
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    cb(null, `${Date.now()}_${base}${ext}`)
  },
})

const recUpload = multer({
  storage: recStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/webm', 'application/octet-stream']
    cb(null, ok.includes(file.mimetype))
  },
})

function uploadCampaignRecording(field: string) {
  return createMiddleware(async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;((c.env as { incoming: unknown }).incoming as any)._userId = c.get('user').userId
    const handler = recUpload.single(field)
    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler((c.env as { incoming: unknown }).incoming as any, (c.env as { outgoing: unknown }).outgoing as any, (err: unknown) => {
        if (err) reject(err); else resolve()
      })
    })
    await next()
  })
}

autoDialerRoutes.use('*', authenticateAny)

// ═══════════════════ RECORDINGS ═══════════════════════════════════════════════

autoDialerRoutes.get('/recordings', async (c) => {
  const rows = await prisma.autoDialerRecording.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  return c.json(bigintFix(rows))
})

autoDialerRoutes.post('/recordings', adminOnly, uploadCampaignRecording('file'), async (c) => {
  const { userId } = c.get('user')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as { incoming: unknown }).incoming as any).file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = ((c.env as { incoming: unknown }).incoming as any).body || {}
  const name = (body.name as string)?.trim() || file.originalname
  const durationSec = Number(body.durationSec || 0)

  const relPath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')

  const rec = await prisma.autoDialerRecording.create({
    data: {
      name,
      filePath: relPath,
      durationSec: Math.max(0, durationSec),
      sizeBytes: file.size,
      mimeType: file.mimetype,
      uploadedBy: BigInt(userId),
    },
  })
  return c.json(bigintFix(rec), 201)
})

// Stream recording — accessible to admin OR any authenticated counsellor who
// has a campaign assignment that uses this recording (or via mobile JWT).
autoDialerRoutes.get('/recordings/:id/stream', authenticateAny, async (c) => {
  const requester = c.get('user')
  const id = BigInt(c.req.param('id'))
  const rec = await prisma.autoDialerRecording.findUnique({ where: { id } })
  if (!rec) return c.json({ error: 'Not found' }, 404)

  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  if (!isAdmin) {
    // counsellor: must have an assignment on a campaign that references this recording
    const ok = await prisma.autoDialerCampaignAssignment.findFirst({
      where: {
        counsellorId: BigInt(requester.userId),
        campaign: { recordingId: id },
      },
      select: { id: true },
    })
    if (!ok) return c.json({ error: 'Forbidden' }, 403)
  }

  const abs = path.join(process.cwd(), rec.filePath)
  if (!fs.existsSync(abs)) return c.json({ error: 'File missing' }, 410)
  const stat = fs.statSync(abs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = fs.createReadStream(abs) as any
  return new Response(stream, {
    headers: {
      'Content-Type': rec.mimeType || 'audio/mpeg',
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

autoDialerRoutes.delete('/recordings/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const inUse = await prisma.autoDialerCampaign.count({
    where: { recordingId: id, status: { in: ['draft', 'active', 'paused'] } },
  })
  if (inUse > 0) return c.json({ error: 'Recording is in use by an active campaign' }, 409)
  await prisma.autoDialerRecording.update({
    where: { id },
    data: { archivedAt: new Date() },
  })
  return c.json({ message: 'Archived' })
})

// ═══════════════════ CAMPAIGNS ════════════════════════════════════════════════

const campaignCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  type: z.enum(['B2B', 'B2C']).default('B2B'),
  recordingId: z.number().int().optional(),
  callGapSec: z.number().int().min(15).max(600).default(30),
})

autoDialerRoutes.post('/campaigns', adminOnly, zValidator('json', campaignCreateSchema), async (c) => {
  const { userId } = c.get('user')
  const data = c.req.valid('json')
  if (data.type === 'B2C') return c.json({ error: 'B2C campaigns not yet supported' }, 400)

  if (data.recordingId) {
    const rec = await prisma.autoDialerRecording.findUnique({ where: { id: BigInt(data.recordingId) } })
    if (!rec || rec.archivedAt) return c.json({ error: 'Recording not found' }, 404)
  }

  const camp = await prisma.autoDialerCampaign.create({
    data: {
      name: data.name,
      description: data.description,
      type: data.type,
      recordingId: data.recordingId ? BigInt(data.recordingId) : null,
      callGapSec: data.callGapSec,
      createdBy: BigInt(userId),
    },
  })
  return c.json(bigintFix(camp), 201)
})

// List campaigns. Admin: all. Counsellor: only campaigns assigned to them.
autoDialerRoutes.get('/campaigns', async (c) => {
  const requester = c.get('user')
  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  const { page, limit, skip } = parsePagination({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  })
  const status = c.req.query('status')

  const where: Prisma.AutoDialerCampaignWhereInput = {}
  if (status) where.status = status
  if (!isAdmin) {
    where.assignments = { some: { counsellorId: BigInt(requester.userId) } }
    // counsellor doesn't see drafts
    where.status = where.status ?? { in: ['active', 'paused', 'completed'] }
  }

  const [data, total] = await Promise.all([
    prisma.autoDialerCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        recording: { select: { id: true, name: true, durationSec: true } },
        _count: { select: { contacts: true, assignments: true } },
      },
    }),
    prisma.autoDialerCampaign.count({ where }),
  ])

  return c.json(bigintFix(buildPaginatedResult(data, total, page, limit)))
})

autoDialerRoutes.get('/campaigns/:id', async (c) => {
  const requester = c.get('user')
  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  const id = BigInt(c.req.param('id'))

  const camp = await prisma.autoDialerCampaign.findUnique({
    where: { id },
    include: {
      recording: true,
      assignments: { include: { campaign: false } },
    },
  })
  if (!camp) return c.json({ error: 'Not found' }, 404)

  if (!isAdmin) {
    const mine = camp.assignments.some((a) => a.counsellorId === BigInt(requester.userId))
    if (!mine) return c.json({ error: 'Forbidden' }, 403)
  }

  // Counsellor name lookup
  const counsellorIds = camp.assignments.map((a) => a.counsellorId)
  const users = counsellorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: counsellorIds } },
        select: { id: true, name: true, mobile: true },
      })
    : []
  const userMap = new Map(users.map((u) => [String(u.id), u]))

  return c.json(bigintFix({
    ...camp,
    assignments: camp.assignments.map((a) => ({
      ...a,
      counsellor: userMap.get(String(a.counsellorId)) ?? null,
    })),
  }))
})

// Attach contacts (admin only — draft state only)
const attachSchema = z.object({
  b2bContactIds: z.array(z.number().int()).min(1).max(20000),
})

autoDialerRoutes.post('/campaigns/:id/contacts', adminOnly, zValidator('json', attachSchema), async (c) => {
  const id = BigInt(c.req.param('id'))
  const { b2bContactIds } = c.req.valid('json')
  const camp = await prisma.autoDialerCampaign.findUnique({ where: { id } })
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (camp.status !== 'draft') return c.json({ error: 'Cannot modify contacts after start' }, 409)

  const rows: Prisma.AutoDialerCampaignContactCreateManyInput[] = b2bContactIds.map((cid) => ({
    campaignId: id,
    b2bContactId: BigInt(cid),
  }))
  // skipDuplicates relies on the @@unique([campaignId, b2bContactId])
  const inserted = await prisma.autoDialerCampaignContact.createMany({
    data: rows,
    skipDuplicates: true,
  })

  const total = await prisma.autoDialerCampaignContact.count({ where: { campaignId: id } })
  await prisma.autoDialerCampaign.update({ where: { id }, data: { totalContacts: total } })

  return c.json({ added: inserted.count, total })
})

// Detach single contact (draft only)
autoDialerRoutes.delete('/campaigns/:id/contacts/:contactId', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const contactId = BigInt(c.req.param('contactId'))
  const camp = await prisma.autoDialerCampaign.findUnique({ where: { id } })
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (camp.status !== 'draft') return c.json({ error: 'Cannot modify after start' }, 409)
  await prisma.autoDialerCampaignContact.deleteMany({
    where: { campaignId: id, b2bContactId: contactId },
  })
  const total = await prisma.autoDialerCampaignContact.count({ where: { campaignId: id } })
  await prisma.autoDialerCampaign.update({ where: { id }, data: { totalContacts: total } })
  return c.json({ total })
})

// List contacts inside a campaign (admin: all; counsellor: only assignedToUserId = me)
autoDialerRoutes.get('/campaigns/:id/contacts', async (c) => {
  const requester = c.get('user')
  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  const id = BigInt(c.req.param('id'))
  const { page, limit, skip } = parsePagination({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  })
  const status = c.req.query('status')

  const where: Prisma.AutoDialerCampaignContactWhereInput = { campaignId: id }
  if (!isAdmin) where.assignedToUserId = BigInt(requester.userId)
  if (status) where.status = status

  const [data, total] = await Promise.all([
    prisma.autoDialerCampaignContact.findMany({
      where,
      orderBy: [{ status: 'asc' }, { id: 'asc' }],
      skip,
      take: limit,
      include: {
        b2bContact: true,
      },
    }),
    prisma.autoDialerCampaignContact.count({ where }),
  ])

  return c.json(bigintFix(buildPaginatedResult(data, total, page, limit)))
})

// Assign counsellors and round-robin split (draft or active OK; new assignments
// only inherit yet-unassigned + pending contacts)
const assignSchema = z.object({
  counsellorIds: z.array(z.number().int()).min(1).max(50),
  rebalance: z.boolean().optional(), // if true, redistributes pending across all current assignees
})

autoDialerRoutes.post('/campaigns/:id/assign', adminOnly, zValidator('json', assignSchema), async (c) => {
  const id = BigInt(c.req.param('id'))
  const { counsellorIds, rebalance } = c.req.valid('json')
  const camp = await prisma.autoDialerCampaign.findUnique({ where: { id } })
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (camp.status === 'completed') return c.json({ error: 'Campaign already completed' }, 409)

  // validate counsellors
  const counsellors = await prisma.user.findMany({
    where: { id: { in: counsellorIds.map((n) => BigInt(n)) }, status: 1 },
    select: { id: true, role: true },
  })
  const validIds = counsellors.map((u) => u.id)
  if (validIds.length === 0) return c.json({ error: 'No valid counsellors' }, 400)

  // upsert assignments
  await prisma.$transaction(
    validIds.map((cid) =>
      prisma.autoDialerCampaignAssignment.upsert({
        where: { campaignId_counsellorId: { campaignId: id, counsellorId: cid } },
        update: {},
        create: { campaignId: id, counsellorId: cid },
      })
    )
  )

  // Determine which contacts to (re)distribute
  const targetWhere: Prisma.AutoDialerCampaignContactWhereInput = rebalance
    ? { campaignId: id, status: { in: ['pending'] } }
    : { campaignId: id, assignedToUserId: null, status: 'pending' }

  const queue = await prisma.autoDialerCampaignContact.findMany({
    where: targetWhere,
    orderBy: { id: 'asc' },
    select: { id: true },
  })

  // round-robin assign across validIds
  const updates: Promise<unknown>[] = []
  for (let i = 0; i < queue.length; i++) {
    const cid = validIds[i % validIds.length]
    updates.push(
      prisma.autoDialerCampaignContact.update({
        where: { id: queue[i].id },
        data: { assignedToUserId: cid },
      })
    )
  }
  // batch in chunks of 100 to keep transactions sane
  for (let i = 0; i < updates.length; i += 100) {
    await Promise.all(updates.slice(i, i + 100))
  }

  // per-counsellor counts
  const perUser = await prisma.autoDialerCampaignContact.groupBy({
    by: ['assignedToUserId'],
    where: { campaignId: id },
    _count: { _all: true },
  })

  return c.json({
    assigned: queue.length,
    counsellors: perUser
      .filter((g) => g.assignedToUserId !== null)
      .map((g) => ({ counsellorId: Number(g.assignedToUserId), count: g._count._all })),
  })
})

// Remove a counsellor from a campaign (their pending rows become unassigned)
autoDialerRoutes.delete('/campaigns/:id/assign/:counsellorId', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const counsellorId = BigInt(c.req.param('counsellorId'))
  await prisma.autoDialerCampaignContact.updateMany({
    where: { campaignId: id, assignedToUserId: counsellorId, status: 'pending' },
    data: { assignedToUserId: null },
  })
  await prisma.autoDialerCampaignAssignment.deleteMany({
    where: { campaignId: id, counsellorId },
  })
  return c.json({ message: 'Removed' })
})

// Lifecycle: start / pause / resume / complete
async function transition(id: bigint, from: string[], to: string, extra: Prisma.AutoDialerCampaignUpdateInput = {}) {
  const camp = await prisma.autoDialerCampaign.findUnique({ where: { id } })
  if (!camp) return { error: 'Not found' as const, code: 404 as const }
  if (!from.includes(camp.status)) return { error: `Cannot transition from ${camp.status}` as const, code: 409 as const }
  const updated = await prisma.autoDialerCampaign.update({ where: { id }, data: { status: to, ...extra } })
  return { camp: updated }
}

autoDialerRoutes.post('/campaigns/:id/start', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const camp = await prisma.autoDialerCampaign.findUnique({ where: { id } })
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (camp.status !== 'draft') return c.json({ error: 'Already started' }, 409)

  const total = await prisma.autoDialerCampaignContact.count({ where: { campaignId: id } })
  if (total === 0) return c.json({ error: 'No contacts attached' }, 400)
  const assignedCount = await prisma.autoDialerCampaignAssignment.count({ where: { campaignId: id } })
  if (assignedCount === 0) return c.json({ error: 'No counsellors assigned' }, 400)

  const updated = await prisma.autoDialerCampaign.update({
    where: { id },
    data: { status: 'active', startedAt: new Date(), totalContacts: total },
  })
  return c.json(bigintFix(updated))
})

autoDialerRoutes.post('/campaigns/:id/pause', adminOnly, async (c) => {
  const r = await transition(BigInt(c.req.param('id')), ['active'], 'paused')
  if ('error' in r) return c.json({ error: r.error }, r.code)
  return c.json(bigintFix(r.camp))
})

autoDialerRoutes.post('/campaigns/:id/resume', adminOnly, async (c) => {
  const r = await transition(BigInt(c.req.param('id')), ['paused'], 'active')
  if ('error' in r) return c.json({ error: r.error }, r.code)
  return c.json(bigintFix(r.camp))
})

autoDialerRoutes.post('/campaigns/:id/complete', adminOnly, async (c) => {
  const r = await transition(BigInt(c.req.param('id')), ['active', 'paused'], 'completed', { completedAt: new Date() })
  if ('error' in r) return c.json({ error: r.error }, r.code)
  return c.json(bigintFix(r.camp))
})

// ─── Live stats ─────────────────────────────────────────────────────────────
autoDialerRoutes.get('/campaigns/:id/stats', async (c) => {
  const requester = c.get('user')
  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  const id = BigInt(c.req.param('id'))

  if (!isAdmin) {
    const ok = await prisma.autoDialerCampaignAssignment.findFirst({
      where: { campaignId: id, counsellorId: BigInt(requester.userId) },
      select: { id: true },
    })
    if (!ok) return c.json({ error: 'Forbidden' }, 403)
  }

  const baseWhere: Prisma.AutoDialerCampaignContactWhereInput = { campaignId: id }
  if (!isAdmin) baseWhere.assignedToUserId = BigInt(requester.userId)

  const [byStatus, perCounsellor, callAgg] = await Promise.all([
    prisma.autoDialerCampaignContact.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    }),
    isAdmin
      ? prisma.autoDialerCampaignContact.groupBy({
          by: ['assignedToUserId', 'status'],
          where: { campaignId: id },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.mobileCall.aggregate({
      where: {
        campaignContactId: { not: null },
        leadId: null, // campaign calls aren't lead-bound
        ...(isAdmin ? {} : { userId: BigInt(requester.userId) }),
        // tighten to this campaign via subquery
      },
      _sum: { durationSec: true },
      _count: { _all: true },
    }),
  ])

  // Pull this-campaign call rows for accurate avg duration / connected counts
  const calls = await prisma.mobileCall.findMany({
    where: {
      campaignContactId: {
        in: (
          await prisma.autoDialerCampaignContact.findMany({
            where: { campaignId: id },
            select: { id: true },
          })
        ).map((r) => r.id),
      },
      ...(isAdmin ? {} : { userId: BigInt(requester.userId) }),
    },
    select: { status: true, durationSec: true, userId: true },
  })

  const totalDuration = calls.reduce((s, c2) => s + (c2.durationSec || 0), 0)
  const answered = calls.filter((c2) => c2.status === 'ANSWERED').length
  const avgTalkTime = answered > 0
    ? Math.round(calls.filter((c2) => c2.status === 'ANSWERED').reduce((s, c2) => s + (c2.durationSec || 0), 0) / answered)
    : 0

  const statusCounts: Record<string, number> = {}
  for (const g of byStatus) statusCounts[g.status] = g._count._all
  const totalContacts = Object.values(statusCounts).reduce((a, b) => a + b, 0)
  const dialed = totalContacts - (statusCounts.pending ?? 0)
  const progress = totalContacts > 0 ? Math.round((dialed / totalContacts) * 100) : 0

  return c.json({
    totalContacts,
    dialed,
    pending: statusCounts.pending ?? 0,
    connected: statusCounts.connected ?? 0,
    noAnswer: statusCounts.no_answer ?? 0,
    busy: statusCounts.busy ?? 0,
    declined: statusCounts.declined ?? 0,
    failed: statusCounts.failed ?? 0,
    skipped: statusCounts.skipped ?? 0,
    completed: statusCounts.completed ?? 0,
    totalCallDurationSec: totalDuration,
    avgTalkTimeSec: avgTalkTime,
    progressPct: progress,
    callsLogged: callAgg._count._all,
    perCounsellor: isAdmin
      ? (() => {
          const map = new Map<string, Record<string, number>>()
          for (const g of perCounsellor as Array<{ assignedToUserId: bigint | null; status: string; _count: { _all: number } }>) {
            const k = String(g.assignedToUserId ?? 0)
            if (!map.has(k)) map.set(k, {})
            map.get(k)![g.status] = g._count._all
          }
          return Array.from(map.entries()).map(([uid, counts]) => ({
            counsellorId: Number(uid),
            ...counts,
          }))
        })()
      : undefined,
  })
})

// ─── Queue dispatcher (mobile counsellor): next pending contact ─────────────
// Atomically flips status: pending → dialing, returns contact + recording URL.
autoDialerRoutes.get('/campaigns/:id/next', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))

  const camp = await prisma.autoDialerCampaign.findUnique({
    where: { id },
    include: { recording: true },
  })
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (camp.status !== 'active') return c.json({ error: 'Campaign not active', status: camp.status }, 409)

  const assigned = await prisma.autoDialerCampaignAssignment.findFirst({
    where: { campaignId: id, counsellorId: BigInt(userId) },
    select: { id: true },
  })
  if (!assigned) return c.json({ error: 'Not assigned to this campaign' }, 403)

  // Atomic pop: pick lowest-id pending row assigned to me, flip to dialing
  const result = await prisma.$transaction(async (tx) => {
    const next = await tx.autoDialerCampaignContact.findFirst({
      where: { campaignId: id, assignedToUserId: BigInt(userId), status: 'pending' },
      orderBy: { id: 'asc' },
      include: { b2bContact: true },
    })
    if (!next) return null
    await tx.autoDialerCampaignContact.update({
      where: { id: next.id },
      data: { status: 'dialing', lastAttemptAt: new Date(), attemptCount: { increment: 1 } },
    })
    return next
  })

  if (!result) {
    // Determine why
    const remaining = await prisma.autoDialerCampaignContact.count({
      where: { campaignId: id, assignedToUserId: BigInt(userId), status: 'pending' },
    })
    return c.json({ done: true, remaining }, 200)
  }

  return c.json(bigintFix({
    campaignContactId: Number(result.id),
    contact: result.b2bContact,
    recording: camp.recording
      ? {
          id: Number(camp.recording.id),
          name: camp.recording.name,
          durationSec: camp.recording.durationSec,
          streamUrl: `/api/auto-dialer/recordings/${Number(camp.recording.id)}/stream`,
        }
      : null,
    callGapSec: camp.callGapSec,
  }))
})

// Counsellor manual override: skip a contact
autoDialerRoutes.post('/campaigns/:id/contacts/:contactId/skip', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  const contactId = BigInt(c.req.param('contactId'))
  const row = await prisma.autoDialerCampaignContact.findUnique({ where: { id: contactId } })
  if (!row || row.campaignId !== id || row.assignedToUserId !== BigInt(userId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await prisma.autoDialerCampaignContact.update({
    where: { id: contactId },
    data: { status: 'skipped' },
  })
  return c.json({ ok: true })
})

// ─── Sync: report call outcome for a campaign-contact (called by mobile) ────
// This is in addition to /calls/sync (which is the canonical MobileCall sync).
// Used to reconcile CampaignContact.status from a freshly-synced MobileCall.
const reconcileSchema = z.object({
  mobileCallId: z.number().int(),
  campaignContactId: z.number().int(),
})

autoDialerRoutes.post('/reconcile', authenticateMobile, zValidator('json', reconcileSchema), async (c) => {
  const { userId } = c.get('user')
  const { mobileCallId, campaignContactId } = c.req.valid('json')

  const call = await prisma.mobileCall.findUnique({ where: { id: BigInt(mobileCallId) } })
  if (!call || call.userId !== BigInt(userId)) return c.json({ error: 'Call not found' }, 404)
  const row = await prisma.autoDialerCampaignContact.findUnique({ where: { id: BigInt(campaignContactId) } })
  if (!row || row.assignedToUserId !== BigInt(userId)) return c.json({ error: 'Forbidden' }, 403)

  const mapped = mapCallStatusToContactStatus(call.status)
  await prisma.$transaction([
    prisma.autoDialerCampaignContact.update({
      where: { id: row.id },
      data: { status: mapped, mobileCallId: call.id },
    }),
    prisma.mobileCall.update({
      where: { id: call.id },
      data: { campaignContactId: row.id },
    }),
  ])

  return c.json({ ok: true, status: mapped })
})

function mapCallStatusToContactStatus(status: string): string {
  switch (status) {
    case 'ANSWERED': return 'connected'
    case 'MISSED':
    case 'NO_ANSWER': return 'no_answer'
    case 'BUSY': return 'busy'
    case 'REJECTED': return 'declined'
    case 'FAILED': return 'failed'
    default: return 'failed'
  }
}
