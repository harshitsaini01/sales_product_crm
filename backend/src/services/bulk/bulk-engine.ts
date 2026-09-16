// Bulk engine — single source of truth for every multi-lead admin operation.
//
// Goals of this module:
//   1. Chunked, transactional execution so a 50k-row bulk does not blow up the
//      single Hono request or the Prisma connection.
//   2. One BulkOperation row per run so admins (and we) have an audit trail.
//   3. Per-lead before-snapshot for reversible kinds → /undo can restore state.
//   4. Recipe-style multi-step pipelines (move + status + assign + followup in
//      one call) executed in order, share the resolved id set across steps.
//   5. Dry-run mode: resolves the target id set and per-step preview without
//      writing anything.
//
// Non-goals:
//   - This module does not own filter parsing. Callers pass a resolved list of
//     `BigInt` lead ids OR a filter object that this module hands off to
//     `resolveTargetIds` (which leans on the lead-routes WHERE builder).

import { Prisma } from '@prisma/client'
import { permanentlyDeleteLeads } from '../leads/permanent-delete.service'
import { resolveStatusCascade } from '../leads/status-cascade.service'
import { prisma } from '../../lib/prisma'

// ─── Types ───────────────────────────────────────────────────────────────────

export type BulkStep =
  | { type: 'assign'; counsellorId: number }
  | { type: 'unassign'; counsellorId?: number }
  | { type: 'move'; departmentId: number; leadStatusId?: number; leadSubStatusId?: number }
  | { type: 'status'; leadStatusId?: number; leadSubStatusId?: number; departmentId?: number }
  | { type: 'reset-status' }
  | { type: 'field-update'; field: string; value: string | number | null }
  | { type: 'trash' }
  | { type: 'restore' }
  | { type: 'permanent-delete' }
  | { type: 'note'; note: string }
  | { type: 'comment'; comment: string }
  | { type: 'reminder'; reminderDate: string; note?: string }
  | { type: 'followup'; comment: string; followupDate?: string; followupNA?: boolean; leadStatusId?: number; leadSubStatusId?: number }
  | { type: 'call-status'; called?: 0 | 1; wapp?: 0 | 1 }
  | { type: 'tag'; field: 'event' | 'source' | 'website'; value: string }

export interface BulkRunInput {
  actorId: bigint
  kind: string                         // 'apply' | one of step.type when single-step
  leadIds?: bigint[]                   // explicit ids (preferred when known)
  filter?: Record<string, unknown>     // serialized filter snapshot (saved on the operation row)
  resolveIds?: () => Promise<bigint[]> // run when leadIds is empty; returns ids matching `filter`
  recipe: BulkStep[]
  dryRun?: boolean
  source?: 'web' | 'api' | 'cron'
}

export interface BulkRunResult {
  operationId: number
  status: 'completed' | 'partial' | 'failed' | 'preview'
  total: number
  succeeded: number
  failed: number
  skipped: number
  failures: Array<{ leadId: number; step: string; error: string }>
  // dry-run only: sample of up to 20 affected leads for preview
  sample?: Array<{ id: number; name: string; mobile: string | null; email: string | null }>
  message?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHUNK_SIZE = 500           // per-chunk transaction batch size
const MAX_FAILURE_LOG = 250      // cap failure detail JSON
const SNAPSHOT_KINDS = new Set<string>([    // ops we can undo
  'assign', 'unassign', 'move', 'status', 'reset-status',
  'trash', 'restore', 'field-update', 'tag', 'call-status',
  // followup mutates lead state (status/sub/dept/bucket/followupDate) when a
  // status change is bundled in — snapshot the before-state so undo can roll
  // those columns back. The followup row itself is NOT removed by undo (matches
  // the normal single-lead behaviour where follow-ups are immutable history).
  'followup',
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function asNumberArray(ids: bigint[]): number[] {
  return ids.map((id) => Number(id))
}

// Pick the subset of Lead columns we need to snapshot to enable an undo.
// We pick everything any reversible step touches plus the active assignments.
const SNAPSHOT_LEAD_SELECT = {
  id: true,
  leadStatus: true,
  leadStatusId: true,
  leadSubStatus: true,
  leadSubStatusId: true,
  departmentId: true,
  statusLeadTypeId: true,
  trash: true,
  called: true,
  wapp: true,
  event: true,
  source: true,
  website: true,
  city: true,
  state: true,
  country: true,
  nationality: true,
  intrestedCourse: true,
  intrestedUniversity: true,
  neetQualified: true,
  bucketExcluded: true,
} satisfies Prisma.LeadSelect

type LeadSnapshot = Prisma.LeadGetPayload<{ select: typeof SNAPSHOT_LEAD_SELECT }>

// ─── Engine entrypoint ──────────────────────────────────────────────────────

export async function runBulkOperation(input: BulkRunInput): Promise<BulkRunResult> {
  // 1) resolve target id set
  let ids: bigint[] = input.leadIds ?? []
  if (ids.length === 0 && input.resolveIds) {
    ids = await input.resolveIds()
  }
  ids = Array.from(new Set(ids.map((v) => BigInt(v))))    // dedupe

  // 2) dry-run path: skip writes, return a sample
  if (input.dryRun) {
    const op = await prisma.bulkOperation.create({
      data: {
        actorId: input.actorId,
        kind: input.kind,
        status: 'completed',
        source: input.source ?? 'web',
        dryRun: true,
        filter: (input.filter ?? null) as Prisma.InputJsonValue,
        recipe: input.recipe as unknown as Prisma.InputJsonValue,
        total: ids.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        startedAt: new Date(),
        finishedAt: new Date(),
        message: `Dry run — would affect ${ids.length} lead${ids.length === 1 ? '' : 's'}`,
      },
    })

    const sample = ids.length
      ? await prisma.lead.findMany({
          where: { id: { in: ids.slice(0, 20) } },
          select: { id: true, name: true, mobile: true, email: true },
        })
      : []

    return {
      operationId: Number(op.id),
      status: 'preview',
      total: ids.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
      sample: sample.map((s) => ({
        id: Number(s.id),
        name: s.name,
        mobile: s.mobile,
        email: s.email,
      })),
      message: op.message ?? undefined,
    }
  }

  // 3) create an operation row in 'running' state
  const op = await prisma.bulkOperation.create({
    data: {
      actorId: input.actorId,
      kind: input.kind,
      status: 'running',
      source: input.source ?? 'web',
      dryRun: false,
      filter: (input.filter ?? null) as Prisma.InputJsonValue,
      recipe: input.recipe as unknown as Prisma.InputJsonValue,
      total: ids.length,
      startedAt: new Date(),
    },
  })

  // 4) snapshot before-state if any step in the recipe is reversible
  const isReversible = input.recipe.some((s) => SNAPSHOT_KINDS.has(s.type))
  let snapshot: LeadSnapshot[] = []
  if (isReversible && ids.length) {
    // cap snapshot at 10k leads — undo of larger ops is impractical anyway
    const snapIds = ids.slice(0, 10_000)
    snapshot = await prisma.lead.findMany({
      where: { id: { in: snapIds } },
      select: SNAPSHOT_LEAD_SELECT,
    })
  }
  const activeAssignments = isReversible && ids.length
    ? await prisma.asignedLead.findMany({
        where: { stdId: { in: ids.slice(0, 10_000) }, status: 1 },
        select: { stdId: true, clrId: true, leadType: true, statusLeadTypeId: true, departmentId: true },
      })
    : []

  // 5) run the recipe step by step over the same id set
  const failures: Array<{ leadId: number; step: string; error: string }> = []
  let succeeded = 0
  let failed = 0
  let processed = 0

  for (const step of input.recipe) {
    for (const batch of chunks(ids, CHUNK_SIZE)) {
      try {
        const out = await applyStep(step, batch, input.actorId)
        succeeded += out.affected
      } catch (err) {
        failed += batch.length
        const msg = err instanceof Error ? err.message : 'unknown error'
        for (const id of batch.slice(0, Math.max(0, MAX_FAILURE_LOG - failures.length))) {
          failures.push({ leadId: Number(id), step: step.type, error: msg })
        }
      }
      processed += batch.length
      // periodic progress checkpoint so the polling UI sees motion
      if (processed % (CHUNK_SIZE * 4) === 0) {
        await prisma.bulkOperation.update({
          where: { id: op.id },
          data: { processed, succeeded, failed },
        })
      }
    }
  }

  // 6) finalize
  const finalStatus: 'completed' | 'partial' | 'failed' =
    failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed'
  const message =
    failed === 0
      ? `${succeeded} write${succeeded === 1 ? '' : 's'} across ${ids.length} lead${ids.length === 1 ? '' : 's'}`
      : `${succeeded} succeeded, ${failed} failed`

  await prisma.bulkOperation.update({
    where: { id: op.id },
    data: {
      status: finalStatus,
      processed,
      succeeded,
      failed,
      failures: failures.length ? (failures as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      snapshot: isReversible
        ? ({
            leads: snapshot.map(serializeLeadSnapshot),
            assignments: activeAssignments.map((a) => ({
              stdId: Number(a.stdId),
              clrId: Number(a.clrId),
              leadType: a.leadType,
              statusLeadTypeId: a.statusLeadTypeId ? Number(a.statusLeadTypeId) : null,
              departmentId: a.departmentId ? Number(a.departmentId) : null,
            })),
            recipe: input.recipe,
          } as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      finishedAt: new Date(),
      message,
    },
  })

  return {
    operationId: Number(op.id),
    status: finalStatus,
    total: ids.length,
    succeeded,
    failed,
    skipped: 0,
    failures,
    message,
  }
}

function serializeLeadSnapshot(s: LeadSnapshot) {
  // BigInt-safe; everything else stays as-is.
  return {
    id: Number(s.id),
    leadStatus: s.leadStatus,
    leadStatusId: s.leadStatusId ? Number(s.leadStatusId) : null,
    leadSubStatus: s.leadSubStatus,
    leadSubStatusId: s.leadSubStatusId ? Number(s.leadSubStatusId) : null,
    departmentId: s.departmentId ? Number(s.departmentId) : null,
    statusLeadTypeId: s.statusLeadTypeId ? Number(s.statusLeadTypeId) : null,
    trash: s.trash,
    called: s.called,
    wapp: s.wapp,
    event: s.event,
    source: s.source,
    website: s.website,
    city: s.city,
    state: s.state,
    country: s.country,
    nationality: s.nationality,
    intrestedCourse: s.intrestedCourse,
    intrestedUniversity: s.intrestedUniversity,
    neetQualified: s.neetQualified,
    bucketExcluded: s.bucketExcluded,
  }
}

// ─── Per-step writers ───────────────────────────────────────────────────────
// Each writer returns `{ affected }` so the engine can roll up succeeded counts.
// Writers must be safe to retry — if a chunk throws halfway the engine flags it
// as failed but continues.

const FIELD_UPDATE_ALLOWLIST = new Set([
  'city', 'state', 'nationality', 'source', 'event', 'intrestedCourse',
  'intrestedUniversity', 'neetQualified', 'website', 'country',
  'leadType',
])

async function applyStep(step: BulkStep, ids: bigint[], actorId: bigint): Promise<{ affected: number }> {
  if (!ids.length) return { affected: 0 }

  switch (step.type) {
    case 'assign': {
      const clrId = BigInt(step.counsellorId)
      const existing = await prisma.asignedLead.findMany({
        where: { clrId, stdId: { in: ids } },
        select: { stdId: true },
      })
      const already = new Set(existing.map((e) => e.stdId.toString()))
      const toAssign = ids.filter((id) => !already.has(id.toString()))
      if (toAssign.length) {
        await prisma.asignedLead.createMany({
          data: toAssign.map((stdId) => ({ clrId, stdId, leadType: 'new', status: 1 })),
          skipDuplicates: true,
        })
      }
      await prisma.lead.updateMany({
        where: { id: { in: ids }, flagRcv: 1 },
        data: { flagRcv: 0 },
      })
      await prisma.lead.updateMany({
        where: { id: { in: toAssign } },
        data: { bucketExcluded: false },
      })
      return { affected: toAssign.length }
    }

    case 'unassign': {
      const where: Prisma.AsignedLeadWhereInput = { stdId: { in: ids }, status: 1 }
      if (step.counsellorId != null) where.clrId = BigInt(step.counsellorId)
      const res = await prisma.asignedLead.deleteMany({ where })
      await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { bucketExcluded: true },
      })
      return { affected: res.count }
    }

    case 'move': {
      // Move always sets the dept. If the caller also picked a status (and
      // optionally a sub-status), resolve their titles once and apply them in
      // the same transaction so the lead lands in the right tab — not the
      // "Default" tab of the destination dept. Writes a status-history row
      // whenever a status/sub-status actually changes.
      const data: Record<string, unknown> = { departmentId: BigInt(step.departmentId) }
      let newStatusTitle: string | undefined
      let newSubStatusTitle: string | null | undefined
      if (step.leadStatusId) {
        const ls = await prisma.leadStatus.findUnique({
          where: { id: BigInt(step.leadStatusId) },
          select: { title: true },
        })
        if (ls) {
          data.leadStatusId = BigInt(step.leadStatusId)
          data.leadStatus = ls.title
          newStatusTitle = ls.title
        }
      }
      if (step.leadSubStatusId) {
        const lss = await prisma.leadSubStatus.findUnique({
          where: { id: BigInt(step.leadSubStatusId) },
          select: { subStatus: true, statusLeadTypeId: true },
        })
        if (lss) {
          data.leadSubStatusId = BigInt(step.leadSubStatusId)
          data.leadSubStatus = lss.subStatus
          data.statusLeadTypeId = lss.statusLeadTypeId ?? null
          newSubStatusTitle = lss.subStatus
        }
      } else if (step.leadStatusId) {
        // Status changed but no sub-status — clear stale sub-status / bucket so
        // the lead doesn't surface under a bucket from the previous status.
        data.leadSubStatusId = null
        data.leadSubStatus = null
        data.statusLeadTypeId = null
        newSubStatusTitle = null
      } else {
        // No status picked — clear the bucket so the lead falls into the new
        // dept's Default tab rather than inheriting the old dept's bucket id.
        data.statusLeadTypeId = null
      }
      const before = await prisma.lead.findMany({
        where: { id: { in: ids } },
        select: { id: true, leadStatus: true, leadSubStatus: true },
      })
      await prisma.$transaction(async (tx) => {
        await tx.lead.updateMany({ where: { id: { in: ids } }, data })
        if (newStatusTitle !== undefined || newSubStatusTitle !== undefined) {
          await tx.leadStatusHistory.createMany({
            data: before.map((row) => ({
              leadId: row.id,
              changedById: actorId,
              fromStatus: row.leadStatus,
              toStatus: newStatusTitle ?? row.leadStatus,
              fromSubStatus: row.leadSubStatus,
              toSubStatus: newSubStatusTitle !== undefined ? newSubStatusTitle : row.leadSubStatus,
              source: 'bulk',
            })),
          })
        }
      })
      return { affected: before.length }
    }

    case 'status': {
      // Status-cascade is intentionally simpler here than the legacy
      // `resolveStatusCascade` helper — recipe authors pass the explicit
      // departmentId when they want a cross-dept move. We DO still need to
      // resolve the human-readable label so the lead row stays consistent.
      const update: Record<string, unknown> = {}
      if (step.leadStatusId) {
        const ls = await prisma.leadStatus.findUnique({
          where: { id: BigInt(step.leadStatusId) },
          select: { title: true, departmentId: true },
        })
        if (ls) {
          update.leadStatusId = BigInt(step.leadStatusId)
          update.leadStatus = ls.title
          if (!step.departmentId) update.departmentId = ls.departmentId
        }
      }
      if (step.leadSubStatusId) {
        const lss = await prisma.leadSubStatus.findUnique({
          where: { id: BigInt(step.leadSubStatusId) },
          select: { subStatus: true, statusLeadTypeId: true, departmentId: true },
        })
        if (lss) {
          update.leadSubStatusId = BigInt(step.leadSubStatusId)
          update.leadSubStatus = lss.subStatus
          if (lss.statusLeadTypeId !== undefined) update.statusLeadTypeId = lss.statusLeadTypeId
          if (!step.departmentId && lss.departmentId) update.departmentId = lss.departmentId
        }
      }
      if (step.departmentId) update.departmentId = BigInt(step.departmentId)

      const before = await prisma.lead.findMany({
        where: { id: { in: ids } },
        select: { id: true, leadStatus: true, leadSubStatus: true },
      })
      await prisma.$transaction(async (tx) => {
        await tx.lead.updateMany({ where: { id: { in: ids } }, data: update })
        if (update.leadStatus || update.leadSubStatus !== undefined) {
          await tx.leadStatusHistory.createMany({
            data: before.map((row) => ({
              leadId: row.id,
              changedById: actorId,
              fromStatus: row.leadStatus,
              toStatus: (update.leadStatus as string | undefined) ?? row.leadStatus,
              fromSubStatus: row.leadSubStatus,
              toSubStatus: (update.leadSubStatus as string | null | undefined) ?? row.leadSubStatus,
              source: 'bulk',
            })),
          })
        }
      })
      return { affected: before.length }
    }

    case 'reset-status': {
      const before = await prisma.lead.findMany({
        where: { id: { in: ids } },
        select: { id: true, leadStatus: true, leadSubStatus: true },
      })
      await prisma.$transaction(async (tx) => {
        await tx.lead.updateMany({
          where: { id: { in: ids } },
          data: {
            leadStatus: 'Fresh',
            leadStatusId: null,
            leadSubStatus: null,
            leadSubStatusId: null,
          },
        })
        await tx.leadStatusHistory.createMany({
          data: before.map((row) => ({
            leadId: row.id,
            changedById: actorId,
            fromStatus: row.leadStatus,
            toStatus: 'Fresh',
            fromSubStatus: row.leadSubStatus,
            toSubStatus: null,
            reason: 'Bulk reset',
            source: 'bulk',
          })),
        })
      })
      return { affected: before.length }
    }

    case 'trash': {
      const res = await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { trash: 1 },
      })
      return { affected: res.count }
    }

    case 'restore': {
      const res = await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { trash: 0 },
      })
      return { affected: res.count }
    }

    case 'permanent-delete': {
      const affected = await permanentlyDeleteLeads(ids)
      return { affected }
    }

    case 'field-update': {
      if (!FIELD_UPDATE_ALLOWLIST.has(step.field)) {
        throw new Error(`field "${step.field}" not allowed in bulk update`)
      }
      const res = await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { [step.field]: step.value === null ? null : String(step.value) } as Prisma.LeadUpdateManyMutationInput,
      })
      return { affected: res.count }
    }

    case 'tag': {
      const res = await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { [step.field]: step.value } as Prisma.LeadUpdateManyMutationInput,
      })
      return { affected: res.count }
    }

    case 'call-status': {
      const data: Record<string, unknown> = {}
      if (step.called !== undefined) data.called = step.called
      if (step.wapp !== undefined) data.wapp = step.wapp
      if (!Object.keys(data).length) return { affected: 0 }
      const res = await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data,
      })
      return { affected: res.count }
    }

    case 'note': {
      await prisma.leadNote.createMany({
        data: ids.map((leadId) => ({ leadId, userId: actorId, note: step.note })),
      })
      return { affected: ids.length }
    }

    case 'comment': {
      await prisma.leadComment.createMany({
        data: ids.map((leadId) => ({ leadId, userId: actorId, comment: step.comment })),
      })
      return { affected: ids.length }
    }

    case 'reminder': {
      await prisma.reminder.createMany({
        data: ids.map((leadId) => ({
          leadId,
          userId: actorId,
          reminderDate: new Date(step.reminderDate),
          note: step.note ?? null,
        })),
      })
      return { affected: ids.length }
    }

    case 'followup': {
      const followupDate = step.followupNA
        ? new Date('0001-01-01T00:00:00.000Z')
        : step.followupDate
          ? new Date(step.followupDate)
          : null

      // Resolve status / sub-status titles + cascade dept through the SAME
      // resolver addLeadFollowup and POST /leads/bulk-status use, so a recipe
      // routes leads exactly where the Update Status modal would. (This block
      // used to be a hand-rolled fourth copy that read `sub_status.department_id`
      // instead of `move_to` and so never moved anything.)
      const cascade = await resolveStatusCascade({
        leadStatusId: step.leadStatusId ? BigInt(step.leadStatusId) : undefined,
        leadSubStatusId: step.leadSubStatusId ? BigInt(step.leadSubStatusId) : undefined,
      })
      const newStatusTitle = cascade.leadStatus
      const newSubStatusTitle = cascade.leadSubStatus
      const resolvedDeptId = cascade.departmentId
      const resolvedBucketId = cascade.statusLeadTypeId

      const before = (newStatusTitle !== undefined || newSubStatusTitle !== undefined)
        ? await prisma.lead.findMany({
            where: { id: { in: ids } },
            select: { id: true, leadStatus: true, leadSubStatus: true },
          })
        : []

      await prisma.$transaction(async (tx) => {
        // 1. Insert one followup row per lead
        await tx.leadFollowup.createMany({
          data: ids.map((stdId) => ({
            stdId,
            userid: actorId,
            comment: step.comment,
            followupDate,
            leadStatusId: step.leadStatusId ? BigInt(step.leadStatusId) : null,
            leadSubStatusId: step.leadSubStatusId ? BigInt(step.leadSubStatusId) : null,
            departmentId: resolvedDeptId ?? null,
            statusLeadTypeId: resolvedBucketId ?? null,
            type: 'followup',
            status: 1,
          })),
        })

        // 2. Mirror onto the lead row so list views, tab counts and follow-up
        //    queues stay in sync with what was just recorded.
        const leadUpdate: Record<string, unknown> = {}
        if (followupDate) {
          leadUpdate.followupDate = followupDate
          leadUpdate.commentDate = new Date()
        }
        if (step.leadStatusId) {
          leadUpdate.leadStatusId = BigInt(step.leadStatusId)
          if (newStatusTitle) leadUpdate.leadStatus = newStatusTitle
        }
        if (step.leadSubStatusId) {
          leadUpdate.leadSubStatusId = BigInt(step.leadSubStatusId)
          if (newSubStatusTitle !== undefined) leadUpdate.leadSubStatus = newSubStatusTitle
          if (resolvedBucketId !== undefined) leadUpdate.statusLeadTypeId = resolvedBucketId
        }
        if (resolvedDeptId) leadUpdate.departmentId = resolvedDeptId
        if (step.comment && step.comment.trim()) leadUpdate.comment = step.comment
        if (Object.keys(leadUpdate).length) {
          await tx.lead.updateMany({
            where: { id: { in: ids } },
            data: leadUpdate,
          })
        }

        // 3. Audit trail when status / sub-status actually changed.
        if (before.length) {
          await tx.leadStatusHistory.createMany({
            data: before.map((row) => ({
              leadId: row.id,
              changedById: actorId,
              fromStatus: row.leadStatus,
              toStatus: newStatusTitle ?? row.leadStatus,
              fromSubStatus: row.leadSubStatus,
              toSubStatus: newSubStatusTitle !== undefined ? newSubStatusTitle : row.leadSubStatus,
              source: 'bulk',
            })),
          })
        }
      })
      return { affected: ids.length }
    }

    default: {
      const exhaustive: never = step
      throw new Error(`unsupported step: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// ─── Undo ────────────────────────────────────────────────────────────────────
// Replays the snapshot back onto each lead. Caps at the snapshot population
// (so a 50k op whose snapshot we capped at 10k will only restore 10k leads).
// Returns the count restored. Refuses to undo if the op was already undone or
// if no snapshot exists (the recipe contained only irreversible steps).

export async function undoOperation(operationId: bigint, actorId: bigint): Promise<{
  restored: number
  message: string
}> {
  const op = await prisma.bulkOperation.findUnique({ where: { id: operationId } })
  if (!op) throw new Error('Operation not found')
  if (op.undoneAt) throw new Error('Operation has already been undone')
  if (!op.snapshot) throw new Error('This operation cannot be undone (no snapshot was captured)')

  const snap = op.snapshot as unknown as {
    leads: Array<ReturnType<typeof serializeLeadSnapshot>>
    assignments: Array<{ stdId: number; clrId: number; leadType: string; statusLeadTypeId: number | null; departmentId: number | null }>
    recipe: BulkStep[]
  }

  // Group assignment rows by stdId for quick lookup
  const assignmentsByLead = new Map<number, typeof snap.assignments>()
  for (const a of snap.assignments) {
    const arr = assignmentsByLead.get(a.stdId) ?? []
    arr.push(a)
    assignmentsByLead.set(a.stdId, arr)
  }

  let restored = 0
  for (const batch of chunks(snap.leads, CHUNK_SIZE)) {
    await prisma.$transaction(async (tx) => {
      for (const l of batch) {
        await tx.lead.update({
          where: { id: BigInt(l.id) },
          data: {
            leadStatus: l.leadStatus ?? 'Fresh',
            leadStatusId: l.leadStatusId != null ? BigInt(l.leadStatusId) : null,
            leadSubStatus: l.leadSubStatus,
            leadSubStatusId: l.leadSubStatusId != null ? BigInt(l.leadSubStatusId) : null,
            departmentId: l.departmentId != null ? BigInt(l.departmentId) : null,
            statusLeadTypeId: l.statusLeadTypeId != null ? BigInt(l.statusLeadTypeId) : null,
            trash: l.trash,
            called: l.called,
            wapp: l.wapp,
            event: l.event,
            source: l.source,
            website: l.website ?? 'other',
            city: l.city,
            state: l.state,
            country: l.country,
            nationality: l.nationality,
            intrestedCourse: l.intrestedCourse,
            intrestedUniversity: l.intrestedUniversity,
            neetQualified: l.neetQualified,
            bucketExcluded: l.bucketExcluded,
          },
        })
        restored++
      }

      // Restore active assignments for this batch's lead ids
      const batchIds = batch.map((l) => BigInt(l.id))
      await tx.asignedLead.deleteMany({
        where: { stdId: { in: batchIds }, status: 1 },
      })
      const wantAssignments: Prisma.AsignedLeadCreateManyInput[] = []
      for (const l of batch) {
        const list = assignmentsByLead.get(l.id) ?? []
        for (const a of list) {
          wantAssignments.push({
            stdId: BigInt(a.stdId),
            clrId: BigInt(a.clrId),
            leadType: a.leadType,
            statusLeadTypeId: a.statusLeadTypeId != null ? BigInt(a.statusLeadTypeId) : null,
            departmentId: a.departmentId != null ? BigInt(a.departmentId) : null,
            status: 1,
          })
        }
      }
      if (wantAssignments.length) {
        await tx.asignedLead.createMany({ data: wantAssignments, skipDuplicates: true })
      }
    })
  }

  await prisma.bulkOperation.update({
    where: { id: operationId },
    data: {
      status: 'undone',
      undoneAt: new Date(),
      undoneById: actorId,
      message: `Undone — restored ${restored} lead${restored === 1 ? '' : 's'}`,
    },
  })

  return { restored, message: `Restored ${restored} lead${restored === 1 ? '' : 's'}` }
}

// ─── Util re-exports ────────────────────────────────────────────────────────
export { asNumberArray, chunks }
