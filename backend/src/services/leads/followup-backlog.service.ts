import { prisma } from '../../lib/prisma'
import { todayDateOnly, addDays, REAL_FOLLOWUP_MIN } from '../../utils/date-range'

// Roles whose "pending follow-ups" are scoped to leads assigned to them.
// Admin / sub-admin have no personal assignment, so their backlog is empty
// unless a specific target counsellor is requested.
const ASSIGNED_ROLES = ['counsellor', 'employee', 'franchise', 'sales-head']

export function scopedFollowupWhere(userId: bigint, role: string, extra: Record<string, unknown>) {
  const where: Record<string, unknown> = { trash: 0, ...extra }
  if (ASSIGNED_ROLES.includes(role)) {
    where.assignedTo = { some: { clrId: userId, status: 1 } }
  }
  return where
}

// Backlog snapshot — relative to refDate (defaults to IST today).
export async function getFollowupBacklogCounts(userId: bigint, role: string, refDate?: Date) {
  const today = refDate ? todayDateOnly(refDate) : todayDateOnly()
  const tomorrow = addDays(today, 1)
  const horizon = addDays(tomorrow, 7)

  const [overdue, dueToday, upcoming] = await Promise.all([
    prisma.lead.count({ where: scopedFollowupWhere(userId, role, { followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today } }) }),
    prisma.lead.count({ where: scopedFollowupWhere(userId, role, { followupDate: { gte: today, lt: tomorrow } }) }),
    prisma.lead.count({ where: scopedFollowupWhere(userId, role, { followupDate: { gte: tomorrow, lt: horizon } }) }),
  ])

  return { overdue, dueToday, upcoming }
}

