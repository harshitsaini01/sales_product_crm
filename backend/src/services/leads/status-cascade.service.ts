/**
 * Canonical status → department / bucket cascade.
 * ───────────────────────────────────────────────────────────────────────────
 * THE single place that answers "if a lead takes this status / sub-status,
 * which department and which lead-type bucket does it end up in?".
 *
 * Before this module existed the answer was implemented FOUR times —
 * `addLeadFollowup`, `resolveStatusCascade` in leads.routes, the bulk-engine
 * `followup` step, and (client-side) UpdateStatusModal / BulkActionBar — and
 * they disagreed about the meaning of `lead_sub_statuses.move_to`:
 *
 *   - LeadConfig UI + POST/PATCH /lead-config/sub-statuses  → move_to = DEPARTMENT
 *     (the field is literally labelled "Move To (Department)" and is populated
 *      from the departments list)
 *   - addLeadFollowup                                       → move_to = LEAD TYPE
 *     (`lead.leadType = String(moveTo)`) and read `sub_status.department_id`
 *      for the department instead
 *
 * `department_id` is a legacy mirror that the current config UI never writes,
 * so for any sub-status configured in the new system the department cascade
 * silently did nothing, while a department id got stamped into the
 * `leads.lead_type` slug column.
 *
 * `move_to` is the department. `status_lead_type_id` is the bucket.
 * `department_id` is kept as a read-only fallback for rows migrated from the
 * old CRM. Nothing writes `lead.leadType` from this cascade — ever.
 *
 * Department precedence:  explicit caller value > sub-status.move_to
 *                         > sub-status.department_id > parent status.department_id
 * Bucket precedence:      explicit caller value > sub-status.status_lead_type_id
 *                         > null when the department changes (see below)
 *
 * "No lead will break" guarantee: when the resolved department differs from
 * the lead's current one and nothing supplied a bucket, the bucket is cleared
 * (null) rather than inherited. A bucket belonging to the OLD department makes
 * the lead invisible in the new department's tab list; a NULL bucket is folded
 * into that department's Default tab, so the lead is always somewhere visible.
 */
import { prisma } from '../../lib/prisma'

export interface CascadeResult {
  /** Resolved status title. undefined = no status was supplied. */
  leadStatus?: string
  /** Resolved sub-status title. undefined = none supplied; null = cleared. */
  leadSubStatus?: string | null
  /** Target department. undefined = leave the lead where it is. */
  departmentId?: bigint
  /** Target bucket/tab. undefined = leave as-is; null = clear it. */
  statusLeadTypeId?: bigint | null
}

export async function resolveStatusCascade(opts: {
  leadStatusId?: bigint
  leadSubStatusId?: bigint
  /** Caller-supplied department — wins over everything the config says. */
  explicitDepartmentId?: bigint
  /** Caller-supplied bucket — wins over the sub-status mapping. */
  explicitStatusLeadTypeId?: bigint | null
  /** The lead's department right now, used for the stale-bucket guarantee. */
  currentDepartmentId?: bigint | null
}): Promise<CascadeResult> {
  const out: CascadeResult = {}

  const [ls, lss] = await Promise.all([
    opts.leadStatusId
      ? prisma.leadStatus.findUnique({
          where: { id: opts.leadStatusId },
          select: { title: true, departmentId: true },
        })
      : Promise.resolve(null),
    opts.leadSubStatusId
      ? prisma.leadSubStatus.findUnique({
          where: { id: opts.leadSubStatusId },
          select: { subStatus: true, moveTo: true, departmentId: true, statusLeadTypeId: true },
        })
      : Promise.resolve(null),
  ])

  if (ls) out.leadStatus = ls.title
  if (lss) out.leadSubStatus = lss.subStatus

  // ── Department ──
  if (opts.explicitDepartmentId !== undefined) {
    out.departmentId = opts.explicitDepartmentId
  } else if (lss?.moveTo) {
    out.departmentId = lss.moveTo
  } else if (lss?.departmentId) {
    out.departmentId = lss.departmentId
  } else if (ls?.departmentId) {
    out.departmentId = ls.departmentId
  }

  // ── Bucket ──
  if (opts.explicitStatusLeadTypeId !== undefined) {
    out.statusLeadTypeId = opts.explicitStatusLeadTypeId
  } else if (lss) {
    out.statusLeadTypeId = lss.statusLeadTypeId ?? null
  }

  // ── Stale-bucket guarantee ──
  if (
    out.statusLeadTypeId === undefined &&
    out.departmentId !== undefined &&
    opts.currentDepartmentId != null &&
    out.departmentId !== opts.currentDepartmentId
  ) {
    out.statusLeadTypeId = null
  }

  return out
}

/**
 * Department a sub-status routes to, without touching the DB — for callers
 * that already hold the workflow tree (the `/lead-config/workflow` payload).
 * Kept next to `resolveStatusCascade` so the two can never drift.
 */
export function subStatusTargetDepartment(
  subStatus: { moveTo?: number | bigint | null; departmentId?: number | bigint | null } | null | undefined,
  parentStatusDepartmentId: number | bigint | null | undefined,
): number | null {
  const pick = subStatus?.moveTo ?? subStatus?.departmentId ?? parentStatusDepartmentId
  return pick == null ? null : Number(pick)
}
