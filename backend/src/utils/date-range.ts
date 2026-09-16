// Server may run in UTC, but the business operates in IST. PostgreSQL `@db.Date`
// columns (e.g. lead.followup_date) store calendar dates with no zone, so we must
// compute "today" against the IST calendar and pass it to Prisma as a UTC-midnight
// Date — otherwise Prisma's `setHours(0,0,0,0)` approach silently shifts the
// window by a day for any server whose local timezone isn't IST.

const TZ_OFFSET_MINUTES = 330 // IST = UTC+5:30

function istCalendarDate(now: Date = new Date()): { y: number; m: number; d: number } {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60_000)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() }
}

// Returns the IST-today calendar date as a UTC-midnight Date — safe to compare
// against `@db.Date` columns in Prisma.
export function todayDateOnly(now: Date = new Date()): Date {
  const { y, m, d } = istCalendarDate(now)
  return new Date(Date.UTC(y, m, d))
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

// Leads marked "N/A — no follow-up needed" store followupDate = 0001-01-01.
// This cutoff filters them out of overdue/pending queues so dead leads stop
// pinging counsellors. Any real follow-up date falls after this boundary.
export const REAL_FOLLOWUP_MIN = new Date(Date.UTC(2000, 0, 1))
