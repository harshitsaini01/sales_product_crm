import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { verifyGroup, evictTransport } from '../services/campaign-mailer.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bigintFix(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(bigintFix)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = bigintFix(obj[k])
    return out
  }
  return obj
}

// zValidator's default hook hands the raw ZodError back as `error`, so a 400
// from any route below used to arrive at the browser as `{ error: { issues,
// name } }`. The modal renders `error` straight into a <div>, and React blows
// up on an object child (minified error #31 — "Objects are not valid as a
// React child"). Flatten every validation failure into one readable string so
// this router's 400s always have the same `{ error: string }` shape as the
// hand-written ones.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zJson<T extends z.ZodType<any, any, any>>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ')
      return c.json({ error: msg || 'Invalid request body' }, 400)
    }
  })
}

export const campaignsRoutes = new Hono()
campaignsRoutes.use('*', authenticate)

// ─── Campaign Groups (sender accounts) ──────────────────────────────────────
// Admin-only — these hold SMTP/IMAP creds.

const groupSchema = z.object({
  name: z.string().min(1).max(120),
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email().max(160),
  smtpHost: z.string().min(1).max(160),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().min(1).max(160),
  smtpPass: z.string().min(1).max(255),
  smtpSecure: z.boolean().optional().default(true),
  imapHost: z.string().max(160).optional().nullable(),
  imapPort: z.number().int().min(1).max(65535).optional().nullable(),
  imapUser: z.string().max(160).optional().nullable(),
  imapPass: z.string().max(255).optional().nullable(),
  imapSecure: z.boolean().optional().default(true),
  hourlyCap: z.number().int().min(1).max(1000).optional().default(50),
  authorityScore: z.number().int().min(1).max(10).optional().default(5),
  isActive: z.boolean().optional().default(true),
  notes: z.string().max(2000).optional().nullable(),
})

campaignsRoutes.get('/groups', adminOnly, async (c) => {
  const groups = await prisma.campaignGroup.findMany({
    orderBy: [{ isActive: 'desc' }, { authorityScore: 'desc' }, { name: 'asc' }],
  })
  // Strip secrets — UI never needs them after creation.
  return c.json(bigintFix(groups.map((g) => ({ ...g, smtpPass: undefined, imapPass: undefined }))))
})

campaignsRoutes.post('/groups', adminOnly, zJson(groupSchema), async (c) => {
  const data = c.req.valid('json')
  const created = await prisma.campaignGroup.create({ data })
  return c.json(bigintFix({ ...created, smtpPass: undefined, imapPass: undefined }))
})

campaignsRoutes.patch('/groups/:id', adminOnly, zJson(groupSchema.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const data = c.req.valid('json')
  const updated = await prisma.campaignGroup.update({ where: { id }, data })
  evictTransport(id)
  return c.json(bigintFix({ ...updated, smtpPass: undefined, imapPass: undefined }))
})

campaignsRoutes.delete('/groups/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  // Soft-block delete if any campaign is running on this group.
  const inUse = await prisma.emailCampaignChunk.count({
    where: { groupId: id, finishedAt: null },
  })
  if (inUse > 0) {
    return c.json({ error: `Group still has ${inUse} pending chunks — pause/cancel those campaigns first.` }, 409)
  }
  await prisma.campaignGroup.delete({ where: { id } })
  evictTransport(id)
  return c.json({ ok: true })
})

campaignsRoutes.post('/groups/:id/test', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const group = await prisma.campaignGroup.findUnique({ where: { id } })
  if (!group) return c.json({ error: 'Group not found' }, 404)
  const result = await verifyGroup(group)
  return c.json(result)
})

// ─── Campaigns ──────────────────────────────────────────────────────────────

const distSchema = z.enum(['AUTHORITY', 'EQUAL', 'MANUAL'])

const previewSchema = z.object({
  leadIds: z.array(z.number().int()).min(1).max(50000),
  distribution: distSchema.optional().default('AUTHORITY'),
  groupIds: z.array(z.number().int()).optional(), // restrict to subset
  manualPlan: z.array(z.object({ groupId: z.number().int(), count: z.number().int().min(0) })).optional(),
  // Optional per-campaign override for how many mails go out per hour. When
  // set, this replaces the group's hourlyCap for chunk sizing on THIS campaign
  // only — the group's own cap is unchanged. Hard-capped at 70 to keep sender
  // reputation intact ("more than 70 mails from one address in an hour" is the
  // point most anti-spam heuristics flip red).
  mailsPerHour: z.number().int().min(1).max(70).optional(),
  // Per-account rate override. When present it wins over `mailsPerHour` for
  // the named group — lets a campaign say "send from A at 60/hr, B at 30/hr,
  // C at 70/hr" so each mailbox drips at its own independent pace instead of
  // being forced to a shared campaign-wide rate. Missing entries fall back to
  // `mailsPerHour`, then to the group's own `hourlyCap`.
  perGroupCaps: z.array(z.object({
    groupId: z.number().int(),
    mailsPerHour: z.number().int().min(1).max(70),
  })).optional(),
  // Gap between two consecutive mails on the SAME mailbox. The old ceiling
  // here was 60 s, which meant any rate under 60/hr (auto-gap = 3600 / rate,
  // so 59/hr already needs 61 s) failed validation the instant it was typed —
  // that was the source of the blank-screen crash. The real ceiling is one
  // hour: at 1 mail/hr the gap legitimately is 3600 s. The server re-derives a
  // safe value anyway (see safeDelayMs) so a bad client value can never pace
  // a mailbox fast enough to get it blocked.
  perEmailDelayMs: z.number().int().min(1000).max(3600000).optional().default(5000),
  batchGapMs: z.number().int().min(60000).max(86400000).optional().default(3600000),
  startAt: z.string().datetime(),
})

// Response cap — never build more than this many chunk rows per group in the
// preview payload. A campaign like "59k leads at 1/hr" would otherwise return
// 59k chunk objects (~10 MB JSON) and error out mid-parse. We still return the
// TRUE totalChunks count so the summary stats stay honest; the plan array is
// just truncated for display.
const MAX_CHUNKS_PER_GROUP_IN_PREVIEW = 200

interface DistShare {
  group: {
    id: bigint
    name: string
    fromEmail: string
    hourlyCap: number
    authorityScore: number
  }
  count: number
}

async function computeDistribution(
  total: number,
  distribution: 'AUTHORITY' | 'EQUAL' | 'MANUAL',
  groupIds: number[] | undefined,
  manualPlan: { groupId: number; count: number }[] | undefined,
): Promise<DistShare[]> {
  const where: Prisma.CampaignGroupWhereInput = { isActive: true }
  if (groupIds && groupIds.length > 0) where.id = { in: groupIds.map((n) => BigInt(n)) }
  const groups = await prisma.campaignGroup.findMany({
    where,
    orderBy: { authorityScore: 'desc' },
  })
  if (groups.length === 0) throw new Error('No active campaign groups configured')

  if (distribution === 'MANUAL') {
    if (!manualPlan || manualPlan.length === 0) throw new Error('manualPlan required for MANUAL distribution')
    const sum = manualPlan.reduce((s, p) => s + p.count, 0)
    if (sum !== total) throw new Error(`manualPlan sum (${sum}) must equal total recipients (${total})`)
    return manualPlan.map((p) => {
      const g = groups.find((x) => Number(x.id) === p.groupId)
      if (!g) throw new Error(`Group ${p.groupId} not found or inactive`)
      return {
        group: { id: g.id, name: g.name, fromEmail: g.fromEmail, hourlyCap: g.hourlyCap, authorityScore: g.authorityScore },
        count: p.count,
      }
    })
  }

  if (distribution === 'EQUAL') {
    const base = Math.floor(total / groups.length)
    const rem = total - base * groups.length
    return groups.map((g, i) => ({
      group: { id: g.id, name: g.name, fromEmail: g.fromEmail, hourlyCap: g.hourlyCap, authorityScore: g.authorityScore },
      count: base + (i < rem ? 1 : 0),
    }))
  }

  // AUTHORITY (weighted by score)
  const totalScore = groups.reduce((s, g) => s + g.authorityScore, 0)
  const shares = groups.map((g) => ({
    group: { id: g.id, name: g.name, fromEmail: g.fromEmail, hourlyCap: g.hourlyCap, authorityScore: g.authorityScore },
    raw: (g.authorityScore / totalScore) * total,
  }))
  // Round, then fix rounding drift on the highest-score group.
  const rounded = shares.map((s) => ({ ...s, count: Math.floor(s.raw) }))
  let assigned = rounded.reduce((s, x) => s + x.count, 0)
  // Distribute remainder by largest fractional part.
  const fracOrder = [...rounded]
    .map((s, i) => ({ i, frac: s.raw - s.count }))
    .sort((a, b) => b.frac - a.frac)
  let cursor = 0
  while (assigned < total && cursor < fracOrder.length) {
    rounded[fracOrder[cursor].i].count++
    assigned++
    cursor++
  }
  return rounded.map((s) => ({ group: s.group, count: s.count }))
}

interface ChunkPlan {
  groupId: number
  groupName: string
  fromEmail: string
  recipientCount: number
  chunks: { index: number; scheduledAt: string; size: number }[]
  totalChunks: number       // real number (may be > chunks.length if truncated)
  cap: number               // per-hour cap this group ended up using
  chunksTruncated: boolean  // true when only the first N were serialised
}

// Resolve the per-hour cap for a given group by preference:
//   per-group override → global campaign override → group's own hourlyCap.
function resolveCap(
  groupId: bigint,
  groupHourlyCap: number,
  mailsPerHourOverride?: number,
  perGroupCaps?: { groupId: number; mailsPerHour: number }[],
): number {
  const idNum = Number(groupId)
  const perGroup = perGroupCaps?.find((c) => c.groupId === idNum)
  if (perGroup) return perGroup.mailsPerHour
  return mailsPerHourOverride ?? groupHourlyCap
}

// Auto gap between mails, enforced server-side. Two rules:
//   1. Never faster than 30 s — a tighter drip than that from one mailbox is
//      the quickest route to a spam flag / blocked account.
//   2. Never so slow that a chunk overruns its own hour. The fastest mailbox
//      in the campaign sets the ceiling: cap x gap must fit inside batchGapMs,
//      otherwise hour 1's tail would still be sending when hour 2's chunk
//      starts and the two would interleave on the same account.
// The client's requested value is honoured only inside that window.
const MIN_GAP_MS = 30_000

function safeDelayMs(
  shares: DistShare[],
  requestedMs: number,
  batchGapMs: number,
  mailsPerHourOverride?: number,
  perGroupCaps?: { groupId: number; mailsPerHour: number }[],
): number {
  const caps = shares
    .filter((s) => s.count > 0)
    .map((s) => resolveCap(s.group.id, s.group.hourlyCap, mailsPerHourOverride, perGroupCaps))
  const fastest = caps.length > 0 ? Math.max(...caps) : 1
  const ceiling = Math.max(MIN_GAP_MS, Math.floor(batchGapMs / Math.max(1, fastest)))
  return Math.min(Math.max(requestedMs, MIN_GAP_MS), ceiling)
}

function planChunks(
  shares: DistShare[],
  startAt: Date,
  batchGapMs: number,
  mailsPerHourOverride?: number,
  perGroupCaps?: { groupId: number; mailsPerHour: number }[],
  chunkLimitPerGroup?: number,
): ChunkPlan[] {
  return shares
    .filter((s) => s.count > 0)
    .map((s) => {
      const cap = resolveCap(s.group.id, s.group.hourlyCap, mailsPerHourOverride, perGroupCaps)
      const total = s.count
      const numChunks = Math.ceil(total / cap)
      const buildCount = chunkLimitPerGroup ? Math.min(numChunks, chunkLimitPerGroup) : numChunks
      const chunks: { index: number; scheduledAt: string; size: number }[] = []
      let remaining = total
      for (let i = 0; i < buildCount; i++) {
        const size = Math.min(cap, remaining)
        const t = new Date(startAt.getTime() + i * batchGapMs)
        chunks.push({ index: i, scheduledAt: t.toISOString(), size })
        remaining -= size
      }
      return {
        groupId: Number(s.group.id),
        groupName: s.group.name,
        fromEmail: s.group.fromEmail,
        recipientCount: total,
        chunks,
        totalChunks: numChunks,
        cap,
        chunksTruncated: numChunks > chunks.length,
      }
    })
}

// POST /campaigns/preview — returns the chunk plan without saving.
campaignsRoutes.post('/preview', zJson(previewSchema), async (c) => {
  const body = c.req.valid('json')
  const total = body.leadIds.length
  let shares: DistShare[]
  try {
    shares = await computeDistribution(total, body.distribution, body.groupIds, body.manualPlan)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
  const plan = planChunks(
    shares,
    new Date(body.startAt),
    body.batchGapMs,
    body.mailsPerHour,
    body.perGroupCaps,
    MAX_CHUNKS_PER_GROUP_IN_PREVIEW,
  )
  // The gap the engine will actually use — the modal shows this, so what the
  // admin reads is what gets sent, not what was requested.
  const effectiveDelayMs = safeDelayMs(shares, body.perEmailDelayMs, body.batchGapMs, body.mailsPerHour, body.perGroupCaps)
  // Real total (across ALL chunks, not just the ones we serialised) — used by
  // the modal's summary tiles so numbers stay honest when the plan is huge.
  const totalChunks = plan.reduce((s, p) => s + p.totalChunks, 0)
  // Compute the TRUE last-chunk-time by projecting from each group's
  // totalChunks, not from the (possibly truncated) chunks array. Otherwise
  // "Finishes" would understate by however many chunks we dropped.
  const startMs = new Date(body.startAt).getTime()
  const lastMs = plan.reduce(
    (max, p) => Math.max(max, startMs + Math.max(0, p.totalChunks - 1) * body.batchGapMs),
    startMs,
  )
  const anyTruncated = plan.some((p) => p.chunksTruncated)
  return c.json({
    totalRecipients: total,
    totalChunks,
    perEmailDelayMs: effectiveDelayMs,
    batchGapMs: body.batchGapMs,
    startAt: body.startAt,
    lastChunkScheduledAt: new Date(lastMs).toISOString(),
    plan,
    // Signal to the UI so it can render "+ N more chunks not shown" tail.
    chunksTruncated: anyTruncated,
    chunkLimitPerGroup: MAX_CHUNKS_PER_GROUP_IN_PREVIEW,
  })
})

const createSchema = previewSchema.extend({
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(240),
  bodyHtml: z.string().min(1),
  signatureId: z.number().int().optional().nullable(),
})

// POST /campaigns — create + persist chunks/recipients in one transaction.
campaignsRoutes.post('/', zJson(createSchema), async (c) => {
  const body = c.req.valid('json')
  const requester = c.get('user')

  // Resolve leads → email + name
  const leads = await prisma.lead.findMany({
    where: { id: { in: body.leadIds.map((n) => BigInt(n)) }, trash: 0 },
    select: { id: true, name: true, email: true },
  })
  const valid = leads.filter((l) => l.email && /@/.test(l.email))
  if (valid.length === 0) return c.json({ error: 'None of the selected leads have a valid email address' }, 400)

  let shares: DistShare[]
  try {
    shares = await computeDistribution(valid.length, body.distribution, body.groupIds, body.manualPlan)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
  const startAt = new Date(body.startAt)

  // Slice leads into groups in declared order.
  const sliced: { share: DistShare; leads: typeof valid }[] = []
  let cursor = 0
  for (const s of shares) {
    sliced.push({ share: s, leads: valid.slice(cursor, cursor + s.count) })
    cursor += s.count
  }

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.emailCampaign.create({
      data: {
        userId: BigInt(requester.userId),
        name: body.name,
        subject: body.subject,
        bodyHtml: body.bodyHtml,
        signatureId: body.signatureId ? BigInt(body.signatureId) : null,
        status: 'SCHEDULED',
        distribution: body.distribution,
        totalRecipients: valid.length,
        chunkSize: 50, // legacy field — actual chunk size is group.hourlyCap
        batchGapMs: body.batchGapMs,
        perEmailDelayMs: safeDelayMs(shares, body.perEmailDelayMs, body.batchGapMs, body.mailsPerHour, body.perGroupCaps),
        startAt,
      },
    })

    for (const { share, leads: groupLeads } of sliced) {
      if (groupLeads.length === 0) continue
      // Same resolution as the preview: perGroupCaps beats global mailsPerHour
      // beats the group's own hourlyCap, so the persisted chunks match exactly
      // what the modal previewed.
      const cap = resolveCap(share.group.id, share.group.hourlyCap, body.mailsPerHour, body.perGroupCaps)
      const numChunks = Math.ceil(groupLeads.length / cap)
      for (let i = 0; i < numChunks; i++) {
        const slice = groupLeads.slice(i * cap, (i + 1) * cap)
        const chunk = await tx.emailCampaignChunk.create({
          data: {
            campaignId: campaign.id,
            groupId: share.group.id,
            index: i,
            scheduledAt: new Date(startAt.getTime() + i * body.batchGapMs),
          },
        })
        await tx.emailCampaignRecipient.createMany({
          data: slice.map((l) => ({
            campaignId: campaign.id,
            chunkId: chunk.id,
            groupId: share.group.id,
            leadId: l.id,
            toEmail: l.email!,
            toName: l.name,
            status: 'QUEUED' as const,
          })),
          skipDuplicates: true, // unique on (campaignId, toEmail) — drops dupe leads
        })
      }
    }
    return campaign
  })

  return c.json(bigintFix({ id: Number(result.id), status: result.status, totalRecipients: valid.length }))
})

// GET /campaigns
campaignsRoutes.get('/', async (c) => {
  const requester = c.get('user')
  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  const where: Prisma.EmailCampaignWhereInput = {}
  if (!isAdmin) where.userId = BigInt(requester.userId)
  const [data, total] = await Promise.all([
    prisma.emailCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        _count: { select: { recipients: true, chunks: true } },
      },
    }),
    prisma.emailCampaign.count({ where }),
  ])
  // Add aggregated recipient counts per status
  const ids = data.map((c) => c.id)
  const [statusGroups, openedCounts] = ids.length === 0 ? [[], []] as [Array<{ campaignId: bigint; status: string; _count: { _all: number } }>, Array<{ campaignId: bigint; _count: { _all: number } }>] : await Promise.all([
    prisma.emailCampaignRecipient.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: ids } },
      _count: { _all: true },
    }),
    // OPENED isn't a status — it's a stamped timestamp. Count it separately so
    // the frontend can compute open-rate without a second round-trip.
    prisma.emailCampaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, openedAt: { not: null } },
      _count: { _all: true },
    }),
  ])
  const byCampaign = new Map<string, Record<string, number>>()
  for (const sg of statusGroups) {
    const k = String(sg.campaignId)
    if (!byCampaign.has(k)) byCampaign.set(k, {})
    byCampaign.get(k)![sg.status] = sg._count._all
  }
  for (const og of openedCounts) {
    const k = String(og.campaignId)
    if (!byCampaign.has(k)) byCampaign.set(k, {})
    byCampaign.get(k)!.OPENED = og._count._all
  }
  return c.json(bigintFix({
    data: data.map((row) => ({
      ...row,
      counts: byCampaign.get(String(row.id)) ?? {},
    })),
    total,
  }))
})

// GET /campaigns/:id — full detail with chunks + recipients
campaignsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const requester = c.get('user')
  const isAdmin = requester.role === 'admin' || requester.role === 'sub-admin'
  const camp = await prisma.emailCampaign.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: [{ groupId: 'asc' }, { index: 'asc' }],
        include: { group: { select: { id: true, name: true, fromEmail: true } } },
      },
    },
  })
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (!isAdmin && camp.userId !== BigInt(requester.userId)) return c.json({ error: 'Forbidden' }, 403)

  const recipients = await prisma.emailCampaignRecipient.findMany({
    where: { campaignId: id },
    orderBy: [{ chunkId: 'asc' }, { id: 'asc' }],
    take: 2000,
    include: {
      group: { select: { id: true, name: true, fromEmail: true } },
      lead: { select: { id: true, name: true } },
    },
  })

  return c.json(bigintFix({ campaign: camp, recipients }))
})

// POST /campaigns/:id/pause
campaignsRoutes.post('/:id/pause', async (c) => {
  const id = BigInt(c.req.param('id'))
  const camp = await prisma.emailCampaign.update({ where: { id }, data: { status: 'PAUSED' } })
  return c.json(bigintFix(camp))
})

// POST /campaigns/:id/resume
campaignsRoutes.post('/:id/resume', async (c) => {
  const id = BigInt(c.req.param('id'))
  const camp = await prisma.emailCampaign.update({ where: { id }, data: { status: 'RUNNING' } })
  return c.json(bigintFix(camp))
})

// POST /campaigns/:id/cancel
campaignsRoutes.post('/:id/cancel', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.emailCampaign.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } })
  // Drop QUEUED recipients so the engine ignores them.
  await prisma.emailCampaignRecipient.updateMany({
    where: { campaignId: id, status: 'QUEUED' },
    data: { status: 'FAILED', errorMessage: 'Campaign cancelled' },
  })
  return c.json({ ok: true })
})
