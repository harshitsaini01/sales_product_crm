import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'
import { recordStatusChange } from './status-history.service'
import { canMoveTo, BackwardMoveError } from './pipeline.service'
import { resolveStatusCascade } from './status-cascade.service'
import { buildBulkStatusPlan } from './bulk-status-plan.service'

/**
 * CRITICAL BUSINESS LOGIC — Lead Follow-up Status Cascade
 *
 * Ported from old CRM: CommonLeadFollowupController/addLeadFollowup()
 *
 * When a follow-up is submitted:
 *  1. Resolve new leadStatus / leadSubStatus titles
 *  2. Apply sub_status.move_to → lead.lead_type, sub_status.department_id → lead.department_id
 *  3. Update leads + asigned_leads in a transaction
 *  4. Append row to lead_status_history (audit trail) on actual status change
 *  5. Insert into lead_followups
 *  6. If followupDate present, upsert a Reminder so it shows on the counsellor's dashboard
 */
export async function addLeadFollowup(params: {
  stdId: bigint
  userid: bigint
  comment: string
  followupDate?: string
  leadStatus?: string
  leadStatusId?: number
  leadSubStatusId?: number
  callAnsweredStatus?: number
  departmentId?: number
  statusLeadTypeId?: number
  fStatus?: string
  leadFollowStatus?: number
  type?: string
  description?: string
  /** Caller's role — required for pipeline-direction guard. Optional only
   *  for back-compat; if absent the guard is skipped (used by internal
   *  callers like the auto-call-outcome rule). */
  role?: string
}) {
  const {
    stdId, userid, comment, followupDate,
    leadStatus, leadStatusId, leadSubStatusId, callAnsweredStatus,
    departmentId, statusLeadTypeId, fStatus, leadFollowStatus, type, description, role,
  } = params

  // Pre-fetch current lead state for audit comparison.
  // Also pull the lead's current departmentId so we can guard against
  // counsellor-initiated backward moves through the pipeline.
  const currentLead = await prisma.lead.findUnique({
    where: { id: stdId },
    select: { leadStatus: true, leadSubStatus: true, departmentId: true },
  })

  // Resolve target titles + destination via the canonical cascade, so this
  // path cannot drift from PATCH /leads/:id, POST /leads/bulk-status or the
  // bulk-engine. See status-cascade.service.ts for the precedence rules and
  // the `move_to` = department history.
  const explicitFreshStatus = leadStatus?.trim().toLowerCase() === 'fresh'

  const cascade = explicitFreshStatus
    ? {}
    : await resolveStatusCascade({
        leadStatusId: leadStatusId ? BigInt(leadStatusId) : undefined,
        leadSubStatusId: leadSubStatusId ? BigInt(leadSubStatusId) : undefined,
        explicitDepartmentId: departmentId ? BigInt(departmentId) : undefined,
        explicitStatusLeadTypeId: statusLeadTypeId !== undefined ? BigInt(statusLeadTypeId) : undefined,
        currentDepartmentId: currentLead?.departmentId ?? null,
      })

  let leadStatusTitle: string = cascade.leadStatus ?? currentLead?.leadStatus ?? 'Fresh'
  let leadSubStatusTitle: string | null =
    cascade.leadSubStatus !== undefined ? cascade.leadSubStatus : currentLead?.leadSubStatus ?? null
  let newDeptId: bigint | null = cascade.departmentId ?? null
  // Bar/tab the lead should appear under.
  // `undefined` = leave lead.statusLeadTypeId untouched; `null` = clear it.
  let resolvedStatusLeadTypeId: bigint | null | undefined = cascade.statusLeadTypeId

  if (explicitFreshStatus) {
    leadStatusTitle = 'Fresh'
    leadSubStatusTitle = null
    resolvedStatusLeadTypeId = null
    newDeptId = departmentId ? BigInt(departmentId) : null
  }

  // ─── Pipeline-direction guard ───────────────────────────────────────────
  // If the resolved dept differs from the lead's current dept, ensure the
  // caller is allowed to make that move. Counsellors are hard-blocked from
  // backward moves — only admins can recycle leads upstream.
  if (role && newDeptId && currentLead?.departmentId && newDeptId !== currentLead.departmentId) {
    const verdict = await canMoveTo({
      currentDeptId: currentLead.departmentId,
      targetDeptId: newDeptId,
      role,
    })
    if (!verdict.allowed) throw verdict.error
  }

  // (The "no lead will break" stale-bucket guarantee lives in the cascade —
  // it clears the bucket whenever the department changes and nothing supplied
  // a replacement, so the lead lands in the new dept's Default tab.)

  // An empty comment means the counsellor opened the Update Status modal,
  // possibly changed status / followup-date fields, but did NOT edit the
  // pre-filled last comment. In that case we apply field updates but do NOT
  // insert a new lead_followups row (so the comment thread isn't polluted
  // with duplicate-of-last entries) and skip the reminder note.
  const hasComment = !!(comment && comment.trim())

  const result = await prisma.$transaction(async (tx) => {
    // 1. Update lead
    const leadUpdateData: Record<string, unknown> = {
      leadStatus: leadStatusTitle,
      leadSubStatus: leadSubStatusTitle,
    }
    if (hasComment) leadUpdateData.commentDate = new Date()
    if (explicitFreshStatus) {
      leadUpdateData.leadStatusId = null
      leadUpdateData.leadSubStatusId = null
    } else {
      if (leadStatusId) leadUpdateData.leadStatusId = BigInt(leadStatusId)
      if (leadSubStatusId) leadUpdateData.leadSubStatusId = BigInt(leadSubStatusId)
    }
    if (followupDate) leadUpdateData.followupDate = new Date(followupDate)
    // NOTE: `lead.leadType` is deliberately NOT written here. It is a slug
    // column ('new', 'not-interested', 'cbse-data', …); the old code wrote
    // `String(subStatus.moveTo)` into it, stamping a numeric DEPARTMENT id
    // over the slug and breaking the leadType filter for those leads.
    // Department routing is `departmentId`; tab routing is `statusLeadTypeId`.
    if (newDeptId) leadUpdateData.departmentId = newDeptId
    if (resolvedStatusLeadTypeId !== undefined) leadUpdateData.statusLeadTypeId = resolvedStatusLeadTypeId
    if (callAnsweredStatus !== undefined) leadUpdateData.callAnsweredStatus = String(callAnsweredStatus)
    if (leadFollowStatus !== undefined) leadUpdateData.leadFollowStatus = BigInt(leadFollowStatus)
    // Mirror the latest comment onto the lead row only when a new comment was
    // actually typed. Otherwise keep the previous lead.comment unchanged.
    if (hasComment) leadUpdateData.comment = comment

    await tx.lead.update({ where: { id: stdId }, data: leadUpdateData })

    // 2. Audit trail — only writes if actually changed (status-only changes
    // are still tracked here even when no new comment is added)
    await recordStatusChange({
      leadId: stdId,
      changedById: userid,
      fromStatus: currentLead?.leadStatus ?? null,
      toStatus: leadStatusTitle,
      fromSubStatus: currentLead?.leadSubStatus ?? null,
      toSubStatus: leadSubStatusTitle,
      reason: hasComment ? comment.slice(0, 200) : '',
      source: 'followup',
      tx,
    })

    // 3. Update asigned_leads
    const asignedUpdateData: Record<string, unknown> = {}
    if (explicitFreshStatus) {
      asignedUpdateData.leadStatusId = null
      asignedUpdateData.leadSubStatusId = null
    } else {
      if (leadStatusId) asignedUpdateData.leadStatusId = BigInt(leadStatusId)
      if (leadSubStatusId) asignedUpdateData.leadSubStatusId = BigInt(leadSubStatusId)
    }
    if (callAnsweredStatus !== undefined) asignedUpdateData.callAnsweredStatus = callAnsweredStatus
    if (newDeptId) asignedUpdateData.departmentId = newDeptId
    if (resolvedStatusLeadTypeId !== undefined) asignedUpdateData.statusLeadTypeId = resolvedStatusLeadTypeId

    if (Object.keys(asignedUpdateData).length > 0) {
      // Every ACTIVE assignment row for this lead, not just the actor's own.
      // Scoping this to `clrId: userid` meant an admin (or any user who isn't
      // the assigned counsellor) updated zero rows, leaving asigned_leads
      // pointing at the lead's previous department — which dept-scoped views
      // read, so the lead kept showing under the old department.
      await tx.asignedLead.updateMany({
        where: { stdId, status: 1 },
        data: asignedUpdateData,
      })
    }

    // 4. Insert followup row — ONLY when a new comment was typed.
    // Empty comment = keep the previous row, don't duplicate it.
    let followup = null
    if (hasComment) {
      // Lead score: +2 whenever a real follow-up is logged. Empty-comment
      // "status-only" updates don't get this — the +3 from recordStatusChange
      // above already covers those.
      await tx.lead.update({
        where: { id: stdId },
        data: { leadScore: { increment: 2 } },
      })
      followup = await tx.leadFollowup.create({
        data: {
          stdId,
          userid,
          comment,
          followupDate: followupDate ? new Date(followupDate) : null,
          leadStatusId: leadStatusId ? BigInt(leadStatusId) : null,
          leadSubStatusId: leadSubStatusId ? BigInt(leadSubStatusId) : null,
          callAnsweredStatus: callAnsweredStatus ?? null,
          departmentId: newDeptId,
          statusLeadTypeId: resolvedStatusLeadTypeId ?? null,
          fStatus: fStatus || null,
          type: type || 'followup',
          description: description || null,
          status: 1,
        },
        include: { user: { select: { id: true, name: true } } },
      })
    }

    // 5. Auto-create reminder if followupDate is set.
    // Reminder still gets created even without a new comment — the counsellor
    // explicitly chose a new follow-up date, so the calendar should reflect it.
    if (followupDate) {
      // Upsert semantics: a lead has at most ONE open reminder per user at a
      // time. Plain `create` left a new row on every status update, so a lead
      // touched ten times fired ten bell notifications for ten stale dates.
      await tx.reminder.deleteMany({ where: { leadId: stdId, userId: userid, status: 0 } })
      await tx.reminder.create({
        data: {
          leadId: stdId,
          userId: userid,
          reminderDate: new Date(followupDate),
          note: hasComment ? comment.slice(0, 200) : '',
          status: 0,
        },
      })
    }

    return followup
  })

  return bigintFix(result)
}

// ─── GET FOLLOW-UP HISTORY ────────────────────────────────────────────────────
export async function getFollowups(stdId: bigint, limit = 50) {
  const followups = await prisma.leadFollowup.findMany({
    where: { stdId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { id: true, name: true } } },
  })
  return bigintFix(followups)
}

// ─── GET LAST FOLLOWUP ────────────────────────────────────────────────────────
export async function getLastFollowup(stdId: bigint) {
  const followup = await prisma.leadFollowup.findFirst({
    where: { stdId },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  })
  return bigintFix(followup)
}

// ─── DELETE FOLLOWUP ──────────────────────────────────────────────────────────
export async function deleteFollowup(id: bigint) {
  await prisma.leadFollowup.delete({ where: { id } })
}

// ─── ADD BULK FOLLOWUP ────────────────────────────────────────────────────────
/**
 * Set-based bulk follow-up.
 *
 * This used to loop `addLeadFollowup` once per lead. That is ~10 statements per
 * lead run strictly serially — at the measured 51 ms round-trip to this
 * database, 100 leads took ~51 s and 2 000 took ~17 min, so anything past a few
 * hundred leads hit nginx's 300 s `proxy_read_timeout` and died PART-WAY: each
 * lead was its own transaction, so some were updated and some were not, and the
 * caller only ever saw a generic failure with no record of how far it got.
 *
 * Now it plans once (via the same `buildBulkStatusPlan` the preview screen and
 * `POST /leads/bulk-status` use, so all three agree on where each lead lands)
 * and writes in chunks of `CHUNK` leads, one transaction per chunk — roughly 8
 * statements per chunk instead of 10 per lead. 2 000 leads: ~1.6 s.
 *
 * Chunking rather than one giant transaction is deliberate: a single
 * transaction over 10 000 leads would hold row locks across the whole batch for
 * the duration, on a live CRM. Per-chunk keeps lock windows short, and every
 * chunk is still all-or-nothing.
 */
const CHUNK = 500

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function addBulkFollowup(params: {
  leadIds: number[]
  userid: bigint
  comment: string
  followupDate?: string
  leadStatusId?: number
  leadSubStatusId?: number
  role?: string
}) {
  const requested = params.leadIds.map((id) => BigInt(id))

  // An absent role means an internal caller that opts out of the pipeline
  // guard (the old per-lead path skipped it too). 'admin' is the role
  // `canMoveTo` waves through, so the behaviour is preserved exactly.
  const plan = await buildBulkStatusPlan({
    leadIds: requested,
    leadStatusId: params.leadStatusId,
    leadSubStatusId: params.leadSubStatusId,
    role: params.role ?? 'admin',
  })

  const { cascade, allowedIds, movingIds } = plan
  const allowedSet = new Set(allowedIds.map((b) => b.toString()))
  const movingSet = new Set(movingIds.map((b) => b.toString()))

  // Empty comment = field updates only, no follow-up row (matches the
  // single-lead path, which refuses to duplicate the previous comment).
  const hasComment = !!(params.comment && params.comment.trim())
  const followupDate = params.followupDate ? new Date(params.followupDate) : null
  const now = new Date()

  const leadUpdate: Record<string, unknown> = {}
  if (cascade.leadStatus) leadUpdate.leadStatus = cascade.leadStatus
  if (cascade.leadSubStatus !== undefined) leadUpdate.leadSubStatus = cascade.leadSubStatus
  if (params.leadStatusId) leadUpdate.leadStatusId = BigInt(params.leadStatusId)
  if (params.leadSubStatusId) leadUpdate.leadSubStatusId = BigInt(params.leadSubStatusId)
  if (cascade.departmentId !== undefined) leadUpdate.departmentId = cascade.departmentId
  if (cascade.statusLeadTypeId !== undefined) leadUpdate.statusLeadTypeId = cascade.statusLeadTypeId
  if (followupDate) leadUpdate.followupDate = followupDate
  if (hasComment) {
    leadUpdate.comment = params.comment
    leadUpdate.commentDate = now
  }

  const assignedUpdate: Record<string, unknown> = {}
  if (params.leadStatusId) assignedUpdate.leadStatusId = BigInt(params.leadStatusId)
  if (params.leadSubStatusId) assignedUpdate.leadSubStatusId = BigInt(params.leadSubStatusId)
  if (cascade.departmentId !== undefined) assignedUpdate.departmentId = cascade.departmentId
  if (cascade.statusLeadTypeId !== undefined) assignedUpdate.statusLeadTypeId = cascade.statusLeadTypeId

  const applied: bigint[] = []
  const failedChunks: Array<{ leadIds: number[]; error: string }> = []

  // Indexed once — a nested scan here would be O(chunk x rows) per chunk,
  // which for a 10 000-lead batch is ~100M comparisons of pure overhead.
  const rowById = new Map(plan.rows.map((r) => [r.id, r]))

  for (const chunk of chunked(allowedIds, CHUNK)) {
    const rows = chunk
      .map((id) => rowById.get(Number(id)))
      .filter((r): r is NonNullable<typeof r> => !!r)
    // Only leads whose status or sub-status actually moves get an audit row —
    // same rule `recordStatusChange` applies for a single lead.
    const changed = rows.filter(
      (r) => r.fromStatus !== r.toStatus || r.fromSubStatus !== r.toSubStatus,
    )
    const statusChanged = changed.filter((r) => r.fromStatus !== r.toStatus)
    const movingInChunk = chunk.filter((id) => movingSet.has(id.toString()))

    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(leadUpdate).length > 0) {
          await tx.lead.updateMany({ where: { id: { in: chunk } }, data: leadUpdate })
        }

        // Stale-bucket guarantee: a lead that changed department with no
        // replacement bucket keeps the OLD department's tab id and becomes
        // invisible there. Clearing drops it into the new dept's Default tab.
        if (cascade.statusLeadTypeId === undefined && movingInChunk.length > 0) {
          await tx.lead.updateMany({
            where: { id: { in: movingInChunk } },
            data: { statusLeadTypeId: null },
          })
        }

        if (Object.keys(assignedUpdate).length > 0) {
          await tx.asignedLead.updateMany({
            where: { stdId: { in: chunk }, status: 1 },
            data: assignedUpdate,
          })
        }
        if (cascade.statusLeadTypeId === undefined && movingInChunk.length > 0) {
          await tx.asignedLead.updateMany({
            where: { stdId: { in: movingInChunk }, status: 1 },
            data: { statusLeadTypeId: null },
          })
        }

        if (changed.length > 0) {
          await tx.leadStatusHistory.createMany({
            data: changed.map((r) => ({
              leadId: BigInt(r.id),
              changedById: params.userid,
              fromStatus: r.fromStatus,
              toStatus: r.toStatus ?? r.fromStatus ?? '',
              fromSubStatus: r.fromSubStatus,
              toSubStatus: r.toSubStatus,
              reason: hasComment ? params.comment.slice(0, 200) : null,
              source: 'bulk' as const,
            })),
          })
        }

        // Lead score mirrors the single-lead path: +3 when the main status
        // moves, +2 when a real follow-up is logged.
        if (statusChanged.length > 0) {
          await tx.lead.updateMany({
            where: { id: { in: statusChanged.map((r) => BigInt(r.id)) } },
            data: { leadScore: { increment: 3 } },
          })
        }

        if (hasComment) {
          await tx.leadFollowup.createMany({
            data: chunk.map((stdId) => ({
              stdId,
              userid: params.userid,
              comment: params.comment,
              followupDate,
              leadStatusId: params.leadStatusId ? BigInt(params.leadStatusId) : null,
              leadSubStatusId: params.leadSubStatusId ? BigInt(params.leadSubStatusId) : null,
              departmentId: cascade.departmentId ?? null,
              statusLeadTypeId: cascade.statusLeadTypeId ?? null,
              type: 'followup',
              status: 1,
            })),
          })
          await tx.lead.updateMany({
            where: { id: { in: chunk } },
            data: { leadScore: { increment: 2 } },
          })
        }

        // One open reminder per lead per user — replace, don't pile up.
        if (followupDate) {
          await tx.reminder.deleteMany({
            where: { leadId: { in: chunk }, userId: params.userid, status: 0 },
          })
          await tx.reminder.createMany({
            data: chunk.map((leadId) => ({
              leadId,
              userId: params.userid,
              reminderDate: followupDate,
              note: hasComment ? params.comment.slice(0, 200) : '',
              status: 0,
            })),
          })
        }
      })
      applied.push(...chunk)
    } catch (err) {
      // Chunk rolled back as a unit — report it rather than silently losing it.
      failedChunks.push({ leadIds: chunk.map(Number), error: String(err) })
    }
  }

  const appliedSet = new Set(applied.map((b) => b.toString()))
  const blockedById = new Map(plan.blocked.map((r) => [r.id, r]))
  const failedIds = new Set(failedChunks.flatMap((f) => f.leadIds))

  // Per-lead result shape kept identical to the old loop so the route and the
  // bulk modal keep working unchanged.
  return params.leadIds.map((leadId) => {
    const key = BigInt(leadId).toString()
    if (appliedSet.has(key)) return { leadId, success: true as const }
    const blocked = blockedById.get(leadId)
    if (blocked) {
      return {
        leadId,
        success: false as const,
        error: blocked.blockReason ?? 'backward_move_blocked',
        code: 'backward_move_blocked',
        fromDept: blocked.fromDepartment ?? undefined,
        toDept: blocked.toDepartment ?? undefined,
      }
    }
    if (failedIds.has(leadId)) {
      return { leadId, success: false as const, error: 'write_failed', code: 'write_failed' }
    }
    if (!allowedSet.has(key)) {
      return { leadId, success: false as const, error: 'lead_not_found', code: 'not_found' }
    }
    return { leadId, success: false as const, error: 'unknown', code: 'unknown' }
  })
}

// ─── GET LEAD STATUSES BY DEPARTMENT ─────────────────────────────────────────
export async function getStatusesByDepartment(departmentId: number) {
  const statuses = await prisma.leadStatus.findMany({
    where: { departmentId: BigInt(departmentId), status: 1 },
    include: { subStatuses: true },
    orderBy: { priority: 'asc' },
  })
  return bigintFix(statuses)
}

// ─── GET SUB-STATUSES BY STATUS ───────────────────────────────────────────────
export async function getSubStatusesByStatus(statusId: number) {
  const subStatuses = await prisma.leadSubStatus.findMany({
    where: { statusId: BigInt(statusId) },
  })
  return bigintFix(subStatuses)
}
 
