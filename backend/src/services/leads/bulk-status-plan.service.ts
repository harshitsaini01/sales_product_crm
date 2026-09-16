/**
 * Bulk status / department change — planner.
 * ───────────────────────────────────────────────────────────────────────────
 * Works out, per lead, exactly what a bulk status change would do BEFORE
 * anything is written: which department each lead leaves, which it lands in,
 * what its status becomes, and whether the pipeline guard blocks it.
 *
 * `POST /leads/bulk-status/preview` renders this plan; `POST /leads/bulk-status`
 * applies it. Both call `buildBulkStatusPlan`, so the confirmation screen can
 * never promise a move the apply step won't make.
 */
import { prisma } from '../../lib/prisma'
import { canMoveTo } from './pipeline.service'
import { resolveStatusCascade, type CascadeResult } from './status-cascade.service'

export interface PlannedLead {
  id: number
  name: string
  mobile: string | null
  fromDepartmentId: number | null
  fromDepartment: string | null
  toDepartmentId: number | null
  toDepartment: string | null
  fromStatus: string | null
  toStatus: string | null
  fromSubStatus: string | null
  toSubStatus: string | null
  /** Department actually changes for this lead. */
  moving: boolean
  /** Pipeline guard rejects this lead — it will be skipped on apply. */
  blocked: boolean
  blockReason: string | null
}

export interface BulkStatusPlan {
  cascade: CascadeResult
  rows: PlannedLead[]
  /** Ids the apply step is allowed to write (everything not blocked). */
  allowedIds: bigint[]
  blocked: PlannedLead[]
  /** Ids that change department and need their stale bucket cleared. */
  movingIds: bigint[]
  total: number
  movingCount: number
  blockedCount: number
  /** Distinct source departments in the selection, for the preview header. */
  fromDepartments: string[]
  toDepartment: string | null
}

export async function buildBulkStatusPlan(opts: {
  leadIds: bigint[]
  leadStatusId?: number
  leadSubStatusId?: number
  /** Explicit target department (from the Move Department flow). */
  departmentId?: number
  role: string
}): Promise<BulkStatusPlan> {
  const cascade = await resolveStatusCascade({
    leadStatusId: opts.leadStatusId ? BigInt(opts.leadStatusId) : undefined,
    leadSubStatusId: opts.leadSubStatusId ? BigInt(opts.leadSubStatusId) : undefined,
    explicitDepartmentId: opts.departmentId ? BigInt(opts.departmentId) : undefined,
    // Per-lead current dept varies across the batch, so the stale-bucket rule
    // is applied per row below rather than inside the cascade.
  })

  // Chunked: one `IN (...)` per 10 000 ids. Postgres caps a statement at 32 767
  // bind variables, and the Leads page can hand us "all N matching" — north of
  // 60 000 rows — which would otherwise hard-fail the whole plan.
  const FETCH_CHUNK = 10_000
  const leadChunks: bigint[][] = []
  for (let i = 0; i < opts.leadIds.length; i += FETCH_CHUNK) {
    leadChunks.push(opts.leadIds.slice(i, i + FETCH_CHUNK))
  }

  const [leadGroups, departments] = await Promise.all([
    Promise.all(
      leadChunks.map((ids) =>
        prisma.lead.findMany({
          where: { id: { in: ids } },
          select: {
            id: true, name: true, mobile: true,
            leadStatus: true, leadSubStatus: true, departmentId: true,
          },
          orderBy: { id: 'asc' },
        }),
      ),
    ),
    prisma.leadDepartment.findMany({ select: { id: true, name: true } }),
  ])
  const leads = leadGroups.flat()

  const deptName = new Map(departments.map((d) => [d.id.toString(), d.name]))
  const targetDeptId = cascade.departmentId ?? null

  const rows: PlannedLead[] = []
  const allowedIds: bigint[] = []
  const movingIds: bigint[] = []

  for (const lead of leads) {
    const from = lead.departmentId
    const moving = targetDeptId !== null && from !== null && from !== targetDeptId

    let blocked = false
    let blockReason: string | null = null
    if (moving) {
      const verdict = await canMoveTo({ currentDeptId: from, targetDeptId, role: opts.role })
      if (!verdict.allowed) {
        blocked = true
        blockReason = `Backward move — ${verdict.error.fromDeptName ?? 'current'} → ${verdict.error.toDeptName}. Only an admin can recycle a lead upstream.`
      }
    }

    const row: PlannedLead = {
      id: Number(lead.id),
      name: lead.name,
      mobile: lead.mobile,
      fromDepartmentId: from === null ? null : Number(from),
      fromDepartment: from === null ? null : deptName.get(from.toString()) ?? null,
      toDepartmentId: targetDeptId === null ? null : Number(targetDeptId),
      toDepartment: targetDeptId === null ? null : deptName.get(targetDeptId.toString()) ?? null,
      fromStatus: lead.leadStatus,
      toStatus: cascade.leadStatus ?? lead.leadStatus,
      fromSubStatus: lead.leadSubStatus,
      toSubStatus: cascade.leadSubStatus !== undefined ? cascade.leadSubStatus : lead.leadSubStatus,
      moving,
      blocked,
      blockReason,
    }
    rows.push(row)

    if (!blocked) {
      allowedIds.push(lead.id)
      if (moving) movingIds.push(lead.id)
    }
  }

  const blockedRows = rows.filter((r) => r.blocked)
  const fromDepartments = [
    ...new Set(rows.map((r) => r.fromDepartment).filter((n): n is string => !!n)),
  ]

  return {
    cascade,
    rows,
    allowedIds,
    blocked: blockedRows,
    movingIds,
    total: rows.length,
    movingCount: rows.filter((r) => r.moving).length,
    blockedCount: blockedRows.length,
    fromDepartments,
    toDepartment:
      targetDeptId === null ? null : deptName.get(targetDeptId.toString()) ?? null,
  }
}
