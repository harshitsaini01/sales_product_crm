import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { bigintFix } from '../utils/bigint-fix'
import { todayDateOnly, addDays, REAL_FOLLOWUP_MIN } from '../utils/date-range'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'
import * as followupService from '../services/leads/lead-followup.service'
import { scopedFollowupWhere, getFollowupBacklogCounts } from '../services/leads/followup-backlog.service'

export const followupsRoutes = new Hono()

followupsRoutes.use('*', authenticate)

const followupSchema = z.object({
  stdId: z.number(),
  comment: z.string().optional().default(''),
  leadStatus: z.string().optional(),
  leadStatusId: z.number().optional(),
  leadSubStatusId: z.number().optional(),
  statusLeadTypeId: z.number().optional(),
  followupDate: z.string().optional(),
  callAnsweredStatus: z.number().optional(),
  departmentId: z.number().optional(),
  type: z.string().optional(),
  fStatus: z.string().optional(),
  leadFollowStatus: z.number().optional(),
  description: z.string().optional(),
})

// GET /api/followups?leadId=xxx
followupsRoutes.get('/', async (c) => {
  const leadId = c.req.query('leadId')
  if (!leadId) return c.json({ error: 'leadId required' }, 400)

  const followups = await followupService.getFollowups(BigInt(leadId))
  return c.json(bigintFix(followups))
})

// POST /api/followups  (THE CRITICAL ROUTE — runs cascade logic)
followupsRoutes.post('/', zValidator('json', followupSchema), async (c) => {
  const body = c.req.valid('json')
  const { userId, role } = c.get('user')

  try {
    const followup = await followupService.addLeadFollowup({
      stdId: BigInt(body.stdId),
      userid: BigInt(userId),
      comment: body.comment,
      followupDate: body.followupDate,
      leadStatus: body.leadStatus,
      leadStatusId: body.leadStatusId,
      leadSubStatusId: body.leadSubStatusId,
      statusLeadTypeId: body.statusLeadTypeId,
      callAnsweredStatus: body.callAnsweredStatus,
      departmentId: body.departmentId,
      fStatus: body.fStatus,
      leadFollowStatus: body.leadFollowStatus,
      type: body.type,
      description: body.description,
      role,
    })

    return c.json(bigintFix(followup), 201)
  } catch (err) {
    // Pipeline guard: counsellors cannot move a lead backward through the
    // department pipeline. Surfaces as a 403 with structured payload so the
    // frontend can render a friendly "ask an admin to recycle this lead"
    // message rather than a generic toast.
    const e = err as { code?: string; fromDeptId?: number; toDeptId?: number; fromDeptName?: string; toDeptName?: string; message?: string }
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

// POST /api/followups/bulk
followupsRoutes.post('/bulk', async (c) => {
  const body = await c.req.json()
  const { userId, role } = c.get('user')

  // Validate leadIds is a non-empty array before passing to service
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return c.json({ error: 'leadIds must be a non-empty array' }, 400)
  }

  const results = await followupService.addBulkFollowup({
    leadIds: body.leadIds,
    userid: BigInt(userId), // must be BigInt — matches single POST /followups behaviour
    comment: body.comment,
    followupDate: body.followupDate,
    leadStatusId: body.leadStatusId,
    leadSubStatusId: body.leadSubStatusId,
    role,
  })

  // Surface the per-lead pipeline-block summary so the bulk modal can show
  // "247 updated, 3 skipped (would move backward)" instead of a flat success.
  const skipped = results.filter((r) => !r.success)
  const codeOf = (r: (typeof results)[number]) => ('code' in r ? (r as { code?: string }).code : undefined)
  const blocked = skipped.filter((r) => codeOf(r) === 'backward_move_blocked').length
  // A chunk that rolled back is reported explicitly — the old serial loop could
  // die at the proxy mid-batch and leave the caller with no idea what landed.
  const writeFailed = skipped.filter((r) => codeOf(r) === 'write_failed').length
  return c.json({
    results,
    total: body.leadIds.length,
    updated: results.length - skipped.length,
    skipped: skipped.length,
    blockedBackward: blocked,
    writeFailed,
  })
})

// ─── Shared helpers for pending-followup endpoints ───────────────────────────
function scopedWhere(userId: number, role: string, extra: Record<string, unknown>) {
  return scopedFollowupWhere(BigInt(userId), role, extra)
}

// Admins/sub-admins may pass ?userId= to view a specific counsellor's
// backlog instead of their own. Anyone else is always scoped to themselves.
async function resolveTargetUser(c: import('hono').Context): Promise<{ userId: number; role: string } | null> {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const queryUserId = c.req.query('userId')
  if (isAdmin && queryUserId) {
    const { prisma } = await import('../lib/prisma')
    const target = await prisma.user.findUnique({ where: { id: BigInt(queryUserId) }, select: { id: true, role: true } })
    if (!target) return null
    return { userId: Number(target.id), role: target.role }
  }
  return { userId, role }
}

const LEAD_SELECT = {
  id: true, name: true, mobile: true, email: true,
  leadStatus: true, leadSubStatus: true, followupDate: true,
  comment: true, source: true, event: true,
  followups: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { comment: true, description: true },
  },
} as const

type LeadRow = {
  id: bigint
  name: string
  mobile: string | null
  email: string | null
  leadStatus: string | null
  leadSubStatus: string | null
  followupDate: Date | null
  comment: string | null
  followups: Array<{ comment: string; description: string | null }>
}

// Flatten the latest follow-up into lastComment/lastNote so the dashboard cards
// can render them without an extra round-trip per row.
function withLastComment(leads: unknown[]): unknown[] {
  return (leads as LeadRow[]).map((l) => {
    const latest = l.followups?.[0]
    return {
      ...l,
      lastComment: latest?.comment || l.comment || null,
      lastNote: latest?.description || null,
    }
  })
}

function refDateFromQuery(dateParam?: string): Date {
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  return todayDateOnly()
}

// GET /api/followups/today — today's follow-ups for current counsellor
// (or, for admin/sub-admin, ?userId= to view a specific counsellor's)
followupsRoutes.get('/today', async (c) => {
  const target = await resolveTargetUser(c)
  if (!target) return c.json({ error: 'User not found' }, 404)
  const { userId, role } = target
  const today = refDateFromQuery(c.req.query('date'))
  const tomorrow = addDays(today, 1)
  const { page, limit, skip } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') || '200' })

  const { prisma } = await import('../lib/prisma')
  const where = scopedWhere(userId, role, { followupDate: { gte: today, lt: tomorrow } })
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({ where, select: LEAD_SELECT, orderBy: { followupDate: 'asc' }, skip, take: limit }),
    prisma.lead.count({ where }),
  ])

  return c.json(buildPaginatedResult(withLastComment(bigintFix(leads) as unknown[]), total, page, limit))
})

// GET /api/followups/overdue — followups whose date has already passed
followupsRoutes.get('/overdue', async (c) => {
  const target = await resolveTargetUser(c)
  if (!target) return c.json({ error: 'User not found' }, 404)
  const { userId, role } = target
  const today = refDateFromQuery(c.req.query('date'))
  const { page, limit, skip } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') || '200' })

  const { prisma } = await import('../lib/prisma')
  const where = scopedWhere(userId, role, { followupDate: { gte: REAL_FOLLOWUP_MIN, lt: today } })
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({ where, select: LEAD_SELECT, orderBy: { followupDate: 'asc' }, skip, take: limit }),
    prisma.lead.count({ where }),
  ])

  return c.json(buildPaginatedResult(withLastComment(bigintFix(leads) as unknown[]), total, page, limit))
})

// GET /api/followups/upcoming — followups due within the next 7 days (excluding today)
followupsRoutes.get('/upcoming', async (c) => {
  const target = await resolveTargetUser(c)
  if (!target) return c.json({ error: 'User not found' }, 404)
  const { userId, role } = target
  const today = refDateFromQuery(c.req.query('date'))
  const tomorrow = addDays(today, 1)
  const horizon = addDays(tomorrow, 7)
  const { page, limit, skip } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') || '200' })

  const { prisma } = await import('../lib/prisma')
  const where = scopedWhere(userId, role, { followupDate: { gte: tomorrow, lt: horizon } })
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({ where, select: LEAD_SELECT, orderBy: { followupDate: 'asc' }, skip, take: limit }),
    prisma.lead.count({ where }),
  ])

  return c.json(buildPaginatedResult(withLastComment(bigintFix(leads) as unknown[]), total, page, limit))
})

// GET /api/followups/pending-counts — counts for dashboard widget badges
// (or, for admin/sub-admin, ?userId= to view a specific counsellor's)
followupsRoutes.get('/pending-counts', async (c) => {
  const target = await resolveTargetUser(c)
  if (!target) return c.json({ error: 'User not found' }, 404)
  const { overdue, dueToday, upcoming } = await getFollowupBacklogCounts(BigInt(target.userId), target.role)
  return c.json({ overdue, today: dueToday, upcoming })
})

// GET /api/followups/range?from=&to= — leads with followups in a date range
// (used by Calendar page for monthly view)
followupsRoutes.get('/range', async (c) => {
  const { userId, role } = c.get('user')
  const fromStr = c.req.query('from')
  const toStr = c.req.query('to')
  const counsellorIdStr = c.req.query('counsellorId')
  if (!fromStr || !toStr) return c.json({ error: 'from and to required' }, 400)
  // Parse YYYY-MM-DD as IST calendar dates → UTC-midnight Date for @db.Date columns
  const parseDay = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  }
  const from = parseDay(fromStr)
  const to = addDays(parseDay(toStr), 1)

  const extraWhere: Record<string, unknown> = { followupDate: { gte: from, lt: to } }
  const doneWhereLead: Record<string, unknown> = {}
  
  if (counsellorIdStr && (role === 'admin' || role === 'sub-admin')) {
    extraWhere.assignedTo = { some: { clrId: BigInt(counsellorIdStr), status: 1 } }
    doneWhereLead.assignedTo = { some: { clrId: BigInt(counsellorIdStr), status: 1 } }
  }

  const { prisma } = await import('../lib/prisma')
  
  const [pendingLeads, doneFollowups] = await Promise.all([
    prisma.lead.findMany({
      where: scopedWhere(userId, role, extraWhere),
      select: LEAD_SELECT,
      orderBy: { followupDate: 'asc' },
      take: 1000,
    }),
    prisma.leadFollowup.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        lead: scopedWhere(userId, role, doneWhereLead),
      },
      select: {
        id: true,
        createdAt: true,
        lead: {
          select: { id: true, name: true, leadStatus: true, source: true, event: true }
        }
      },
      take: 1000,
    })
  ])

  const results = [
    ...pendingLeads.map(l => ({ ...l, isDone: false })),
    ...doneFollowups.map(f => ({
      id: f.lead.id,
      name: f.lead.name,
      followupDate: f.createdAt,
      leadStatus: f.lead.leadStatus,
      source: f.lead.source,
      event: f.lead.event,
      isDone: true,
      followupRecordId: f.id,
    }))
  ]

  return c.json(bigintFix(results))
})

// GET /api/followups/last/:leadId — last followup for a lead
followupsRoutes.get('/last/:leadId', async (c) => {
  const leadId = BigInt(c.req.param('leadId'))
  const followup = await followupService.getLastFollowup(leadId)
  return c.json(bigintFix(followup))
})

// DELETE /api/followups/:id (admin only)
followupsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await followupService.deleteFollowup(id)
  return c.json({ message: 'Followup deleted' })
})
