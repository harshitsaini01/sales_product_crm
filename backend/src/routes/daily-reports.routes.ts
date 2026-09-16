import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { bigintFix } from '../utils/bigint-fix'
import { getFollowupBacklogCounts } from '../services/leads/followup-backlog.service'

export const dailyReportsRoutes = new Hono()

dailyReportsRoutes.use('*', authenticate)

const ASSIGNABLE_ROLES = ['counsellor', 'sales-head', 'employee', 'franchise']

function fmtTalkTime(sec: number): string {
  if (sec <= 0) return '0m'
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`
}

// GET /api/daily-reports/team-summary?date=YYYY-MM-DD — admin roster view:
// returns full metrics per counsellor: Live Pipeline (active, enrolled, conv %, stale),
// Follow-ups backlog (overdue, today, upcoming), Activity on date (new leads, F/U, status changes),
// and Calls on date (total, answered, unanswered, talk time).
dailyReportsRoutes.get('/team-summary', adminOnly, async (c) => {
  const dateParam = c.req.query('date')
  const day = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : new Date().toISOString().slice(0, 10)
  const dayStart = new Date(`${day}T00:00:00`)
  const dayEnd = new Date(`${day}T23:59:59.999`)
  const staleCutoff = new Date(dayStart.getTime() - 7 * 86400000) // 7 days stale

  const users = await prisma.user.findMany({
    where: {
      status: 1,
      OR: [
        { role: { in: ASSIGNABLE_ROLES } },
        { roles: { some: { role: { in: ASSIGNABLE_ROLES } } } },
      ],
    },
    select: { id: true, name: true, designation: true, role: true },
    orderBy: { name: 'asc' },
  })
  const userIds = users.map((u) => u.id)

  const [
    mobileCallsGrouped,
    followupsGrouped,
    statusChangesGrouped,
    newAssignGrouped,
    activeLeadsGrouped,
    enrolledLeadsGrouped,
    staleLeadsGrouped,
  ] = await Promise.all([
    prisma.mobileCall.groupBy({
      by: ['userId', 'status'],
      where: { userId: { in: userIds }, startedAt: { gte: dayStart, lte: dayEnd } },
      _count: { _all: true },
      _sum: { durationSec: true },
    }),
    prisma.leadFollowup.groupBy({
      by: ['userid'],
      where: { userid: { in: userIds }, createdAt: { gte: dayStart, lte: dayEnd } },
      _count: { _all: true },
    }),
    prisma.leadStatusHistory.groupBy({
      by: ['changedById'],
      where: { changedById: { in: userIds }, createdAt: { gte: dayStart, lte: dayEnd } },
      _count: { _all: true },
    }),
    prisma.asignedLead.groupBy({
      by: ['clrId'],
      where: { clrId: { in: userIds }, status: 1, createdAt: { gte: dayStart, lte: dayEnd } },
      _count: { _all: true },
    }),
    prisma.asignedLead.groupBy({
      by: ['clrId'],
      where: { clrId: { in: userIds }, status: 1, lead: { trash: 0 } },
      _count: { _all: true },
    }),
    prisma.asignedLead.groupBy({
      by: ['clrId'],
      where: { clrId: { in: userIds }, status: 1, lead: { trash: 0, enrolled: 1 } },
      _count: { _all: true },
    }),
    prisma.asignedLead.groupBy({
      by: ['clrId'],
      where: { clrId: { in: userIds }, status: 1, lead: { trash: 0, updatedAt: { lt: staleCutoff } } },
      _count: { _all: true },
    }),
  ])

  // Maps for quick lookup
  const followupMap = new Map(followupsGrouped.map((r) => [r.userid.toString(), r._count._all]))
  const statusMap = new Map(statusChangesGrouped.map((r) => [r.changedById.toString(), r._count._all]))
  const newAssignMap = new Map(newAssignGrouped.map((r) => [r.clrId.toString(), r._count._all]))

  const activeMap = new Map(activeLeadsGrouped.map((r) => [r.clrId.toString(), r._count._all]))
  const enrolledMap = new Map(enrolledLeadsGrouped.map((r) => [r.clrId.toString(), r._count._all]))
  const staleMap = new Map(staleLeadsGrouped.map((r) => [r.clrId.toString(), r._count._all]))

  // Mobile call stats per user
  const callsTotalMap = new Map<string, number>()
  const callsAnsMap = new Map<string, number>()
  const callsUnansMap = new Map<string, number>()
  const talkSecMap = new Map<string, number>()

  for (const row of mobileCallsGrouped) {
    if (!row.userId) continue
    const k = row.userId.toString()
    const cnt = row._count._all
    if (row.status !== 'MISSED') {
      callsTotalMap.set(k, (callsTotalMap.get(k) ?? 0) + cnt)
    }
    if (row.status === 'ANSWERED') {
      callsAnsMap.set(k, (callsAnsMap.get(k) ?? 0) + cnt)
      talkSecMap.set(k, (talkSecMap.get(k) ?? 0) + (row._sum.durationSec ?? 0))
    } else {
      callsUnansMap.set(k, (callsUnansMap.get(k) ?? 0) + cnt)
    }
  }

  const backlogs = await Promise.all(users.map((u) => getFollowupBacklogCounts(u.id, u.role, dayStart)))

  const rows = users.map((u, i) => {
    const k = u.id.toString()
    const active = activeMap.get(k) ?? 0
    const enrolled = enrolledMap.get(k) ?? 0
    const stale = staleMap.get(k) ?? 0
    const convRate = active > 0 ? `${((enrolled / active) * 100).toFixed(1)}%` : '0.0%'

    const newLeads = newAssignMap.get(k) ?? 0
    const followupsDone = followupMap.get(k) ?? 0
    const statusChanges = statusMap.get(k) ?? 0

    const totalCalls = callsTotalMap.get(k) ?? 0
    const answeredCalls = callsAnsMap.get(k) ?? 0
    const unansweredCalls = callsUnansMap.get(k) ?? 0
    const talkSec = talkSecMap.get(k) ?? 0

    return {
      userId: Number(u.id),
      name: u.name,
      designation: u.designation,
      role: u.role,
      pipeline: {
        active,
        enrolled,
        convRate,
        stale,
      },
      backlog: backlogs[i],
      activity: {
        newLeads,
        followupsDone,
        statusChanges,
      },
      calls: {
        total: totalCalls,
        answered: answeredCalls,
        unanswered: unansweredCalls,
        talkSec,
        talkTimeFormatted: fmtTalkTime(talkSec),
      },
      callsToday: totalCalls,
      followupsToday: followupsDone,
      statusChangesToday: statusChanges,
    }
  })

  return c.json({ date: day, rows })
})

// GET /api/daily-reports — list. Counsellors see only their own; admins see all.
// Query params: userId (admin only), fromDate, toDate
dailyReportsRoutes.get('/', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const queryUserId = c.req.query('userId')
  const fromDate = c.req.query('fromDate')
  const toDate = c.req.query('toDate')

  const where: Record<string, unknown> = { status: 1 }
  if (!isAdmin) {
    where.userId = BigInt(userId)
  } else if (queryUserId) {
    where.userId = BigInt(queryUserId)
  }
  if (fromDate || toDate) {
    where.reportDate = {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate ? { lte: new Date(toDate) } : {}),
    }
  }

  const reports = await prisma.dailyReport.findMany({
    where,
    orderBy: { reportDate: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true, designation: true } } },
  })
  return c.json(bigintFix(reports))
})

// GET /api/daily-reports/today — current user's report for today (or null)
dailyReportsRoutes.get('/today', async (c) => {
  const { userId } = c.get('user')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const report = await prisma.dailyReport.findUnique({
    where: { daily_report_user_date_uk: { userId: BigInt(userId), reportDate: today } },
  })
  return c.json(report ? bigintFix(report) : null)
})

// POST /api/daily-reports — create or upsert today's report
dailyReportsRoutes.post('/', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()
  const reportDate = body.reportDate ? new Date(body.reportDate) : new Date()
  reportDate.setHours(0, 0, 0, 0)

  if (!body.summary || !String(body.summary).trim()) {
    return c.json({ error: 'Summary is required' }, 400)
  }

  const report = await prisma.dailyReport.upsert({
    where: { daily_report_user_date_uk: { userId: BigInt(userId), reportDate } },
    update: {
      summary: body.summary,
      challenges: body.challenges || null,
      tomorrowPlan: body.tomorrowPlan || null,
      leadsContacted: Number(body.leadsContacted) || 0,
      callsMade: Number(body.callsMade) || 0,
      meetingsHeld: Number(body.meetingsHeld) || 0,
      enrollments: Number(body.enrollments) || 0,
    },
    create: {
      userId: BigInt(userId),
      reportDate,
      summary: body.summary,
      challenges: body.challenges || null,
      tomorrowPlan: body.tomorrowPlan || null,
      leadsContacted: Number(body.leadsContacted) || 0,
      callsMade: Number(body.callsMade) || 0,
      meetingsHeld: Number(body.meetingsHeld) || 0,
      enrollments: Number(body.enrollments) || 0,
    },
  })
  return c.json(bigintFix(report), 201)
})

// PATCH /api/daily-reports/:id — owner or admin can update
dailyReportsRoutes.patch('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const body = await c.req.json()

  const existing = await prisma.dailyReport.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!isAdmin && Number(existing.userId) !== userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const updated = await prisma.dailyReport.update({
    where: { id },
    data: {
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.challenges !== undefined ? { challenges: body.challenges } : {}),
      ...(body.tomorrowPlan !== undefined ? { tomorrowPlan: body.tomorrowPlan } : {}),
      ...(body.leadsContacted !== undefined ? { leadsContacted: Number(body.leadsContacted) } : {}),
      ...(body.callsMade !== undefined ? { callsMade: Number(body.callsMade) } : {}),
      ...(body.meetingsHeld !== undefined ? { meetingsHeld: Number(body.meetingsHeld) } : {}),
      ...(body.enrollments !== undefined ? { enrollments: Number(body.enrollments) } : {}),
    },
  })
  return c.json(bigintFix(updated))
})

// DELETE /api/daily-reports/:id — admin only
dailyReportsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.dailyReport.update({ where: { id }, data: { status: 0 } })
  return c.json({ message: 'Deleted' })
})
