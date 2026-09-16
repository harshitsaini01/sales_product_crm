import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, authenticateAny } from '../middleware/auth'
import { authenticateMobile } from '../middleware/mobile-auth'
import { adminOnly } from '../middleware/rbac'
import { callsScopeUserIds, isFullAdmin, isCallsManager } from '../utils/branch-scope'
import { callPhoneOr, phoneKeysOf } from '../utils/phone'
import { sendClickToCall } from '../services/fcm.service'
import { createMiddleware } from 'hono/factory'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { Prisma } from '@prisma/client'

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

// ─── Call-log visibility helpers ─────────────────────────────────────────────
// Visibility is branch-scoped: a full admin sees every call; a calls manager
// (sub-admin / sales-head) sees calls made by users in their assigned branches
// and can play those recordings; everyone else sees only their own calls. See
// utils/branch-scope.ts (callsScopeUserIds).

// Only a full admin sees full numbers — everyone else (sub-admin, sales-head,
// counsellor) gets the number masked to the last 5 digits, server-side, so it
// can't be recovered from the network response.
function maskCallPhone(value: string | null | undefined): string | null {
  if (!value) return value ?? null
  const digits = String(value).replace(/\D/g, '')
  if (digits.length <= 5) return value
  return '••••• ' + digits.slice(-5)
}

const RECORDINGS_DIR = path.join(process.cwd(), 'uploads', 'recordings')
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true })

// Recording-specific multer (m4a/aac, up to 50 MB per file)
const recordingStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any)._userId || 'unknown'
    const ym = new Date().toISOString().slice(0, 7) // yyyy-mm
    const dir = path.join(RECORDINGS_DIR, String(userId), ym)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname).toLowerCase() || '.m4a'
    const allowed = ['.m4a', '.aac', '.mp3', '.mp4', '.wav', '.mpeg']
    if (!allowed.includes(ext)) {
      ext = '.m4a' // Fallback to safe default extension
    }
    cb(null, `${Date.now()}${ext}`)
  },
})
// Android call-recording apps emit a surprising spread of mimetypes depending
// on device and codec (m4a/aac, but also 3gp/amr on older phones, wav, and a
// generic octet-stream). The old allowlist was too narrow and SILENTLY dropped
// anything else — the file just vanished and the handler returned a misleading
// "No file uploaded". This is a prime suspect for the 100% error rate. Broaden
// it, and log every rejection so a genuinely-unwanted type is still visible.
const RECORDING_MIME_OK = new Set([
  'audio/mp4', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/3gpp', 'audio/amr', 'audio/ogg',
  'video/mp4', 'video/3gpp', 'application/octet-stream',
])
const recordingUpload = multer({
  storage: recordingStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (RECORDING_MIME_OK.has(file.mimetype)) return cb(null, true)
    console.warn(`[recording] rejected mimetype "${file.mimetype}" for ${file.originalname}`)
    cb(null, false)
  },
})

function uploadRecording(field: string) {
  return createMiddleware(async (c, next) => {
    // pass userId for storage path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;((c.env as { incoming: unknown }).incoming as any)._userId = c.get('user').userId
    const handler = recordingUpload.single(field)
    // A multer error (wrong field name → LIMIT_UNEXPECTED_FILE, oversized file →
    // LIMIT_FILE_SIZE) used to reject this promise and surface as a generic 500,
    // which hid the real reason. Capture it and let the handler return a precise
    // 400 with the multer code instead.
    const uploadErr = await new Promise<{ code?: string; message: string } | null>((resolve) => {
      handler(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.env as { incoming: unknown }).incoming as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.env as { outgoing: unknown }).outgoing as any,
        (err: unknown) => {
          if (err) {
            const e = err as { code?: string; message?: string }
            console.warn(`[recording] multer error ${e.code ?? ''}: ${e.message ?? err}`)
            resolve({ code: e.code, message: e.message ?? 'Upload failed' })
          } else resolve(null)
        },
      )
    })
    c.set('uploadError' as never, uploadErr as never)
    await next()
  })
}

export const callsRoutes = new Hono()

// ─── Lead phone matcher ─────────────────────────────────────────────────────
async function matchLeadByPhone(phone: string): Promise<bigint | null> {
  const norm = phone.replace(/\D/g, '')
  if (norm.length < 10) return null // Require at least 10 digits to prevent false positive contains matches
  const last10 = norm.slice(-10)
  const lead = await prisma.lead.findFirst({
    where: {
      OR: [
        { mobile: { endsWith: last10 } },
        { mobile2: { endsWith: last10 } },
        { mobile3: { endsWith: last10 } },
      ],
      trash: 0,
    },
    // Explicit ordering so a duplicated number always resolves to the same row.
    // Without it the database is free to return either duplicate, which made
    // attribution drift between syncs.
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  return lead?.id ?? null
}

/**
 * Which lead a synced call belongs to.
 *
 * The device is authoritative whenever it knows: a call started from a lead
 * screen, the auto-dialer or a CRM click-to-call carries the exact leadId, so
 * there is nothing to infer. Only calls the app didn't originate (system
 * dialer, incoming) fall through to matching on the number.
 *
 * That fallback prefers a lead assigned to the counsellor who placed the call.
 * A bare findFirst across all leads picks an arbitrary row when two leads share
 * a mobile — frequently one belonging to someone else — which is how a call
 * could be logged against the wrong lead and leave the right lead's calling
 * task sitting there as pending.
 */
async function resolveLeadId(
  clientLeadId: number | null,
  phone: string,
  userId: bigint,
): Promise<bigint | null> {
  const norm = phone.replace(/\D/g, '')
  const last10 = norm.length >= 10 ? norm.slice(-10) : null
  const numberMatches = last10 ? {
    OR: [
      { mobile: { endsWith: last10 } },
      { mobile2: { endsWith: last10 } },
      { mobile3: { endsWith: last10 } },
    ],
    trash: 0,
  } : null

  if (clientLeadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: BigInt(clientLeadId), trash: 0 },
      select: { id: true, assignedTo: { where: { status: 1, clrId: userId }, select: { id: true } } },
    })
    // The device's id is only authoritative when that lead is actually THIS
    // counsellor's. Duplicates of the same number are often split across
    // counsellors — filing the call on a row owned by someone else puts it in
    // the wrong person's pipeline and leaves the right lead looking uncalled.
    if (lead?.assignedTo.length) return lead.id
    if (lead) {
      const mine = numberMatches ? await pickAssignedLead(numberMatches, userId) : null
      // Keep the device's answer when this counsellor owns no copy of the number.
      return mine ?? lead.id
    }
    // Fall through when the id is stale/deleted rather than dropping the link.
  }

  if (!numberMatches) return null

  // Ambiguity is real: two lead rows can legitimately carry the same number
  // (a shared family phone, or a duplicate import). When it happens we resolve
  // it the same way every time instead of taking whatever row the database
  // returns first — an unordered findFirst is why the same number could land on
  // a different lead from one call to the next.
  //
  // Order of preference:
  //   1. A lead currently assigned to the counsellor who placed the call.
  //      Never attribute across counsellors — that is the worst failure, since
  //      the call shows up in someone else's pipeline.
  //   2. Among those, the one this counsellor has an OPEN calling task for —
  //      if they're working a task list, that's who they meant to ring.
  //   3. Otherwise the most recently created, as a stable tiebreak.
  return (await pickAssignedLead(numberMatches, userId)) ?? matchLeadByPhone(phone)
}

/**
 * The lead carrying this number that belongs to the given counsellor, or null.
 * When they own several copies, the one sitting in an open calling task wins —
 * that's the row they were working from.
 */
async function pickAssignedLead(numberMatches: any, userId: bigint): Promise<bigint | null> {
  const assigned = await prisma.lead.findMany({
    where: { ...numberMatches, assignedTo: { some: { clrId: userId, status: 1 } } },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  if (!assigned.length) return null
  if (assigned.length === 1) return assigned[0].id
  const ids = assigned.map((lead) => lead.id)
  const inOpenTask = await prisma.leadWorkBatchItem.findFirst({
    where: {
      leadId: { in: ids },
      completedAt: null,
      batch: { assignedToId: userId, status: 0 },
    },
    orderBy: { id: 'desc' },
    select: { leadId: true },
  })
  return inOpenTask?.leadId ?? assigned[0].id
}

// ─── CRM → app: trigger click-to-call ────────────────────────────────────────
const triggerSchema = z.object({
  leadId: z.number().int(),
  counsellorId: z.number().int().optional(), // defaults to current user if counsellor
})

callsRoutes.post('/trigger', authenticate, zValidator('json', triggerSchema), async (c) => {
  const requester = c.get('user')
  const { leadId, counsellorId } = c.req.valid('json')

  const targetUserId = counsellorId ?? requester.userId

  const lead = await prisma.lead.findUnique({
    where: { id: BigInt(leadId) },
    select: { id: true, name: true, mobile: true },
  })
  if (!lead || !lead.mobile) return c.json({ error: 'Lead not found or no phone number' }, 404)

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: BigInt(targetUserId) },
    orderBy: { lastSeenAt: 'desc' },
    take: 3,
  })
  if (tokens.length === 0) return c.json({ error: 'Counsellor has no registered device' }, 409)

  // Persist a TRIGGERED row immediately so the app can correlate via /pending
  const triggerRow = await prisma.mobileCall.create({
    data: {
      deviceCallId: `trigger_${Date.now()}_${targetUserId}_${leadId}`,
      userId: BigInt(targetUserId),
      leadId: lead.id,
      phoneNumber: lead.mobile,
      direction: 'OUTGOING',
      status: 'TRIGGERED',
      startedAt: new Date(),
      triggeredFrom: 'CRM_WEB',
    },
  })

  const payload = {
    callId: String(triggerRow.id),
    phone: lead.mobile,
    leadId: String(lead.id),
    leadName: lead.name,
    triggeredBy: String(requester.userId),
  }
  const results = await Promise.all(tokens.map((t) => sendClickToCall(t.fcmToken, payload)))
  const delivered = results.some(Boolean)

  if (!delivered) {
    await prisma.mobileCall.update({
      where: { id: triggerRow.id },
      data: { status: 'FAILED' },
    })
  }

  return c.json(bigintFix({ callId: Number(triggerRow.id), delivered }))
})

// ─── App → backend: pending triggers (poll on foreground) ────────────────────
callsRoutes.get('/pending', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const cutoff = new Date(Date.now() - 5 * 60 * 1000) // last 5 min
  const pending = await prisma.mobileCall.findMany({
    where: {
      userId: BigInt(userId),
      status: 'TRIGGERED',
      createdAt: { gte: cutoff },
    },
    select: {
      id: true, phoneNumber: true, leadId: true, startedAt: true,
      lead: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return c.json(bigintFix(pending))
})

// ─── App → backend: bulk sync call rows (idempotent) ─────────────────────────
const syncItemSchema = z.object({
  deviceCallId: z.string().min(1),
  leadId: z.number().int().positive().nullable().optional(),
  phoneNumber: z.string().min(1),
  direction: z.enum(['OUTGOING', 'INCOMING']),
  status: z.enum(['ANSWERED', 'MISSED', 'REJECTED', 'NO_ANSWER', 'BUSY', 'FAILED', 'RINGING']),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationSec: z.number().int().nonnegative().default(0),
  triggerCallId: z.number().int().optional(),
  notes: z.string().optional(),
  simSlot: z.number().int().nonnegative().nullable().optional(),
  simCarrier: z.string().max(80).nullable().optional(),
  simNumber: z.string().max(32).nullable().optional(),
  source: z.enum(['IN_APP', 'SYSTEM_DIALER', 'INCOMING', 'CRM_WEB', 'AUTO_DIALER']).optional(),
  campaignContactId: z.number().int().optional(),
  recordingPlayedId: z.number().int().optional(),
})
const syncSchema = z.object({ calls: z.array(syncItemSchema).max(200) })

callsRoutes.post('/sync', authenticateMobile, zValidator('json', syncSchema), async (c) => {
  const { userId } = c.get('user')
  const { calls } = c.req.valid('json')
  const retentionDays = Number(process.env.RECORDING_RETENTION_DAYS || 90)

  const results: { deviceCallId: string; id: number }[] = []
  for (const item of calls) {
    const leadId = await resolveLeadId(item.leadId ?? null, item.phoneNumber, BigInt(userId))
    const expiresAt = new Date(Date.now() + retentionDays * 86400 * 1000)

    const data = {
      userId: BigInt(userId),
      leadId,
      phoneNumber: item.phoneNumber,
      direction: item.direction,
      status: item.status,
      startedAt: new Date(item.startedAt),
      endedAt: item.endedAt ? new Date(item.endedAt) : null,
      durationSec: item.durationSec,
      triggerCallId: item.triggerCallId ? BigInt(item.triggerCallId) : null,
      // Trust the mobile-side `source` when provided so we can tell an in-app
      // dialer call apart from a system-dialer call. Fallback to the legacy
      // heuristic for older clients.
      triggeredFrom: (() => {
        if (item.campaignContactId) return 'AUTO_DIALER'
        if (item.triggerCallId) return 'CRM_WEB'
        if (item.source === 'AUTO_DIALER') return 'AUTO_DIALER'
        if (item.source === 'IN_APP') return 'APP_DIALER'
        if (item.source === 'SYSTEM_DIALER') return 'SYSTEM_DIALER'
        if (item.source === 'INCOMING') return 'INCOMING'
        if (item.source === 'CRM_WEB') return 'CRM_WEB'
        return item.direction === 'INCOMING' ? 'INCOMING' : 'APP_DIALER'
      })(),
      notes: item.notes,
      simSlot: item.simSlot ?? null,
      simCarrier: item.simCarrier ?? null,
      simNumber: item.simNumber ?? null,
      campaignContactId: item.campaignContactId ? BigInt(item.campaignContactId) : null,
      recordingPlayedId: item.recordingPlayedId ? BigInt(item.recordingPlayedId) : null,
      recordingExpiresAt: expiresAt,
    }

    // If this call already exists (re-sync), update it
    const existingByDeviceId = await prisma.mobileCall.findUnique({
      where: { deviceCallId: item.deviceCallId },
      select: { id: true, userId: true, status: true, durationSec: true, recordingPath: true, startedAt: true, phoneNumber: true, leadId: true },
    })

    // Lead score bookkeeping: award +1 the first time a MobileCall for this
    // lead transitions to ANSWERED. Snapshot the prior state now so we can
    // decide whether to increment after the upsert lands.
    const wasAlreadyAnswered = existingByDeviceId?.status === 'ANSWERED'

    // Legacy `clog_<N>` deviceCallIds (from client versions before the userId
    // + content-hash scoping) are inherently unsafe: Android recycles
    // CallLog._ID when the user clears their call history, so the same id
    // legitimately refers to different physical calls at different times.
    // If the incoming item's startedAt is more than an hour off from the
    // existing row's, OR the phone number differs, this is definitely a
    // recycled id, NOT a re-sync — treat it like a new insert.
    const isLegacyClog = /^clog_[0-9]+$/.test(item.deviceCallId)
    const looksRecycled =
      !!existingByDeviceId && isLegacyClog && (
        Math.abs(existingByDeviceId.startedAt.getTime() - new Date(item.startedAt).getTime()) > 3600_000 ||
        existingByDeviceId.phoneNumber.replace(/\D/g, '').slice(-10) !==
          item.phoneNumber.replace(/\D/g, '').slice(-10)
      )

    let row
    if (existingByDeviceId && !looksRecycled && existingByDeviceId.userId === BigInt(userId)) {
      // Guard against a stale re-sync from the client flipping an ANSWERED row
      // back to NO_ANSWER/dur=0. A connected call cannot later become a
      // zero-second non-answer — the incoming status is stale (the client
      // re-finalized against a mutated CallLog row). Keep the answered state so
      // admins don't see "NO_ANSWER + playable recording" phantoms.
      //
      // This used to also require `recordingPath !== null`, i.e. it only
      // protected rows whose recording had ALREADY been uploaded. But the
      // recording lands SECONDS AFTER the sync (the recorder file has to be
      // flushed and located on disk first), so the exact window this guard
      // exists to cover — stale re-sync arrives, recording arrives next — was
      // the one window it did not cover. The row got downgraded, and the
      // upload that followed was then rejected 409 by the "non-answered call"
      // check in POST /:id/recording and the audio deleted. That was the
      // source of our 409s, and every one of them lost a real recording.
      // Physical evidence (a prior nonzero duration) is enough on its own.
      const wouldDowngradeAnswered =
        existingByDeviceId.status === 'ANSWERED' &&
        existingByDeviceId.durationSec > 0 &&
        (item.status !== 'ANSWERED' || item.durationSec === 0)
      const safeData = wouldDowngradeAnswered
        ? { ...data, status: existingByDeviceId.status, durationSec: existingByDeviceId.durationSec }
        : { ...data }
      // Attribution is decided ONCE, on the row's first write, and then frozen.
      // Calls re-sync repeatedly (recording attach, status reconcile), and
      // re-running the phone matcher each time meant a call could silently hop
      // to a different lead later — the same number resolving differently as
      // leads were added, reassigned or trashed. Only ever fill a blank.
      if (existingByDeviceId.leadId !== null) {
        safeData.leadId = existingByDeviceId.leadId
      }
      row = await prisma.mobileCall.update({ where: { id: existingByDeviceId.id }, data: safeData })
    } else if (existingByDeviceId && !looksRecycled) {
      // deviceCallId collided with a row owned by a DIFFERENT counsellor (e.g. two
      // devices independently generated the same client-side id). Never overwrite
      // another counsellor's row — that's how a recording ends up attributed to
      // the wrong person. Re-key this item under a per-user-scoped id instead.
      const scopedId = `${item.deviceCallId}_u${userId}`
      const existingScoped = await prisma.mobileCall.findUnique({
        where: { deviceCallId: scopedId },
        select: { id: true },
      })
      if (existingScoped) {
        row = await prisma.mobileCall.update({ where: { id: existingScoped.id }, data })
      } else {
        row = await prisma.mobileCall.create({ data: { deviceCallId: scopedId, ...data } })
      }
    } else {
      // Try to merge into the matching TRIGGERED row created by CRM "Push to phone"
      // — first by explicit triggerCallId, else by recent same-user+phone TRIGGERED row.
      const last10 = item.phoneNumber.replace(/\D/g, '').slice(-10)
      const triggerRow = item.triggerCallId
        ? await prisma.mobileCall.findFirst({
            where: { id: BigInt(item.triggerCallId), userId: BigInt(userId), status: 'TRIGGERED' },
            select: { id: true },
          })
        : await prisma.mobileCall.findFirst({
            where: {
              userId: BigInt(userId),
              status: 'TRIGGERED',
              phoneNumber: { endsWith: last10 },
              createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })

      // If we fell here because the legacy id is being recycled, we cannot
      // insert with the raw legacy id (would UNIQUE-collide with the old row
      // we chose not to mutate). Scope it with the actual physical-call
      // signature so the new row gets its own PK and the old row stays
      // untouched.
      const insertDeviceCallId = looksRecycled
        ? `${item.deviceCallId}_${new Date(item.startedAt).getTime()}_${item.durationSec}`
        : item.deviceCallId

      if (triggerRow) {
        row = await prisma.mobileCall.update({
          where: { id: triggerRow.id },
          data: { ...data, deviceCallId: insertDeviceCallId },
        })
      } else {
        row = await prisma.mobileCall.create({ data: { deviceCallId: insertDeviceCallId, ...data } })
      }
    }

    // Auto-dialer reconciliation: if this call is linked to a campaign contact,
    // map MobileCall.status to CampaignContact.status and stamp mobileCallId.
    if (item.campaignContactId) {
      const ccId = BigInt(item.campaignContactId)
      const cc = await prisma.autoDialerCampaignContact.findUnique({ where: { id: ccId } })
      if (cc && cc.assignedToUserId === BigInt(userId)) {
        const mapped =
          item.status === 'ANSWERED' ? 'connected'
          : item.status === 'MISSED' || item.status === 'NO_ANSWER' ? 'no_answer'
          : item.status === 'BUSY' ? 'busy'
          : item.status === 'REJECTED' ? 'declined'
          : item.status === 'FAILED' ? 'failed'
          : cc.status // keep current for RINGING etc.
        await prisma.autoDialerCampaignContact.update({
          where: { id: ccId },
          data: { status: mapped, mobileCallId: row.id, lastAttemptAt: new Date() },
        })
      }
    }

    // Lead score: +1 per picked-up call. Only awards on the first transition
    // to ANSWERED — re-syncs of an already-answered row don't stack, and
    // downgrade guards (wouldDowngradeAnswered above) can't accidentally
    // credit twice because we key off the pre-update status.
    if (leadId && item.status === 'ANSWERED' && !wasAlreadyAnswered) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { leadScore: { increment: 1 } },
      })
    }

    results.push({ deviceCallId: item.deviceCallId, id: Number(row.id) })
  }

  return c.json({ synced: results.length, results })
})

// ─── App → backend: upload recording for a call ──────────────────────────────
callsRoutes.post('/:id/recording', authenticateMobile, uploadRecording('recording'), async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  const uploadErr = c.get('uploadError' as never) as { code?: string; message: string } | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as { incoming: unknown }).incoming as any).file as Express.Multer.File | undefined

  if (uploadErr) {
    // Surface the precise multer reason (unexpected field / too large / etc.)
    // instead of a generic 500 or a misleading "No file uploaded".
    return c.json({ error: `Upload failed: ${uploadErr.message}`, code: uploadErr.code }, 400)
  }
  if (!file) {
    // Either no part was sent, or fileFilter rejected the mimetype (logged above).
    console.warn(`[recording] no accepted file for call ${id} from user ${userId}`)
    return c.json({ error: 'No accepted file uploaded (check audio format)' }, 400)
  }

  const call = await prisma.mobileCall.findUnique({ where: { id } })
  if (!call || call.userId !== BigInt(userId)) {
    fs.unlink(file.path, () => undefined)
    console.warn(
      `[recording] call ${id} not found or not owned by user ${userId}` +
        (call ? ` (owner=${call.userId})` : ' (no such row)'),
    )
    return c.json({ error: 'Call not found' }, 404)
  }
  // A call that never connected physically has no audio to record, and storing
  // one would put a Play button on a NO_ANSWER row in the admin UI — the
  // phantom this check exists to prevent.
  //
  // "Never connected" means BOTH a non-answered status AND a zero duration.
  // The old test was `durationSec === 0 || status !== 'ANSWERED'`, which also
  // rejected two cases that DID connect:
  //   - a nonzero-duration row a stale re-sync had relabelled NO_ANSWER, and
  //   - an ANSWERED call under a second, whose duration rounds down to 0.
  // Both threw away a real recording. A nonzero duration is physical proof the
  // call connected, so it is enough on its own.
  if (call.durationSec === 0 && call.status !== 'ANSWERED') {
    fs.unlink(file.path, () => undefined)
    console.warn(
      `[recording] rejected for call ${id}: status=${call.status} durationSec=${call.durationSec}`,
    )
    return c.json({ error: 'Recording not accepted for non-answered call' }, 409)
  }

  const relPath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
  await prisma.mobileCall.update({
    where: { id },
    data: {
      recordingPath: relPath,
      recordingSize: file.size,
      // Repair a row a stale re-sync mislabelled. We only get here with a
      // nonzero duration, so the call demonstrably connected; leaving the row
      // NO_ANSWER while attaching audio to it is exactly the phantom above.
      ...(call.status !== 'ANSWERED' ? { status: 'ANSWERED' } : {}),
    },
  })
  if (call.status !== 'ANSWERED') {
    console.warn(
      `[recording] repaired call ${id}: ${call.status} → ANSWERED (durationSec=${call.durationSec})`,
    )
  }

  return c.json({ success: true, path: relPath, size: file.size })
})

// Build the standard MobileCall filter from query params so /list and /summary
// stay in lockstep — same where = same numbers.
function parseDate(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

// Apply the call's user-id scope.
//  - allowedIds === null → full admin: optionally narrow to one `userId` param.
//  - allowedIds is an array → restrict to those users; a branch manager may
//    still narrow to one of their own counsellors via the `userId` param.
//    An empty array means "see nothing".
function applyUserScope(
  where: Prisma.MobileCallWhereInput,
  allowedIds: bigint[] | null,
  userIdParam?: string,
): void {
  if (allowedIds === null) {
    if (userIdParam) where.userId = BigInt(userIdParam)
    return
  }
  const requested = userIdParam ? BigInt(userIdParam) : null
  where.userId = requested && allowedIds.includes(requested) ? requested : { in: allowedIds }
}

async function buildCallsWhere(
  c: Context,
  allowedIds: bigint[] | null,
): Promise<Prisma.MobileCallWhereInput> {
  const userId = c.req.query('userId')
  const leadId = c.req.query('leadId')
  const status = c.req.query('status')
  const direction = c.req.query('direction')
  const source = c.req.query('source')
  const departmentId = c.req.query('departmentId')
  const leadStatus = c.req.query('leadStatus')
  const q = (c.req.query('q') || '').trim()
  const fromDate = c.req.query('fromDate')
  const toDate = c.req.query('toDate')

  const where: Prisma.MobileCallWhereInput = {}
  const and: Prisma.MobileCallWhereInput[] = []
  applyUserScope(where, allowedIds, userId)
  if (leadId) {
    // A person often exists in the CRM more than once (re-import, second web
    // enquiry). Calls land on whichever duplicate row was open at the time, so
    // filtering on leadId alone hides real calls from this lead's timeline.
    //
    // The number alone is not enough to claim a call though: duplicates are
    // frequently owned by DIFFERENT counsellors, and pulling in every call to
    // the number would show another counsellor's work on this lead. So a
    // same-number call only counts when the caller is one of this lead's own
    // assigned counsellors. Calls stamped with this exact leadId always count.
    const lead = await prisma.lead.findUnique({
      where: { id: BigInt(leadId) },
      select: {
        mobile: true, mobile2: true, mobile3: true,
        assignedTo: { where: { status: 1 }, select: { clrId: true } },
      },
    })
    const keys = phoneKeysOf(lead?.mobile, lead?.mobile2, lead?.mobile3)
    const owners = (lead?.assignedTo || []).map((row) => row.clrId)
    if (keys.length && owners.length) {
      and.push({
        OR: [
          { leadId: BigInt(leadId) },
          { AND: [{ OR: callPhoneOr(keys) }, { userId: { in: owners } }] },
        ],
      })
    } else {
      where.leadId = BigInt(leadId)
    }
  }

  // Filter calls by lead's department or status
  const leadWhere: Prisma.LeadWhereInput = {}
  if (departmentId) {
    leadWhere.departmentId = BigInt(departmentId)
  }
  if (leadStatus) {
    leadWhere.leadStatus = { equals: leadStatus.trim(), mode: 'insensitive' }
  }
  if (Object.keys(leadWhere).length > 0) {
    where.lead = { is: leadWhere }
  }
  
  if (status) {
    where.status = status.trim().toUpperCase() as Prisma.MobileCallWhereInput['status']
  } else {
    where.status = { not: 'TRIGGERED' }
  }

  if (direction === 'OUTGOING' || direction === 'INCOMING') where.direction = direction
  if (source) where.triggeredFrom = source
  
  if (fromDate || toDate) {
    const from = fromDate ? parseDate(fromDate) : null
    const to = toDate ? parseDate(toDate) : null
    if (from || to) {
      where.startedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: new Date(to.getTime() + 86399999) } : {}), // 23:59:59.999
      }
    }
  }
  if (q) {
    const digits = q.replace(/\D/g, '')
    const or: Prisma.MobileCallWhereInput[] = []
    if (digits.length >= 3) or.push({ phoneNumber: { contains: digits } })
    or.push({ lead: { name: { contains: q, mode: 'insensitive' } } })
    or.push({ user: { name: { contains: q, mode: 'insensitive' } } })
    where.OR = or
  }
  if (and.length) where.AND = and
  return where
}

// ─── Admin: list calls ──────────────────────────────────────────────────────
// Physical-call collapse: the mobile app ships the SAME physical call under
// multiple deviceCallIds — the in-app-dialer pre-log, PhoneStateReceiver's
// live capture, and CallLogBackfiller's after-the-fact scan each generate
// their own. That's why the timeline used to show 2–4 rows per call.
//
// We DO NOT mutate the DB (recordings, remarks, and audit history stay on
// their original rows). Instead we collapse at display time: rows with the
// same physical fingerprint — (user, direction, last-10 phone digits,
// started_at ±5s, matching duration) — become ONE visible row, preferring
// the one that carries a recording. Toggle off with ?collapse=0.
function callFingerprint(r: { userId: bigint | null; direction: string; phoneNumber: string; startedAt: Date; durationSec: number }): string {
  const tail = r.phoneNumber.replace(/\D/g, '').slice(-10)
  const bucket = Math.floor(r.startedAt.getTime() / 5_000) // 5s bucket
  return `${r.userId ?? 'null'}|${r.direction}|${tail}|${bucket}|${r.durationSec}`
}

const TRIGGERED_FROM_PRIORITY: Record<string, number> = {
  AUTO_DIALER: 5, CRM_WEB: 4, APP_DIALER: 3, INCOMING: 2, SYSTEM_DIALER: 1,
}

// Given rows sorted by startedAt DESC, keep only one row per fingerprint —
// the "best" one. Best = has a recording > answered with duration > higher
// triggeredFrom priority > earliest created (usually the pre-log with the
// lead attribution).
function collapseByFingerprint<T extends {
  id: bigint; userId: bigint | null; direction: string; phoneNumber: string;
  startedAt: Date; durationSec: number; status: string; recordingPath: string | null;
  triggeredFrom: string | null; createdAt: Date;
}>(rows: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const k = callFingerprint(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
    // Also register the adjacent bucket so a pair straddling the 5s boundary
    // still collapses. We de-dupe by row id when reading back.
    const alt = k.replace(/\|(\d+)\|(\d+)$/, (_m, b, d) => `|${Number(b) - 1}|${d}`)
    if (!groups.has(alt)) groups.set(alt, [])
    groups.get(alt)!.push(r)
  }
  const chosenIds = new Set<bigint>()
  const winners: T[] = []
  for (const r of rows) {
    if (chosenIds.has(r.id)) continue
    const k = callFingerprint(r)
    const candidates = groups.get(k) ?? [r]
    // Only consider members that aren't already picked as a winner elsewhere.
    const pool = candidates.filter(x => !chosenIds.has(x.id))
    if (pool.length === 0) continue
    const best = pool.reduce((a, b) => {
      const score = (x: T) =>
        (x.recordingPath ? 1000 : 0) +
        (x.status === 'ANSWERED' && x.durationSec > 0 ? 100 : 0) +
        (TRIGGERED_FROM_PRIORITY[x.triggeredFrom ?? ''] ?? 0) * 10 +
        -x.createdAt.getTime() / 1e12
      return score(b) > score(a) ? b : a
    })
    for (const p of pool) chosenIds.add(p.id)
    winners.push(best)
  }
  return winners
}

// Shared by /summary and /stats so their totals match what /calls (the list
// view) shows. Both used to run raw groupBy/aggregate straight over
// mobile_calls, which double-counted the same physical call whenever the
// app logged it under more than one deviceCallId (in-app-dialer pre-log +
// PhoneStateReceiver live capture + CallLogBackfiller re-scan, or a
// reinstall re-sync that raced a format change) — that's why the dashboard
// tiles showed ~2x what the collapsed list/app UI showed for the same rows.
type CollapsedCallRow = {
  id: bigint; userId: bigint | null; direction: string; phoneNumber: string;
  startedAt: Date; durationSec: number; status: string; recordingPath: string | null;
  triggeredFrom: string | null; createdAt: Date; leadId: bigint | null;
}
async function fetchCollapsedCalls(where: Prisma.MobileCallWhereInput): Promise<CollapsedCallRow[]> {
  const rows = await prisma.mobileCall.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    select: {
      id: true, userId: true, direction: true, phoneNumber: true,
      startedAt: true, durationSec: true, status: true,
      recordingPath: true, triggeredFrom: true, createdAt: true,
      leadId: true,
    },
  })
  return collapseByFingerprint(rows)
}

callsRoutes.get('/', authenticate, async (c) => {
  const requester = c.get('user')
  const page = Math.max(1, Number(c.req.query('page') || 1))
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || 100)))
  const collapse = (c.req.query('collapse') ?? '1') !== '0'
  const allowedIds = await callsScopeUserIds(requester)
  const where = await buildCallsWhere(c, allowedIds)

  const depts = await prisma.leadDepartment.findMany({ select: { id: true, name: true } })
  const deptMap = new Map(depts.map((d) => [Number(d.id), d.name]))

  const leadSelect = { select: { id: true, name: true, mobile: true, leadStatus: true, leadSubStatus: true, departmentId: true } }

  const mapLeadRow = (r: any) => {
    const isAdmin = isFullAdmin(requester.role)
    const phone = isAdmin ? r.phoneNumber : maskCallPhone(r.phoneNumber)
    const leadMobile = isAdmin ? r.lead?.mobile ?? null : maskCallPhone(r.lead?.mobile)
    const departmentName = r.lead?.departmentId != null ? (deptMap.get(Number(r.lead.departmentId)) || null) : null

    return {
      ...r,
      phoneNumber: phone,
      lead: r.lead
        ? {
            ...r.lead,
            mobile: leadMobile,
            departmentName,
          }
        : null,
    }
  }

  if (!collapse) {
    // Legacy raw-list path — kept behind ?collapse=0 for debugging.
    const [data, total] = await Promise.all([
      prisma.mobileCall.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true } },
          lead: leadSelect,
          remarks: {
            orderBy: { createdAt: 'desc' },
            include: {
              createdBy: { select: { id: true, name: true, role: true } },
            },
          },
        },
      }),
      prisma.mobileCall.count({ where }),
    ])
    const rows = data.map(mapLeadRow)
    return c.json(bigintFix({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) }))
  }

  // Collapsed path — fetch the minimal fingerprint columns for the WHOLE
  // filter (bounded by the date filter the UI always sends), pick winners,
  // then hydrate only the page's winners with joins. This keeps `total`
  // accurate for pagination.
  const fingerprintRows = await prisma.mobileCall.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    select: {
      id: true, userId: true, direction: true, phoneNumber: true,
      startedAt: true, durationSec: true, status: true,
      recordingPath: true, triggeredFrom: true, createdAt: true,
    },
  })
  const winners = collapseByFingerprint(fingerprintRows)
  const total = winners.length
  const pageWinners = winners.slice((page - 1) * limit, (page - 1) * limit + limit)
  const pageIds = pageWinners.map(w => w.id)

  const hydrated = pageIds.length === 0 ? [] : await prisma.mobileCall.findMany({
    where: { id: { in: pageIds } },
    include: {
      user: { select: { id: true, name: true } },
      lead: leadSelect,
      remarks: {
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true, role: true } } },
      },
    },
  })
  // Preserve the winners' order (Prisma returns unordered from `IN`).
  const byId = new Map(hydrated.map(r => [r.id.toString(), r]))
  const data = pageIds.map(id => byId.get(id.toString())).filter((x): x is NonNullable<typeof x> => !!x)

  const rows = data.map(mapLeadRow)

  return c.json(bigintFix({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) }))
})

// ─── Summary for the current filter (totals across ALL matching rows, not just the visible page) ──
callsRoutes.get('/summary', authenticate, async (c) => {
  const requester = c.get('user')
  const allowedIds = await callsScopeUserIds(requester)
  // Branch managers + full admins get the per-counsellor breakdown.
  const showBreakdown = isFullAdmin(requester.role) || isCallsManager(requester.role)
  const where = await buildCallsWhere(c, allowedIds)

  // Totals across the filter — collapsed to one row per physical call, same
  // as the /calls list, so this tile can't disagree with what admins see there.
  const collapsedRows = await fetchCollapsedCalls(where)
  let total = 0
  let answered = 0
  let missed = 0
  let noAnswer = 0
  let rejected = 0
  let busy = 0
  let failed = 0
  let totalSec = 0
  let answeredSec = 0
  for (const r of collapsedRows) {
    // MISSED = incoming the user didn't pick up — not a call they "made".
    // Keep it out of total/totalSec; it surfaces only in the dedicated `missed` tile.
    if (r.status !== 'MISSED') {
      total += 1
      totalSec += r.durationSec ?? 0
    }
    if (r.status === 'ANSWERED') {
      answered += 1
      answeredSec += r.durationSec ?? 0
    }
    if (r.status === 'MISSED') missed += 1
    if (r.status === 'NO_ANSWER') noAnswer += 1
    if (r.status === 'REJECTED') rejected += 1
    if (r.status === 'BUSY') busy += 1
    if (r.status === 'FAILED') failed += 1
  }

  // "Today" — independent of the date filter, but respects userId / counsellor scope
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const todayWhere: Prisma.MobileCallWhereInput = {
    startedAt: { gte: startOfToday },
    status: { not: 'TRIGGERED' },
  }
  const userIdParam = c.req.query('userId')
  applyUserScope(todayWhere, allowedIds, userIdParam)

  // Exclude MISSED (incoming not picked up) from today's count — counsellors
  // only want their own outgoing/answered activity in this tile.
  const todayCollapsed = await fetchCollapsedCalls({ ...todayWhere, status: { notIn: ['TRIGGERED', 'MISSED'] } })
  const todayCount = todayCollapsed.length
  const todaySec = todayCollapsed.reduce((sum, r) => sum + (r.durationSec ?? 0), 0)
  const todayAnswered = todayCollapsed.filter(r => r.status === 'ANSWERED').length

  // Per-counsellor breakdown (admins + branch managers). `where` is already
  // branch-scoped, so a manager's breakdown only covers their own branches.
  // Reuses `collapsedRows` so the sum of this breakdown always matches `total` above.
  let perUser: { userId: number; name: string; count: number; answered: number; talkSec: number }[] = []
  if (showBreakdown) {
    const byUser = new Map<string, { count: number; answered: number; talkSec: number }>()
    const userIds = new Set<bigint>()
    for (const r of collapsedRows) {
      if (r.userId == null) continue
      userIds.add(r.userId)
      const k = String(r.userId)
      const acc = byUser.get(k) ?? { count: 0, answered: 0, talkSec: 0 }
      // MISSED (incoming not picked up) isn't a call the counsellor made — leave it out of `count`.
      if (r.status !== 'MISSED') acc.count += 1
      acc.talkSec += r.durationSec ?? 0
      if (r.status === 'ANSWERED') acc.answered += 1
      byUser.set(k, acc)
    }
    const targetRoles = ['counsellor', 'employee', 'franchise', 'agent']
    const users = await prisma.user.findMany({
      where: {
        id: { in: Array.from(userIds) },
        ...(isFullAdmin(requester.role) ? {} : {
          OR: [
            { role: { in: targetRoles } },
            { roles: { some: { role: { in: targetRoles } } } },
          ],
        }),
      },
      select: { id: true, name: true },
    })
    const nameById = new Map(users.map((u) => [String(u.id), u.name]))
    perUser = Array.from(byUser.entries())
      .filter(([uid]) => nameById.has(uid))
      .map(([uid, v]) => ({ userId: Number(uid), name: nameById.get(uid)!, ...v }))
      .sort((a, b) => b.talkSec - a.talkSec)
  }

  // Hourly Calls Analytics (24 hours) — also derived from `collapsedRows`.
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: 0,
    answered: 0,
    talkSec: 0
  }))

  for (const call of collapsedRows) {
    if (call.status === 'MISSED' || call.status === 'TRIGGERED') continue;
    const istTime = new Date(call.startedAt.getTime() + 5.5 * 60 * 60 * 1000)
    const h = istTime.getUTCHours()
    if (h >= 0 && h < 24) {
      hourly[h].count++
      if (call.status === 'ANSWERED') {
        hourly[h].answered++
        hourly[h].talkSec += call.durationSec ?? 0
      }
    }
  }

  // Calculate source & department breakdowns for the active filter
  const leadIds = Array.from(new Set(collapsedRows.map(r => r.leadId).filter((id): id is bigint => id != null)))
  const leads = leadIds.length === 0 ? [] : await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, website: true, source: true, event: true, departmentId: true },
  })
  const leadMap = new Map(leads.map(l => [l.id.toString(), l]))

  const depts = await prisma.leadDepartment.findMany({ select: { id: true, name: true } })
  const deptMap = new Map(depts.map(d => [Number(d.id), d.name]))

  const sourceMap = new Map<string, { source: string; callsTotal: number; callsAnswered: number; callsMissed: number; talkTimeSec: number }>()
  const deptAggMap = new Map<string, { departmentName: string; callsTotal: number; callsAnswered: number; callsMissed: number; talkTimeSec: number }>()

  for (const r of collapsedRows) {
    const lead = r.leadId != null ? leadMap.get(r.leadId.toString()) : null

    // Source determination
    let src = 'Unlinked / Direct'
    if (lead) {
      if (lead.website && lead.website.trim() && lead.website.toLowerCase() !== 'other') {
        src = lead.website.trim()
      } else if (lead.source && lead.source.trim()) {
        src = lead.source.trim()
      } else if (lead.event && lead.event.trim()) {
        src = lead.event.trim()
      } else {
        src = 'Other'
      }
    }

    // Department determination
    let deptName = 'Unassigned / Direct'
    if (lead && lead.departmentId != null) {
      deptName = deptMap.get(Number(lead.departmentId)) || 'Unassigned / Direct'
    }

    // Aggregate into sourceMap
    if (!sourceMap.has(src)) {
      sourceMap.set(src, { source: src, callsTotal: 0, callsAnswered: 0, callsMissed: 0, talkTimeSec: 0 })
    }
    const sEntry = sourceMap.get(src)!
    if (r.status !== 'MISSED') sEntry.callsTotal += 1
    if (r.status === 'ANSWERED') {
      sEntry.callsAnswered += 1
      sEntry.talkTimeSec += r.durationSec ?? 0
    } else if (['NO_ANSWER', 'REJECTED', 'BUSY', 'FAILED'].includes(r.status)) {
      sEntry.callsMissed += 1
    }

    // Aggregate into deptAggMap
    if (!deptAggMap.has(deptName)) {
      deptAggMap.set(deptName, { departmentName: deptName, callsTotal: 0, callsAnswered: 0, callsMissed: 0, talkTimeSec: 0 })
    }
    const dEntry = deptAggMap.get(deptName)!
    if (r.status !== 'MISSED') dEntry.callsTotal += 1
    if (r.status === 'ANSWERED') {
      dEntry.callsAnswered += 1
      dEntry.talkTimeSec += r.durationSec ?? 0
    } else if (['NO_ANSWER', 'REJECTED', 'BUSY', 'FAILED'].includes(r.status)) {
      dEntry.callsMissed += 1
    }
  }

  const bySource = Array.from(sourceMap.values()).sort((a, b) => b.callsTotal - a.callsTotal || b.callsAnswered - a.callsAnswered)
  const byDepartment = Array.from(deptAggMap.values()).sort((a, b) => b.callsTotal - a.callsTotal || b.callsAnswered - a.callsAnswered)

  return c.json(bigintFix({
    filter: { total, answered, missed, noAnswer, rejected, busy, failed, totalSec, answeredSec },
    today: {
      count: todayCount,
      answered: todayAnswered,
      talkSec: todaySec,
    },
    perUser,
    hourly,
    bySource,
    byDepartment,
  }))
})

// ─── Admin: stats ────────────────────────────────────────────────────────────
callsRoutes.get('/stats', authenticate, async (c) => {
  const requester = c.get('user')
  const allowedIds = await callsScopeUserIds(requester)
  const userId = c.req.query('userId')

  const fromQuery = c.req.query('fromDate')
  const toQuery = c.req.query('toDate')

  const parsedFrom = fromQuery ? parseDate(fromQuery) : null
  const parsedTo = toQuery ? parseDate(toQuery) : null

  const fromDate = parsedFrom || (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })()

  const toDate = parsedTo
    ? new Date(parsedTo.getTime() + 86399999)
    : new Date()

  const where: Prisma.MobileCallWhereInput = {
    startedAt: { gte: fromDate, lte: toDate },
    // Exclude TRIGGERED placeholders so stats count only real calls.
    status: { not: 'TRIGGERED' },
  }
  applyUserScope(where, allowedIds, userId)

  // Collapsed to one row per physical call — see fetchCollapsedCalls — so
  // this can't disagree with /calls or /summary for the same filter.
  const collapsed = await fetchCollapsedCalls(where)
  const byKey = new Map<string, { userId: bigint | null; status: string; count: number; durationSec: number }>()
  for (const r of collapsed) {
    const k = `${r.userId}|${r.status}`
    const acc = byKey.get(k) ?? { userId: r.userId, status: r.status, count: 0, durationSec: 0 }
    acc.count += 1
    acc.durationSec += r.durationSec ?? 0
    byKey.set(k, acc)
  }

  return c.json(bigintFix(Array.from(byKey.values()).map((g) => ({
    userId: Number(g.userId),
    status: g.status,
    count: g.count,
    durationSec: g.durationSec,
  }))))
})

// ─── Stream recording (admin or owner) ──────────────────────────────────────
callsRoutes.get('/:id/recording', authenticateAny, async (c) => {
  const requester = c.get('user')
  const id = BigInt(c.req.param('id'))
  const call = await prisma.mobileCall.findUnique({ where: { id } })
  if (!call || !call.recordingPath) return c.json({ error: 'Not found' }, 404)

  // Recordings are for admins + branch managers (team oversight). Counsellors
  // don't get to play back their own calls — privacy + compliance policy.
  if (!isFullAdmin(requester.role) && !isCallsManager(requester.role)) {
    return c.json({ error: 'Admin only' }, 403)
  }
  // A branch manager may only play recordings of calls made by users in their
  // assigned branches.
  if (isCallsManager(requester.role)) {
    const allowedIds = await callsScopeUserIds(requester)
    const ok = allowedIds !== null && call.userId !== null && allowedIds.includes(call.userId)
    if (!ok) return c.json({ error: 'Forbidden' }, 403)
  }

  const abs = path.join(process.cwd(), call.recordingPath)
  if (!fs.existsSync(abs)) {
    // Self-heal: drop the dangling path so the row stops reporting a recording
    // it can never serve. Next fetch returns 404 ("No recording") instead of
    // 410 ("Recording expired") in perpetuity. Common triggers: redeploy that
    // didn't preserve uploads/, PM2 restart under a different cwd, or the
    // retention job removing the file without touching the row.
    await prisma.mobileCall.update({
      where: { id },
      data: { recordingPath: null, recordingSize: null },
    })
    return c.json({ error: 'File missing' }, 410)
  }

  const stat = fs.statSync(abs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = fs.createReadStream(abs) as any
  return new Response(stream, {
    headers: {
      'Content-Type': 'audio/mp4',
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  })
})
