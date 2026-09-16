import { prisma } from '../lib/prisma'
import type { Prisma } from '@prisma/client'

// ─── Role helpers ─────────────────────────────────────────────────────────────

/** Only the top-level 'admin' role sees ALL data org-wide and full PII. */
export function isFullAdmin(role: string): boolean {
  return role === 'admin'
}

/**
 * Sub-admin = a branch-scoped manager for ALL data (leads, reports, dashboard,
 * app-tracking, students, calls). Behaves like an admin but limited to their
 * assigned branches, never sees full phone numbers.
 *
 * NOTE: sales-head is intentionally NOT here. A sales-head behaves like a normal
 * counsellor everywhere EXCEPT the Calls section, where it is branch-scoped —
 * see isCallsManager / callsScopeUserIds.
 */
export function isBranchManager(role: string): boolean {
  return role === 'sub-admin'
}

/**
 * Roles whose CALLS view is branch-scoped (their branches' employees only) and
 * who may play those recordings: sub-admin + sales-head.
 */
export function isCallsManager(role: string): boolean {
  return role === 'sub-admin' || role === 'sales-head'
}

// ─── Branch membership ────────────────────────────────────────────────────────

/**
 * Every user id whose `User.branchId` falls inside the branches assigned to this
 * manager (via user_branch_access), plus the manager themselves. Returns `[]`
 * when no branch is assigned (→ they see nothing).
 *
 * Requires the `user_branch_access` table (migration 20260602000000).
 */
async function branchMemberIds(userId: number): Promise<bigint[]> {
  const access = await prisma.userBranchAccess.findMany({
    where: { userId: BigInt(userId) },
    select: { branchId: true },
  })
  if (access.length === 0) return []
  const branchIds = access.map((a) => a.branchId)
  const members = await prisma.user.findMany({
    where: { branchId: { in: branchIds } },
    select: { id: true },
  })
  const selfId = BigInt(userId)
  const ids = members.map((m) => m.id)
  if (!ids.some((id) => id === selfId)) ids.push(selfId)
  return ids
}

/**
 * True when this manager's user_branch_access covers EVERY existing branch.
 * Used to promote a fully-permissioned sub-admin to admin-level data scope so
 * they can see unassigned leads + leads belonging to counsellors with no
 * branchId (legacy users) — those are invisible under the strict branch-member
 * filter even when "all branches" is ticked, because the filter is
 * `User.branchId IN (...)` which excludes NULLs and unassigned leads alike.
 */
async function hasAllBranchAccess(userId: number): Promise<boolean> {
  const [accessCount, totalCount] = await Promise.all([
    prisma.userBranchAccess.count({ where: { userId: BigInt(userId) } }),
    prisma.branch.count(),
  ])
  return totalCount > 0 && accessCount >= totalCount
}

// ─── Accessible-users resolution (general data: leads/reports/dashboard/…) ─────

/**
 * The set of user IDs whose data `user` may see:
 *  - `null`     → no restriction (full admin, OR a sub-admin who has access
 *                 to every branch — see hasAllBranchAccess).
 *  - `bigint[]` → restrict to exactly these users.
 *      • sub-admin → branch members (empty when no branch assigned → sees nothing).
 *      • everyone else (counsellor, employee, sales-head, …) → just themselves.
 */
export async function accessibleUserIds(user: {
  userId: number
  role: string
}): Promise<bigint[] | null> {
  if (isFullAdmin(user.role)) return null
  if (isBranchManager(user.role) || isCallsManager(user.role)) {
    if (await hasAllBranchAccess(user.userId)) return null
    return branchMemberIds(user.userId)
  }
  // Everyone else (incl. counsellor) only sees their own data.
  return [BigInt(user.userId)]
}

/**
 * Calls-specific scope. Same as accessibleUserIds, except sales-head is ALSO
 * branch-scoped here (sees calls of employees in their assigned branches).
 *  - `null` → full admin (all calls).
 *  - `bigint[]` → sub-admin / sales-head → branch members; else → just themselves.
 */
export async function callsScopeUserIds(user: {
  userId: number
  role: string
}): Promise<bigint[] | null> {
  if (isFullAdmin(user.role)) return null
  if (isCallsManager(user.role)) {
    if (await hasAllBranchAccess(user.userId)) return null
    return branchMemberIds(user.userId)
  }
  return [BigInt(user.userId)]
}

/**
 * Convenience: a Lead `where` fragment limiting to leads assigned to the
 * accessible users. Spread into a Prisma lead query:
 *   `where: { trash: 0, ...(await leadScopeWhere(user)) }`
 * Returns `{}` for a full admin (no restriction).
 */
export async function leadScopeWhere(user: {
  userId: number
  role: string
}): Promise<Prisma.LeadWhereInput> {
  const ids = await accessibleUserIds(user)
  if (ids === null) return {}
  return { assignedTo: { some: { clrId: { in: ids } } } }
}

/**
 * Login Logs scope:
 * - Admin -> null (sees everyone)
 * - Sub-Admin / Sales Head -> branch members (with fallbacks if user_branch_access empty)
 * - Counsellor / Employee / Agent -> only themselves
 */
export async function loginLogsScopeUserIds(user: {
  userId: number
  role: string
  roles?: string[]
}): Promise<bigint[] | null> {
  const allRoles = [user.role, ...(user.roles ?? [])]
  const isTopAdmin = allRoles.includes('admin')
  if (isTopAdmin) return null

  const isManager = allRoles.some((r) => r === 'sub-admin' || r === 'sales-head')
  if (isManager) {
    if (await hasAllBranchAccess(user.userId)) return null
    let ids = await branchMemberIds(user.userId)

    if (ids.length === 0) {
      const u = await prisma.user.findUnique({
        where: { id: BigInt(user.userId) },
        select: { branchId: true },
      })
      if (u?.branchId) {
        const members = await prisma.user.findMany({
          where: { branchId: u.branchId },
          select: { id: true },
        })
        ids = members.map((m) => m.id)
      }
    }

    if (ids.length === 0) {
      const nonAdmins = await prisma.user.findMany({
        where: { role: { notIn: ['admin'] } },
        select: { id: true },
      })
      ids = nonAdmins.map((m) => m.id)
    }

    const selfId = BigInt(user.userId)
    if (!ids.some((id) => id === selfId)) ids.push(selfId)
    return ids
  }

  return [BigInt(user.userId)]
}

