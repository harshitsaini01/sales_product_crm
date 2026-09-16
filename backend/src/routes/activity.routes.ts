import { Hono } from 'hono'
import type { Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import {
  getStatus,
  ackPendingEvents,
  pingActivity,
  loadConfig,
  saveConfig,
  computeStage,
} from '../services/inactivity.service'
import { loginLogsScopeUserIds } from '../utils/branch-scope'

export const activityRoutes = new Hono()

activityRoutes.use('*', authenticate)

// GET /api/activity/status — polled by the frontend tracker every 30s.
activityRoutes.get('/status', async (c) => {
  const user = c.get('user')
  const status = await getStatus(user.userId)
  return c.json(status)
})

// POST /api/activity/ping — explicit heartbeat from web/mobile (click, scroll,
// route change). Always succeeds, even if disabled in settings.
activityRoutes.post('/ping', async (c) => {
  const user = c.get('user')
  await pingActivity(user.userId, 'web')
  return c.json({ ok: true })
})

// POST /api/activity/ack — counsellor pressed "Mark as Read" on the popup.
activityRoutes.post('/ack', async (c) => {
  const user = c.get('user')
  const count = await ackPendingEvents(user.userId)
  return c.json({ acknowledged: count })
})

// GET /api/activity/me — counsellor self-view. Bundles config + status + today
// counts + last 30 days of own events so the My Activity page renders in one call.
activityRoutes.get('/me', async (c) => {
  const user = c.get('user')
  const userId = BigInt(user.userId)

  const cfg = await loadConfig()
  const status = await getStatus(user.userId)

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const monthStart = new Date()
  monthStart.setDate(monthStart.getDate() - 30)
  monthStart.setHours(0, 0, 0, 0)

  const [todayEvents, recentEvents] = await Promise.all([
    prisma.inactivityEvent.findMany({
      where: { userId, raisedAt: { gte: dayStart } },
      orderBy: { raisedAt: 'asc' },
    }),
    prisma.inactivityEvent.findMany({
      where: { userId, raisedAt: { gte: monthStart } },
      orderBy: { raisedAt: 'desc' },
      take: 200,
    }),
  ])

  const todayCounts = todayEvents.reduce(
    (acc, e) => {
      if (e.kind === 'warning') acc.warning++
      else if (e.kind === 'alert') acc.alert++
      else if (e.kind === 'halfday') acc.halfday++
      return acc
    },
    { warning: 0, alert: 0, halfday: 0 },
  )

  return c.json({
    enabled: cfg.enabled,
    config: {
      warningMinutes: cfg.warningMinutes,
      alertMinutes: cfg.alertMinutes,
      halfdayMinutes: cfg.halfdayMinutes,
    },
    status,
    todayCounts,
    todayEvents: todayEvents.map((e) => ({
      id: Number(e.id),
      kind: e.kind,
      raisedAt: e.raisedAt.toISOString(),
      ackAt: e.ackAt?.toISOString() ?? null,
      inactiveSeconds: e.inactiveSeconds,
    })),
    recentEvents: recentEvents.map((e) => ({
      id: Number(e.id),
      kind: e.kind,
      raisedAt: e.raisedAt.toISOString(),
      ackAt: e.ackAt?.toISOString() ?? null,
      inactiveSeconds: e.inactiveSeconds,
    })),
  })
})

// GET /api/activity/config — current thresholds (any authed user, so the UI can
// render the right copy + countdowns).
activityRoutes.get('/config', async (c) => {
  const cfg = await loadConfig()
  return c.json(cfg)
})

// PATCH /api/activity/config — admin only. Toggle on/off + thresholds.
activityRoutes.patch('/config', adminOnly, async (c) => {
  const body = await c.req.json<{
    enabled?: boolean
    warningMinutes?: number
    alertMinutes?: number
    halfdayMinutes?: number
  }>()

  if (body.warningMinutes !== undefined && body.warningMinutes < 1) {
    return c.json({ error: 'warningMinutes must be at least 1' }, 400)
  }
  if (
    body.alertMinutes !== undefined &&
    body.warningMinutes !== undefined &&
    body.alertMinutes <= body.warningMinutes
  ) {
    return c.json({ error: 'alertMinutes must be greater than warningMinutes' }, 400)
  }
  if (
    body.halfdayMinutes !== undefined &&
    body.alertMinutes !== undefined &&
    body.halfdayMinutes <= body.alertMinutes
  ) {
    return c.json({ error: 'halfdayMinutes must be greater than alertMinutes' }, 400)
  }

  await saveConfig(body)
  const cfg = await loadConfig()
  return c.json(cfg)
})

// GET /api/activity/summary — admin rollup. One row per counsellor with
// warning/alert/halfday counts in the date range, current lastActivityAt and
// current stage. Drives the InactivityMonitor table.
//
// Query params:
//   from / to  — ISO date (defaults to last 7 days)
//   branchId   — optional branch filter
activityRoutes.get('/summary', adminOnly, async (c) => {
  const cfg = await loadConfig()
  const now = new Date()

  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const branchIdParam = c.req.query('branchId')

  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const to = toParam ? new Date(toParam) : now

  // All active counsellors / sales-heads, optionally branch-scoped.
  const users = await prisma.user.findMany({
    where: {
      status: 1,
      OR: [{ role: 'counsellor' }, { role: 'sales-head' }],
      ...(branchIdParam ? { branchId: BigInt(branchIdParam) } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      role: true,
      branchId: true,
      lastActivityAt: true,
      lastActivitySource: true,
      onCallSince: true,
    },
    orderBy: { name: 'asc' },
  })

  const onCallStale = new Date(now.getTime() - 4 * 60 * 60 * 1000)

  // Group counts in one query and stitch them back per user. Cheaper than
  // N+1 even for large counsellor pools.
  const grouped = await prisma.inactivityEvent.groupBy({
    by: ['userId', 'kind'],
    where: {
      raisedAt: { gte: from, lte: to },
      userId: { in: users.map((u) => u.id) },
    },
    _count: { _all: true },
  })

  // userId -> { warning, alert, halfday }
  const counts = new Map<string, { warning: number; alert: number; halfday: number }>()
  for (const g of grouped) {
    const key = g.userId.toString()
    const row = counts.get(key) ?? { warning: 0, alert: 0, halfday: 0 }
    if (g.kind === 'warning') row.warning = g._count._all
    else if (g.kind === 'alert') row.alert = g._count._all
    else if (g.kind === 'halfday') row.halfday = g._count._all
    counts.set(key, row)
  }

  const rows = users.map((u) => {
    const last = u.lastActivityAt
    const inactiveSeconds = last
      ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / 1000))
      : null
    const onCallFresh = !!u.onCallSince && u.onCallSince > onCallStale
    // While on a call we display stage as 'ok' (matches getStatus) so the
    // admin sees a clear "on call" indicator instead of a misleading "Idle".
    const rawStage =
      inactiveSeconds == null ? 'unknown' : computeStage(inactiveSeconds, cfg)
    const stage = onCallFresh ? 'ok' : rawStage
    const c = counts.get(u.id.toString()) ?? { warning: 0, alert: 0, halfday: 0 }
    return {
      userId: Number(u.id),
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      role: u.role,
      branchId: u.branchId ? Number(u.branchId) : null,
      lastActivityAt: last?.toISOString() ?? null,
      lastActivitySource: u.lastActivitySource,
      inactiveSeconds,
      currentStage: stage,
      onCall: onCallFresh,
      onCallSince: onCallFresh ? u.onCallSince!.toISOString() : null,
      counts: c,
      total: c.warning + c.alert + c.halfday,
    }
  })

  return c.json({
    from: from.toISOString(),
    to: to.toISOString(),
    enabled: cfg.enabled,
    thresholds: {
      warning: cfg.warningMinutes * 60,
      alert: cfg.alertMinutes * 60,
      halfday: cfg.halfdayMinutes * 60,
    },
    rows,
  })
})

// GET /api/activity/events — admin audit view. Most-recent first; supports
// optional ?userId= and ?kind= filters.
activityRoutes.get('/events', adminOnly, async (c) => {
  const userIdParam = c.req.query('userId')
  const kindParam = c.req.query('kind')
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const limit = Math.min(Number(c.req.query('limit') || 100), 500)

  const events = await prisma.inactivityEvent.findMany({
    where: {
      ...(userIdParam ? { userId: BigInt(userIdParam) } : {}),
      ...(kindParam ? { kind: kindParam } : {}),
      ...(fromParam || toParam
        ? {
            raisedAt: {
              ...(fromParam ? { gte: new Date(fromParam) } : {}),
              ...(toParam ? { lte: new Date(toParam) } : {}),
            },
          }
        : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { raisedAt: 'desc' },
    take: limit,
  })

  return c.json(
    events.map((e) => ({
      id: Number(e.id),
      userId: Number(e.userId),
      userName: e.user.name,
      userEmail: e.user.email,
      kind: e.kind,
      raisedAt: e.raisedAt.toISOString(),
      ackAt: e.ackAt?.toISOString() ?? null,
      inactiveSeconds: e.inactiveSeconds,
    })),
  )
})

// GET /api/activity/login-log-users — returns all active users for filtering dropdown
activityRoutes.get('/login-log-users', async (c) => {
  const scopeIds = await loginLogsScopeUserIds(c.get('user'))
  const users = await prisma.user.findMany({
    where: {
      status: 1,
      ...(scopeIds !== null ? { id: { in: scopeIds } } : {}),
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  })

  return c.json(users.map((u) => ({ ...u, id: Number(u.id) })))
})

// GET /api/activity/login-logs — audit view of who logged in, from where (IP), and when.
const ADMIN_ROLES = ['admin', 'sub-admin']

activityRoutes.get('/login-logs', async (c) => {
  const currentUser = c.get('user')
  const scopeIds = await loginLogsScopeUserIds(currentUser)

  const rawUserIdParam = c.req.query('userId')
  const userIdParam = rawUserIdParam ? decodeURIComponent(rawUserIdParam).replace(/["']/g, '').trim() : undefined
  const roleParam = c.req.query('role')
  const q = (c.req.query('q') ?? '').trim()
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const adminOnlyParam = c.req.query('adminOnly')

  const page = Math.max(1, Number(c.req.query('page') || 1))
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)))

  // Construct main LoginDetail filter
  const where: Prisma.LoginDetailWhereInput = {}

  if (userIdParam && !isNaN(Number(userIdParam))) {
    const targetUserId = BigInt(userIdParam)

    // A userId query parameter must never bypass the caller's login-log scope.
    if (scopeIds !== null && !scopeIds.some((id) => id === targetUserId)) {
      return c.json({ error: 'You can only view login logs within your permitted scope' }, 403)
    }

    where.userId = targetUserId
  } else {
    const userFilter: Prisma.UserWhereInput = {}

    if (scopeIds !== null) {
      userFilter.id = { in: scopeIds }
    }

    if (adminOnlyParam === '1' || adminOnlyParam === 'true') {
      userFilter.OR = [
        { role: { in: ADMIN_ROLES } },
        { roles: { some: { role: { in: ADMIN_ROLES } } } },
      ]
    } else if (roleParam) {
      userFilter.OR = [
        { role: roleParam },
        { roles: { some: { role: roleParam } } },
      ]
    } else {
      userFilter.AND = [
        { role: { notIn: ADMIN_ROLES } },
        { roles: { none: { role: { in: ADMIN_ROLES } } } },
      ]
    }

    where.user = userFilter
  }

  if (fromParam || toParam) {
    where.createdAt = {
      ...(fromParam ? { gte: new Date(fromParam) } : {}),
      ...(toParam ? { lte: new Date(toParam) } : {}),
    }
  }

  if (q) {
    where.OR = [
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { ip: { contains: q, mode: 'insensitive' } },
      { browser: { contains: q, mode: 'insensitive' } },
      { os: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [total, rows, uniqueUsersCount, appLoginsCount] = await Promise.all([
    prisma.loginDetail.count({ where }),
    prisma.loginDetail.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.loginDetail.groupBy({
      by: ['userId'],
      where,
    }).then((res) => res.length),
    prisma.loginDetail.count({
      where: {
        ...where,
        browser: 'Android App',
      },
    }),
  ])

  let data = await Promise.all(
    rows.map(async (r) => {
      let uName = r.user?.name
      let uEmail = r.user?.email
      let uRole = r.user?.role

      if (!uName) {
        const u = await prisma.user.findUnique({
          where: { id: r.userId },
          select: { name: true, email: true, role: true },
        })
        if (u) {
          uName = u.name
          uEmail = u.email
          uRole = u.role
        }
      }

      return {
        id: Number(r.id),
        userId: Number(r.userId),
        userName: uName || `User #${r.userId}`,
        userEmail: uEmail || '—',
        userRole: uRole || 'employee',
        ip: r.ip || '—',
        browser: r.browser || 'Web Browser',
        os: r.os || 'Desktop / Web',
        createdAt: r.createdAt.toISOString(),
      }
    })
  )

  let finalTotal = total
  let finalUnique = uniqueUsersCount
  let finalApp = appLoginsCount
  let finalWeb = total - appLoginsCount

  // FALLBACK: If a specific userId was requested and no explicit login_details were found in DB,
  // synthesize virtual login/activity logs from User metadata, DeviceToken, and account creation!
  if (userIdParam && rows.length === 0) {
    const targetUserId = BigInt(userIdParam)
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true, role: true, createdAt: true, lastActivityAt: true },
    })

    if (targetUser) {
      const virtualLogs: Array<{
        id: number
        userId: number
        userName: string
        userEmail: string
        userRole: string
        ip: string
        browser: string
        os: string
        createdAt: string
      }> = []

      // 1. Device Token (Mobile App activity)
      const device = await prisma.deviceToken.findFirst({
        where: { userId: targetUserId },
        orderBy: { lastSeenAt: 'desc' },
      })
      if (device && device.lastSeenAt) {
        virtualLogs.push({
          id: 900001,
          userId: Number(targetUser.id),
          userName: targetUser.name,
          userEmail: targetUser.email,
          userRole: targetUser.role,
          ip: 'App Active Device',
          browser: 'Android App',
          os: device.platform || 'Android App',
          createdAt: device.lastSeenAt.toISOString(),
        })
      }

      // 2. User lastActivityAt (Web CRM activity)
      if (targetUser.lastActivityAt) {
        virtualLogs.push({
          id: 900002,
          userId: Number(targetUser.id),
          userName: targetUser.name,
          userEmail: targetUser.email,
          userRole: targetUser.role,
          ip: 'Active CRM Session',
          browser: 'Web Application (Logged in)',
          os: 'Web Desktop',
          createdAt: targetUser.lastActivityAt.toISOString(),
        })
      }

      // 3. User account creation / initial registration
      virtualLogs.push({
        id: 900003,
        userId: Number(targetUser.id),
        userName: targetUser.name,
        userEmail: targetUser.email,
        userRole: targetUser.role,
        ip: 'Initial Sign-in',
        browser: 'Account Creation / Registered',
        os: 'System',
        createdAt: targetUser.createdAt.toISOString(),
      })

      data = virtualLogs
      finalTotal = virtualLogs.length
      finalUnique = 1
      finalApp = virtualLogs.filter((v) => v.browser === 'Android App').length
      finalWeb = finalTotal - finalApp
    }
  }

  return c.json({
    data,
    total: finalTotal,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(finalTotal / limit)),
    stats: {
      totalLogins: finalTotal,
      uniqueUsers: finalUnique,
      webLogins: finalWeb,
      appLogins: finalApp,
    },
  })
})
