import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { todayDateOnly, addDays, REAL_FOLLOWUP_MIN } from '../utils/date-range'
import { accessibleUserIds, leadScopeWhere, isBranchManager } from '../utils/branch-scope'
import { superAdminOnly } from '../middleware/rbac'

export const dashboardRoutes = new Hono()

dashboardRoutes.use('*', authenticate)

// GET /api/dashboard/super-admin
// Cross-branch oversight is restricted to the top-level admin; sub-admins stay scoped.
dashboardRoutes.get('/super-admin', superAdminOnly, async (c) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const [totalUsers, activeUsers, totalBranches, activeBranches, totalLeads, todayLeads, overdueFollowups, enrolledStudents, recentLogins, staffByRole, branchCoverage] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { status: 1 } }), prisma.branch.count(), prisma.branch.count({ where: { status: 1 } }),
    prisma.lead.count({ where: { trash: 0 } }), prisma.lead.count({ where: { trash: 0, createdAt: { gte: today, lt: tomorrow } } }),
    prisma.lead.count({ where: { trash: 0, followupDate: { gte: REAL_FOLLOWUP_MIN, lt: todayDateOnly() } } }), prisma.lead.count({ where: { enrolled: 1 } }),
    prisma.loginDetail.findMany({ where: { createdAt: { gte: sevenDaysAgo } }, orderBy: { createdAt: 'desc' }, take: 8, select: { createdAt: true, ip: true, user: { select: { id: true, name: true, role: true, branch: { select: { name: true } } } } } }),
    prisma.user.groupBy({ by: ['role'], where: { status: 1 }, _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    prisma.branch.findMany({ where: { status: 1 }, orderBy: { name: 'asc' }, select: { id: true, name: true, city: true, _count: { select: { users: { where: { status: 1 } } } } } }),
  ])
  return c.json({
    metrics: { totalUsers, activeUsers, totalBranches, activeBranches, totalLeads, todayLeads, overdueFollowups, enrolledStudents },
    staffByRole: staffByRole.map((row) => ({ role: row.role || 'unassigned', count: row._count.id })),
    branches: branchCoverage.map((branch) => ({ id: Number(branch.id), name: branch.name, city: branch.city, activeUsers: branch._count.users })),
    recentLogins: recentLogins.map((row) => ({ at: row.createdAt, ip: row.ip, user: { id: Number(row.user.id), name: row.user.name, role: row.user.role, branch: row.user.branch?.name || null } })),
  })
})
// GET /api/dashboard/stats
dashboardRoutes.get('/stats', async (c) => {
  const { userId, role } = c.get('user')

  const assignedFilter = await leadScopeWhere({ userId, role })

  // Anchor "today" to real IST midnight (not the server's local midnight) so
  // these counts match the createdAt bounds produced by the /app/leads
  // date-range filters (safeDate parses `YYYY-MM-DD` as `T00:00:00+05:30`
  // regardless of the server's own timezone). Previously the server's local
  // midnight was used, so on a UTC host every "New Today / This Week / This
  // Month" card disagreed with the same filter clicked through on the leads
  // page.
  const istDay = todayDateOnly() // UTC-midnight stamp for IST-today (calendar-date safe)
  const istMidnight = (date: Date) => new Date(date.getTime() - 330 * 60_000) // -5:30 → real IST midnight
  const today = istMidnight(istDay)
  const tomorrow = istMidnight(addDays(istDay, 1))
  const weekAgo = istMidnight(addDays(istDay, -7))
  const monthStart = istMidnight(new Date(Date.UTC(istDay.getUTCFullYear(), istDay.getUTCMonth(), 1)))

  const [
    totalLeads,
    todayLeads,
    weekLeads,
    monthLeads,
    todayFollowups,
    enrolledCount,
    overdueFollowups,
    activeLeads,
  ] = await Promise.all([
    prisma.lead.count({ where: { ...assignedFilter, trash: 0 } }),
    prisma.lead.count({ where: { ...assignedFilter, trash: 0, createdAt: { gte: today, lt: tomorrow } } }),
    prisma.lead.count({ where: { ...assignedFilter, trash: 0, createdAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { ...assignedFilter, trash: 0, createdAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { ...assignedFilter, trash: 0, followupDate: { gte: todayDateOnly(), lt: addDays(todayDateOnly(), 1) } } }),
    prisma.lead.count({ where: { ...assignedFilter, enrolled: 1 } }),
    prisma.lead.count({ where: { ...assignedFilter, trash: 0, followupDate: { gte: REAL_FOLLOWUP_MIN, lt: todayDateOnly() } } }),
    prisma.lead.count({ where: { ...assignedFilter, trash: 0, OR: [{ enrolled: 0 }, { enrolled: null }] } }),
  ])

  return c.json({ totalLeads, todayLeads, weekLeads, monthLeads, todayFollowups, enrolledCount, overdueFollowups, activeLeads })
})

// GET /api/dashboard/assigned-today
// Leads assigned to the current user today (based on AsignedLead.createdAt).
// Admins get a count across the org and the most recent rows; counsellors get
// only their own.
dashboardRoutes.get('/assigned-today', async (c) => {
  const { userId, role } = c.get('user')
  const ids = await accessibleUserIds({ userId, role })
  // Show the "assigned counsellor" column to admins + branch managers (who
  // oversee several counsellors), not to a plain counsellor viewing their own.
  const showCounsellor = ids === null || isBranchManager(role)
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)))

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const where = {
    status: 1,
    createdAt: { gte: today, lt: tomorrow },
    ...(ids === null ? {} : { clrId: { in: ids } }),
  }

  const [total, rows] = await Promise.all([
    prisma.asignedLead.count({ where }),
    prisma.asignedLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        createdAt: true,
        lead: {
          select: {
            id: true,
            name: true,
            mobile: true,
            email: true,
            city: true,
            followupDate: true,
            called: true,
            wapp: true,
            leadStatus: true,
            leadSubStatus: true,
          },
        },
        counsellor: showCounsellor ? { select: { id: true, name: true } } : false,
      },
    }),
  ])

  const data = rows
    .filter((r) => r.lead)
    .map((r) => ({
      id: Number(r.lead!.id),
      name: r.lead!.name,
      mobile: r.lead!.mobile,
      email: r.lead!.email,
      city: r.lead!.city,
      followupDate: r.lead!.followupDate,
      called: r.lead!.called,
      wapp: r.lead!.wapp,
      leadStatus: r.lead!.leadStatus || null,
      leadSubStatus: r.lead!.leadSubStatus || null,
      assignedAt: r.createdAt,
      counsellor: showCounsellor && r.counsellor ? { id: Number(r.counsellor.id), name: r.counsellor.name } : undefined,
    }))

  return c.json({ total, data })
})

// GET /api/dashboard/leads-by-status
dashboardRoutes.get('/leads-by-status', async (c) => {
  const { userId, role } = c.get('user')

  const assignedFilter = await leadScopeWhere({ userId, role })

  const [statuses, grouped] = await Promise.all([
    prisma.leadStatus.findMany({ where: { status: 1 }, orderBy: { priority: 'asc' } }),
    prisma.lead.groupBy({
      by: ['leadStatusId'],
      where: { ...assignedFilter, trash: 0 },
      _count: { id: true },
    }),
  ])

  const countMap = new Map(grouped.map((g) => [g.leadStatusId, g._count.id]))

  const counts = statuses.map((s) => ({
    id: Number(s.id),
    title: s.title,
    count: countMap.get(s.id) || 0,
  }))

  return c.json(counts)
})

// GET /api/dashboard/leads-by-source
dashboardRoutes.get('/leads-by-source', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })

  const where = { trash: 0, ...scope }

  const grouped = await prisma.lead.groupBy({
    by: ['website'],
    where,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  return c.json(grouped.map((g) => ({ source: g.website, count: g._count.id })))
})

// GET /api/dashboard/today-by-source
// Today's new leads grouped by website (a.k.a. "source" in the dashboard UI).
dashboardRoutes.get('/today-by-source', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const grouped = await prisma.lead.groupBy({
    by: ['website'],
    where: { trash: 0, ...scope, createdAt: { gte: today, lt: tomorrow } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  return c.json(grouped.map((g) => ({ source: g.website, count: g._count.id })))
})

// GET /api/dashboard/leads-trend?period=month
dashboardRoutes.get('/leads-trend', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })
  const period = c.req.query('period') || 'month'
  const days = period === 'year' ? 365 : period === 'week' ? 7 : 30

  const from = new Date()
  from.setDate(from.getDate() - days)

  const leads = await prisma.lead.findMany({
    where: {
      createdAt: { gte: from },
      trash: 0,
      ...scope,
    },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  // Group by date
  const grouped: Record<string, number> = {}
  for (const lead of leads) {
    const date = lead.createdAt.toISOString().split('T')[0]
    grouped[date] = (grouped[date] || 0) + 1
  }

  return c.json(Object.entries(grouped).map(([date, count]) => ({ date, count })))
})

// GET /api/dashboard/leads-trend-by-website?period=month
// Returns one series per website (top N by total) so the dashboard can render
// a multi-line chart of where leads are coming from over time.
dashboardRoutes.get('/leads-trend-by-website', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })
  const period = c.req.query('period') || 'month'
  const topN = Math.min(10, Math.max(1, parseInt(c.req.query('top') || '6', 10)))
  const days = period === 'year' ? 365 : period === 'week' ? 7 : 30

  const from = new Date()
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - days)

  const leads = await prisma.lead.findMany({
    where: {
      createdAt: { gte: from },
      trash: 0,
      ...scope,
    },
    select: { createdAt: true, website: true },
    orderBy: { createdAt: 'asc' },
  })

  // Tally totals per website to pick top N
  const totals = new Map<string, number>()
  for (const l of leads) {
    const w = l.website || 'other'
    totals.set(w, (totals.get(w) || 0) + 1)
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const topWebsites = sorted.slice(0, topN).map(([w]) => w)
  const topSet = new Set(topWebsites)
  const hasOther = sorted.length > topN

  // Bucket per date×website
  const grouped: Record<string, Record<string, number>> = {}
  for (const lead of leads) {
    const date = lead.createdAt.toISOString().split('T')[0]
    const w = lead.website || 'other'
    const key = topSet.has(w) ? w : '__other__'
    grouped[date] = grouped[date] || {}
    grouped[date][key] = (grouped[date][key] || 0) + 1
  }

  const websites = hasOther ? [...topWebsites, '__other__'] : topWebsites
  const rows = Object.keys(grouped)
    .sort()
    .map((date) => {
      const row: Record<string, string | number> = { date }
      for (const w of websites) row[w] = grouped[date][w] || 0
      return row
    })

  return c.json({ websites, rows })
})

// GET /api/dashboard/month-wise?website=MYS
dashboardRoutes.get('/month-wise', async (c) => {
  const { userId, role } = c.get('user')
  const website = c.req.query('website')
  // Branch managers are limited to their branch; admin/counsellor unchanged.
  const scope = isBranchManager(role) ? await leadScopeWhere({ userId, role }) : {}
  const where: Record<string, unknown> = { trash: 0, ...scope }
  if (website) where.website = website

  const leads = await prisma.lead.findMany({
    where,
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  // Group by year-month
  const grouped: Record<string, number> = {}
  for (const lead of leads) {
    const ym = lead.createdAt.toISOString().substring(0, 7) // "2024-03"
    grouped[ym] = (grouped[ym] || 0) + 1
  }

  const months = Object.entries(grouped)
    .map(([month, count], i, arr) => {
      const prev = i > 0 ? arr[i - 1][1] : null
      const change = prev ? Math.round(((count - prev) / prev) * 100) : null
      return { month, count, change }
    })
    .slice(-24) // last 24 months

  return c.json(months)
})

// GET /api/dashboard/source-breakdown?website=MYS
dashboardRoutes.get('/source-breakdown', async (c) => {
  const { userId, role } = c.get('user')
  const website = c.req.query('website')
  const scope = isBranchManager(role) ? await leadScopeWhere({ userId, role }) : {}
  const where: Record<string, unknown> = { trash: 0, ...scope }
  if (website) where.website = website

  const [ byEvent, bySource ] = await Promise.all([
    prisma.lead.groupBy({
      by: ['event'],
      where: { ...where, event: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    }),
    prisma.lead.groupBy({
      by: ['source'],
      where: { ...where, source: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    }),
  ])

  return c.json({
    byEvent: byEvent.map((e) => ({ label: e.event || 'Unknown', count: e._count.id })),
    bySource: bySource.map((e) => ({ label: e.source || 'Unknown', count: e._count.id })),
  })
})

// GET /api/dashboard/year-comparison?years=2025,2024 (defaults: this year, last year)
// Replicates legacy LeadDashboardController.getLeadComparisonData — returns
// per-month lead counts for two (or more) years for side-by-side comparison.
dashboardRoutes.get('/year-comparison', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })
  const website = c.req.query('website')

  const yearsParam = c.req.query('years')
  const now = new Date()
  const years = yearsParam
    ? yearsParam
        .split(',')
        .map((y) => parseInt(y.trim(), 10))
        .filter((y) => !Number.isNaN(y))
    : [now.getFullYear(), now.getFullYear() - 1]

  if (!years.length) return c.json({ error: 'No valid years' }, 400)

  const baseWhere: Record<string, unknown> = {
    trash: 0,
    ...scope,
    ...(website ? { website } : {}),
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const series = await Promise.all(
    years.map(async (year) => {
      const yearStart = new Date(year, 0, 1)
      const yearEnd = new Date(year + 1, 0, 1)
      const leads = await prisma.lead.findMany({
        where: { ...baseWhere, createdAt: { gte: yearStart, lt: yearEnd } },
        select: { createdAt: true },
      })
      const counts = new Array(12).fill(0)
      for (const l of leads) counts[l.createdAt.getMonth()] += 1
      return { year, total: leads.length, counts }
    }),
  )

  // Build chart-friendly rows: one per month with year columns
  const rows = months.map((m, i) => {
    const row: Record<string, string | number> = { month: m }
    for (const s of series) row[String(s.year)] = s.counts[i]
    return row
  })

  return c.json({ years, totals: series.map((s) => ({ year: s.year, total: s.total })), rows })
})

// GET /api/dashboard/website-breakdown
dashboardRoutes.get('/website-breakdown', async (c) => {
  const { userId, role } = c.get('user')
  const scope = isBranchManager(role) ? await leadScopeWhere({ userId, role }) : {}
  const grouped = await prisma.lead.groupBy({
    by: ['website'],
    where: { trash: 0, ...scope },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  return c.json(grouped.map((g) => ({ website: g.website, count: g._count.id })))
})
