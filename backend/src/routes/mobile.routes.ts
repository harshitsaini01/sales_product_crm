import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { compare } from 'bcryptjs'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticateMobile, signMobileToken } from '../middleware/mobile-auth'
import { tenantFromLoginBody } from '../middleware/tenant'
import { currentTenant } from '../lib/tenant-context'
import { rateLimit, loginSubject } from '../middleware/rate-limit'
import { recordStatusChange } from '../services/leads/status-history.service'
import * as followupService from '../services/leads/lead-followup.service'
import {
  getStatus as getInactivityStatus,
  ackPendingEvents,
  pingActivity,
  setPhoneState,
} from '../services/inactivity.service'
import { REAL_FOLLOWUP_MIN } from '../utils/date-range'
import {
  hydrateBatch, hydrateBatches, withDayNumbers, dayLabel,
  markTaskItemDone, undoTaskItemDone, MANUAL_REASON_KEYS,
} from './lead-work.routes'
import { negateLeadClause } from '../utils/lead-filter'
import {
  loadLeadDetailBundle, loadFlagUsers,
  shapeNotes, shapeComments, shapeHistory, shapeFlags, buildTimeline,
} from '../services/leads/mobile-lead-detail.service'

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

export const mobileRoutes = new Hono()

// Per-IP, per-path ceiling on every mobile endpoint (scraping / runaway client).
// Generous on purpose: a whole office shares one public IP.
mobileRoutes.use('*', rateLimit({ windowMs: 60_000, max: 120 }))
// Brute-force defence on login, keyed on the ACCOUNT being tried rather than the
// caller's IP — see loginSubject(). Ten guesses a minute against one account is
// nowhere near enough to brute-force a password, and colleagues behind the same
// NAT no longer consume each other's budget. The wildcard above still caps total
// login traffic from any single address.
mobileRoutes.use('/login', rateLimit({ windowMs: 60_000, max: 10, subject: loginSubject('loginid') }))

const loginSchema = z.object({
  loginid: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().min(1),
  fcmToken: z.string().optional(),
  appVersion: z.string().optional(),
})

// The app's login carries no token, so nothing upstream has resolved which
// customer it belongs to. This does it from the loginid in the body — see
// middleware/tenant.ts. Everything below then runs against that schema.
mobileRoutes.use('/login', tenantFromLoginBody('loginid'))

// POST /api/mobile/login
mobileRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { loginid, password, deviceId, fcmToken, appVersion } = c.req.valid('json')
  const trimmed = loginid.trim()

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { loginid: trimmed },
        { email: { equals: trimmed, mode: 'insensitive' } },
        { username: trimmed },
        { mobile: trimmed },
      ],
      status: 1,
    },
    include: { roles: true },
  })
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  // Mobile is for counsellors + sales-heads (admins use web only). A sales-head
  // logs in and behaves exactly like a counsellor here — mobile data is always
  // self-scoped, so they only ever see their own leads/calls. Their team-wide
  // call tracking lives on the web Calls page, not the app.
  const roles = user.roles.map((r) => r.role)
  const isAllowed =
    user.role === 'counsellor' || roles.includes('counsellor') ||
    user.role === 'sales-head' || roles.includes('sales-head')
  if (!isAllowed) return c.json({ error: 'Mobile access is restricted to counsellors' }, 403)

  const valid = await compare(password, user.password)
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401)

  // Single-session enforcement: any previously-installed app for this user
  // gets kicked out on the next API call (sid mismatch → 401 + reason).
  const sid = randomUUID()
  await prisma.user.update({
    where: { id: user.id },
    data: { activeMobileSessionId: sid },
  })

  const ctx = currentTenant()
  const token = signMobileToken({
    userId: Number(user.id),
    role: user.role as 'counsellor',
    roles: roles as ('counsellor')[],
    name: user.name,
    email: user.email,
    sid,
    kind: 'mobile',
    tenantId: ctx?.tenantId,
    tenantSlug: ctx?.slug,
  })

  if (fcmToken) {
    await prisma.deviceToken.upsert({
      where: { fcmToken },
      create: { userId: user.id, fcmToken, deviceId, appVersion, platform: 'android' },
      update: { userId: user.id, deviceId, appVersion, lastSeenAt: new Date() },
    })
  }

  // Log login — same login_details table the web login writes to, so the
  // admin's Login Logs view shows both web and app sign-ins in one list.
  await prisma.loginDetail.create({
    data: {
      userId: user.id,
      ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '',
      browser: 'Android App',
      os: appVersion ? `v${appVersion}` : null,
    },
  })

  return c.json(bigintFix({
    token,
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      showFullPhone: Boolean(user.showFullPhone),
      showBucket: user.showBucket,
      locationTrackingEnabled: user.locationTrackingEnabled,
      locationRequired: user.locationRequired,
    },
  }))
})

// All routes below require valid mobile JWT
mobileRoutes.use('/fcm-token', authenticateMobile)
mobileRoutes.use('/logout', authenticateMobile)
mobileRoutes.use('/leads/*', authenticateMobile)
mobileRoutes.use('/lead-work/*', authenticateMobile)
mobileRoutes.use('/followups/*', authenticateMobile)
mobileRoutes.use('/me', authenticateMobile)
mobileRoutes.use('/lead-config', authenticateMobile)
mobileRoutes.use('/activity/*', authenticateMobile)
mobileRoutes.use('/location', authenticateMobile)
mobileRoutes.use('/device-status', authenticateMobile)

// GET /api/mobile/activity/status — same shape as the web tracker so the
// Android app can render the warning / alert / halfday UI off one struct.
mobileRoutes.get('/activity/status', async (c) => {
  const { userId } = c.get('user')
  const status = await getInactivityStatus(userId)
  return c.json(status)
})

// POST /api/mobile/activity/ping — explicit heartbeat from the app
// (background tick or app-foreground event). Activity from any other mobile
// API call already updates lastActivityAt via the tracker middleware, so this
// is just an extra reset hook for the app.
mobileRoutes.post('/activity/ping', async (c) => {
  const { userId } = c.get('user')
  await pingActivity(userId, 'mobile')
  return c.json({ ok: true })
})

// POST /api/mobile/activity/ack — user pressed "Mark as Read" inside the app.
mobileRoutes.post('/activity/ack', async (c) => {
  const { userId } = c.get('user')
  const count = await ackPendingEvents(userId)
  return c.json({ acknowledged: count })
})

// POST /api/mobile/activity/phone-state — Android PhoneStateListener reports a
// call started/ended. While `onCall: true` the inactivity scheduler skips the
// user; on `onCall: false` we credit the call as a fresh activity so they
// aren't immediately flagged the moment they hang up.
const phoneStateSchema = z.object({
  onCall: z.boolean(),
  since: z.string().datetime().optional(),
})
mobileRoutes.post('/activity/phone-state', zValidator('json', phoneStateSchema), async (c) => {
  const { userId } = c.get('user')
  const { onCall, since } = c.req.valid('json')
  const result = await setPhoneState(userId, onCall, since ? new Date(since) : undefined)
  return c.json(result)
})

// Helper: verify the lead is assigned to the calling counsellor
// The single reason a counsellor is ever refused a lead on mobile: it is not
// (or is no longer) assigned to them. It reads as a bare "Forbidden" in the app
// otherwise, which looks like a bug rather than what it is — an admin
// reassigned the lead while the app still had it in its local cache. `reason`
// lets the app evict the stale row instead of just showing the message.
const NOT_ASSIGNED = {
  error: 'This lead is no longer assigned to you',
  reason: 'not_assigned',
} as const

async function ensureAssigned(userId: number, leadId: bigint): Promise<boolean> {
  const a = await prisma.asignedLead.findFirst({
    where: { clrId: BigInt(userId), stdId: leadId, status: 1 },
    select: { id: true },
  })
  return !!a
}

const fcmSchema = z.object({
  fcmToken: z.string().min(1),
  deviceId: z.string().min(1),
  appVersion: z.string().optional(),
})

// POST /api/mobile/fcm-token
mobileRoutes.post('/fcm-token', zValidator('json', fcmSchema), async (c) => {
  const { userId } = c.get('user')
  const { fcmToken, deviceId, appVersion } = c.req.valid('json')
  await prisma.deviceToken.upsert({
    where: { fcmToken },
    create: { userId: BigInt(userId), fcmToken, deviceId, appVersion, platform: 'android' },
    update: { userId: BigInt(userId), deviceId, appVersion, lastSeenAt: new Date() },
  })
  return c.json({ success: true })
})

// POST /api/mobile/logout
mobileRoutes.post('/logout', zValidator('json', z.object({ fcmToken: z.string().optional() })), async (c) => {
  const { userId } = c.get('user')
  const body = c.req.valid('json')
  if (body.fcmToken) {
    await prisma.deviceToken.deleteMany({ where: { fcmToken: body.fcmToken } })
  }
  // Clear the active mobile session so any other JWT for this user is also rejected.
  await prisma.user.update({
    where: { id: BigInt(userId) },
    data: { activeMobileSessionId: null },
  })
  return c.json({ success: true })
})

// GET /api/mobile/me
mobileRoutes.get('/me', async (c) => {
  const { userId } = c.get('user')
  const user = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: { id: true, name: true, email: true, mobile: true, role: true, showFullPhone: true, showBucket: true, locationTrackingEnabled: true, locationRequired: true },
  })
  if (!user) return c.json({ error: 'Not found' }, 404)
  return c.json(bigintFix({ ...user, id: Number(user.id), showFullPhone: Boolean(user.showFullPhone) }))
})

const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyM: z.number().finite().min(0).max(100_000).optional(),
  altitudeM: z.number().finite().min(-1_000).max(100_000).optional(),
  speedMps: z.number().finite().min(0).max(500).optional(),
  bearingDeg: z.number().finite().min(0).max(360).optional(),
})

// POST /api/mobile/location — location is always bound to the authenticated
// JWT user. The server timestamp is authoritative, preventing backdated rows.
mobileRoutes.post('/location', zValidator('json', locationSchema), async (c) => {
  const { userId } = c.get('user')
  const user = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: { locationTrackingEnabled: true },
  })
  if (!user?.locationTrackingEnabled) return c.json({ error: 'Location tracking is disabled' }, 403)

  const point = c.req.valid('json')
  const latest = await prisma.userLocation.findFirst({
    where: { userId: BigInt(userId) },
    orderBy: { recordedAt: 'desc' },
    select: { recordedAt: true },
  })
  // A foreground service may retry after a transient network failure; accepting
  // one sample per 20 seconds keeps the admin timeline useful without allowing
  // an accidental client loop to flood the database.
  if (latest && Date.now() - latest.recordedAt.getTime() < 20_000) {
    return c.json({ accepted: false, reason: 'throttled' }, 202)
  }
  await prisma.userLocation.create({ data: { userId: BigInt(userId), ...point } })
  return c.json({ accepted: true }, 201)
})

const deviceStatusSchema = z.object({
  permissionGranted: z.boolean(),
  backgroundGranted: z.boolean(),
  gpsEnabled: z.boolean(),
  batteryExempt: z.boolean(),
  callPhoneGranted: z.boolean().optional(),
  phoneStateGranted: z.boolean().optional(),
  callLogGranted: z.boolean().optional(),
  recordAudioGranted: z.boolean().optional(),
  notificationsGranted: z.boolean().optional(),
  blocked: z.boolean(),
  blockReason: z.string().max(120).nullable().optional(),
})

// POST /api/mobile/device-status — the device's own report of the four
// LocationGate conditions (permission / background permission / GPS / battery
// exemption). Reported directly by the app instead of inferred from silence,
// so "GPS is on but the app was never granted location permission" (or any
// other single condition) is visible on the admin dashboard by name, not
// guessed from a stale timestamp.
mobileRoutes.post('/device-status', zValidator('json', deviceStatusSchema), async (c) => {
  const { userId } = c.get('user')
  const body = c.req.valid('json')
  await prisma.userDeviceLocationStatus.upsert({
    where: { userId: BigInt(userId) },
    create: { userId: BigInt(userId), ...body },
    update: body,
  })
  return c.json({ accepted: true })
})
// GET /api/mobile/leads/sync?since=ISO
// Delta sync of assigned leads — counsellor sees only their assignments.
//
// `assignedIds` is ALWAYS the complete current set of assigned lead IDs so the
// app can prune local rows that were reassigned away. `leads` is a delta:
// every lead that was touched OR whose assignment was created/updated since
// the last sync. Counsellors getting freshly-assigned leads (where
// Lead.updatedAt itself doesn't change — bulk-assign only writes AsignedLead)
// used to require a data-clear + relogin; this fixes it.
mobileRoutes.get('/leads/sync', async (c) => {
  const { userId } = c.get('user')
  const since = c.req.query('since')
  const sinceDate = since ? new Date(since) : new Date(0)

  const assignments = await prisma.asignedLead.findMany({
    where: { clrId: BigInt(userId), status: 1 },
    select: { stdId: true, updatedAt: true, createdAt: true },
  })
  const leadIds = assignments.map((a) => a.stdId)
  const assignedIds = leadIds.map((id) => Number(id))

  // Pull a lead if its own record was updated OR its assignment to this
  // counsellor was created/updated after `since`. The latter catches admin
  // bulk-assigns that don't touch lead.updatedAt.
  const freshAssignmentLeadIds = assignments
    .filter((a) => a.updatedAt >= sinceDate || a.createdAt >= sinceDate)
    .map((a) => a.stdId)

  const leads = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      trash: 0,
      OR: [
        { updatedAt: { gte: sinceDate } },
        { id: { in: freshAssignmentLeadIds } },
      ],
    },
    select: {
      id: true, name: true, mobile: true, mobile2: true, email: true,
      city: true, state: true, leadStatus: true, leadSubStatus: true,
      intrestedCourse: true, updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 1000,
  })

  return c.json(bigintFix({
    syncedAt: new Date().toISOString(),
    leads,
    assignedIds,
  }))
})

// GET /api/mobile/leads/list — server-paginated assigned-leads list for the
// mobile counsellor app. Unlike /leads/sync (capped at 1000 for the offline
// cache), this is the authoritative "show me ALL my leads with filters"
// endpoint — pagination + search + a few key filters mirror the web /app/leads
// page. Returns `total` so the UI can show "X–Y of Z" instead of "1000".
mobileRoutes.get('/leads/list', async (c) => {
  const { userId } = c.get('user')
  const uid = BigInt(userId)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query('pageSize') ?? 500)))
  const q = (c.req.query('q') ?? '').trim()
  const status = (c.req.query('status') ?? '').trim()
  const subStatus = (c.req.query('subStatus') ?? '').trim()
  const hasFollowup = c.req.query('hasFollowup') // 'today' | 'overdue' | 'upcoming' | 'any'
  const calledFlag = c.req.query('called')       // '0' | '1'
  const fromDateStr = (c.req.query('fromDate') ?? '').trim()
  const toDateStr = (c.req.query('toDate') ?? '').trim()
  // Comma-separated lead ids — used by the mobile Tasks screen to show the
  // exact set of leads in a calling-task batch, in the same list format as
  // the regular Leads tab. Malformed ids are dropped silently.
  const idsParam = (c.req.query('ids') ?? '').trim()
  const idFilter = idsParam
    ? idsParam.split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map((s) => BigInt(s))
    : null
  // `batchId` opens ONE of the counsellor's own calling tasks. It supersedes
  // `ids`: the batch is both the authorisation (it is assigned to them) and
  // the ordering — leads still to call come first, and the ones already
  // called stay listed underneath with a done marker instead of vanishing the
  // moment the call lands.
  const batchIdParam = (c.req.query('batchId') ?? '').trim()
  const batchId = /^\d+$/.test(batchIdParam) ? BigInt(batchIdParam) : null
  // Default to 'assignedAt' so freshly-assigned leads jump to the top of the
  // counsellor's list, regardless of whether the lead itself was recently
  // touched (called/commented/status-changed) by anyone.
  const orderField = (c.req.query('orderBy') ?? 'assignedAt') as 'updatedAt' | 'createdAt' | 'name' | 'followupDate' | 'assignedAt'
  const orderDir = ((c.req.query('orderDir') ?? 'desc') as 'asc' | 'desc')
  // When true, every USER-SELECTED filter clause (status/subStatus/called/
  // date-range/hasFollowup/q) is negated independently. The scope filters
  // (trash, assignedTo) stay intact in both modes.
  const excludeModeRaw = (c.req.query('excludeMode') ?? '').trim()
  const isExclude = excludeModeRaw === '1' || excludeModeRaw === 'true'

  function parseDate(s: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const d = new Date(s + 'T00:00:00')
    return isNaN(d.getTime()) ? null : d
  }
  const fromDate = parseDate(fromDateStr)
  const toDateInclusive = (() => {
    const d = parseDate(toDateStr); if (!d) return null
    const end = new Date(d); end.setDate(end.getDate() + 1)
    return end
  })()

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
  const inAWeek = new Date(startOfToday); inAWeek.setDate(inAWeek.getDate() + 7)

  // Collect user-selected filter clauses separately so excludeMode can wrap
  // each one in NOT without inverting the assignment / trash scope.
  const userClauses: Prisma.LeadWhereInput[] = []
  if (status) userClauses.push({ leadStatus: status })
  if (subStatus) userClauses.push({ leadSubStatus: subStatus })
  if (calledFlag === '0' || calledFlag === '1') userClauses.push({ called: Number(calledFlag) })
  if (fromDate || toDateInclusive) {
    userClauses.push({
      createdAt: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDateInclusive ? { lt: toDateInclusive } : {}),
      },
    })
  }
  if (hasFollowup === 'today') userClauses.push({ followupDate: { gte: startOfToday, lt: startOfTomorrow } })
  else if (hasFollowup === 'overdue') userClauses.push({ followupDate: { gte: REAL_FOLLOWUP_MIN, lt: startOfToday } })
  else if (hasFollowup === 'upcoming') userClauses.push({ followupDate: { gte: startOfTomorrow, lt: inAWeek } })
  else if (hasFollowup === 'any') userClauses.push({ followupDate: { gte: REAL_FOLLOWUP_MIN } })
  if (q.length >= 1) {
    userClauses.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { mobile: { contains: q } },
        { mobile2: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ],
    })
  }

  // ─── Calling-task scope ───────────────────────────────────────────────
  // Resolved before the lead query so the task can supply both the id set and
  // the order. Per-lead task facts (done / how / when) ride along on the rows
  // so the list can show a done marker rather than dropping the lead.
  type TaskMeta = {
    taskItemId: string
    taskDone: boolean
    taskCompletedAt: string | null
    taskCompletionType: string | null
    callAttempts: number
    lastCallDurationSec: number
    lastCallOutcome: string | null
  }
  const taskMeta = new Map<string, TaskMeta>()
  /** Pending-first lead order for a batch-scoped list; null when not in one. */
  let taskOrder: bigint[] | null = null
  let taskTitle: string | null = null
  if (batchId) {
    const batch = await prisma.leadWorkBatch.findFirst({
      where: { id: batchId, assignedToId: uid },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: { lead: { select: { id: true, name: true, mobile: true, followupDate: true, leadStatus: true } } },
        },
      },
    })
    if (!batch) return c.json({ error: 'Task not found' }, 404)
    const hydrated = await hydrateBatch(batch)
    const items: any[] = hydrated?.items ?? []
    for (const item of items) {
      taskMeta.set(item.leadId.toString(), {
        // The mark-done endpoint acts on the ITEM, not the lead — a lead can
        // sit in more than one task.
        taskItemId: item.id.toString(),
        taskDone: !!item.completedAt,
        taskCompletedAt: item.completedAt ? new Date(item.completedAt).toISOString() : null,
        taskCompletionType: item.completionType ?? null,
        callAttempts: item.callAttempts ?? 0,
        lastCallDurationSec: item.lastCallDurationSec ?? 0,
        lastCallOutcome: item.lastCallOutcome ?? null,
      })
    }
    taskTitle = batch.title
    // Still-to-call first, already-called underneath — both in the order the
    // admin built the task in.
    taskOrder = [
      ...items.filter((item) => !item.completedAt).map((item) => item.leadId as bigint),
      ...items.filter((item) => !!item.completedAt).map((item) => item.leadId as bigint),
    ]
  }

  const scopeIds = taskOrder ?? idFilter

  const leadWhere: Prisma.LeadWhereInput = {
    trash: 0,
    ...(scopeIds ? { id: { in: scopeIds } } : {}),
    ...(userClauses.length > 0
      ? {
          // NULL-safe negation — a plain `NOT` drops every lead whose column is
          // empty (SQL: NOT NULL is NULL, not TRUE), so excluding one status
          // used to also wipe out every lead with no sub-status/city/email set.
          AND: isExclude
            ? userClauses.map((cl) => negateLeadClause(cl as Record<string, unknown>) as Prisma.LeadWhereInput)
            : userClauses,
        }
      : {}),
  }

  // Ownership scope.
  //
  // Normally: leads actively assigned to this counsellor. But a lead can be
  // reassigned out from under an open calling task — building a task for
  // someone else deactivates every earlier assignment row for those leads —
  // and the old task still counts it as pending. Requiring an active
  // assignment then hid exactly the lead the task said was left: "1 call to
  // do" with an empty list. Inside a task scope the batch membership IS the
  // authorisation, so the check relaxes to "assigned to me OR in one of my
  // own tasks".
  const ownedByMe: Prisma.LeadWhereInput = { assignedTo: { some: { clrId: uid, status: 1 } } }
  const inMyTasks: Prisma.LeadWhereInput = { workBatchItems: { some: { batch: { assignedToId: uid } } } }
  const scopeWhere: Prisma.LeadWhereInput = scopeIds ? { OR: [ownedByMe, inMyTasks] } : ownedByMe

  const leadSelect = {
    id: true, name: true, mobile: true, mobile2: true, email: true,
    city: true, state: true, leadStatus: true, leadSubStatus: true,
    intrestedCourse: true, source: true, followupDate: true, called: true,
    flagSend: true, flagRcv: true, updatedAt: true, createdAt: true,
  } satisfies Prisma.LeadSelect

  let total = 0
  let rows: Prisma.LeadGetPayload<{ select: typeof leadSelect }>[] = []

  if (taskOrder) {
    // Task order can't be expressed as an ORDER BY, so resolve the matching
    // ids first, rank them in memory, then hydrate only the page's worth.
    const rank = new Map(taskOrder.map((id, index) => [id.toString(), index]))
    const matching = await prisma.lead.findMany({
      where: { ...leadWhere, ...scopeWhere },
      select: { id: true },
    })
    const ordered = matching
      .map((row) => row.id)
      .sort((a, b) => (rank.get(a.toString()) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.toString()) ?? Number.MAX_SAFE_INTEGER))
    total = ordered.length
    const slice = ordered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    const found = slice.length
      ? await prisma.lead.findMany({ where: { id: { in: slice } }, select: leadSelect })
      : []
    const byId = new Map(found.map((row) => [row.id.toString(), row]))
    rows = slice.map((id) => byId.get(id.toString())).filter(Boolean) as typeof rows
  } else if (orderField === 'assignedAt' && !scopeIds) {
    // 'assignedAt' sorts by the assignment row's own createdAt (i.e. when this
    // lead landed with this counsellor) instead of any Lead-level timestamp —
    // so the base query runs off AsignedLead, not Lead, for that case.
    const assignedWhere: Prisma.AsignedLeadWhereInput = { clrId: uid, status: 1, lead: leadWhere }
    const [count, page1] = await Promise.all([
      prisma.asignedLead.count({ where: assignedWhere }),
      prisma.asignedLead.findMany({
        where: assignedWhere,
        orderBy: { createdAt: orderDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { lead: { select: leadSelect } },
      }).then((assigned) => assigned.map((a) => a.lead)),
    ])
    total = count
    rows = page1
  } else {
    const where = { ...leadWhere, ...scopeWhere }
    // An id-scoped list still defaults to orderBy=assignedAt; there is no
    // assignment row to sort on in that path, so fall back to the lead's own
    // createdAt (clients that care re-sort by the task order anyway).
    const sortField = orderField === 'assignedAt' ? 'createdAt' : orderField
    const [count, pageRows] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { [sortField]: orderDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: leadSelect,
      }),
    ])
    total = count
    rows = pageRows
  }

  const decorated = await decorateLeadRows(rows, uid, taskMeta)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return c.json(bigintFix({
    rows: decorated,
    page,
    pageSize,
    total,
    totalPages,
    ...(taskTitle !== null ? { taskTitle } : {}),
  }))
})

/**
 * Per-row extras the lead card needs but the Lead table doesn't hold:
 *
 *  - `lastCallAt` — when this lead was last actually rung, across both call
 *    sources (app-captured MobileCall rows and web-entered CallLog rows).
 *    Two grouped aggregates, so it stays one round trip per source no matter
 *    how many calls a lead has accumulated.
 *  - `inTodayTask` — is this lead on one of the counsellor's calling tasks for
 *    today? The list paints those cards green so today's work stands out
 *    while scrolling the ordinary Leads tab.
 *  - the task facts from `taskMeta` when the list is scoped to one task.
 */
async function decorateLeadRows(
  rows: { id: bigint }[],
  uid: bigint,
  taskMeta: Map<string, {
    taskItemId: string
    taskDone: boolean
    taskCompletedAt: string | null
    taskCompletionType: string | null
    callAttempts: number
    lastCallDurationSec: number
    lastCallOutcome: string | null
  }>,
) {
  if (!rows.length) return rows
  const leadIds = rows.map((row) => row.id)
  const todayStart = new Date(`${dayLabel(new Date())}T00:00:00.000Z`)
  const [mobileCalls, manualCalls, todayItems] = await Promise.all([
    prisma.mobileCall.groupBy({
      by: ['leadId'],
      where: { leadId: { in: leadIds }, status: { not: 'TRIGGERED' } },
      _max: { startedAt: true },
    }),
    prisma.callLog.groupBy({
      by: ['leadId'],
      where: { leadId: { in: leadIds } },
      _max: { createdAt: true },
    }),
    prisma.leadWorkBatchItem.findMany({
      where: {
        leadId: { in: leadIds },
        batch: { assignedToId: uid, workDate: todayStart, status: { not: 2 } },
      },
      select: { leadId: true },
    }),
  ])
  const lastCall = new Map<string, Date>()
  const bump = (leadId: bigint | null, at: Date | null | undefined) => {
    if (!leadId || !at) return
    const key = leadId.toString()
    const current = lastCall.get(key)
    if (!current || at > current) lastCall.set(key, at)
  }
  for (const row of mobileCalls) bump(row.leadId, row._max.startedAt)
  for (const row of manualCalls) bump(row.leadId, row._max.createdAt)
  const todayTaskLeads = new Set(todayItems.map((item) => item.leadId.toString()))

  return rows.map((row) => {
    const key = row.id.toString()
    const meta = taskMeta.get(key)
    return {
      ...row,
      lastCallAt: lastCall.get(key)?.toISOString() ?? null,
      inTodayTask: todayTaskLeads.has(key),
      taskItemId: meta ? Number(meta.taskItemId) : null,
      taskDone: meta?.taskDone ?? false,
      taskCompletedAt: meta?.taskCompletedAt ?? null,
      taskCompletionType: meta?.taskCompletionType ?? null,
      callAttempts: meta?.callAttempts ?? 0,
      lastCallDurationSec: meta?.lastCallDurationSec ?? 0,
      lastCallOutcome: meta?.lastCallOutcome ?? null,
    }
  })
}

// GET /api/mobile/lead-work/batches — the counsellor's own "Calling Tasks"
// (LeadWorkBatch rows assigned to them), mirrored from the web's /app/tasks
// LeadCallingTasks panel. Same hydration logic as the web's GET /lead-work/batches
// (imported from lead-work.routes.ts) — total/completed/progress/state and a
// per-item completion flag so the mobile Tasks screen and its "View leads"
// list stay in sync with the web without duplicating the outcome-tracking logic.
mobileRoutes.get('/lead-work/batches', async (c) => {
  const { userId } = c.get('user')
  const batches = await prisma.leadWorkBatch.findMany({
    where: { assignedToId: BigInt(userId) },
    orderBy: [{ workDate: 'desc' }, { sequence: 'asc' }, { createdAt: 'asc' }],
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      // Items in insertion order (id ASC) — matches the web /lead-work/batches
      // endpoint so the auto-dialer walks leads in the exact sequence the web
      // task view lists them. Prisma doesn't guarantee any order without this.
      items: {
        orderBy: { id: 'asc' },
        include: { lead: { select: { id: true, name: true, mobile: true, followupDate: true, leadStatus: true } } },
      },
    },
  })
  // hydrateBatches builds the duplicate map and fetches every batch's activity
  // in one pass — a per-batch lookup would re-scan the leads table for each task.
  const hydrated = withDayNumbers(await hydrateBatches(batches))
  // Every task for the day is workable — no locked-until-the-one-above queue.
  return c.json(bigintFix(hydrated
    .filter((batch) => batch.status !== 2)
    .map((batch) => {
      const state = batch.status === 1 ? 'COMPLETED' : batch.completed ? 'IN_PROGRESS' : 'READY'
      return { ...batch, state }
    })))
})

// POST /api/mobile/lead-work/items/:itemId/mark-done — the counsellor's escape
// hatch, mirroring the web's Mark-done button. Without it a task item that no
// call can ever satisfy (no number on the lead, wrong number, reached on
// WhatsApp instead) sat pending forever and the task never left "1 call left".
// The mark writes a real CallLog row, so it shows on the lead and in reports —
// it is not a private "task done" flag.
mobileRoutes.post('/lead-work/items/:itemId/mark-done', async (c) => {
  const { userId } = c.get('user')
  const body: { reason?: string; notes?: string } = await c.req.json().catch(() => ({}))
  const result = await markTaskItemDone(BigInt(c.req.param('itemId')), userId, false, body)
  return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result)
})

// POST /api/mobile/lead-work/items/:itemId/undo-done — only undoes MANUAL_*
// marks; an auto-derived completion is left alone.
mobileRoutes.post('/lead-work/items/:itemId/undo-done', async (c) => {
  const { userId } = c.get('user')
  const result = await undoTaskItemDone(BigInt(c.req.param('itemId')), userId, false)
  return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result)
})

// The reason list the app renders, so the two never drift apart.
mobileRoutes.get('/lead-work/manual-reasons', async (c) => c.json({ reasons: MANUAL_REASON_KEYS }))

// Same "hide archived leads from the shared Bucket" rule as leads.routes.ts's
// getArchiveDepartmentIds() — once a lead is moved into the Archive department
// it must not resurface here either. Kept in sync manually; if this drifts
// from leads.routes.ts again the mobile bucket count will balloon past the
// web bucket count like it did before (mobile was missing this exclusion
// entirely, plus the flagRcv/flagSend exclusion below).
async function getArchiveDepartmentIdsMobile(): Promise<bigint[]> {
  const rows = await prisma.leadDepartment.findMany({ where: { slug: 'archive' }, select: { id: true } })
  return rows.map((r) => r.id)
}

async function canAccessMobileBucket(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: BigInt(userId) }, select: { showBucket: true } })
  return user?.showBucket !== false
}
mobileRoutes.get('/leads/bucket', async (c) => {
  const bucketUser = c.get('user')
  if (!await canAccessMobileBucket(bucketUser.userId)) return c.json({ error: 'Bucket access has been disabled by your administrator' }, 403)
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query('pageSize') ?? 50)))
  const flagBucket = c.req.query('flagBucket') === '1'
  const q = (c.req.query('q') ?? '').trim()
  const website = (c.req.query('website') ?? '').trim()
  const source = (c.req.query('source') ?? '').trim()
  const event = (c.req.query('event') ?? '').trim()
  const fromDate = c.req.query('fromDate')
  const toDate = c.req.query('toDate')
  const createdAt = (fromDate || toDate) ? { ...(fromDate ? { gte: new Date(fromDate + 'T00:00:00.000Z') } : {}), ...(toDate ? { lte: new Date(toDate + 'T23:59:59.999Z') } : {}) } : undefined
  const archiveDeptIds = await getArchiveDepartmentIdsMobile()
  const where: Prisma.LeadWhereInput = {
    trash: 0,
    ...(flagBucket
      ? { OR: [{ flagRcv: 1 }, { flagSend: 1 }] }
      : { leadStatus: 'Fresh', bucketExcluded: false, assignedTo: { none: { status: 1 } }, flagRcv: 0, flagSend: 0 }),
    ...(archiveDeptIds.length ? { departmentId: { notIn: archiveDeptIds } } : {}),
    ...(website ? { website } : {}), ...(source ? { source: { contains: source, mode: 'insensitive' } } : {}),
    ...(event ? { event: { contains: event, mode: 'insensitive' } } : {}), ...(createdAt ? { createdAt } : {}),
    ...(q ? { AND: [{ OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }] }] } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, mobile: true, email: true, city: true, state: true, intrestedCourse: true, website: true, source: true, createdAt: true, flagRcv: true, flagSend: true } }),
  ])
  return c.json(bigintFix({ rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }))
})
mobileRoutes.get('/leads/bucket/facets', async (c) => {
  const bucketUser = c.get('user')
  if (!await canAccessMobileBucket(bucketUser.userId)) return c.json({ error: 'Bucket access has been disabled by your administrator' }, 403)
  const flagBucket = c.req.query('flagBucket') === '1'
  const archiveDeptIds = await getArchiveDepartmentIdsMobile()
  const base: Prisma.LeadWhereInput = flagBucket
    ? { trash: 0, OR: [{ flagRcv: 1 }, { flagSend: 1 }] }
    : {
        trash: 0,
        leadStatus: 'Fresh',
        bucketExcluded: false,
        assignedTo: { none: { status: 1 } },
        flagRcv: 0,
        flagSend: 0,
        ...(archiveDeptIds.length ? { departmentId: { notIn: archiveDeptIds } } : {}),
      }
  const [websites, sources, events, total] = await Promise.all([
    prisma.lead.groupBy({ by: ['website'], where: base, _count: { _all: true }, orderBy: { _count: { website: 'desc' } } }),
    prisma.lead.groupBy({ by: ['source'], where: { ...base, source: { not: null } }, _count: { _all: true }, orderBy: { _count: { source: 'desc' } } }),
    prisma.lead.groupBy({ by: ['event'], where: { ...base, event: { not: null } }, _count: { _all: true }, orderBy: { _count: { event: 'desc' } } }),
    prisma.lead.count({ where: base }),
  ])
  return c.json({ total, websites: websites.filter(x => x.website).map(x => ({ value: x.website, count: x._count._all })), sources: sources.filter(x => x.source).map(x => ({ value: x.source as string, count: x._count._all })), events: events.filter(x => x.event).map(x => ({ value: x.event as string, count: x._count._all })) })
})
mobileRoutes.post('/leads/bucket/claim', async (c) => {
  const bucketUser = c.get('user')
  if (!await canAccessMobileBucket(bucketUser.userId)) return c.json({ error: 'Bucket access has been disabled by your administrator' }, 403)
  const { userId } = c.get('user')
  const body = await c.req.json<{ leadIds?: number[] }>().catch(() => ({ leadIds: [] as number[] }))
  const ids = Array.from(new Set((body.leadIds ?? []).map(Number).filter(Number.isSafeInteger))).slice(0, 100)
  if (!ids.length) return c.json({ error: 'leadIds required' }, 400)
  const claimed = await prisma.$transaction(async (tx) => {
    const eligible = await tx.lead.findMany({ where: { id: { in: ids.map((id) => BigInt(id)) }, trash: 0, leadStatus: 'Fresh', bucketExcluded: false, assignedTo: { none: { status: 1 } } }, select: { id: true } })
    if (!eligible.length) return 0
    await tx.asignedLead.createMany({ data: eligible.map((lead) => ({ clrId: BigInt(userId), stdId: lead.id, leadType: 'new', status: 1 })), skipDuplicates: true })
    await tx.lead.updateMany({ where: { id: { in: eligible.map((l) => l.id) } }, data: { bucketExcluded: false } })
    return eligible.length
  })
  return c.json({ claimed, skipped: ids.length - claimed, message: claimed + ' lead(s) assigned to you' })
})
// GET /api/mobile/leads/status-options — distinct leadStatus + leadSubStatus
// values across the counsellor's assigned leads. Used to populate the filter
// dropdowns. Cheap-ish: scoped to this counsellor's leads only.
mobileRoutes.get('/leads/status-options', async (c) => {
  const { userId } = c.get('user')
  const uid = BigInt(userId)

  const where: Prisma.LeadWhereInput = {
    trash: 0,
    assignedTo: { some: { clrId: uid, status: 1 } },
  }

  const [statuses, subStatuses] = await Promise.all([
    prisma.lead.groupBy({
      by: ['leadStatus'],
      where,
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['leadStatus', 'leadSubStatus'],
      where,
      _count: { _all: true },
    }),
  ])

  return c.json({
    statuses: statuses
      .filter((s) => !!s.leadStatus)
      .map((s) => ({ value: s.leadStatus as string, count: s._count._all }))
      .sort((a, b) => b.count - a.count),
    subStatuses: subStatuses
      .filter((s) => !!s.leadSubStatus)
      .map((s) => ({
        value: s.leadSubStatus as string,
        parentStatus: s.leadStatus,
        count: s._count._all,
      }))
      .sort((a, b) => b.count - a.count),
  })
})

// GET /api/mobile/home/overview — everything the new fintech-style home screen
// needs in a single round-trip: today stats, leads, followup counts, the most
// imminent followup, last 6 calls, and a 7-day call trend.
mobileRoutes.get('/home/overview', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const uid = BigInt(userId)

  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  const tomorrow = new Date(start); tomorrow.setDate(tomorrow.getDate() + 1)
  const horizon = new Date(start); horizon.setDate(horizon.getDate() + 7)
  const weekStart = new Date(start); weekStart.setDate(weekStart.getDate() - 6)

  const scope = { trash: 0, assignedTo: { some: { clrId: uid, status: 1 } } } as const

  const [
    callsToday,
    totalLeads,
    hotLeads,
    todayFollowupsCount,
    overdueFollowupsCount,
    upcomingFollowupsCount,
    nextFollowupLead,
    recentCalls,
    weekCalls,
  ] = await Promise.all([
    prisma.mobileCall.findMany({
      where: { userId: uid, startedAt: { gte: start, lte: end }, status: { not: 'TRIGGERED' } },
      select: { status: true, durationSec: true, direction: true },
    }),
    prisma.asignedLead.count({ where: { clrId: uid, status: 1 } }),
    prisma.lead.count({
      where: { ...scope, leadStatus: { in: ['Hot', 'Interested', 'Qualified'] } },
    }),
    prisma.lead.count({ where: { ...scope, followupDate: { gte: start, lte: end } } }),
    prisma.lead.count({ where: { ...scope, followupDate: { gte: REAL_FOLLOWUP_MIN, lt: start } } }),
    prisma.lead.count({ where: { ...scope, followupDate: { gte: tomorrow, lt: horizon } } }),
    // Most imminent followup from "now" forward (today + upcoming combined).
    prisma.lead.findFirst({
      where: { ...scope, followupDate: { gte: new Date() } },
      orderBy: { followupDate: 'asc' },
      select: {
        id: true, name: true, mobile: true,
        leadStatus: true, leadSubStatus: true, followupDate: true,
      },
    }),
    prisma.mobileCall.findMany({
      where: { userId: uid, status: { not: 'TRIGGERED' } },
      orderBy: { startedAt: 'desc' },
      take: 6,
      select: {
        id: true, phoneNumber: true, direction: true, status: true,
        startedAt: true, durationSec: true,
        lead: { select: { id: true, name: true } },
      },
    }),
    prisma.mobileCall.findMany({
      // Drop MISSED here too — the week chart on the home screen sums these
      // into a "X total" label, which should stay consistent with the day's
      // total tile (calls the counsellor actually made).
      where: { userId: uid, startedAt: { gte: weekStart, lte: end }, status: { notIn: ['TRIGGERED', 'MISSED'] } },
      select: { startedAt: true },
    }),
  ])

  // MISSED = incoming the counsellor didn't pick up. It surfaces in its own
  // tile below — keep it out of `total` so the "calls he made" number isn't
  // padded by calls he never actually placed or answered.
  const total = callsToday.filter((c) => c.status !== 'MISSED').length
  const answered = callsToday.filter((c) => c.status === 'ANSWERED').length
  // Keep MISSED (incoming we didn't pick) and NO_ANSWER (outgoing that rang out)
  // separate — counsellors treat them as different events. The home screen and
  // calls list both render them as distinct tiles.
  const missed = callsToday.filter((c) => c.status === 'MISSED').length
  const noAnswer = callsToday.filter((c) => c.status === 'NO_ANSWER').length
  // REJECTED = target declined the call (or we declined an incoming one).
  // Counsellors want to see this separately — it usually means "not interested".
  const rejected = callsToday.filter((c) => c.status === 'REJECTED' || c.status === 'BUSY').length
  const totalDurationSec = callsToday.reduce((sum, c) => sum + (c.durationSec ?? 0), 0)

  // Bucket the last 7 days (including today). Index 0 = 6 days ago, index 6 = today.
  const dayBuckets: { date: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(start); day.setDate(day.getDate() - i)
    dayBuckets.push({ date: day.toISOString().slice(0, 10), count: 0 })
  }
  for (const call of weekCalls) {
    const isoDay = new Date(call.startedAt).toISOString().slice(0, 10)
    const bucket = dayBuckets.find((b) => b.date === isoDay)
    if (bucket) bucket.count++
  }

  return c.json(bigintFix({
    today: {
      total,
      answered,
      missed,
      noAnswer,
      rejected,
      outgoing: callsToday.filter((c) => c.direction === 'OUTGOING').length,
      incoming: callsToday.filter((c) => c.direction === 'INCOMING').length,
      totalDurationSec,
    },
    leads: { total: totalLeads, hot: hotLeads },
    followups: {
      today: todayFollowupsCount,
      overdue: overdueFollowupsCount,
      upcoming: upcomingFollowupsCount,
    },
    nextFollowup: nextFollowupLead && nextFollowupLead.followupDate
      ? {
          id: Number(nextFollowupLead.id),
          name: nextFollowupLead.name,
          mobile: nextFollowupLead.mobile,
          leadStatus: nextFollowupLead.leadStatus,
          leadSubStatus: nextFollowupLead.leadSubStatus,
          followupDate: nextFollowupLead.followupDate,
        }
      : null,
    recentCalls: recentCalls.map((r) => ({
      id: Number(r.id),
      phoneNumber: r.phoneNumber,
      direction: r.direction,
      status: r.status,
      startedAt: r.startedAt,
      durationSec: r.durationSec,
      lead: r.lead ? { id: Number(r.lead.id), name: r.lead.name } : null,
    })),
    weekStats: dayBuckets,
  }))
})

// GET /api/mobile/dashboard — today's stats for the logged-in counsellor
mobileRoutes.get('/dashboard', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)

  const [calls, totalLeads, hotLeads, todayFollowupsCount] = await Promise.all([
    prisma.mobileCall.findMany({
      where: {
        userId: BigInt(userId),
        startedAt: { gte: start, lte: end },
        // TRIGGERED rows are CRM "Push to phone" placeholders — not yet a real call.
        // The /sync handler merges into them when the call actually happens (status
        // flips to ANSWERED/MISSED/etc), so excluding TRIGGERED here prevents the
        // synced completion row + its TRIGGERED ancestor from both being counted.
        status: { not: 'TRIGGERED' },
      },
      select: { status: true, durationSec: true, direction: true },
    }),
    prisma.asignedLead.count({ where: { clrId: BigInt(userId), status: 1 } }),
    prisma.asignedLead.findMany({
      where: { clrId: BigInt(userId), status: 1 },
      select: { stdId: true },
    }).then(async (assigned) => {
      const ids = assigned.map((a) => a.stdId)
      if (ids.length === 0) return 0
      return prisma.lead.count({
        where: { id: { in: ids }, trash: 0, leadStatus: { in: ['Hot', 'Interested', 'Qualified'] } },
      })
    }),
    prisma.lead.count({
      where: {
        trash: 0,
        followupDate: { gte: start, lte: end },
        assignedTo: { some: { clrId: BigInt(userId), status: 1 } },
      },
    }),
  ])

  // Exclude MISSED from `total` — it's an incoming call the counsellor never
  // picked up, not a call they made. It still shows in the dedicated missed tile.
  const total = calls.filter((c) => c.status !== 'MISSED').length
  const answered = calls.filter((c) => c.status === 'ANSWERED').length
  // Same split as /home/overview: MISSED (incoming we didn't pick) and
  // NO_ANSWER (outgoing rang out) are distinct concepts.
  const missed = calls.filter((c) => c.status === 'MISSED').length
  const noAnswer = calls.filter((c) => c.status === 'NO_ANSWER').length
  const totalDurationSec = calls.reduce((sum, c) => sum + (c.durationSec ?? 0), 0)

  return c.json({
    today: {
      total,
      answered,
      missed,
      noAnswer,
      totalDurationSec,
      outgoing: calls.filter((c) => c.direction === 'OUTGOING').length,
      incoming: calls.filter((c) => c.direction === 'INCOMING').length,
    },
    leads: { total: totalLeads, hot: hotLeads },
    followups: { today: todayFollowupsCount },
  })
})

// GET /api/mobile/followups/counts — { today, overdue, upcoming } for Home tiles
mobileRoutes.get('/followups/counts', async (c) => {
  const { userId } = c.get('user')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7)

  const scope = { trash: 0, assignedTo: { some: { clrId: BigInt(userId), status: 1 } } }
  const [todayCount, overdueCount, upcomingCount] = await Promise.all([
    prisma.lead.count({ where: { ...scope, followupDate: { gte: today, lt: tomorrow } } }),
    prisma.lead.count({ where: { ...scope, followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today } } }),
    prisma.lead.count({ where: { ...scope, followupDate: { gte: tomorrow, lt: horizon } } }),
  ])
  return c.json({ today: todayCount, overdue: overdueCount, upcoming: upcomingCount })
})

// GET /api/mobile/followups/overdue — past followups still pending
mobileRoutes.get('/followups/overdue', async (c) => {
  const { userId } = c.get('user')
  const q = (c.req.query('q') ?? '').trim()
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const where: Prisma.LeadWhereInput = {
    trash: 0,
    followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today },
    assignedTo: { some: { clrId: BigInt(userId), status: 1 } },
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { mobile: { contains: q } },
      { email: { contains: q } },
    ]
  }
  const leads = await prisma.lead.findMany({
    where,
    select: { id: true, name: true, mobile: true, followupDate: true, leadStatus: true, leadSubStatus: true },
    orderBy: { followupDate: 'desc' },
    take: 200,
  })
  return c.json(bigintFix(leads.map((l) => ({
    id: Number(l.id), name: l.name, mobile: l.mobile,
    followupDate: l.followupDate, leadStatus: l.leadStatus, leadSubStatus: l.leadSubStatus,
  }))))
})

// GET /api/mobile/followups/upcoming — next 7 days
mobileRoutes.get('/followups/upcoming', async (c) => {
  const { userId } = c.get('user')
  const q = (c.req.query('q') ?? '').trim()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7)

  const where: Prisma.LeadWhereInput = {
    trash: 0,
    followupDate: { gte: tomorrow, lt: horizon },
    assignedTo: { some: { clrId: BigInt(userId), status: 1 } },
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { mobile: { contains: q } },
      { email: { contains: q } },
    ]
  }
  const leads = await prisma.lead.findMany({
    where,
    select: { id: true, name: true, mobile: true, followupDate: true, leadStatus: true, leadSubStatus: true },
    orderBy: { followupDate: 'asc' },
    take: 200,
  })
  return c.json(bigintFix(leads.map((l) => ({
    id: Number(l.id), name: l.name, mobile: l.mobile,
    followupDate: l.followupDate, leadStatus: l.leadStatus, leadSubStatus: l.leadSubStatus,
  }))))
})

// GET /api/mobile/followups/today — list of leads with a follow-up due today
mobileRoutes.get('/followups/today', async (c) => {
  const { userId } = c.get('user')
  const q = (c.req.query('q') ?? '').trim()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)

  const where: Prisma.LeadWhereInput = {
    trash: 0,
    followupDate: { gte: start, lte: end },
    assignedTo: { some: { clrId: BigInt(userId), status: 1 } },
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { mobile: { contains: q } },
      { email: { contains: q } },
    ]
  }
  const leads = await prisma.lead.findMany({
    where,
    select: {
      id: true,
      name: true,
      mobile: true,
      followupDate: true,
      leadStatus: true,
      leadSubStatus: true,
    },
    orderBy: { followupDate: 'asc' },
    take: 200,
  })

  return c.json(bigintFix(leads.map((l) => ({
    id: Number(l.id),
    name: l.name,
    mobile: l.mobile,
    followupDate: l.followupDate,
    leadStatus: l.leadStatus,
    leadSubStatus: l.leadSubStatus,
  }))))
})

// GET /api/mobile/lead-config — statuses + sub-statuses + followup-statuses + departments
mobileRoutes.get('/lead-config', async (c) => {
  const [statuses, followupStatuses, departments] = await Promise.all([
    prisma.leadStatus.findMany({
      where: { status: 1 },
      orderBy: { priority: 'asc' },
      include: { subStatuses: { orderBy: { id: 'asc' } } },
    }),
    prisma.leadFollowupStatus.findMany({ orderBy: { id: 'asc' } }),
    prisma.leadDepartment.findMany({ orderBy: { id: 'asc' } }),
  ])
  return c.json(bigintFix({ statuses, followupStatuses, departments }))
})

// GET /api/mobile/leads/:id — live single-lead fetch (no Room caching).
// Counsellor can only read leads assigned to them.
mobileRoutes.get('/leads/:id', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) {
    return c.json(NOT_ASSIGNED, 403)
  }
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true, name: true, mobile: true, mobile2: true, email: true,
      city: true, state: true, leadStatus: true, leadSubStatus: true,
      leadStatusId: true, leadSubStatusId: true, leadFollowStatus: true, departmentId: true,
      intrestedCourse: true, followupDate: true, comment: true,
      flagSend: true, flagRcv: true, called: true, wapp: true,
      updatedAt: true, createdAt: true, trash: true,
    },
  })
  if (!lead || lead.trash === 1) return c.json({ error: 'Not found' }, 404)
  return c.json(bigintFix(lead))
})

// GET /api/mobile/leads/:id/detail — the whole detail screen in one request.
//
// Replaces the seven-request fan-out (lead + notes + comments + followups +
// timeline + history + flags) the app used to fire on every open AND on every
// 60s poll tick. One assignment check instead of seven, and each list is read
// once instead of twice — /timeline used to independently re-query the same
// five lists its siblings had just fetched.
//
// The individual endpoints below are kept: app builds already in the field
// still call them, and they now share this module's shapers so the two paths
// cannot return different JSON for the same data.
mobileRoutes.get('/leads/:id/detail', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)

  const bundle = await loadLeadDetailBundle(id)
  if (!bundle) return c.json({ error: 'Not found' }, 404)
  return c.json(bigintFix(bundle))
})

// PATCH /api/mobile/leads/:id — counsellor updates status / sub-status / followup
mobileRoutes.patch('/leads/:id', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) {
    return c.json(NOT_ASSIGNED, 403)
  }
  const body = await c.req.json()
  const updates: Record<string, unknown> = {}

  if (body.leadStatusId != null) {
    const statusId = BigInt(body.leadStatusId)
    const ls = await prisma.leadStatus.findUnique({ where: { id: statusId } })
    if (!ls) return c.json({ error: 'Invalid leadStatusId' }, 400)
    updates.leadStatusId = statusId
    updates.leadStatus = ls.title
  }
  if (body.leadSubStatusId != null) {
    if (body.leadSubStatusId === 0 || body.leadSubStatusId === '0') {
      updates.leadSubStatusId = null
      updates.leadSubStatus = null
    } else {
      const subId = BigInt(body.leadSubStatusId)
      const lss = await prisma.leadSubStatus.findUnique({ where: { id: subId } })
      if (!lss) return c.json({ error: 'Invalid leadSubStatusId' }, 400)
      updates.leadSubStatusId = subId
      updates.leadSubStatus = lss.subStatus
    }
  }
  // Kotlin's kotlinx.serialization sends explicit `null` for nullable fields
  // the caller didn't set. Treat `null` as "no change", and reserve the empty
  // string "" as the explicit "clear this field" sentinel.
  if (body.followupDate !== undefined && body.followupDate !== null) {
    updates.followupDate = body.followupDate === '' ? null : new Date(body.followupDate)
  }
  if (body.comment !== undefined && body.comment !== null) {
    updates.comment = body.comment === '' ? null : body.comment
    updates.commentDate = body.comment === '' ? null : new Date()
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No updatable fields' }, 400)
  }

  const isStatusChange = 'leadStatus' in updates || 'leadSubStatus' in updates
  const current = isStatusChange
    ? await prisma.lead.findUnique({
        where: { id },
        select: { leadStatus: true, leadSubStatus: true },
      })
    : null

  const lead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { ...updates, updatedAt: new Date() },
    })
    if (isStatusChange && current) {
      await recordStatusChange({
        leadId: id,
        changedById: BigInt(userId),
        fromStatus: current.leadStatus,
        toStatus: updated.leadStatus ?? '',
        fromSubStatus: current.leadSubStatus,
        toSubStatus: updated.leadSubStatus,
        source: 'manual',
        tx,
      })
    }
    return updated
  })

  return c.json(bigintFix({
    id: Number(lead.id),
    leadStatus: lead.leadStatus,
    leadSubStatus: lead.leadSubStatus,
    leadStatusId: lead.leadStatusId ? Number(lead.leadStatusId) : null,
    leadSubStatusId: lead.leadSubStatusId ? Number(lead.leadSubStatusId) : null,
    followupDate: lead.followupDate,
    updatedAt: lead.updatedAt,
  }))
})

// GET /api/mobile/leads/:id/notes
mobileRoutes.get('/leads/:id/notes', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) {
    return c.json(NOT_ASSIGNED, 403)
  }
  const notes = await prisma.leadNote.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { id: true, name: true } } },
  })
  return c.json(bigintFix(shapeNotes(notes)))
})

// POST /api/mobile/leads/:id/notes — counsellor adds a note
mobileRoutes.post('/leads/:id/notes', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) {
    return c.json(NOT_ASSIGNED, 403)
  }
  const { note } = await c.req.json()
  if (!note || typeof note !== 'string' || note.trim() === '') {
    return c.json({ error: 'note required' }, 400)
  }
  const created = await prisma.leadNote.create({
    data: { leadId: id, userId: BigInt(userId), note: note.trim() },
    include: { user: { select: { id: true, name: true } } },
  })
  // Touch lead.updatedAt so the next mobile sync sees it.
  await prisma.lead.update({ where: { id }, data: { updatedAt: new Date() } })
  return c.json(bigintFix({
    id: Number(created.id),
    note: created.note,
    createdAt: created.createdAt,
    userId: Number(created.userId),
    userName: created.user?.name ?? null,
  }), 201)
})

// GET /api/mobile/leads/:id/timeline — unified activity feed (status + followup + note + call + comment)
mobileRoutes.get('/leads/:id/timeline', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)

  const [history, followups, notes, calls, comments, flags] = await Promise.all([
    prisma.leadStatusHistory.findMany({
      where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { changedBy: { select: { id: true, name: true } } },
    }),
    prisma.leadFollowup.findMany({
      where: { stdId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.leadNote.findMany({
      where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.mobileCall.findMany({
      where: { leadId: id, status: { not: 'TRIGGERED' } },
      orderBy: { startedAt: 'desc' }, take: 100,
    }),
    prisma.leadComment.findMany({
      where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.flagMessage.findMany({
      where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 50,
    }),
  ])

  return c.json(buildTimeline({
    history, followups, notes, calls, comments, flags,
    flagUsers: await loadFlagUsers(flags),
  }))
})

// GET /api/mobile/leads/:id/followups
mobileRoutes.get('/leads/:id/followups', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const rows = await followupService.getFollowups(id, 100)
  return c.json(bigintFix(rows))
})

// POST /api/mobile/leads/:id/followups — runs the full cascade (status/sub-status/dept/reminder)
mobileRoutes.post('/leads/:id/followups', async (c) => {
  const { userId, role } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const body = await c.req.json()
  if (!body.comment || typeof body.comment !== 'string' || !body.comment.trim()) {
    return c.json({ error: 'comment required' }, 400)
  }
  // Strip nulls so the service's `if (x !== undefined)` checks don't choke
  // on BigInt(null) etc. (Kotlin serializes unset nullable fields as `null`.)
  const opt = <T,>(v: T | null | undefined): T | undefined =>
    v == null ? undefined : v
  try {
    const created = await followupService.addLeadFollowup({
      stdId: id,
      userid: BigInt(userId),
      comment: body.comment.trim(),
      followupDate: opt(body.followupDate) || undefined,
      leadStatusId: opt(body.leadStatusId),
      leadSubStatusId: opt(body.leadSubStatusId),
      statusLeadTypeId: opt(body.statusLeadTypeId),
      callAnsweredStatus: opt(body.callAnsweredStatus),
      departmentId: opt(body.departmentId),
      fStatus: opt(body.fStatus),
      leadFollowStatus: opt(body.leadFollowStatus),
      type: opt(body.type) ?? 'followup',
      description: opt(body.description),
      // Passing `role` arms the pipeline-direction guard. Without it mobile
      // silently skipped the check the web modal enforces, so a counsellor on
      // Android could walk a lead backward through the pipeline (e.g.
      // Counselling → Tele Calling) while the browser refused the same action.
      role,
    })
    return c.json(bigintFix(created), 201)
  } catch (err) {
    // Mirror the web route's structured rejections so the app can show a real
    // message instead of a bare 500 now that the guard is armed here.
    const e = err as {
      code?: string; message?: string
      fromDeptId?: number; toDeptId?: number
      fromDeptName?: string; toDeptName?: string
    }
    if (e?.code === 'backward_move_blocked') {
      return c.json(
        {
          error: 'backward_move_blocked',
          message: e.message,
          fromDeptId: e.fromDeptId,
          toDeptId: e.toDeptId,
          fromDept: e.fromDeptName,
          toDept: e.toDeptName,
        },
        403,
      )
    }
    if (e?.code === 'status_dept_mismatch') {
      return c.json({ error: 'status_dept_mismatch', message: e.message }, 400)
    }
    throw err
  }
})

// GET /api/mobile/leads/:id/comments
mobileRoutes.get('/leads/:id/comments', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const rows = await prisma.leadComment.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true } } },
  })
  return c.json(bigintFix(shapeComments(rows)))
})

// POST /api/mobile/leads/:id/comments
mobileRoutes.post('/leads/:id/comments', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const { comment } = await c.req.json()
  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return c.json({ error: 'comment required' }, 400)
  }
  const created = await prisma.leadComment.create({
    data: { leadId: id, userId: BigInt(userId), comment: comment.trim() },
    include: { user: { select: { id: true, name: true } } },
  })
  await prisma.lead.update({ where: { id }, data: { updatedAt: new Date() } })
  return c.json(bigintFix({
    id: Number(created.id),
    comment: created.comment,
    createdAt: created.createdAt,
    userId: Number(created.userId),
    userName: created.user?.name ?? null,
  }), 201)
})

// GET /api/mobile/leads/:id/flags — list flag messages (counsellor side: 'rcv')
mobileRoutes.get('/leads/:id/flags', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const rows = await prisma.flagMessage.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return c.json(bigintFix(shapeFlags(rows, await loadFlagUsers(rows))))
})

// POST /api/mobile/leads/:id/flag — counsellor flags lead back to admin (always 'rcv')
mobileRoutes.post('/leads/:id/flag', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const body = await c.req.json().catch(() => ({}))
  const message: string | undefined = body?.message

  const lead = await prisma.lead.findUnique({ where: { id }, select: { flagRcv: true } })
  if (!lead) return c.json({ error: 'Not found' }, 404)
  const wasOn = lead.flagRcv === 1
  const updated = await prisma.lead.update({
    where: { id }, data: { flagRcv: wasOn ? 0 : 1 },
    select: { flagSend: true, flagRcv: true },
  })
  if (!wasOn && message?.trim()) {
    await prisma.flagMessage.create({
      data: { leadId: id, userId: BigInt(userId), message: message.trim(), type: 'rcv' },
    })
  }
  // Releasing into the shared Flag bucket — drop every active assignment so the
  // lead surfaces for any counsellor to claim.
  if (!wasOn) {
    await prisma.asignedLead.updateMany({
      where: { stdId: id, status: 1 },
      data: { status: 0 },
    })
  }
  return c.json(updated)
})

// GET /api/mobile/leads/:id/history — status change audit trail
mobileRoutes.get('/leads/:id/history', async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  if (!(await ensureAssigned(userId, id))) return c.json(NOT_ASSIGNED, 403)
  const rows = await prisma.leadStatusHistory.findMany({
    where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100,
    include: { changedBy: { select: { id: true, name: true } } },
  })
  return c.json(bigintFix(shapeHistory(rows)))
})

// ─── Filter Leads (lead-staging) — mobile ──────────────────────────────────
// The web "Filter Leads" feature (frontend/src/pages/admin/FilterLeads.tsx +
// FilterLeadsBatch.tsx, backed by lead-staging.routes.ts). Admin uploads
// batches of purchased leads and assigns them to counsellors; the counsellor
// verifies each lead (Verified / Not Verified) + leaves a note, then the admin
// seeds the verified ones into "My Leads" from the web.
//
// These mobile routes mirror the web ones but are scoped to authenticateMobile
// and self-assignment. Seeding stays web/admin-only — counsellors only verify.
// (lead-staging.routes.ts uses the web `authenticate` middleware which rejects
//  the mobile-audience JWT, so we re-expose the read/verify surface here.)

function isAssignedToBatch(
  assignees: { userId: bigint }[],
  userId: number,
): boolean {
  const me = BigInt(userId)
  return assignees.some((a) => a.userId === me)
}

// GET /api/mobile/filter-leads — active batches assigned to this counsellor
mobileRoutes.get('/filter-leads', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const batches = await prisma.leadStagingBatch.findMany({
    where: { deletedAt: null, assignees: { some: { userId: BigInt(userId) } } },
    include: {
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const out = batches.map((b) => ({
    ...b,
    assignees: b.assignees.map((a) => ({ id: Number(a.user.id), name: a.user.name })),
  }))
  return c.json(bigintFix(out))
})

// GET /api/mobile/filter-leads/:id — batch detail with items (must be mine)
mobileRoutes.get('/filter-leads/:id', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const id = BigInt(c.req.param('id'))
  const batch = await prisma.leadStagingBatch.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: 'asc' } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })
  if (!batch || batch.deletedAt) return c.json({ error: 'Batch not found' }, 404)
  if (!isAssignedToBatch(batch.assignees, userId)) {
    return c.json({ error: 'Forbidden: batch not assigned to you' }, 403)
  }
  const out = {
    ...batch,
    assignees: batch.assignees.map((a) => ({ id: Number(a.user.id), name: a.user.name })),
  }
  return c.json(bigintFix(out))
})

// PATCH /api/mobile/filter-leads/items/:itemId — verify / not-verified / comment
// Body: { status?: "verified" | "rejected" | "pending", comments?: string }
// `status` is used (instead of the web's boolean `verified`) because the mobile
// JSON serializer drops explicit nulls — a string keeps "set to pending"
// expressible over the wire. The web `verified` boolean is also accepted.
mobileRoutes.patch('/filter-leads/items/:itemId', authenticateMobile, async (c) => {
  const { userId } = c.get('user')
  const itemId = BigInt(c.req.param('itemId'))
  const body = await c.req.json<{
    status?: string
    verified?: boolean | null
    callNotAnswered?: boolean
    comments?: string
  }>()

  const existing = await prisma.leadStagingItem.findUnique({
    where: { id: itemId },
    include: {
      batch: {
        select: { id: true, deletedAt: true, assignees: { select: { userId: true } } },
      },
    },
  })
  if (!existing || existing.batch.deletedAt) return c.json({ error: 'Item not found' }, 404)
  if (!isAssignedToBatch(existing.batch.assignees, userId)) {
    return c.json({ error: 'Forbidden: batch not assigned to you' }, 403)
  }
  if (existing.seeded) return c.json({ error: 'Cannot modify a seeded item' }, 400)

  const data: { verified?: boolean | null; callNotAnswered?: boolean; comments?: string } = {}
  if (typeof body.status === 'string') {
    // Map the explicit string status → the underlying field set. Reject
    // anything else so a typo'd/garbage value can't silently flip an item
    // to pending and corrupt the batch counter.
    const s = body.status
    if (s === 'verified') {
      data.verified = true
      data.callNotAnswered = false
    } else if (s === 'rejected') {
      data.verified = false
      data.callNotAnswered = false
    } else if (s === 'pending') {
      data.verified = null
      data.callNotAnswered = false
    } else if (s === 'call_not_answered') {
      data.verified = null
      data.callNotAnswered = true
    } else {
      return c.json({ error: 'Invalid status (expected verified | rejected | pending | call_not_answered)' }, 400)
    }
  } else {
    if ('callNotAnswered' in body) {
      data.callNotAnswered = !!body.callNotAnswered
      if (data.callNotAnswered) data.verified = null
    }
    if ('verified' in body) {
      data.verified = body.verified ?? null
      if (data.verified !== null) data.callNotAnswered = false
    }
  }
  if ('comments' in body && body.comments !== undefined && body.comments !== null) {
    data.comments = body.comments
  }
  if (Object.keys(data).length === 0) {
    return c.json({ error: 'No updatable fields' }, 400)
  }

  const updated = await prisma.leadStagingItem.update({ where: { id: itemId }, data })

  // Recompute batch counters across all three review states.
  const [verifiedAgg, callAgg] = await Promise.all([
    prisma.leadStagingItem.groupBy({
      by: ['verified'],
      where: { batchId: existing.batchId },
      _count: { _all: true },
    }),
    prisma.leadStagingItem.count({
      where: { batchId: existing.batchId, callNotAnswered: true },
    }),
  ])
  let verifiedCount = 0
  let rejectedCount = 0
  for (const row of verifiedAgg) {
    if (row.verified === true) verifiedCount = row._count._all
    else if (row.verified === false) rejectedCount = row._count._all
  }
  await prisma.leadStagingBatch.update({
    where: { id: existing.batchId },
    data: { verifiedCount, rejectedCount, callNotAnsweredCount: callAgg },
  })

  return c.json(bigintFix(updated))
})

// GET /api/mobile/calls — paginated + filtered call log for the counsellor.
// Mirrors the web /app/calls page filter surface (see frontend/src/pages/admin/Calls.tsx).
// Query params:
//   page, pageSize                       — pagination (default 100, cap 500)
//   range=today|yesterday|week|month|year|all
//                                        — quick date range (default all). 'month' = last 30 days,
//                                          'year' = last 365 days. Ignored if fromDate/toDate set.
//   fromDate, toDate (YYYY-MM-DD)        — explicit date range, overrides `range`
//   status                               — ANSWERED | MISSED | NO_ANSWER | REJECTED | BUSY | FAILED | RINGING
//   direction                            — OUTGOING | INCOMING
//   q                                    — search by phone tail OR lead name (3+ chars)
//   hasRecording=true|false              — only calls with / without an uploaded recording
//   userId                               — (admin only — currently unreachable since mobile login is
//                                          counsellor-only, but accepted for future use)
//
// Returns rows + total + totalPages + a filter-aware `summary` block and a
// separate `today` block so the screen header can show today's snapshot
// regardless of which filter is active.
mobileRoutes.get('/calls', authenticateMobile, async (c) => {
  const user = c.get('user')
  const uid = BigInt(user.userId)
  const userRole = (user.role ?? '').toLowerCase()
  const isAdminLike = userRole === 'admin' || userRole === 'sub-admin'

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query('pageSize') ?? 100)))
  const range = (c.req.query('range') ?? 'all').toLowerCase()
  const q = (c.req.query('q') ?? '').trim()
  const status = (c.req.query('status') ?? '').trim().toUpperCase()
  const direction = (c.req.query('direction') ?? '').trim().toUpperCase()
  const hasRecording = c.req.query('hasRecording')
  const fromDateStr = (c.req.query('fromDate') ?? '').trim()
  const toDateStr = (c.req.query('toDate') ?? '').trim()
  const requestedUserId = c.req.query('userId')

  // Date filter: explicit fromDate/toDate wins; otherwise fall back to `range`.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 6)
  const startOfMonth = new Date(startOfToday); startOfMonth.setDate(startOfMonth.getDate() - 29)
  const startOfYear = new Date(startOfToday); startOfYear.setDate(startOfYear.getDate() - 364)

  function parseDate(s: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const d = new Date(s + 'T00:00:00')
    return isNaN(d.getTime()) ? null : d
  }

  const dateFilter: Prisma.DateTimeFilter | undefined = (() => {
    const from = parseDate(fromDateStr)
    const to = parseDate(toDateStr)
    if (from || to) {
      const f: Prisma.DateTimeFilter = {}
      if (from) f.gte = from
      if (to) {
        const end = new Date(to); end.setDate(end.getDate() + 1)
        f.lt = end
      }
      return f
    }
    switch (range) {
      case 'today': return { gte: startOfToday }
      case 'yesterday': return { gte: startOfYesterday, lt: startOfToday }
      case 'week': return { gte: startOfWeek }
      case 'month': return { gte: startOfMonth }
      case 'year': return { gte: startOfYear }
      default: return undefined
    }
  })()

  // Resolve scope: counsellor sees only their own calls; admin can pass userId.
  const scopedUserId: bigint = isAdminLike && requestedUserId
    ? BigInt(requestedUserId)
    : uid

  const VALID_STATUSES = new Set(['ANSWERED', 'MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY', 'FAILED', 'RINGING'])
  const VALID_DIRECTIONS = new Set(['OUTGOING', 'INCOMING'])

  const callsWhere: Prisma.MobileCallWhereInput = {
    userId: scopedUserId,
    // Hide TRIGGERED placeholders — they get merged into a real row by /sync
    // once the call actually happens. Showing them caused 1 call to appear as 2.
    ...(VALID_STATUSES.has(status)
      ? { status: status as Prisma.MobileCallWhereInput['status'] }
      : { status: { not: 'TRIGGERED' } }),
    ...(VALID_DIRECTIONS.has(direction) ? { direction: direction as 'OUTGOING' | 'INCOMING' } : {}),
    ...(dateFilter ? { startedAt: dateFilter } : {}),
    ...(hasRecording === 'true' ? { recordingPath: { not: null } } : {}),
    ...(hasRecording === 'false' ? { recordingPath: null } : {}),
  }
  if (q.length >= 3) {
    const last10 = q.replace(/\D/g, '').slice(-10)
    callsWhere.OR = [
      ...(last10.length >= 4 ? [{ phoneNumber: { endsWith: last10 } }] : []),
      { lead: { is: { name: { contains: q, mode: 'insensitive' as const } } } },
    ]
  }

  // Today snapshot — independent of the active filter. Always scoped to the
  // logged-in counsellor (admins viewing someone else's calls still see their
  // own "today" stats, matching the web behaviour).
  const todayWhere: Prisma.MobileCallWhereInput = {
    userId: uid,
    status: { not: 'TRIGGERED' },
    startedAt: { gte: startOfToday },
  }

  const [rows, total, filterAgg, todayAgg] = await Promise.all([
    prisma.mobileCall.findMany({
      where: callsWhere,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { lead: { select: { id: true, name: true } } },
    }),
    prisma.mobileCall.count({ where: callsWhere }),
    prisma.mobileCall.findMany({
      where: callsWhere,
      select: { status: true, durationSec: true },
    }),
    prisma.mobileCall.findMany({
      where: todayWhere,
      select: { status: true, durationSec: true },
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function aggregate(rs: { status: string; durationSec: number | null }[]) {
    const total = rs.length
    const answered = rs.filter((s) => s.status === 'ANSWERED').length
    const missed = rs.filter((s) => s.status === 'MISSED').length
    const noAnswer = rs.filter((s) => s.status === 'NO_ANSWER').length
    const rejected = rs.filter((s) => s.status === 'REJECTED' || s.status === 'BUSY').length
    const failed = rs.filter((s) => s.status === 'FAILED').length
    const totalSec = rs.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
    const answeredSec = rs.filter((s) => s.status === 'ANSWERED')
      .reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
    return { total, answered, missed, noAnswer, rejected, failed, totalSec, answeredSec, talkSec: totalSec }
  }

  return c.json(bigintFix({
    rows: rows.map((r) => ({
      id: Number(r.id),
      phoneNumber: r.phoneNumber,
      direction: r.direction,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationSec: r.durationSec,
      hasRecording: !!r.recordingPath,
      triggeredFrom: r.triggeredFrom,
      simSlot: r.simSlot,
      simCarrier: r.simCarrier,
      simNumber: r.simNumber,
      lead: r.lead ? { id: Number(r.lead.id), name: r.lead.name } : null,
    })),
    page,
    pageSize,
    total,
    totalPages,
    summary: aggregate(filterAgg),
    today: aggregate(todayAgg),
  }))
})
