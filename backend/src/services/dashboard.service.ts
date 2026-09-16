import { prisma } from '../lib/prisma'
import { bigintFix } from '../utils/bigint-fix'

// ─── DASHBOARD STATS (matching old CRM leadStatics) ──────────────────────────
export async function getDashboardStats(userId: number, role: string) {
  const baseWhere: Record<string, unknown> = { trash: 0 }

  // Role scoping
  if (['counsellor', 'employee', 'franchise', 'sales-head'].includes(role)) {
    baseWhere.assignedTo = { some: { clrId: BigInt(userId), status: 1 } }
  }

  const [
    totalLeads,
    newLeads,
    totalUsers,
    todayFollowups,
    pendingLeads,
  ] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where: { ...baseWhere, leadType: 'new' } }),
    prisma.user.count({ where: { status: 1 } }),
    prisma.lead.count({
      where: {
        ...baseWhere,
        followupDate: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      },
    }),
    prisma.lead.count({ where: { ...baseWhere, asign: 1 } }),
  ])

  // Lead type distribution
  const leadTypeBreakdown = await prisma.lead.groupBy({
    by: ['leadType'],
    where: baseWhere,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  // Department distribution
  const departmentBreakdown = await prisma.lead.groupBy({
    by: ['departmentId'],
    where: baseWhere,
    _count: { id: true },
  })

  // Recent leads (last 7 days by day)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const recentLeads = await prisma.lead.findMany({
    where: { ...baseWhere, createdAt: { gte: sevenDaysAgo } },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  return bigintFix({
    totals: {
      leads: totalLeads,
      newLeads,
      users: totalUsers,
      todayFollowups,
      pendingLeads,
    },
    leadTypeBreakdown: leadTypeBreakdown.map((l) => ({
      type: l.leadType,
      count: l._count.id,
    })),
    departmentBreakdown: departmentBreakdown.map((d) => ({
      departmentId: d.departmentId,
      count: d._count.id,
    })),
    recentLeads,
  })
}

// ─── LEAD STATISTICS DETAIL (admin/counsellor per-type reporting) ─────────────
export async function getLeadStatsByType(userId: number, role: string, fromDate?: string, toDate?: string) {
  const baseWhere: Record<string, unknown> = { trash: 0 }

  if (['counsellor', 'employee', 'franchise', 'sales-head'].includes(role)) {
    baseWhere.assignedTo = { some: { clrId: BigInt(userId), status: 1 } }
  }

  if (fromDate || toDate) {
    baseWhere.createdAt = {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate ? { lte: new Date(toDate + 'T23:59:59') } : {}),
    }
  }

  const stats = await prisma.lead.groupBy({
    by: ['leadType', 'leadStatus'],
    where: baseWhere,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  return bigintFix(stats.map((s) => ({ leadType: s.leadType, leadStatus: s.leadStatus, count: s._count.id })))
}
