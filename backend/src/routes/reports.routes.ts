import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { todayDateOnly, addDays, REAL_FOLLOWUP_MIN } from '../utils/date-range'
import { accessibleUserIds, leadScopeWhere } from '../utils/branch-scope'
import { hasFeature } from '../lib/tenant-context'
import { isQuoteExpired } from '../services/crm/quote-builder'

export const reportsRoutes = new Hono()

reportsRoutes.use('*', authenticate)

// GET /api/reports/b2b?months=6
//
// The sales report an IT-sales floor actually reads: the pipeline by stage and
// by rep, quotes sent vs accepted per month, and money collected per month.
// Only for customers with the deals module — nobody else has the tables.
reportsRoutes.get('/b2b', async (c) => {
  if (!hasFeature('deals')) return c.json({ error: 'The deals module is not enabled for this customer.' }, 403)
  const months = Math.min(24, Math.max(3, Number(c.req.query('months') || 6)))
  const num = (v: unknown) => (v == null ? 0 : Number(v))
  const round = (x: number) => Math.round(x * 100) / 100
  const monthKey = (d: Date | string) => {
    const x = new Date(d)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
  }
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  start.setMonth(start.getMonth() - (months - 1))
  const keys: string[] = []
  for (let i = 0; i < months; i++) {
    const d = new Date(start)
    d.setMonth(start.getMonth() + i)
    keys.push(monthKey(d))
  }
  const series = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>

  const salesDocs = hasFeature('sales_docs')
  const [deals, quotes, payments, invoices] = await Promise.all([
    prisma.deal.findMany({
      where: { trash: 0 },
      select: { value: true, probability: true, ownerId: true, createdAt: true, actualCloseDate: true, owner: { select: { id: true, name: true } }, stage: { select: { id: true, name: true, sortOrder: true, probability: true, isWon: true, isLost: true } } },
    }),
    salesDocs ? prisma.quote.findMany({ select: { status: true, total: true, sentAt: true, decidedAt: true, issueDate: true, validUntil: true, ownerId: true } }) : [],
    salesDocs ? prisma.crmPayment.findMany({ where: { paymentDate: { gte: start } }, select: { amount: true, paymentDate: true } }) : [],
    salesDocs ? prisma.crmInvoice.findMany({ where: { status: { notIn: ['draft', 'cancelled'] } }, select: { total: true, amountPaid: true, issueDate: true, dueDate: true, status: true } }) : [],
  ])

  // ── Pipeline by stage
  const byStage = new Map<string, { id: number; name: string; sortOrder: number; probability: number; isWon: boolean; isLost: boolean; count: number; value: number; weighted: number }>()
  for (const d of deals) {
    const k = String(d.stage.id)
    if (!byStage.has(k)) byStage.set(k, { id: Number(d.stage.id), name: d.stage.name, sortOrder: d.stage.sortOrder, probability: d.stage.probability, isWon: d.stage.isWon, isLost: d.stage.isLost, count: 0, value: 0, weighted: 0 })
    const s = byStage.get(k)!
    s.count++
    s.value += num(d.value)
    s.weighted += (num(d.value) * (d.probability ?? d.stage.probability)) / 100
  }

  // ── By rep
  const byRep = new Map<string, { id: number | null; name: string; open: number; openValue: number; won: number; wonValue: number; lost: number; cycleDays: number[] }>()
  for (const d of deals) {
    const k = String(d.ownerId ?? 0)
    if (!byRep.has(k)) byRep.set(k, { id: d.owner ? Number(d.owner.id) : null, name: d.owner?.name ?? 'Unassigned', open: 0, openValue: 0, won: 0, wonValue: 0, lost: 0, cycleDays: [] })
    const r = byRep.get(k)!
    if (d.stage.isWon) {
      r.won++
      r.wonValue += num(d.value)
      if (d.actualCloseDate) r.cycleDays.push((new Date(d.actualCloseDate).getTime() - new Date(d.createdAt).getTime()) / 86_400_000)
    } else if (d.stage.isLost) r.lost++
    else {
      r.open++
      r.openValue += num(d.value)
    }
  }

  // ── Won / lost per month, quotes per month, cash per month
  const wonByMonth = series()
  const wonValueByMonth = series()
  const lostByMonth = series()
  for (const d of deals) {
    if (!d.actualCloseDate) continue
    const k = monthKey(d.actualCloseDate)
    if (!(k in wonByMonth)) continue
    if (d.stage.isWon) {
      wonByMonth[k]++
      wonValueByMonth[k] += num(d.value)
    } else if (d.stage.isLost) lostByMonth[k]++
  }
  const quotesSent = series()
  const quotesSentValue = series()
  const quotesAccepted = series()
  const quotesAcceptedValue = series()
  for (const q of quotes) {
    if (q.sentAt) {
      const k = monthKey(q.sentAt)
      if (k in quotesSent) {
        quotesSent[k]++
        quotesSentValue[k] += num(q.total)
      }
    }
    if (q.status === 'accepted' && q.decidedAt) {
      const k = monthKey(q.decidedAt)
      if (k in quotesAccepted) {
        quotesAccepted[k]++
        quotesAcceptedValue[k] += num(q.total)
      }
    }
  }
  const collected = series()
  for (const p of payments) {
    const k = monthKey(p.paymentDate)
    if (k in collected) collected[k] += num(p.amount)
  }
  const invoiced = series()
  for (const i of invoices) {
    const k = monthKey(i.issueDate)
    if (k in invoiced) invoiced[k] += num(i.total)
  }

  const decided = deals.filter((d) => d.stage.isWon || d.stage.isLost)
  const wonAll = deals.filter((d) => d.stage.isWon)
  const liveQuotes = quotes.filter((q) => ['sent', 'viewed'].includes(q.status) && !isQuoteExpired(q))
  const decidedQuotes = quotes.filter((q) => ['accepted', 'rejected'].includes(q.status))
  const outstanding = invoices.reduce((t, i) => t + (num(i.total) - num(i.amountPaid)), 0)
  const overdue = invoices.filter((i) => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < Date.now()).reduce((t, i) => t + (num(i.total) - num(i.amountPaid)), 0)

  return c.json({
    months: keys,
    summary: {
      openDeals: deals.filter((d) => !d.stage.isWon && !d.stage.isLost).length,
      openValue: round(deals.filter((d) => !d.stage.isWon && !d.stage.isLost).reduce((t, d) => t + num(d.value), 0)),
      weightedValue: round(deals.filter((d) => !d.stage.isWon && !d.stage.isLost).reduce((t, d) => t + (num(d.value) * (d.probability ?? d.stage.probability)) / 100, 0)),
      winRate: decided.length ? Math.round((wonAll.length / decided.length) * 100) : null,
      averageDealSize: wonAll.length ? round(wonAll.reduce((t, d) => t + num(d.value), 0) / wonAll.length) : null,
      quotesAwaiting: liveQuotes.length,
      quotesAwaitingValue: round(liveQuotes.reduce((t, q) => t + num(q.total), 0)),
      quoteAcceptRate: decidedQuotes.length ? Math.round((decidedQuotes.filter((q) => q.status === 'accepted').length / decidedQuotes.length) * 100) : null,
      outstanding: round(outstanding),
      overdue: round(overdue),
      collectedPeriod: round(Object.values(collected).reduce((t, v) => t + v, 0)),
    },
    byStage: [...byStage.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => ({ ...s, value: round(s.value), weighted: round(s.weighted) })),
    byRep: [...byRep.values()]
      .map((r) => ({
        id: r.id,
        name: r.name,
        open: r.open,
        openValue: round(r.openValue),
        won: r.won,
        wonValue: round(r.wonValue),
        lost: r.lost,
        winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null,
        avgCycleDays: r.cycleDays.length ? Math.round(r.cycleDays.reduce((t, x) => t + x, 0) / r.cycleDays.length) : null,
      }))
      .sort((a, b) => b.wonValue + b.openValue - (a.wonValue + a.openValue)),
    monthly: keys.map((k) => ({
      month: k,
      won: wonByMonth[k],
      wonValue: round(wonValueByMonth[k]),
      lost: lostByMonth[k],
      quotesSent: quotesSent[k],
      quotesSentValue: round(quotesSentValue[k]),
      quotesAccepted: quotesAccepted[k],
      quotesAcceptedValue: round(quotesAcceptedValue[k]),
      invoiced: round(invoiced[k]),
      collected: round(collected[k]),
    })),
    salesDocs,
  })
})

// GET /api/reports/overview
reportsRoutes.get('/overview', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })

  const fromDate = c.req.query('fromDate')
  const toDate = c.req.query('toDate')

  const dateFilter = fromDate || toDate ? {
    createdAt: {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate ? { lte: new Date(toDate + 'T23:59:59') } : {}),
    },
  } : {}

  const intrestedCourse = c.req.query('intrestedCourse')
  let courseFilter = {}
  if (intrestedCourse) {
    let list: string[] = []
    try {
      const parsed = JSON.parse(intrestedCourse)
      if (Array.isArray(parsed)) list = parsed.map(String).filter(Boolean)
    } catch {
      list = intrestedCourse.split(',').map(v => v.trim()).filter(Boolean)
    }
    if (list.length > 0) {
      courseFilter = { intrestedCourse: list.length > 1 ? { in: list } : { contains: list[0], mode: 'insensitive' } }
    }
  }

  const baseWhere = {
    trash: 0,
    ...dateFilter,
    ...scope,
    ...courseFilter,
  }

  const [total, enrolled, byStatus, byWebsite] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where: { ...baseWhere, enrolled: 1 } }),
    prisma.lead.groupBy({ by: ['leadStatus'], where: baseWhere, _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    prisma.lead.groupBy({ by: ['website'], where: baseWhere, _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
  ])

  return c.json({
    total,
    enrolled,
    byStatus: byStatus.map((s) => ({ status: s.leadStatus, count: s._count.id })),
    byWebsite: byWebsite.map((w) => ({ website: w.website, count: w._count.id })),
  })
})

// GET /api/reports/by-source/:website
reportsRoutes.get('/by-source/:website', async (c) => {
  const website = c.req.param('website')
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })

  const where = {
    website,
    trash: 0,
    ...scope,
  }

  const [total, byStatus, recent] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ['leadStatus'], where, _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    prisma.lead.findMany({
      where, take: 20, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, mobile: true, leadStatus: true, createdAt: true },
    }),
  ])

  return c.json({
    website,
    total,
    byStatus: byStatus.map((s) => ({ status: s.leadStatus, count: s._count.id })),
    recent,
  })
})

// ─── SOURCE DETAIL (rich breakdown) ──────────────────────────────────────────
// GET /api/reports/source-detail?website=<value>&fromDate=&toDate=
//
// Powers the Reports → Source Breakdown page. Returns per-department and
// per-counsellor splits for leads coming from a single website/source so
// admins can see, for the chosen source: which departments are receiving how
// many leads, and for each counsellor — how many of those leads they own,
// how many follow-ups are due today, and how many follow-ups they've already
// logged today. `website` is optional — omit to see the breakdown across all
// sources combined.
reportsRoutes.get('/source-detail', async (c) => {
  const { userId, role } = c.get('user')
  const scope = await leadScopeWhere({ userId, role })

  const website = c.req.query('website')
  const event = c.req.query('event')
  const fromDate = c.req.query('fromDate')
  const toDate = c.req.query('toDate')

  const dateFilter = fromDate || toDate ? {
    createdAt: {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate ? { lte: new Date(toDate + 'T23:59:59') } : {}),
    },
  } : {}

  const intrestedCourse = c.req.query('intrestedCourse')
  let courseFilter = {}
  if (intrestedCourse) {
    let list: string[] = []
    try {
      const parsed = JSON.parse(intrestedCourse)
      if (Array.isArray(parsed)) list = parsed.map(String).filter(Boolean)
    } catch {
      list = intrestedCourse.split(',').map(v => v.trim()).filter(Boolean)
    }
    if (list.length > 0) {
      courseFilter = { intrestedCourse: list.length > 1 ? { in: list } : { contains: list[0], mode: 'insensitive' } }
    }
  }

  const baseWhere = {
    trash: 0,
    ...(website ? { website } : {}),
    ...(event ? { event } : {}),
    ...dateFilter,
    ...scope,
    ...courseFilter,
  }

  const eventOptionsWhere = {
    trash: 0,
    ...(website ? { website } : {}),
    ...dateFilter,
    ...scope,
    ...courseFilter,
  }

  const today = todayDateOnly()
  const tomorrow = addDays(today, 1)
  const weekStart = addDays(today, -6)

  const [
    total,
    enrolled,
    unassigned,
    todayNew,
    weekNew,
    byStatus,
    bySubSource,
    byEvent,
    eventOptions,
    byDeptGrouped,
    departments,
  ] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where: { ...baseWhere, enrolled: 1 } }),
    prisma.lead.count({ where: { ...baseWhere, assignedTo: { none: { status: 1 } } } }),
    prisma.lead.count({ where: { ...baseWhere, createdAt: { gte: today, lt: tomorrow } } }),
    prisma.lead.count({ where: { ...baseWhere, createdAt: { gte: weekStart, lt: tomorrow } } }),
    prisma.lead.groupBy({
      by: ['leadStatus'], where: baseWhere, _count: { id: true },
      orderBy: { _count: { id: 'desc' } }, take: 20,
    }),
    prisma.lead.groupBy({
      by: ['source'], where: { ...baseWhere, source: { not: null } },
      _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 20,
    }),
    prisma.lead.groupBy({
      by: ['event'], where: { ...baseWhere, event: { not: null } },
      _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 20,
    }),
    prisma.lead.groupBy({
      by: ['event'], where: { ...eventOptionsWhere, event: { not: null } },
      _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 100,
    }),
    prisma.lead.groupBy({
      by: ['departmentId'], where: baseWhere,
      _count: { id: true }, orderBy: { _count: { id: 'desc' } },
    }),
    prisma.leadDepartment.findMany({ select: { id: true, name: true } }),
  ])

  const deptNameById = new Map<number, string>()
  for (const d of departments) deptNameById.set(Number(d.id), d.name)

  // Per-department enrolled counts (parallel)
  const byDepartment = await Promise.all(
    byDeptGrouped.map(async (g) => {
      const did = g.departmentId
      const [enrolledCount, todayCount] = await Promise.all([
        prisma.lead.count({ where: { ...baseWhere, departmentId: did, enrolled: 1 } }),
        prisma.lead.count({
          where: { ...baseWhere, departmentId: did, createdAt: { gte: today, lt: tomorrow } },
        }),
      ])
      return {
        departmentId: did ? Number(did) : null,
        departmentName: did ? (deptNameById.get(Number(did)) || `Dept ${Number(did)}`) : 'Unassigned',
        total: g._count.id,
        enrolled: enrolledCount,
        todayNew: todayCount,
      }
    }),
  )

  // ─── Per-counsellor breakdown for this source ────────────────────────────
  // Find all counsellors with at least one assigned lead matching baseWhere.
  // We need: assigned count from this source, enrolled count from this source,
  // followups due today on those leads, follow-ups *logged* today by that user
  // on those leads.
  const assignedRows = await prisma.asignedLead.findMany({
    where: {
      status: 1,
      lead: baseWhere,
    },
    select: { clrId: true, stdId: true },
  })

  const leadsByCounsellor = new Map<number, Set<number>>()
  for (const a of assignedRows) {
    const uid = Number(a.clrId)
    if (!leadsByCounsellor.has(uid)) leadsByCounsellor.set(uid, new Set())
    leadsByCounsellor.get(uid)!.add(Number(a.stdId))
  }

  const counsellorIds = Array.from(leadsByCounsellor.keys())
  const counsellors = counsellorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: counsellorIds.map((id) => BigInt(id)) } },
        select: { id: true, name: true, role: true, designation: true },
      })
    : []
  const userById = new Map<number, { name: string; role: string | null; designation: string | null }>()
  for (const u of counsellors) {
    userById.set(Number(u.id), { name: u.name, role: u.role, designation: u.designation })
  }

  const byCounsellor = await Promise.all(
    counsellorIds.map(async (uid) => {
      const leadIds = Array.from(leadsByCounsellor.get(uid)!).map((id) => BigInt(id))
      const u = userById.get(uid) || { name: `User ${uid}`, role: null, designation: null }
      const [enrolledCount, dueToday, doneToday] = await Promise.all([
        prisma.lead.count({ where: { id: { in: leadIds }, enrolled: 1 } }),
        prisma.lead.count({
          where: { id: { in: leadIds }, followupDate: { gte: today, lt: tomorrow } },
        }),
        prisma.leadFollowup.count({
          where: {
            userid: BigInt(uid),
            stdId: { in: leadIds },
            createdAt: { gte: today, lt: tomorrow },
          },
        }),
      ])
      return {
        id: uid,
        name: u.name,
        role: u.role,
        designation: u.designation,
        assigned: leadsByCounsellor.get(uid)!.size,
        enrolled: enrolledCount,
        followupsDueToday: dueToday,
        followupsDoneToday: doneToday,
        followupsPendingToday: Math.max(0, dueToday - doneToday),
      }
    }),
  )

  byCounsellor.sort((a, b) => b.assigned - a.assigned)

  return c.json({
    website: website || null,
    event: event || null,
    total,
    enrolled,
    unassigned,
    todayNew,
    weekNew,
    byStatus: byStatus.map((s) => ({ status: s.leadStatus, count: s._count.id })),
    bySubSource: bySubSource.map((s) => ({ label: s.source, count: s._count.id })),
    byEvent: byEvent.map((s) => ({ label: s.event, count: s._count.id })),
    eventOptions: eventOptions.map((s) => ({ label: s.event, count: s._count.id })),
    byDepartment,
    byCounsellor,
  })
})

// GET /api/reports/counsellor-stats (admin only)
// Per-counsellor metrics for the Reports → Counsellor Performance table.
// Replaces the now-removed "Assigned Leads" page — surfaces pending followup
// load (today/overdue/upcoming) alongside assigned/enrolled counts so admins
// can see each counsellor's full pipeline at a glance.
reportsRoutes.get('/counsellor-stats', async (c) => {
  const ROSTER_ROLES = ['counsellor', 'employee', 'franchise', 'agent']
  // Match both the legacy `role` column on User AND the newer many-to-many
  // `user_roles` table — older accounts may only have one or the other.
  const scopeIds = await accessibleUserIds(c.get('user'))
  const counsellors = await prisma.user.findMany({
    where: {
      status: 1,
      ...(scopeIds !== null ? { id: { in: scopeIds } } : {}),
      OR: [
        { role: { in: ROSTER_ROLES } },
        { roles: { some: { role: { in: ROSTER_ROLES } } } },
      ],
    },
    select: { id: true, name: true, designation: true, email: true, mobile: true, role: true },
    orderBy: { name: 'asc' },
  })

  const today = todayDateOnly()
  const tomorrow = addDays(today, 1)
  const horizon = addDays(tomorrow, 7)

  const stats = await Promise.all(
    counsellors.map(async (cc) => {
      const assignedFilter = { assignedTo: { some: { clrId: cc.id, status: 1 } }, trash: 0 }
      const [
        assigned,
        enrolled,
        followupsToday,
        followupsOverdue,
        followupsUpcoming,
        activityToday,
      ] = await Promise.all([
        // distinct leads assigned (handles any historical duplicate asigned_leads rows)
        prisma.lead.count({ where: assignedFilter }),
        prisma.lead.count({ where: { ...assignedFilter, enrolled: 1 } }),
        prisma.lead.count({ where: { ...assignedFilter, followupDate: { gte: today, lt: tomorrow } } }),
        prisma.lead.count({ where: { ...assignedFilter, followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today } } }),
        prisma.lead.count({ where: { ...assignedFilter, followupDate: { gte: tomorrow, lt: horizon } } }),
        prisma.leadFollowup.count({
          where: { userid: cc.id, createdAt: { gte: today, lt: tomorrow } },
        }),
      ])
      return {
        id: Number(cc.id),
        name: cc.name,
        role: cc.role,
        designation: cc.designation,
        email: cc.email,
        mobile: cc.mobile,
        assigned,
        enrolled,
        followupsToday,
        followupsOverdue,
        followupsUpcoming,
        activityToday,
      }
    })
  )

  return c.json(stats)
})

// Helper to group calls by lead source (website, source, event)
interface CallWithLeadSource {
  userId?: bigint
  status: string
  durationSec: number
  lead: {
    website: string | null
    source: string | null
    event: string | null
  } | null
}

function groupCallsBySource(calls: CallWithLeadSource[]) {
  const map = new Map<
    string,
    { source: string; callsTotal: number; callsAnswered: number; callsMissed: number; talkTimeSec: number }
  >()

  for (const c of calls) {
    let src = 'Unlinked / Direct'
    if (c.lead) {
      if (c.lead.website && c.lead.website.trim() && c.lead.website.toLowerCase() !== 'other') {
        src = c.lead.website.trim()
      } else if (c.lead.source && c.lead.source.trim()) {
        src = c.lead.source.trim()
      } else if (c.lead.event && c.lead.event.trim()) {
        src = c.lead.event.trim()
      } else if (c.lead.website && c.lead.website.trim()) {
        src = c.lead.website.trim()
      } else {
        src = 'Other'
      }
    }

    if (!map.has(src)) {
      map.set(src, { source: src, callsTotal: 0, callsAnswered: 0, callsMissed: 0, talkTimeSec: 0 })
    }
    const entry = map.get(src)!

    if (c.status !== 'MISSED') {
      entry.callsTotal += 1
    }
    if (c.status === 'ANSWERED') {
      entry.callsAnswered += 1
      entry.talkTimeSec += c.durationSec || 0
    } else if (['MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY'].includes(c.status)) {
      entry.callsMissed += 1
    }
  }

  return Array.from(map.values()).sort((a, b) => b.callsTotal - a.callsTotal || b.callsAnswered - a.callsAnswered)
}

interface CallWithLeadDept {
  status: string
  durationSec: number
  lead: {
    website?: string | null
    source?: string | null
    event?: string | null
    departmentId?: bigint | null
  } | null
}

function groupCallsByDepartment(calls: CallWithLeadDept[], deptMap: Map<number, string>) {
  const map = new Map<
    string,
    { departmentName: string; callsTotal: number; callsAnswered: number; callsMissed: number; talkTimeSec: number }
  >()

  for (const c of calls) {
    let deptName = 'Unassigned / Direct'
    if (c.lead && c.lead.departmentId != null) {
      deptName = deptMap.get(Number(c.lead.departmentId)) || 'Unassigned / Direct'
    }

    if (!map.has(deptName)) {
      map.set(deptName, { departmentName: deptName, callsTotal: 0, callsAnswered: 0, callsMissed: 0, talkTimeSec: 0 })
    }
    const entry = map.get(deptName)!

    if (c.status !== 'MISSED') {
      entry.callsTotal += 1
    }
    if (c.status === 'ANSWERED') {
      entry.callsAnswered += 1
      entry.talkTimeSec += c.durationSec || 0
    } else if (['MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY', 'FAILED'].includes(c.status)) {
      entry.callsMissed += 1
    }
  }

  return Array.from(map.values()).sort((a, b) => b.callsTotal - a.callsTotal || b.callsAnswered - a.callsAnswered)
}

// ─── COUNSELLOR PERFORMANCE (rich, range-aware) ──────────────────────────────
// GET /api/reports/counsellor-performance?range=today|yesterday|7d|30d|mtd|custom
//   &fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD   (only for range=custom)
//
// Returns a per-counsellor breakdown of *daily* performance: how many leads
// were newly assigned to them in the range, how many follow-ups / comments /
// status changes / calls they logged, how many leads were moved to Enrolled in
// the range, plus the live pipeline (active assignments, stale leads, due
// follow-ups). Each row also carries a `prev` block for the equal-length
// window immediately before the selected range, so the UI can draw trend
// arrows without a second request.
reportsRoutes.get('/counsellor-performance', async (c) => {
  const ROSTER_ROLES = ['counsellor', 'employee', 'franchise', 'agent']

  const today = todayDateOnly()              // UTC-midnight stamp for IST today
  const tomorrow = addDays(today, 1)
  const horizon = addDays(tomorrow, 7)
  const staleCutoff = addDays(today, -7)     // assigned + no update in 7 days

  // ─── Resolve the requested range into [from, to) UTC-midnight bounds ─────
  // We use the same convention as the existing counsellor-stats endpoint
  // (UTC-midnight stamps representing IST calendar dates). The ~5h skew vs
  // real IST midnight is consistent with the rest of the reporting surface
  // and avoids splitting hairs across a day boundary.
  const rangeKey = (c.req.query('range') || 'today').toLowerCase()
  const customFrom = c.req.query('fromDate')
  const customTo = c.req.query('toDate')

  let from: Date, to: Date
  switch (rangeKey) {
    case 'today':
      from = today; to = tomorrow; break
    case 'yesterday':
      from = addDays(today, -1); to = today; break
    case '7d':
      from = addDays(today, -6); to = tomorrow; break
    case '30d':
      from = addDays(today, -29); to = tomorrow; break
    case 'mtd': {
      // First day of this IST month
      const y = today.getUTCFullYear(), m = today.getUTCMonth()
      from = new Date(Date.UTC(y, m, 1)); to = tomorrow; break
    }
    case 'custom': {
      if (!customFrom || !customTo) {
        return c.json({ error: 'fromDate and toDate are required for range=custom' }, 400)
      }
      from = new Date(customFrom + 'T00:00:00Z')
      // Make `to` exclusive — add 1 day so `toDate` itself is included.
      to = addDays(new Date(customTo + 'T00:00:00Z'), 1)
      if (to <= from) return c.json({ error: 'toDate must be on/after fromDate' }, 400)
      break
    }
    default:
      return c.json({ error: `Unknown range "${rangeKey}"` }, 400)
  }

  // Equal-length window immediately before [from, to)
  const lengthMs = to.getTime() - from.getTime()
  const prevTo = from
  const prevFrom = new Date(from.getTime() - lengthMs)

  // ─── Load counsellors ────────────────────────────────────────────────────
  const scopeIds = await accessibleUserIds(c.get('user'))
  const counsellors = await prisma.user.findMany({
    where: {
      status: 1,
      ...(scopeIds !== null ? { id: { in: scopeIds } } : {}),
      OR: [
        { role: { in: ROSTER_ROLES } },
        { roles: { some: { role: { in: ROSTER_ROLES } } } },
      ],
    },
    select: { id: true, name: true, designation: true, email: true, mobile: true, role: true },
    orderBy: { name: 'asc' },
  })
  const userIds = counsellors.map((cc) => cc.id)
  if (userIds.length === 0) {
    return c.json({
      range: { key: rangeKey, from: from.toISOString(), to: to.toISOString(), prevFrom: prevFrom.toISOString(), prevTo: prevTo.toISOString() },
      rows: [],
    })
  }

  // ─── Batched groupBy queries (one per metric, covers all counsellors) ────
  // Each helper returns Map<userIdNumber, count>.
  const toMap = <T extends { _count: { _all: number } }>(rows: T[], key: (r: T) => bigint) => {
    const m = new Map<number, number>()
    for (const r of rows) m.set(Number(key(r)), r._count._all)
    return m
  }
  const sumMap = <T extends { _sum: { durationSec: number | null }; _count: { _all: number } }>(
    rows: T[], key: (r: T) => bigint,
  ) => {
    const cnt = new Map<number, number>()
    const dur = new Map<number, number>()
    for (const r of rows) {
      const k = Number(key(r))
      cnt.set(k, (cnt.get(k) || 0) + r._count._all)
      dur.set(k, (dur.get(k) || 0) + (r._sum.durationSec || 0))
    }
    return { cnt, dur }
  }

  async function rangeMetrics(rFrom: Date, rTo: Date) {
    const [
      followupsGrouped,
      commentsGrouped,
      statusChangesGrouped,
      enrolWinsGrouped,
      newAssignGrouped,
      mobileCallsGrouped,
      mobileCallsWithLead,
    ] = await Promise.all([
      prisma.leadFollowup.groupBy({
        by: ['userid'],
        where: { userid: { in: userIds }, createdAt: { gte: rFrom, lt: rTo } },
        _count: { _all: true },
      }),
      prisma.leadComment.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, createdAt: { gte: rFrom, lt: rTo } },
        _count: { _all: true },
      }),
      prisma.leadStatusHistory.groupBy({
        by: ['changedById'],
        where: { changedById: { in: userIds }, createdAt: { gte: rFrom, lt: rTo } },
        _count: { _all: true },
      }),
      prisma.leadStatusHistory.groupBy({
        by: ['changedById'],
        where: {
          changedById: { in: userIds },
          createdAt: { gte: rFrom, lt: rTo },
          toStatus: { contains: 'enrol', mode: 'insensitive' },
        },
        _count: { _all: true },
      }),
      prisma.asignedLead.groupBy({
        by: ['clrId'],
        where: { clrId: { in: userIds }, status: 1, createdAt: { gte: rFrom, lt: rTo } },
        _count: { _all: true },
      }),
      prisma.mobileCall.groupBy({
        by: ['userId', 'status'],
        where: {
          userId: { in: userIds },
          startedAt: { gte: rFrom, lt: rTo },
          status: { not: 'TRIGGERED' },
        },
        _count: { _all: true },
        _sum: { durationSec: true },
      }),
      prisma.mobileCall.findMany({
        where: {
          userId: { in: userIds },
          startedAt: { gte: rFrom, lt: rTo },
          status: { not: 'TRIGGERED' },
        },
        select: {
          userId: true,
          status: true,
          durationSec: true,
          lead: {
            select: {
              website: true,
              source: true,
              event: true,
            },
          },
        },
      }),
    ])

    const followups = toMap(followupsGrouped, (r) => r.userid)
    const comments = toMap(commentsGrouped, (r) => r.userId)
    const statusChanges = toMap(statusChangesGrouped, (r) => r.changedById)
    const enrolWins = toMap(enrolWinsGrouped, (r) => r.changedById)
    const newAssign = toMap(newAssignGrouped, (r) => r.clrId)

    // Aggregate mobile-call rows by user → total / answered / missed / talkSec
    const callsTotal = new Map<number, number>()
    const callsAnswered = new Map<number, number>()
    const callsMissed = new Map<number, number>()
    const talkSec = new Map<number, number>()
    for (const row of mobileCallsGrouped) {
      const uid = Number(row.userId)
      const cnt = row._count._all
      // MISSED = incoming the counsellor didn't pick up; it doesn't belong in
      // the "calls made" total — only in the missed bucket.
      if (row.status !== 'MISSED') {
        callsTotal.set(uid, (callsTotal.get(uid) || 0) + cnt)
      }
      if (row.status === 'ANSWERED') {
        callsAnswered.set(uid, (callsAnswered.get(uid) || 0) + cnt)
        talkSec.set(uid, (talkSec.get(uid) || 0) + (row._sum.durationSec || 0))
      } else if (row.status === 'MISSED' || row.status === 'NO_ANSWER' || row.status === 'REJECTED' || row.status === 'BUSY') {
        callsMissed.set(uid, (callsMissed.get(uid) || 0) + cnt)
      }
    }

    // Group calls by user → callsBySource
    const callsBySourceMap = new Map<number, ReturnType<typeof groupCallsBySource>>()
    const callsByUserMap = new Map<number, typeof mobileCallsWithLead>()

    for (const c of mobileCallsWithLead) {
      const uid = Number(c.userId)
      if (!callsByUserMap.has(uid)) callsByUserMap.set(uid, [])
      callsByUserMap.get(uid)!.push(c)
    }

    for (const uid of userIds.map(Number)) {
      const userCalls = callsByUserMap.get(uid) || []
      callsBySourceMap.set(uid, groupCallsBySource(userCalls))
    }

    return { followups, comments, statusChanges, enrolWins, newAssign, callsTotal, callsAnswered, callsMissed, talkSec, callsBySourceMap }
  }

  const [cur, prev] = await Promise.all([
    rangeMetrics(from, to),
    rangeMetrics(prevFrom, prevTo),
  ])

  // ─── Pipeline (live, range-independent) — per counsellor in parallel ─────
  const pipeline = await Promise.all(
    counsellors.map(async (cc) => {
      const assignedFilter = { assignedTo: { some: { clrId: cc.id, status: 1 } }, trash: 0 }
      const [active, enrolledLifetime, fToday, fOverdue, fUpcoming, stale] = await Promise.all([
        prisma.lead.count({ where: assignedFilter }),
        prisma.lead.count({ where: { ...assignedFilter, enrolled: 1 } }),
        prisma.lead.count({ where: { ...assignedFilter, followupDate: { gte: today, lt: tomorrow } } }),
        prisma.lead.count({ where: { ...assignedFilter, followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today } } }),
        prisma.lead.count({ where: { ...assignedFilter, followupDate: { gte: tomorrow, lt: horizon } } }),
        // Stale = assigned + Lead.updatedAt older than 7 days (no recent activity)
        prisma.lead.count({ where: { ...assignedFilter, updatedAt: { lt: staleCutoff } } }),
      ])
      return { id: Number(cc.id), active, enrolledLifetime, fToday, fOverdue, fUpcoming, stale }
    })
  )
  const pipelineById = new Map(pipeline.map((p) => [p.id, p]))

  // ─── Compose rows ────────────────────────────────────────────────────────
  const rows = counsellors.map((cc) => {
    const id = Number(cc.id)
    const p = pipelineById.get(id)!
    const conversionRate = p.active + p.enrolledLifetime > 0
      ? p.enrolledLifetime / (p.active + p.enrolledLifetime)
      : 0
    return {
      id,
      name: cc.name,
      role: cc.role,
      designation: cc.designation,
      email: cc.email,
      mobile: cc.mobile,
      // Live pipeline
      assignedActive: p.active,
      enrolledLifetime: p.enrolledLifetime,
      conversionRate: Math.round(conversionRate * 10000) / 100, // % with 2 decimals
      staleLeads: p.stale,
      followupsToday: p.fToday,
      followupsOverdue: p.fOverdue,
      followupsUpcoming: p.fUpcoming,
      // Range activity
      range: {
        newAssignments: cur.newAssign.get(id) || 0,
        followupsLogged: cur.followups.get(id) || 0,
        commentsAdded: cur.comments.get(id) || 0,
        statusChanges: cur.statusChanges.get(id) || 0,
        wins: cur.enrolWins.get(id) || 0,
        callsTotal: cur.callsTotal.get(id) || 0,
        callsAnswered: cur.callsAnswered.get(id) || 0,
        callsMissed: cur.callsMissed.get(id) || 0,
        talkTimeSec: cur.talkSec.get(id) || 0,
        callsBySource: cur.callsBySourceMap.get(id) || [],
      },
      prev: {
        newAssignments: prev.newAssign.get(id) || 0,
        followupsLogged: prev.followups.get(id) || 0,
        commentsAdded: prev.comments.get(id) || 0,
        statusChanges: prev.statusChanges.get(id) || 0,
        wins: prev.enrolWins.get(id) || 0,
        callsTotal: prev.callsTotal.get(id) || 0,
        callsAnswered: prev.callsAnswered.get(id) || 0,
        callsMissed: prev.callsMissed.get(id) || 0,
        talkTimeSec: prev.talkSec.get(id) || 0,
        callsBySource: prev.callsBySourceMap.get(id) || [],
      },
    }
  })

  return c.json({
    range: {
      key: rangeKey,
      from: from.toISOString(),
      to: to.toISOString(),
      prevFrom: prevFrom.toISOString(),
      prevTo: prevTo.toISOString(),
    },
    rows,
  })
})

// ─── COUNSELLOR PERFORMANCE DETAIL (one counsellor, all periods) ─────────────
// GET /api/reports/counsellor/:id/performance-detail
//
// Drill-down companion to /counsellor-performance. Returns per-period activity
// for one counsellor across the windows admins routinely care about (today,
// yesterday, last 7 days, last 30 days, month-to-date) and adds the live
// pipeline plus a today/yesterday follow-up "done vs pending" split that the
// summary endpoint can't compute (since done = leads with a follow-up logged
// that day AND followupDate within that day).
// Self-or-admin: a counsellor may fetch their own performance breakdown
// (so "how am I doing" works without exposing anyone else's numbers), while
// admin/sub-admin may inspect any counsellor in their scope.
reportsRoutes.get('/counsellor/:id/performance-detail', async (c) => {
  const idParam = Number(c.req.param('id'))
  if (!Number.isFinite(idParam) || idParam <= 0) {
    return c.json({ error: 'Invalid counsellor id' }, 400)
  }

  const requester = c.get('user')
  const scopeIds = await accessibleUserIds(requester)
  if (scopeIds !== null && !scopeIds.some((b) => Number(b) === idParam)) {
    return c.json({ error: 'Counsellor not in your scope' }, 403)
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(idParam) },
    select: { id: true, name: true, email: true, mobile: true, designation: true, role: true, status: true, createdAt: true,
      branch: { select: { id: true, name: true, city: true } } },
  })
  if (!user) return c.json({ error: 'Counsellor not found' }, 404)

  const userIdBig = BigInt(idParam)

  const dateParam = c.req.query('date')
  const isCustomDate = Boolean(dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
  let targetDate: Date
  if (isCustomDate && dateParam) {
    const [y, m, d] = dateParam.split('-').map(Number)
    targetDate = new Date(Date.UTC(y, m - 1, d))
  } else {
    targetDate = todayDateOnly()
  }

  const actualToday = todayDateOnly()
  const isToday = targetDate.getTime() === actualToday.getTime()

  const today = targetDate
  const tomorrow = addDays(today, 1)
  const yesterday = addDays(today, -1)
  const last7Start = addDays(today, -6)
  const last30Start = addDays(today, -29)
  const horizon = addDays(tomorrow, 7)
  const staleCutoff = addDays(today, -7)

  // Month-to-date — IST month boundary
  const mtdStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  // ─── Period metrics ──────────────────────────────────────────────────────
  async function metricsFor(from: Date, to: Date) {
    const [
      followupsLogged,
      commentsAdded,
      statusChanges,
      wins,
      newAssignments,
      mobileCalls,
      mobileCallsWithLead,
      depts,
    ] = await Promise.all([
      prisma.leadFollowup.count({ where: { userid: userIdBig, createdAt: { gte: from, lt: to } } }),
      prisma.leadComment.count({ where: { userId: userIdBig, createdAt: { gte: from, lt: to } } }),
      prisma.leadStatusHistory.count({ where: { changedById: userIdBig, createdAt: { gte: from, lt: to } } }),
      prisma.leadStatusHistory.count({
        where: {
          changedById: userIdBig,
          createdAt: { gte: from, lt: to },
          toStatus: { contains: 'enrol', mode: 'insensitive' },
        },
      }),
      prisma.asignedLead.count({
        where: { clrId: userIdBig, status: 1, createdAt: { gte: from, lt: to } },
      }),
      prisma.mobileCall.groupBy({
        by: ['status'],
        where: {
          userId: userIdBig,
          startedAt: { gte: from, lt: to },
          status: { not: 'TRIGGERED' },
        },
        _count: { _all: true },
        _sum: { durationSec: true },
      }),
      prisma.mobileCall.findMany({
        where: {
          userId: userIdBig,
          startedAt: { gte: from, lt: to },
          status: { not: 'TRIGGERED' },
        },
        select: {
          status: true,
          durationSec: true,
          lead: {
            select: {
              website: true,
              source: true,
              event: true,
              departmentId: true,
            },
          },
        },
      }),
      prisma.leadDepartment.findMany({ select: { id: true, name: true } }),
    ])

    let callsTotal = 0, callsAnswered = 0, callsMissed = 0, talkTimeSec = 0
    for (const r of mobileCalls) {
      const cnt = r._count._all
      if (r.status !== 'MISSED') callsTotal += cnt
      if (r.status === 'ANSWERED') {
        callsAnswered += cnt
        talkTimeSec += r._sum.durationSec || 0
      } else if (r.status === 'MISSED' || r.status === 'NO_ANSWER' || r.status === 'REJECTED' || r.status === 'BUSY') {
        callsMissed += cnt
      }
    }

    const deptMap = new Map<number, string>(depts.map((d: { id: bigint; name: string }) => [Number(d.id), d.name]))
    const callsBySource = groupCallsBySource(mobileCallsWithLead)
    const callsByDepartment = groupCallsByDepartment(mobileCallsWithLead, deptMap)

    return {
      newAssignments, followupsLogged, commentsAdded, statusChanges, wins,
      callsTotal, callsAnswered, callsMissed, talkTimeSec, callsBySource, callsByDepartment,
    }
  }

  // Follow-up due/done/pending split for a single calendar day.
  // "Done" = assigned leads where the counsellor logged a follow-up during [dayFrom, dayTo).
  // "Pending" = assigned leads whose followupDate is in [dayFrom, dayTo) with no follow-up logged during [dayFrom, dayTo).
  // "Due" = done + pending.
  async function followupSplit(dayFrom: Date, dayTo: Date) {
    const assignedFilter = { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0 }
    const [done, pending] = await Promise.all([
      prisma.lead.count({
        where: {
          ...assignedFilter,
          followups: { some: { userid: userIdBig, createdAt: { gte: dayFrom, lt: dayTo } } },
        },
      }),
      prisma.lead.count({
        where: {
          ...assignedFilter,
          followupDate: { gte: dayFrom, lt: dayTo },
          followups: { none: { userid: userIdBig, createdAt: { gte: dayFrom, lt: dayTo } } },
        },
      }),
    ])
    const due = done + pending
    return { due, done, pending }
  }

  const [
    todayMetrics, yesterdayMetrics, last7Metrics, last30Metrics, mtdMetrics,
    todaySplit, yesterdaySplit,
    assignedActive, enrolledLifetime,
    followupsOverdue, followupsToday, followupsUpcoming, staleLeads,
    overdue1to7, overdue8to30, overdue30plus,
    recentFollowups, recentComments, recentStatusChanges, recentCalls,
  ] = await Promise.all([
    metricsFor(today, tomorrow),
    metricsFor(yesterday, today),
    metricsFor(last7Start, tomorrow),
    metricsFor(last30Start, tomorrow),
    metricsFor(mtdStart, tomorrow),
    followupSplit(today, tomorrow),
    followupSplit(yesterday, today),
    prisma.lead.count({ where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0 } }),
    prisma.lead.count({ where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0, enrolled: 1 } }),
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today } },
    }),
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        followupDate: { gte: today, lt: tomorrow } },
    }),
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        followupDate: { gte: tomorrow, lt: horizon } },
    }),
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        updatedAt: { lt: staleCutoff } },
    }),
    // Overdue buckets — by how stale the followup date itself is
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        followupDate: { gte: addDays(today, -7), lt: today } },
    }),
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        followupDate: { gte: addDays(today, -30), lt: addDays(today, -7) } },
    }),
    prisma.lead.count({
      where: { assignedTo: { some: { clrId: userIdBig, status: 1 } }, trash: 0,
        followupDate: { gte: REAL_FOLLOWUP_MIN, lt: addDays(today, -30) } },
    }),
    // ─── Recent activity feed (last 7 days up to selected date, mixed) ───
    prisma.leadFollowup.findMany({
      where: { userid: userIdBig, createdAt: { gte: last7Start, lt: tomorrow } },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, createdAt: true, comment: true, fStatus: true, stdId: true,
        lead: { select: { name: true } } },
    }),
    prisma.leadComment.findMany({
      where: { userId: userIdBig, createdAt: { gte: last7Start, lt: tomorrow } },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, createdAt: true, comment: true, leadId: true,
        lead: { select: { name: true } } },
    }),
    prisma.leadStatusHistory.findMany({
      where: { changedById: userIdBig, createdAt: { gte: last7Start, lt: tomorrow } },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, createdAt: true, fromStatus: true, toStatus: true, leadId: true,
        lead: { select: { name: true } } },
    }),
    prisma.mobileCall.findMany({
      where: { userId: userIdBig, startedAt: { gte: last7Start, lt: tomorrow }, status: { not: 'TRIGGERED' } },
      orderBy: { startedAt: 'desc' }, take: 10,
      select: { id: true, startedAt: true, status: true, durationSec: true, phoneNumber: true, leadId: true,
        lead: { select: { name: true } } },
    }),
  ])

  const conversionRate = assignedActive + enrolledLifetime > 0
    ? Math.round((enrolledLifetime / (assignedActive + enrolledLifetime)) * 10000) / 100
    : 0

  // Merge & sort recent activity feed
  type ActivityItem = {
    kind: 'followup' | 'comment' | 'status' | 'call'
    at: string
    leadId: number | null
    leadName: string | null
    text: string
  }
  const activity: ActivityItem[] = [
    ...recentFollowups.map((f): ActivityItem => ({
      kind: 'followup', at: f.createdAt.toISOString(),
      leadId: f.stdId ? Number(f.stdId) : null,
      leadName: f.lead?.name ?? null,
      text: f.fStatus ? `${f.fStatus} — ${(f.comment || '').slice(0, 80)}` : (f.comment || '').slice(0, 120),
    })),
    ...recentComments.map((cm): ActivityItem => ({
      kind: 'comment', at: cm.createdAt.toISOString(),
      leadId: cm.leadId ? Number(cm.leadId) : null,
      leadName: cm.lead?.name ?? null,
      text: (cm.comment || '').slice(0, 120),
    })),
    ...recentStatusChanges.map((s): ActivityItem => ({
      kind: 'status', at: s.createdAt.toISOString(),
      leadId: s.leadId ? Number(s.leadId) : null,
      leadName: s.lead?.name ?? null,
      text: `${s.fromStatus || '—'} → ${s.toStatus}`,
    })),
    ...recentCalls.map((cl): ActivityItem => ({
      kind: 'call', at: cl.startedAt.toISOString(),
      leadId: cl.leadId ? Number(cl.leadId) : null,
      leadName: cl.lead?.name ?? null,
      text: `${cl.status}${cl.durationSec ? ` · ${cl.durationSec}s` : ''} · ${cl.phoneNumber || ''}`.trim(),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15)

  return c.json({
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      designation: user.designation,
      role: user.role,
      status: user.status,
      branch: user.branch ? { id: Number(user.branch.id), name: user.branch.name, city: user.branch.city } : null,
      joinedAt: user.createdAt.toISOString(),
    },
    pipeline: {
      assignedActive,
      enrolledLifetime,
      conversionRate,
      staleLeads,
      followupsOverdue,
      followupsToday,
      followupsUpcoming,
      overdueBuckets: {
        d1to7: overdue1to7,
        d8to30: overdue8to30,
        d30plus: overdue30plus,
      },
    },
    periods: {
      today: { ...todayMetrics, followups: todaySplit },
      yesterday: { ...yesterdayMetrics, followups: yesterdaySplit },
      last7days: last7Metrics,
      last30days: last30Metrics,
      mtd: mtdMetrics,
    },
    activity,
    selectedDate: today.toISOString().slice(0, 10),
    prevDate: yesterday.toISOString().slice(0, 10),
    isToday,
  })
})
