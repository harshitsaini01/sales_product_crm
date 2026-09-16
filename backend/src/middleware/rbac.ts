import { createMiddleware } from 'hono/factory'
import type { Role } from '../types'

export function authorize(...allowedRoles: Role[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const hasRole =
      allowedRoles.includes(user.role as Role) ||
      user.roles?.some((r) => allowedRoles.includes(r))

    if (!hasRole) {
      return c.json({ error: 'Forbidden: insufficient permissions' }, 403)
    }

    await next()
  })
}

// Convenience guards
export const adminOnly = authorize('admin', 'sub-admin')
// Strict guard: ONLY the top-level admin. Sub-admin is a branch-scoped manager
// and is intentionally excluded (user management, lead export, workflows, etc.).
export const superAdminOnly = authorize('admin')
// sales-head is included everywhere counsellor is — it IS a counsellor flow,
// just with a team-wide (branch-scoped) Calls view on top.
export const staffOnly = authorize('admin', 'sub-admin', 'sales-head', 'counsellor', 'franchise', 'employee', 'warehouse', 'accounts')
export const counsellorAndAbove = authorize('admin', 'sub-admin', 'sales-head', 'counsellor')
// Lead-assignment guard: who may hand leads (and calling tasks) to a counsellor.
// Matches the leads-list bulk action bar, which shows Assign to sales-head too.
export const salesHeadAndAbove = authorize('admin', 'sub-admin', 'sales-head')
export const franchiseAndAbove = authorize('admin', 'sub-admin', 'franchise')
