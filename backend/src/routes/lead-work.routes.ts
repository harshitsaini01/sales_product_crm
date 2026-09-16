import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly, salesHeadAndAbove } from '../middleware/rbac'
import { bigintFix } from '../utils/bigint-fix'
import { buildLeadPhoneIndex, callPhoneOr, phoneKey, type LeadPhoneIndex } from '../utils/phone'

export const leadWorkRoutes = new Hono()
leadWorkRoutes.use('*', authenticate)

type WorkType = 'INITIAL_CALL' | 'FOLLOWUP'

function day(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return new Date(`${value}T00:00:00+05:30`)
}

function dbDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

export function dayLabel(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
}

function todayIST() {
  return day(dayLabel(new Date()))!
}

/**
 * Which leads a cohort covers, in one of three shapes:
 *   - `days`  — an explicit set of (not necessarily adjacent) calendar days,
 *               which is what the builder's "Add date" control builds up;
 *   - `gte`/`lt` — a continuous window;
 *   - none of the above — every lead ever, for the All-time view.
 */
type CohortRange = { days?: Date[]; gte?: Date; lt?: Date }

function nextDay(start: Date) {
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return end
}

function rangeWhere(range: CohortRange): Prisma.LeadWhereInput {
  if (range.days?.length) {
    return { trash: 0, OR: range.days.map((start) => ({ createdAt: { gte: start, lt: nextDay(start) } })) }
  }
  if (!range.gte && !range.lt) return { trash: 0 }
  return {
    trash: 0,
    createdAt: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) },
  }
}

/** The single-day cohort the workboard is built around. */
function dayRange(start: Date): CohortRange {
  return { gte: start, lt: nextDay(start) }
}

/**
 * Past this many leads the sub-queries stop being filtered by lead id and just
 * scan their table instead. Two reasons: Postgres caps a prepared statement at
 * 32 767 bind variables, so an `IN` over every lead id simply fails; and at that
 * size the unfiltered scan is cheaper anyway. Measured on this database
 * (60 926 leads): leads 7.8 s, assignments 0.7 s, calls 5.6 s, comments 0.3 s.
 */
const BULK_LEAD_COUNT = 20_000

/**
 * Everything the builder needs about one cohort of leads. `take` caps the number
 * of leads pulled (newest first) and is optional — All-time passes nothing, so
 * every lead comes back.
 *
 * The assignment rows are fetched separately rather than through a Prisma
 * relation include: an include re-queries the children with one bind variable
 * per parent id, which blows the 32 767 cap on any cohort bigger than that.
 */
async function cohortSnapshot(range: CohortRange, take?: number) {
  const rows = await prisma.lead.findMany({
    where: rangeWhere(range),
    orderBy: { createdAt: 'desc' },
    ...(take ? { take } : {}),
    select: {
      id: true, name: true, called: true, followupDate: true,
      mobile: true, email: true, city: true, state: true, country: true,
      intrestedCourse: true, source: true, sourceUrl: true, website: true, comment: true,
      // Extra columns the task builder filters on (mirrors the Leads page filter bar).
      event: true, wapp: true, isDuplicate: true, leadScore: true, createdAt: true,
      leadStatus: true, leadSubStatus: true, leadStatusId: true, leadSubStatusId: true,
      departmentId: true, statusLeadTypeId: true,
    },
  })
  const ids = rows.map((lead) => lead.id)
  const bulk = ids.length > BULK_LEAD_COUNT
  const scopeToCohort = <T extends object>(clause: T) => (bulk ? {} : clause)

  const [assignments, latestComments] = await Promise.all([
    ids.length ? prisma.asignedLead.findMany({
      where: { status: 1, ...scopeToCohort({ stdId: { in: ids } }) },
      select: { stdId: true, clrId: true, createdAt: true, counsellor: { select: { name: true } } },
    }) : [],
    // Latest LeadComment per lead — same pattern the main Bucket page uses.
    ids.length ? prisma.leadComment.findMany({
      where: scopeToCohort({ leadId: { in: ids } }),
      orderBy: { createdAt: 'desc' },
      distinct: ['leadId'],
      select: { leadId: true, comment: true },
    }) : [],
  ])
  const assignedByLead = new Map<string, { clrId: bigint; counsellor: { name: string }; createdAt: Date }[]>()
  for (const row of assignments) {
    const key = row.stdId.toString()
    const list = assignedByLead.get(key)
    if (list) list.push(row)
    else assignedByLead.set(key, [row])
  }
  const leads = rows.map((lead) => ({ ...lead, assignedTo: assignedByLead.get(lead.id.toString()) || [] }))
  const commentByLead = new Map(latestComments.map((row) => [row.leadId.toString(), row.comment]))

  const cohortIds = new Set(ids.map((id) => id.toString()))
  // Calls follow the phone number, not the lead row: the same person can sit in
  // the CRM several times over and the call lands on whichever copy was open.
  // Counting only this cohort's ids reported leads as "never called" when they
  // had in fact been rung under a duplicate.
  //
  // In bulk mode that fold is unnecessary: the cohort already contains every
  // lead, so a call's own lead is always in it and the duplicate index would
  // only map each id to itself — at a cost of ~60k phone lookups.
  const phoneIndex = bulk ? null : await buildLeadPhoneIndex(ids)
  const searchIds = phoneIndex ? phoneIndex.allLeadIds.map((id) => BigInt(id)) : null
  const [mobile, manual] = await Promise.all([
    prisma.mobileCall.findMany({
      where: { status: { not: 'TRIGGERED' }, ...(searchIds ? { leadId: { in: searchIds } } : { leadId: { not: null } }) },
      select: { leadId: true, status: true },
    }),
    prisma.callLog.findMany({
      where: searchIds ? { leadId: { in: searchIds } } : {},
      select: { leadId: true, outcome: true },
    }),
  ])
  // Fold a call on any duplicate back onto the cohort lead(s) it represents.
  const foldToCohort = (leadId?: bigint | null): string[] => {
    if (!leadId) return []
    const id = leadId.toString()
    if (cohortIds.has(id)) return [id]
    if (!phoneIndex) return []
    const out = new Set<string>()
    for (const key of phoneIndex.keysOf(id)) {
      for (const target of phoneIndex.targetsForKey(key)) if (cohortIds.has(target)) out.add(target)
    }
    return [...out]
  }
  const attempted = new Set<string>([
    ...mobile.flatMap((call) => foldToCohort(call.leadId)),
    ...manual.flatMap((call) => foldToCohort(call.leadId)),
  ])
  const answered = new Set<string>([
    ...mobile.filter((call) => call.status === 'ANSWERED').flatMap((call) => foldToCohort(call.leadId)),
    ...manual.filter((call) => call.outcome === 'answered').flatMap((call) => foldToCohort(call.leadId)),
  ])
  const dueFollowup = new Set(leads
    .filter((lead) => attempted.has(lead.id.toString()) && lead.followupDate && lead.followupDate <= todayIST())
    .map((lead) => lead.id.toString()))
  return { leads, attempted, answered, dueFollowup, commentByLead }
}

/**
 * One lead as the task builder consumes it. `createdOn` is the IST day the lead
 * landed — the builder groups by it when creating tasks, because the batch API
 * takes one lead-created date per request.
 */
function mapCohortLead(
  lead: Awaited<ReturnType<typeof cohortSnapshot>>['leads'][number],
  ctx: { attempted: Set<string>; answered: Set<string>; dueFollowup: Set<string>; commentByLead: Map<string, string | null> },
) {
  const key = lead.id.toString()
  return {
    id: Number(lead.id), name: lead.name,
    mobile: lead.mobile, email: lead.email,
    city: lead.city, state: lead.state, country: lead.country,
    interest: lead.intrestedCourse,
    source: lead.source, sourceUrl: lead.sourceUrl, website: lead.website,
    event: lead.event,
    note: ctx.commentByLead.get(key) || lead.comment || null,
    // Filterable lead attributes — same vocabulary as the Leads page filters.
    leadStatus: lead.leadStatus, leadSubStatus: lead.leadSubStatus,
    leadStatusId: lead.leadStatusId === null ? null : Number(lead.leadStatusId),
    leadSubStatusId: lead.leadSubStatusId === null ? null : Number(lead.leadSubStatusId),
    departmentId: lead.departmentId === null ? null : Number(lead.departmentId),
    statusLeadTypeId: lead.statusLeadTypeId === null ? null : Number(lead.statusLeadTypeId),
    called: lead.called === 1, wapp: lead.wapp === 1, isDuplicate: lead.isDuplicate,
    leadScore: lead.leadScore,
    followupDate: lead.followupDate ? dayLabel(lead.followupDate) : null,
    createdAt: lead.createdAt.toISOString(),
    createdOn: dayLabel(lead.createdAt),
    attempted: ctx.attempted.has(key), answered: ctx.answered.has(key),
    pendingFollowup: ctx.dueFollowup.has(key),
    assignedTo: lead.assignedTo.map((assignment) => ({
      id: Number(assignment.clrId), name: assignment.counsellor.name, assignedOn: dayLabel(assignment.createdAt),
    })),
  }
}

// One lead-created-date cohort. Assignment timestamps are deliberately absent.
leadWorkRoutes.get('/workboard', adminOnly, async (c) => {
  const date = day(c.req.query('date')) || todayIST()
  const { leads, attempted, answered, dueFollowup, commentByLead } = await cohortSnapshot(dayRange(date))
  const byCounsellor = new Map<string, { id: number; name: string; assigned: number; attempted: number; answered: number; pending: number }>()
  for (const lead of leads) for (const assignment of lead.assignedTo) {
    const id = Number(assignment.clrId)
    const row = byCounsellor.get(String(id)) || { id, name: assignment.counsellor.name, assigned: 0, attempted: 0, answered: 0, pending: 0 }
    row.assigned++
    if (attempted.has(lead.id.toString())) row.attempted++
    else row.pending++
    if (answered.has(lead.id.toString())) row.answered++
    byCounsellor.set(String(id), row)
  }
  const pendingCallIds = leads.filter((lead) => !attempted.has(lead.id.toString())).map((lead) => Number(lead.id))
  const pendingFollowupIds = leads.filter((lead) => dueFollowup.has(lead.id.toString())).map((lead) => Number(lead.id))
  return c.json({
    date: dayLabel(date), total: leads.length,
    assigned: leads.filter((lead) => lead.assignedTo.length).length,
    attempted: attempted.size, answered: answered.size,
    followups: pendingFollowupIds.length, pending: pendingCallIds.length,
    pendingCallIds, pendingFollowupIds,
    counsellors: [...byCounsellor.values()].sort((a, b) => b.pending - a.pending),
    leads: leads.map((lead) => mapCohortLead(lead, { attempted, answered, dueFollowup, commentByLead })),
  })
})

/**
 * Lead cohort for an arbitrary window — or, with no `from`/`to` at all, for
 * every lead in the CRM. This backs the task builder's date presets and its
 * All-time view, which a per-day endpoint cannot answer.
 *
 * All-time is deliberately capped at the newest `limit` leads: the snapshot
 * builds a phone-duplicate index and pulls every call for the set, which does
 * not scale to the whole table. `total` and `capped` tell the client what it is
 * looking at so it can say so rather than silently truncating.
 */
leadWorkRoutes.get('/cohort', adminOnly, async (c) => {
  // `days` (a comma-separated list) wins over from/to — it is the "Add date"
  // selection, which can hold days that are not next to each other. Capped so a
  // hand-edited URL can't ask for hundreds of day-windows in one OR.
  const picked = (c.req.query('days') || '').split(',').map((value) => day(value.trim())).filter((d): d is Date => !!d)
  const from = day(c.req.query('from'))
  const to = day(c.req.query('to'))
  // No cap by default — All-time really does return every lead. `limit` stays
  // available as an escape hatch if this ever needs throttling from the client.
  const limitParam = Number(c.req.query('limit') || 0)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined
  const range: CohortRange = {}
  if (picked.length) {
    range.days = picked.slice(0, 62)
  } else {
    if (from) range.gte = from
    if (to) range.lt = nextDay(to)
  }
  const [total, snapshot] = await Promise.all([
    prisma.lead.count({ where: rangeWhere(range) }),
    cohortSnapshot(range, limit),
  ])
  const { leads, attempted, answered, dueFollowup, commentByLead } = snapshot
  return c.json({
    days: range.days ? range.days.map(dayLabel) : null,
    from: range.days ? null : (from ? dayLabel(from) : null),
    to: range.days ? null : (to ? dayLabel(to) : null),
    total, returned: leads.length,
    attempted: attempted.size, answered: answered.size,
    pending: leads.filter((lead) => !attempted.has(lead.id.toString())).length,
    followups: dueFollowup.size,
    leads: leads.map((lead) => mapCohortLead(lead, { attempted, answered, dueFollowup, commentByLead })),
  })
})

leadWorkRoutes.get('/history', adminOnly, async (c) => {
  const days = Math.min(31, Math.max(2, Number(c.req.query('days') || 14)))
  const base = day(c.req.query('date')) || todayIST()
  const rows = await Promise.all(Array.from({ length: days }, async (_, index) => {
    const start = new Date(base)
    start.setDate(start.getDate() - index)
    const { leads, attempted, answered, dueFollowup } = await cohortSnapshot(dayRange(start))
    return {
      date: dayLabel(start), total: leads.length,
      assigned: leads.filter((lead) => lead.assignedTo.length).length,
      attempted: attempted.size, answered: answered.size,
      followups: dueFollowup.size,
      pending: leads.filter((lead) => !attempted.has(lead.id.toString())).length,
    }
  }))
  return c.json(rows)
})

leadWorkRoutes.get('/call-quality', adminOnly, async (c) => {
  const start = day(c.req.query('date')) || todayIST()
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const [mobile, manual, followups, changes] = await Promise.all([
    prisma.mobileCall.findMany({ where: { direction: 'OUTGOING', status: { not: 'TRIGGERED' }, startedAt: { gte: start, lt: end }, leadId: { not: null } }, select: { userId: true, leadId: true, status: true, durationSec: true, lead: { select: { followupDate: true } }, user: { select: { name: true } } } }),
    prisma.callLog.findMany({ where: { direction: 'outbound', createdAt: { gte: start, lt: end } }, select: { userId: true, leadId: true, outcome: true, durationSeconds: true, user: { select: { name: true } } } }),
    prisma.leadFollowup.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { userid: true, stdId: true } }),
    prisma.leadStatusHistory.findMany({ where: { createdAt: { gte: start, lt: end }, fromStatus: { not: null } }, select: { changedById: true, leadId: true } }),
  ])
  type Row = { userId: number; name: string; attempts: number; uniqueLeads: Set<string>; connected: number; talkSec: number; noAnswer: number; lateFollowupCalls: number; outcomes: Set<string> }
  const rows = new Map<string, Row>()
  const get = (id: bigint, name: string) => {
    const key = id.toString()
    const row = rows.get(key) || { userId: Number(id), name, attempts: 0, uniqueLeads: new Set<string>(), connected: 0, talkSec: 0, noAnswer: 0, lateFollowupCalls: 0, outcomes: new Set<string>() }
    rows.set(key, row)
    return row
  }
  for (const call of mobile) {
    const row = get(call.userId, call.user.name)
    row.attempts++
    row.uniqueLeads.add(call.leadId!.toString())
    if (call.status === 'ANSWERED') { row.connected++; row.talkSec += call.durationSec }
    if (['NO_ANSWER', 'BUSY', 'REJECTED', 'FAILED'].includes(call.status)) row.noAnswer++
    if (call.lead?.followupDate && call.lead.followupDate < start) row.lateFollowupCalls++
  }
  for (const call of manual) {
    const row = get(call.userId, call.user.name)
    row.attempts++
    row.uniqueLeads.add(call.leadId.toString())
    if (call.outcome === 'answered') { row.connected++; row.talkSec += call.durationSeconds || 0 }
    else row.noAnswer++
  }
  for (const record of followups) {
    const row = rows.get(record.userid.toString())
    if (row?.uniqueLeads.has(record.stdId.toString())) row.outcomes.add(record.stdId.toString())
  }
  for (const record of changes) {
    const row = rows.get(record.changedById.toString())
    if (row?.uniqueLeads.has(record.leadId.toString())) row.outcomes.add(record.leadId.toString())
  }
  return c.json([...rows.values()].map((row) => ({
    userId: row.userId, name: row.name, attempts: row.attempts,
    uniqueLeads: row.uniqueLeads.size, connected: row.connected,
    connectionRate: row.attempts ? Math.round((row.connected * 100) / row.attempts) : 0,
    averageTalkSec: row.connected ? Math.round(row.talkSec / row.connected) : 0,
    noAnswer: row.noAnswer, retries: Math.max(0, row.attempts - row.uniqueLeads.size),
    lateFollowupCalls: row.lateFollowupCalls, outcomesRecorded: row.outcomes.size,
  })).sort((a, b) => b.attempts - a.attempts))
})

// Quickly (re)assign a single lead's owner from the workboard table.
// Deactivates any prior active owner and creates one fresh active row.
leadWorkRoutes.post('/assign-owner', adminOnly, async (c) => {
  const body: { leadId?: number | string; counsellorId?: number | string } = await c.req.json()
  if (!body.leadId || !body.counsellorId) return c.json({ error: 'leadId and counsellorId are required' }, 400)
  const leadId = BigInt(body.leadId)
  const counsellorId = BigInt(body.counsellorId)
  await prisma.$transaction(async (tx) => {
    await tx.asignedLead.updateMany({ where: { stdId: leadId, status: 1 }, data: { status: 0 } })
    await tx.asignedLead.create({ data: { stdId: leadId, clrId: counsellorId, leadType: 'new', status: 1 } })
  })
  return c.json({ ok: true })
})

leadWorkRoutes.post('/batches', salesHeadAndAbove, async (c) => {
  const { userId } = c.get('user')
  const body: { leadIds?: Array<number | string>; assignedToId?: number | string; leadDate?: string; workDate?: string; dueDate?: string; title?: string; priority?: string; workType?: WorkType; notes?: string; keepExistingOwners?: boolean } = await c.req.json()
  const requestedIds = [...new Set<bigint>((body.leadIds || []).map((id) => BigInt(id)))]
  const leadStart = day(body.leadDate)
  const leadDate = body.leadDate ? dbDate(body.leadDate) : null
  const workDateLabel = body.workDate && /^\d{4}-\d{2}-\d{2}$/.test(body.workDate) ? body.workDate : dayLabel(new Date())
  const workDate = dbDate(workDateLabel)
  const assignedToId = body.assignedToId ? BigInt(body.assignedToId) : null
  const workType: WorkType = body.workType === 'FOLLOWUP' ? 'FOLLOWUP' : 'INITIAL_CALL'
  // Additive assignment: the lead keeps every counsellor it already has and
  // simply gains the task's assignee. Handing someone a task is not the same
  // as taking the lead off whoever owns it. Who SEES the task is decided by
  // LeadWorkBatch.assignedToId alone, so nothing leaks by keeping both.
  const keepExistingOwners = body.keepExistingOwners === true
  // `leadDate` is optional. The task builder sends one (every lead comes from a
  // single created-date cohort, and we verify that). The leads list sends none —
  // the admin hand-picked rows spanning arbitrary dates, so there is no cohort
  // to check against and `lead_date` stays null.
  if (!requestedIds.length || !assignedToId) return c.json({ error: 'leadIds and assignedToId are required' }, 400)
  if (body.leadDate && (!leadStart || !leadDate)) return c.json({ error: 'leadDate must be YYYY-MM-DD' }, 400)

  const cohortWindow: Prisma.LeadWhereInput = {}
  if (leadStart) {
    const end = new Date(leadStart)
    end.setDate(end.getDate() + 1)
    cohortWindow.createdAt = { gte: leadStart, lt: end }
  }
  const cohortLeads = await prisma.lead.findMany({
    where: { id: { in: requestedIds }, trash: 0, ...cohortWindow },
    select: { id: true, followupDate: true },
  })
  if (cohortLeads.length !== requestedIds.length) {
    const valid = new Set(cohortLeads.map((lead) => lead.id.toString()))
    return c.json({
      error: leadStart
        ? 'Some selected leads do not belong to the chosen created date'
        : 'Some selected leads no longer exist or are in the trash',
      invalidLeadIds: requestedIds.filter((id) => !valid.has(id.toString())).map(Number),
    }, 400)
  }

  // Admin explicitly picks the leads in the UI — trust the selection for both types.
  // We still block duplicates against another open task of the same type below.
  //
  // Preserve the admin's original order (task builder sends leadIds already
  // sorted the way the counsellor should call in — e.g. newest-first, or
  // filter-sorted). `prisma.lead.findMany({id: {in: [...]}})` returns rows
  // in DB order, which loses that intent. Sort the cohort back to the
  // request order before we write items — this becomes the call sequence on
  // both web and mobile (both endpoints now `orderBy: id ASC` on items,
  // and id is assigned in insertion order).
  const inputOrder = new Map(requestedIds.map((id, index) => [id.toString(), index]))
  let eligibleIds = cohortLeads
    .map((lead) => lead.id)
    .sort((a, b) => (inputOrder.get(a.toString()) ?? 0) - (inputOrder.get(b.toString()) ?? 0))

  const duplicateItems = await prisma.leadWorkBatchItem.findMany({
    where: { leadId: { in: eligibleIds }, batch: { status: 0, workType } },
    select: { leadId: true },
  })
  const duplicates = new Set(duplicateItems.map((item) => item.leadId.toString()))
  eligibleIds = eligibleIds.filter((id) => !duplicates.has(id.toString()))
  if (!eligibleIds.length) return c.json({ error: 'No eligible leads remain for this task type; they may already be completed or in an active task' }, 409)

  const batch = await prisma.$transaction(async (tx) => {
    const lastTask = await tx.leadWorkBatch.findFirst({
      where: { assignedToId, workDate }, orderBy: { sequence: 'desc' }, select: { sequence: true },
    })
    // Cohort tasks slot in next to their own cohort so a counsellor's day reads
    // date-by-date. Hand-picked tasks have no cohort, so they simply append.
    const lastCohortTask = leadDate
      ? await tx.leadWorkBatch.findFirst({
          where: { assignedToId, workDate, leadDate }, orderBy: { sequence: 'desc' }, select: { sequence: true },
        })
      : null
    const sequence = lastCohortTask ? lastCohortTask.sequence + 1 : (lastTask?.sequence || 0) + 1
    if (lastCohortTask && lastTask && sequence <= lastTask.sequence) {
      await tx.leadWorkBatch.updateMany({
        where: { assignedToId, workDate, sequence: { gte: sequence } },
        data: { sequence: { increment: 1 } },
      })
    }
    const defaultTitle = leadDate
      ? workType === 'INITIAL_CALL'
        ? `Call pending leads created on ${body.leadDate}`
        : `Complete follow-ups for leads created on ${body.leadDate}`
      : workType === 'INITIAL_CALL'
        ? `Call ${eligibleIds.length} selected lead${eligibleIds.length === 1 ? '' : 's'}`
        : `Follow up on ${eligibleIds.length} selected lead${eligibleIds.length === 1 ? '' : 's'}`
    const created = await tx.leadWorkBatch.create({
      data: {
        title: body.title?.trim() || defaultTitle, leadDate, workDate,
        dueDate: body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? dbDate(body.dueDate) : workDate,
        workType, sequence, priority: body.priority || 'high',
        notes: body.notes?.trim() || null,
        assignedById: BigInt(userId), assignedToId,
        items: { createMany: { data: eligibleIds.map((leadId) => ({ leadId })), skipDuplicates: true } },
      },
    })
    if (keepExistingOwners) {
      // Leave every existing owner active and add the assignee if they aren't
      // already on the lead. There is no unique index on (std_id, clr_id), so
      // without this check re-assigning a task would stack duplicate active
      // rows and inflate the counsellor's lead count.
      const existing = await tx.asignedLead.findMany({
        where: { stdId: { in: eligibleIds }, clrId: assignedToId, status: 1 },
        select: { stdId: true },
      })
      const held = new Set(existing.map((row) => row.stdId.toString()))
      const toAdd = eligibleIds.filter((stdId) => !held.has(stdId.toString()))
      if (toAdd.length) {
        await tx.asignedLead.createMany({
          data: toAdd.map((stdId) => ({ stdId, clrId: assignedToId, leadType: 'new', status: 1 })),
        })
      }
    } else {
      // Transfer: deactivate any prior active assignments for these leads so we
      // don't stack duplicates, then insert a single fresh active assignment for
      // the new counsellor.
      await tx.asignedLead.updateMany({
        where: { stdId: { in: eligibleIds }, status: 1 },
        data: { status: 0 },
      })
      await tx.asignedLead.createMany({
        data: eligibleIds.map((stdId) => ({ stdId, clrId: assignedToId, leadType: 'new', status: 1 })),
      })
    }
    return created
  })
  return c.json(bigintFix({ ...batch, assigned: eligibleIds.length, skipped: requestedIds.length - eligibleIds.length }), 201)
})

/**
 * Midnight IST on the batch's work day, or the batch's creation time — whichever
 * is EARLIER. Work done earlier the same day counts; a task created for a future
 * date still can't be satisfied by calls that predate it.
 */
function startOfWorkDay(batch: any): Date {
  const workDayStart = day(dayLabel(batch.workDate))
  if (!workDayStart) return batch.createdAt
  return workDayStart < batch.createdAt ? workDayStart : batch.createdAt
}

/**
 * Every activity row that could credit ANY batch in one response, in four
 * queries total rather than four per batch.
 *
 * The old shape ran those four queries inside `hydrateBatch`, so a 388-batch
 * response issued 1 552 of them — measured at 7.1 s of pure hydration. Worse,
 * the MobileCall query ORed one `phone_number LIKE '%<key>'` per open lead
 * (13+ patterns in a single statement was routine); a trailing-wildcard LIKE
 * can't use an index, so every one of those seq-scanned 79k call rows.
 *
 * Here the fetch is scoped by counsellor and time window only — both covered by
 * `mobile_calls (user_id, started_at)` — and the *attribution* (which lead, via
 * which duplicate, by which phone number) happens in memory in `targetsFor`,
 * exactly as before. Dropping the leadId/phone predicates from SQL widens what
 * comes back, never narrows it: a row that the old per-batch WHERE would have
 * excluded now resolves to an empty target list and is a no-op.
 *
 * The window runs from the EARLIEST batch's work-day start. That is what keeps
 * derived completions stable for older tasks — capping it would silently flip
 * long-settled items back to pending.
 */
type ActivityBuckets = {
  mobile: Map<string, { leadId: bigint | null; phoneNumber: string | null; status: string; startedAt: Date; durationSec: number | null }[]>
  manual: Map<string, { leadId: bigint; outcome: string; createdAt: Date; durationSeconds: number | null }[]>
  followups: Map<string, { stdId: bigint; createdAt: Date }[]>
  changes: Map<string, { leadId: bigint; createdAt: Date }[]>
}

const EMPTY_BUCKETS: ActivityBuckets = { mobile: new Map(), manual: new Map(), followups: new Map(), changes: new Map() }

function bucketBy<T>(rows: T[], key: (row: T) => bigint | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    if (id === null || id === undefined) continue
    const bucket = out.get(id.toString())
    if (bucket) bucket.push(row)
    else out.set(id.toString(), [row])
  }
  return out
}

async function fetchActivityFor(batches: any[]): Promise<ActivityBuckets> {
  const live = batches.filter((batch) => batch.items.some((item: any) => !item.completedAt))
  if (!live.length) return EMPTY_BUCKETS
  const userIds = [...new Set(live.map((batch) => batch.assignedToId.toString()))].map((id) => BigInt(id))
  let earliest = startOfWorkDay(live[0])
  for (const batch of live) {
    const since = startOfWorkDay(batch)
    if (since < earliest) earliest = since
  }
  const [mobile, manual, followups, changes] = await Promise.all([
    prisma.mobileCall.findMany({
      where: { userId: { in: userIds }, status: { not: 'TRIGGERED' }, startedAt: { gte: earliest } },
      select: { userId: true, leadId: true, phoneNumber: true, status: true, startedAt: true, durationSec: true },
    }),
    prisma.callLog.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: earliest } },
      select: { userId: true, leadId: true, outcome: true, createdAt: true, durationSeconds: true },
    }),
    prisma.leadFollowup.findMany({
      where: { userid: { in: userIds }, createdAt: { gte: earliest } },
      select: { userid: true, stdId: true, createdAt: true },
    }),
    prisma.leadStatusHistory.findMany({
      where: { changedById: { in: userIds }, createdAt: { gte: earliest } },
      select: { changedById: true, leadId: true, createdAt: true },
    }),
  ])
  // Oldest activity first, per counsellor. The projection below takes the FIRST
  // row it sees as an item's completion moment and the LAST outcome it sees as
  // the item's outcome, so without an explicit order both depended on whatever
  // sequence Postgres happened to return — the same task could report a
  // different `completedAt` on two consecutive refreshes. Sorted ascending,
  // "completed at" is the first call of the window and the outcome chip is the
  // most recent one, which is what those fields were always meant to say.
  const byTime = <T>(rows: T[], at: (row: T) => Date) => rows.sort((a, b) => at(a).getTime() - at(b).getTime())
  return {
    mobile: bucketBy(byTime(mobile, (row) => row.startedAt), (row) => row.userId),
    manual: bucketBy(byTime(manual, (row) => row.createdAt), (row) => row.userId),
    followups: bucketBy(byTime(followups, (row) => row.createdAt), (row) => row.userid),
    changes: bucketBy(byTime(changes, (row) => row.createdAt), (row) => row.changedById),
  }
}

/**
 * Hydrate a whole set of batches. Build the phone index and the activity
 * buckets ONCE, then project each batch in memory.
 *
 * Callers should always use this rather than looping `hydrateBatch` — that is
 * what the per-batch query storm looked like.
 */
export async function hydrateBatches(batches: any[], sharedPhoneIndex?: LeadPhoneIndex) {
  if (!batches.length) return []
  const openLeadIds = batches.flatMap((batch) => batch.items.filter((item: any) => !item.completedAt).map((item: any) => item.leadId))
  // The duplicate map and the activity fetch don't depend on each other.
  const [phoneIndex, activity] = await Promise.all([
    sharedPhoneIndex || (openLeadIds.length ? buildLeadPhoneIndex(openLeadIds) : undefined),
    fetchActivityFor(batches),
  ])
  return batches.map((batch) => projectBatch(batch, phoneIndex, activity))
}

// Pure read-only projection. Any completedAt already persisted on items is trusted;
// items without one are checked against activity that happened at or after the batch
// was created. No writes happen from this helper — /batches is a GET.
//
// Single-batch convenience wrapper; `hydrateBatches` is the path every list
// endpoint takes.
export async function hydrateBatch(batch: any, sharedPhoneIndex?: LeadPhoneIndex) {
  const [hydrated] = await hydrateBatches([batch], sharedPhoneIndex)
  return hydrated
}

function projectBatch(batch: any, sharedPhoneIndex: LeadPhoneIndex | undefined, activity: ActivityBuckets) {
  const openItems = batch.items.filter((item: any) => !item.completedAt)
  const openIds: bigint[] = openItems.map((item: any) => item.leadId)
  const openIdSet = new Set(openIds.map((id) => id.toString()))
  // The same person is often in the CRM more than once, and a call lands on
  // whichever duplicate row the counsellor had open (or on whichever row a
  // system-dialer call resolved to). Matching activity by leadId alone left
  // those items sitting "pending" even though the number had been rung — which
  // is why a task showed fewer calls than the counsellor actually made.
  // The index spans every batch in the response, so `targetsForKey` can name
  // leads from other tasks — `openIdSet` below is what narrows it back to this
  // one, exactly as it did when call sites shared an index by hand.
  const phoneIndex = openIds.length ? (sharedPhoneIndex || null) : null
  // Which open item(s) an activity row belongs to: its own lead when that is in
  // the task, otherwise whichever open lead shares the number.
  const targetsFor = (leadId?: bigint | null, phone?: string | null): string[] => {
    const out = new Set<string>()
    if (leadId) {
      const id = leadId.toString()
      if (openIdSet.has(id)) out.add(id)
      else if (phoneIndex) {
        for (const key of phoneIndex.keysOf(id)) {
          for (const target of phoneIndex.targetsForKey(key)) if (openIdSet.has(target)) out.add(target)
        }
      }
    }
    if (!out.size && phone && phoneIndex) {
      const key = phoneKey(phone)
      if (key) for (const target of phoneIndex.targetsForKey(key)) if (openIdSet.has(target)) out.add(target)
    }
    return [...out]
  }
  // Count activity from the START OF THE WORK DAY, not from the moment the task
  // row was inserted. A counsellor who rings a lead at 9am and only gets the task
  // assigned at 11am has still done the work — anchoring to createdAt made those
  // calls invisible and left the item pending for the rest of the day.
  const since = startOfWorkDay(batch)
  // Calls are matched on the number as well as the lead link, so a call the app
  // filed against a duplicate row — or against no lead at all — still completes
  // the item. That matching is `targetsFor` below; the rows themselves were
  // already fetched for the whole response by `fetchActivityFor`, so all that
  // is left here is narrowing this counsellor's activity to this task's window.
  const owner = batch.assignedToId.toString()
  const mobile = openIds.length ? (activity.mobile.get(owner) || []).filter((row) => row.startedAt >= since) : []
  const manual = openIds.length ? (activity.manual.get(owner) || []).filter((row) => row.createdAt >= since) : []
  const followups = openIds.length ? (activity.followups.get(owner) || []).filter((row) => row.createdAt >= since) : []
  const changes = openIds.length ? (activity.changes.get(owner) || []).filter((row) => row.createdAt >= since) : []

  const completion = new Map<string, { at: Date; type: string }>()
  const outcomes = new Map<string, string>()
  // Per-lead call metrics — surfaced onto every item so the mobile lead card
  // (and the web pending/done list) can say "3 attempts · last: 00:47
  // answered · 2h ago" without a second round trip. Covers PENDING items too:
  // even before an item flips to done, the counsellor should be able to see
  // whether they've tried the number and for how long.
  type CallStats = { attempts: number; lastAt?: Date; lastDurationSec?: number; lastOutcome?: string; totalDurationSec: number; answered: number }
  const callStats = new Map<string, CallStats>()
  const bumpCall = (leadIds: string[], at: Date, outcome: string, durationSec: number) => {
    for (const leadId of leadIds) {
      const stats = callStats.get(leadId) || { attempts: 0, totalDurationSec: 0, answered: 0 }
      stats.attempts += 1
      stats.totalDurationSec += durationSec
      if (outcome === 'ANSWERED') stats.answered += 1
      if (!stats.lastAt || at > stats.lastAt) {
        stats.lastAt = at; stats.lastDurationSec = durationSec; stats.lastOutcome = outcome
      }
      callStats.set(leadId, stats)
    }
  }
  const record = (leadIds: string[], at: Date, type: string, outcome?: string) => {
    for (const leadId of leadIds) {
      if (!completion.has(leadId)) completion.set(leadId, { at, type })
      if (outcome) outcomes.set(leadId, outcome)
    }
  }
  if (batch.workType === 'INITIAL_CALL') {
    for (const call of mobile) {
      const targets = targetsFor(call.leadId, call.phoneNumber)
      record(targets, call.startedAt, `CALL_${call.status}`, call.status)
      bumpCall(targets, call.startedAt, call.status, call.durationSec ?? 0)
    }
    for (const call of manual) {
      const outcome = call.outcome.toUpperCase()
      const targets = targetsFor(call.leadId)
      record(targets, call.createdAt, `CALL_${outcome}`, outcome)
      bumpCall(targets, call.createdAt, outcome, call.durationSeconds ?? 0)
    }
  } else {
    for (const row of followups) record(targetsFor(row.stdId), row.createdAt, 'FOLLOWUP_RECORDED')
    for (const row of changes) record(targetsFor(row.leadId), row.createdAt, 'STATUS_UPDATED')
    // For follow-up tasks the "call" info is still useful context, but calls
    // don't count towards completion — so we tally them without recording as
    // done. A counsellor about to make a follow-up call benefits from knowing
    // the last attempt landed on voicemail three days ago.
    for (const call of mobile) bumpCall(targetsFor(call.leadId, call.phoneNumber), call.startedAt, call.status, call.durationSec ?? 0)
    for (const call of manual) bumpCall(targetsFor(call.leadId), call.createdAt, call.outcome.toUpperCase(), call.durationSeconds ?? 0)
  }

  const isDone = (item: any) => !!item.completedAt || completion.has(item.leadId.toString())
  const completed = batch.items.filter(isDone).length
  const remainingItems = batch.items.filter((item: any) => !isDone(item))
  // Stamp the derived completion onto the items themselves. The aggregate counts
  // below were always correct, but the raw items went out with completedAt: null
  // even for leads we just decided were done — so every client re-rendered them as
  // pending and the app's auto-dialer re-queued leads it had already called.
  const hydratedItems = batch.items.map((item: any) => {
    const key = item.leadId.toString()
    const stats = callStats.get(key)
    // Serialised as flat fields (no nested object) so the mobile Kotlin DTO
    // stays simple and the web can read them without destructuring.
    const callFields = stats ? {
      callAttempts: stats.attempts,
      callAnswered: stats.answered,
      lastCallAt: stats.lastAt?.toISOString() ?? null,
      lastCallDurationSec: stats.lastDurationSec ?? 0,
      lastCallOutcome: stats.lastOutcome ?? null,
      totalCallDurationSec: stats.totalDurationSec,
    } : { callAttempts: 0, callAnswered: 0, lastCallAt: null, lastCallDurationSec: 0, lastCallOutcome: null, totalCallDurationSec: 0 }
    if (item.completedAt) return { ...item, ...callFields }
    const derived = completion.get(key)
    if (!derived) return { ...item, ...callFields }
    return { ...item, completedAt: derived.at, completionType: derived.type, ...callFields }
  })
  // Bucket the lead ids per outcome so the frontend chips can deep-link to a
  // pre-filtered Leads view (e.g. "18 follow-ups → show exactly those 18 leads").
  const answeredIds: string[] = []
  const noAnswerIds: string[] = []
  for (const [leadId, outcome] of outcomes.entries()) {
    if (outcome === 'ANSWERED') answeredIds.push(leadId)
    else if (['NO_ANSWER', 'MISSED', 'FAILED', 'BUSY', 'REJECTED', 'DECLINED'].includes(outcome)) noAnswerIds.push(leadId)
  }
  // Report follow-ups against the lead in THIS task, not the duplicate row the
  // counsellor happened to open, so the chip deep-links somewhere useful.
  const followupLeadIds = [...new Set(followups.flatMap((row: any) => targetsFor(row.stdId)))]
  const derivedStatus = batch.status === 0 && batch.items.length > 0 && completed === batch.items.length ? 1 : batch.status
  return {
    ...batch,
    items: hydratedItems,
    status: derivedStatus,
    workDateLabel: dayLabel(batch.workDate),
    leadDateLabel: batch.leadDate ? dayLabel(batch.leadDate) : null,
    total: batch.items.length,
    completed,
    remaining: batch.items.length - completed,
    progress: batch.items.length ? Math.round((completed * 100) / batch.items.length) : 0,
    summary: {
      connected: answeredIds.length,
      noAnswer: noAnswerIds.length,
      followupsCreated: followupLeadIds.length,
      answeredLeadIds: answeredIds,
      noAnswerLeadIds: noAnswerIds,
      followupLeadIds,
    },
    remainingItems,
  }
}

/**
 * Day-wise task numbers.
 *
 * `sequence` is allocated per (counsellor, work date) at insert time, but rows
 * get deleted and re-created, so the stored numbers drift into 1, 3, 4 — and a
 * counsellor reading "task 4" has no way to tell whether that is the last one
 * of the day. Re-derive a dense 1..N position inside each (counsellor, work
 * day) bucket and ship the bucket size next to it, so every client can render
 * "Task 2 of 3" for the day without having to see the other tasks.
 *
 * Cancelled tasks are left out of the numbering (they are not work anyone has
 * to do) and carry daySequence 0.
 */
export function withDayNumbers(batches: any[]): any[] {
  const buckets = new Map<string, any[]>()
  for (const batch of batches) {
    if (batch.status === 2) continue
    const key = `${batch.assignedToId?.toString() ?? ''}|${batch.workDateLabel ?? ''}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(batch)
    else buckets.set(key, [batch])
  }
  const numbers = new Map<string, { daySequence: number; dayTaskCount: number }>()
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => {
      if (a.sequence !== b.sequence) return a.sequence - b.sequence
      const at = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (at !== 0) return at
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    ordered.forEach((batch, index) => {
      numbers.set(batch.id.toString(), { daySequence: index + 1, dayTaskCount: ordered.length })
    })
  }
  return batches.map((batch) => ({
    ...batch,
    ...(numbers.get(batch.id.toString()) || { daySequence: 0, dayTaskCount: 0 }),
  }))
}

leadWorkRoutes.get('/batches', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const batches = await prisma.leadWorkBatch.findMany({
    where: isAdmin ? {} : { assignedToId: BigInt(userId) },
    orderBy: [{ workDate: 'desc' }, { sequence: 'asc' }, { createdAt: 'asc' }],
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      // Items are ordered by insertion (id ASC) so web and mobile agree on the
      // exact sequence a counsellor should call in — Prisma doesn't guarantee
      // any order without orderBy, and callers that iterated the array (the
      // mobile auto-dialer, especially) would otherwise see a different queue
      // to what the web renders.
      items: {
        orderBy: { id: 'asc' },
        include: { lead: { select: { id: true, name: true, mobile: true, followupDate: true, leadStatus: true } } },
      },
    },
  })
  // hydrateBatches builds the duplicate map and fetches every batch's activity
  // in one pass — a per-batch lookup would re-scan the leads table for each task.
  const hydrated = withDayNumbers(await hydrateBatches(batches))
  // No queue gating: every task assigned for a day is workable straight away.
  // Counsellors decide the order they call in, so a task is simply COMPLETED,
  // CANCELLED, IN_PROGRESS (some calls logged) or READY (none yet).
  return c.json(bigintFix(hydrated.map((batch) => {
    const state = batch.status === 1 ? 'COMPLETED' : batch.status === 2 ? 'CANCELLED' : batch.completed ? 'IN_PROGRESS' : 'READY'
    return { ...batch, state }
  })))
})

/**
 * Per-counsellor load for ONE work date: how many tasks they hold that day and
 * how many of those leads are still open.
 *
 * The task builder used to read this out of `GET /batches`, but that endpoint
 * hydrates every batch that has ever existed — 51 batches x 4 queries each,
 * measured at ~5.5 s — and the builder only ever needed one day's numbers.
 * Scoping the fetch to the chosen work date first makes it cheap, and stops
 * that request from tying up the server while the lead cohort is loading.
 */
leadWorkRoutes.get('/workload', adminOnly, async (c) => {
  const date = day(c.req.query('date')) || todayIST()
  const batches = await prisma.leadWorkBatch.findMany({
    where: { workDate: dbDate(dayLabel(date)), status: { not: 2 } },
    include: {
      assignedTo: { select: { id: true, name: true } },
      items: { select: { id: true, leadId: true, completedAt: true } },
    },
  })
  const hydrated = await hydrateBatches(batches)

  const rows = new Map<string, { counsellorId: number; name: string; tasks: number; total: number; remaining: number }>()
  for (const batch of hydrated) {
    const id = Number(batch.assignedTo.id)
    const row = rows.get(String(id)) || { counsellorId: id, name: batch.assignedTo.name, tasks: 0, total: 0, remaining: 0 }
    row.tasks += 1
    row.total += batch.total
    row.remaining += batch.remaining
    rows.set(String(id), row)
  }
  return c.json({ date: dayLabel(date), counsellors: [...rows.values()].sort((a, b) => b.remaining - a.remaining) })
})

// Admin can permanently delete a task. Items cascade via the schema relation.
leadWorkRoutes.delete('/batches/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadWorkBatch.delete({ where: { id } })
  return c.json({ ok: true })
})

/**
 * Manual completion escape hatch.
 *
 * The auto-derivation in `hydrateBatch` misses real work in a few known cases:
 *   - the counsellor called from their personal phone (no MobileCall row)
 *   - the app dialer fired but OFFHOOK was never captured (status stays TRIGGERED)
 *   - a call was placed pre-midnight but the task rolls to the next work day
 *   - the app is offline and the sync backlog hasn't drained yet
 *
 * Rather than force counsellors to hunt for whatever bit of state would make
 * the item flip green, they can mark it themselves with a reason. The mark
 * writes a real CallLog row so it also shows up on the lead page and in the
 * counsellor-performance report — it's not a private "task done" flag.
 *
 * Only the assignee (or an admin) may mark, and only when the item is still
 * open. Undo works only on items marked manually (completionType MANUAL_*),
 * so we never quietly erase an auto-derived call.
 */
const MANUAL_REASONS: Record<string, { outcome: string; completionType: string }> = {
  answered:     { outcome: 'answered',     completionType: 'MANUAL_ANSWERED' },
  no_answer:    { outcome: 'not_answered', completionType: 'MANUAL_NO_ANSWER' },
  busy:         { outcome: 'busy',         completionType: 'MANUAL_BUSY' },
  wrong_number: { outcome: 'wrong_number', completionType: 'MANUAL_WRONG_NUMBER' },
  dnd:          { outcome: 'declined',     completionType: 'MANUAL_DND' },
  switched_off: { outcome: 'switched_off', completionType: 'MANUAL_SWITCHED_OFF' },
  other:        { outcome: 'not_answered', completionType: 'MANUAL_OTHER' },
}

export const MANUAL_REASON_KEYS = Object.keys(MANUAL_REASONS)

type MarkResult = { error: string; status: 400 | 403 | 404 | 409 } | { ok: true; completedAt: string; completionType: string }

/**
 * Mark one task item done by hand, with a reason.
 *
 * Shared by the web route below and the mobile one in mobile.routes.ts — the
 * app had no escape hatch at all, which is how a task could sit on "1 call
 * left" forever when the lead had no usable number.
 */
export async function markTaskItemDone(
  itemId: bigint,
  userId: number,
  isAdmin: boolean,
  body: { reason?: string; notes?: string },
): Promise<MarkResult> {
  const reason = body.reason && MANUAL_REASONS[body.reason] ? body.reason : null
  if (!reason) return { error: `reason must be one of: ${MANUAL_REASON_KEYS.join(', ')}`, status: 400 }
  const spec = MANUAL_REASONS[reason]

  const item = await prisma.leadWorkBatchItem.findUnique({
    where: { id: itemId },
    include: { batch: { select: { assignedToId: true, status: true } } },
  })
  if (!item) return { error: 'Task item not found', status: 404 }
  if (!isAdmin && item.batch.assignedToId !== BigInt(userId)) return { error: 'Only the assigned counsellor or an admin can mark this item', status: 403 }
  if (item.completedAt) return { error: 'This item is already marked done', status: 409 }
  if (item.batch.status === 2) return { error: 'Task is cancelled; cannot mark items on it', status: 409 }

  const now = new Date()
  await prisma.$transaction([
    prisma.callLog.create({
      data: {
        leadId: item.leadId,
        userId: item.batch.assignedToId,
        outcome: spec.outcome,
        direction: 'outbound',
        notes: body.notes?.trim() || `Marked done by ${isAdmin && item.batch.assignedToId !== BigInt(userId) ? 'admin' : 'counsellor'} on task item #${itemId}`,
      },
    }),
    prisma.leadWorkBatchItem.update({
      where: { id: itemId },
      data: { completedAt: now, completionType: spec.completionType },
    }),
  ])
  return { ok: true, completedAt: now.toISOString(), completionType: spec.completionType }
}

/** Undo a MANUAL_* mark. Auto-derived completions are never touched. */
export async function undoTaskItemDone(
  itemId: bigint,
  userId: number,
  isAdmin: boolean,
): Promise<{ error: string; status: 403 | 404 | 409 } | { ok: true }> {
  const item = await prisma.leadWorkBatchItem.findUnique({
    where: { id: itemId },
    include: { batch: { select: { assignedToId: true } } },
  })
  if (!item) return { error: 'Task item not found', status: 404 }
  if (!isAdmin && item.batch.assignedToId !== BigInt(userId)) return { error: 'Only the assigned counsellor or an admin can undo this', status: 403 }
  if (!item.completedAt) return { error: 'This item is not marked done', status: 409 }
  // Only undo entries WE stamped manually — never quietly wipe an auto-derived
  // completion (its underlying MobileCall / CallLog / followup still exists,
  // and hydrateBatch would just re-derive it on the next fetch anyway).
  if (!item.completionType?.startsWith('MANUAL_')) return { error: 'This item was completed by real activity; undo only works on manual marks', status: 409 }
  await prisma.leadWorkBatchItem.update({
    where: { id: itemId },
    data: { completedAt: null, completionType: null },
  })
  return { ok: true }
}

leadWorkRoutes.post('/items/:itemId/mark-done', async (c) => {
  const { userId, role } = c.get('user')
  const body: { reason?: string; notes?: string } = await c.req.json().catch(() => ({}))
  const result = await markTaskItemDone(BigInt(c.req.param('itemId')), userId, ['admin', 'sub-admin'].includes(role), body)
  return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result)
})

leadWorkRoutes.post('/items/:itemId/undo-done', async (c) => {
  const { userId, role } = c.get('user')
  const result = await undoTaskItemDone(BigInt(c.req.param('itemId')), userId, ['admin', 'sub-admin'].includes(role))
  return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result)
})

/**
 * "Why isn't this marked done?" — a diagnostic snapshot for one pending item.
 * Returns everything hydrateBatch looked at (across all duplicate rows for the
 * lead's phone) plus flags that explain the common gaps: pre-window calls,
 * TRIGGERED-but-never-connected dials, calls placed by a different user, and
 * activity on non-scoring sources for this work type.
 */
leadWorkRoutes.get('/items/:itemId/diagnose', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const itemId = BigInt(c.req.param('itemId'))
  const item = await prisma.leadWorkBatchItem.findUnique({
    where: { id: itemId },
    include: {
      batch: { select: { assignedToId: true, workDate: true, createdAt: true, workType: true, assignedTo: { select: { name: true } } } },
      lead: { select: { id: true, name: true, mobile: true, mobile2: true, mobile3: true } },
    },
  })
  if (!item) return c.json({ error: 'Task item not found' }, 404)
  if (!isAdmin && item.batch.assignedToId !== BigInt(userId)) return c.json({ error: 'Not allowed' }, 403)

  const phoneIndex = await buildLeadPhoneIndex([item.leadId])
  const siblingIds = phoneIndex.siblingsOf(item.leadId).map((id) => BigInt(id))
  const searchKeys = phoneIndex.keysOf(item.leadId)
  const workDayStart = day(dayLabel(item.batch.workDate))
  const windowStart = workDayStart && workDayStart < item.batch.createdAt ? workDayStart : item.batch.createdAt

  const [mobileAll, manualAll, followupsAll, changesAll] = await Promise.all([
    prisma.mobileCall.findMany({
      where: {
        OR: [{ leadId: { in: siblingIds } }, ...callPhoneOr(searchKeys)],
      },
      orderBy: { startedAt: 'desc' }, take: 25,
      select: { id: true, userId: true, leadId: true, phoneNumber: true, status: true, startedAt: true, durationSec: true, user: { select: { name: true } } },
    }),
    prisma.callLog.findMany({
      where: { leadId: { in: siblingIds } },
      orderBy: { createdAt: 'desc' }, take: 25,
      select: { id: true, userId: true, leadId: true, outcome: true, createdAt: true, notes: true, user: { select: { name: true } } },
    }),
    prisma.leadFollowup.findMany({
      where: { stdId: { in: siblingIds } },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, userid: true, stdId: true, createdAt: true, comment: true, user: { select: { name: true } } },
    }),
    prisma.leadStatusHistory.findMany({
      where: { leadId: { in: siblingIds } },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, changedById: true, leadId: true, createdAt: true, toStatus: true, changedBy: { select: { name: true } } },
    }),
  ])

  const assignedTo = item.batch.assignedToId
  const inWindow = (t: Date) => t >= windowStart
  const isMineOrAdmin = (uid: bigint | null | undefined) => uid !== null && uid !== undefined && uid === assignedTo
  const reasons: string[] = []
  const attemptedByOthers = mobileAll.filter((call) => call.userId !== assignedTo).length
  const triggeredOnly = mobileAll.filter((call) => call.status === 'TRIGGERED' && isMineOrAdmin(call.userId)).length
  const preWindowMine = mobileAll.filter((call) => isMineOrAdmin(call.userId) && call.status !== 'TRIGGERED' && !inWindow(call.startedAt)).length
  const anyCallInWindowMine = mobileAll.some((call) => isMineOrAdmin(call.userId) && call.status !== 'TRIGGERED' && inWindow(call.startedAt))
    || manualAll.some((call) => isMineOrAdmin(call.userId) && inWindow(call.createdAt))
  const followupsInWindowMine = followupsAll.filter((row) => isMineOrAdmin(row.userid) && inWindow(row.createdAt)).length
  const statusChangesInWindowMine = changesAll.filter((row) => isMineOrAdmin(row.changedById) && inWindow(row.createdAt)).length

  if (item.completedAt) {
    reasons.push(`Marked done at ${item.completedAt.toISOString()} (${item.completionType || 'auto'})`)
  } else {
    if (item.batch.workType === 'INITIAL_CALL' && (followupsInWindowMine || statusChangesInWindowMine) && !anyCallInWindowMine) {
      reasons.push(`This is an INITIAL_CALL task, so follow-ups and status changes don't count — only a call does. ${followupsInWindowMine} follow-up(s) and ${statusChangesInWindowMine} status change(s) were logged in the window.`)
    }
    if (triggeredOnly > 0) reasons.push(`${triggeredOnly} call(s) fired from the app but never reached ANSWERED / NO_ANSWER — likely the phone was locked / offline or the OS didn't report OFFHOOK. TRIGGERED calls don't count.`)
    if (preWindowMine > 0) reasons.push(`${preWindowMine} of your call(s) to this number happened BEFORE this task's window (${windowStart.toISOString()}). Only calls at/after this timestamp credit the task.`)
    if (attemptedByOthers > 0) reasons.push(`${attemptedByOthers} call(s) to this number were placed by other counsellors. Only calls placed by ${item.batch.assignedTo.name} credit their task.`)
    if (!mobileAll.length && !manualAll.length) reasons.push('No call has ever been logged for this number, from any counsellor.')
    if (!reasons.length) reasons.push('No matching activity found in the credit window. If you did call, use "Mark done" to record it manually.')
  }

  return c.json(bigintFix({
    item: { id: item.id, leadId: item.leadId, completedAt: item.completedAt, completionType: item.completionType },
    lead: item.lead,
    task: {
      assignedToId: item.batch.assignedToId, assignedToName: item.batch.assignedTo.name,
      workType: item.batch.workType, workDate: item.batch.workDate, createdAt: item.batch.createdAt,
      windowStart,
    },
    siblingLeadIds: phoneIndex.siblingsOf(item.leadId).map(Number),
    phoneKeys: searchKeys,
    reasons,
    recent: {
      mobileCalls: mobileAll,
      callLogs: manualAll,
      followups: followupsAll,
      statusChanges: changesAll,
    },
  }))
})
