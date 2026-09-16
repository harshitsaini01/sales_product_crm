/**
 * Lead Pipeline Guard
 * ───────────────────────────────────────────────────────────────────────────
 * Counsellors can only move a lead FORWARD through the department pipeline.
 * Pipeline order is `LeadDepartment.priority` (ascending = earlier stage).
 *
 *   Tele Calling (0) → NEET (1) → Counselling (2) → Admission (3)
 *      → Finance (4) → Visa (5) → Departure (6)
 *
 * Side-branches (no order constraint, reachable from anywhere):
 *   - Marketing  (slug='marketing')
 *   - Consultant (slug='consultant')   — B2B referrals
 *
 * Terminal sink (always allowed forward, never auto-back):
 *   - Archive    (slug='archive')
 *
 * Counsellor / employee / sales-head:  hard-blocked from backward moves.
 * Admin / sub-admin:                   no restriction.
 *
 * The dept order is cached in-process for 60s to keep this hot path cheap —
 * `LeadDepartment` rows rarely change (an admin reordering them is a manual
 * config action, not a per-request event).
 */
import { prisma } from '../../lib/prisma'

const COUNSELLOR_ROLES = new Set(['counsellor', 'employee', 'sales-head'])
const SIDE_BRANCH_SLUGS = new Set(['marketing', 'consultant'])
const TERMINAL_SINK_SLUGS = new Set(['archive'])

type DeptRow = { id: bigint; priority: number; slug: string; name: string }

let cache: { at: number; rows: DeptRow[] } | null = null
const CACHE_TTL_MS = 60_000

async function loadDepts(): Promise<DeptRow[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rows
  const rows = await prisma.leadDepartment.findMany({
    select: { id: true, priority: true, slug: true, name: true },
    orderBy: { priority: 'asc' },
  })
  cache = { at: now, rows }
  return rows
}

/** Invalidate the in-process cache after admin reorders departments. */
export function invalidateDeptCache(): void {
  cache = null
}

export async function getDeptOrder(): Promise<DeptRow[]> {
  return loadDepts()
}

export class BackwardMoveError extends Error {
  readonly code = 'backward_move_blocked'
  readonly fromDeptId: number | null
  readonly toDeptId: number
  readonly fromDeptName: string | null
  readonly toDeptName: string
  constructor(opts: {
    fromDeptId: number | null
    toDeptId: number
    fromDeptName: string | null
    toDeptName: string
  }) {
    super(
      `Counsellors cannot move a lead from "${opts.fromDeptName ?? '(unset)'}" back to "${opts.toDeptName}"`,
    )
    this.fromDeptId = opts.fromDeptId
    this.toDeptId = opts.toDeptId
    this.fromDeptName = opts.fromDeptName
    this.toDeptName = opts.toDeptName
  }
}

export class InvalidStatusForDeptError extends Error {
  readonly code = 'status_dept_mismatch'
  constructor(public readonly statusId: number, public readonly deptId: number) {
    super(`Status ${statusId} does not belong to department ${deptId}`)
  }
}

/**
 * Decide whether a lead currently in `currentDeptId` can transition into
 * `targetDeptId` for the given role.
 *
 *  - currentDeptId === null  → fresh lead, anyone can place it anywhere
 *  - targetDeptId === current → no-op move, always allowed
 *  - side-branch / archive   → always allowed forward
 *  - admin / sub-admin       → always allowed
 *  - counsellor backward     → BLOCKED
 */
export async function canMoveTo(opts: {
  currentDeptId: bigint | number | null | undefined
  targetDeptId: bigint | number
  role: string
}): Promise<{ allowed: true } | { allowed: false; error: BackwardMoveError }> {
  const targetIdBig = typeof opts.targetDeptId === 'bigint' ? opts.targetDeptId : BigInt(opts.targetDeptId)
  const currentIdBig =
    opts.currentDeptId == null
      ? null
      : typeof opts.currentDeptId === 'bigint'
        ? opts.currentDeptId
        : BigInt(opts.currentDeptId)

  // No current dept → fresh lead, anything goes.
  if (currentIdBig === null) return { allowed: true }
  // Same dept → no-op.
  if (currentIdBig === targetIdBig) return { allowed: true }

  // Admin / sub-admin → no restriction.
  if (!COUNSELLOR_ROLES.has(opts.role)) return { allowed: true }

  const depts = await loadDepts()
  const current = depts.find((d) => d.id === currentIdBig)
  const target = depts.find((d) => d.id === targetIdBig)

  // Unknown dept ids → fail-open rather than 500 the lead update; pipeline
  // can't make a judgement without metadata. Logged at call site if needed.
  if (!current || !target) return { allowed: true }

  // Side-branches and the terminal sink are always reachable from anywhere.
  if (SIDE_BRANCH_SLUGS.has(target.slug)) return { allowed: true }
  if (TERMINAL_SINK_SLUGS.has(target.slug)) return { allowed: true }

  // If the lead is currently sitting in a side-branch / archive, treat it as
  // unanchored — counsellor can pick any "real" dept without it being called
  // backward. (Archive is admin-only to exit anyway; this branch handles the
  // case where an admin has just unarchived a lead and a counsellor is now
  // setting the next status.)
  if (SIDE_BRANCH_SLUGS.has(current.slug) || TERMINAL_SINK_SLUGS.has(current.slug)) {
    return { allowed: true }
  }

  // Forward = target priority >= current priority. (Equality is no-op above,
  // but kept here for clarity.)
  if (target.priority >= current.priority) return { allowed: true }

  return {
    allowed: false,
    error: new BackwardMoveError({
      fromDeptId: Number(current.id),
      toDeptId: Number(target.id),
      fromDeptName: current.name,
      toDeptName: target.name,
    }),
  }
}

/**
 * Guarantees the chosen `leadStatusId` belongs to `deptId`. Cheap safety net
 * against UI bugs / forged payloads that would otherwise leave a lead with
 * `departmentId = A` but a status that belongs to dept B (the exact mismatch
 * that drove the original ticket).
 */
export async function assertValidStatusForDept(opts: {
  leadStatusId: bigint
  deptId: bigint
}): Promise<void> {
  const status = await prisma.leadStatus.findUnique({
    where: { id: opts.leadStatusId },
    select: { departmentId: true },
  })
  if (!status) return // status not found is a separate concern; let the update FK-fail
  if (status.departmentId !== opts.deptId) {
    throw new InvalidStatusForDeptError(Number(opts.leadStatusId), Number(opts.deptId))
  }
}
