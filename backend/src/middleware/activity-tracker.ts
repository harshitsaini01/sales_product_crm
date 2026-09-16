import { createMiddleware } from 'hono/factory'
import { prisma } from '../lib/prisma'

// In-memory throttle so we don't hammer the DB on every request. Each user's
// lastActivityAt is updated at most once per THROTTLE_MS window.
const THROTTLE_MS = 30_000
const lastWrite = new Map<number, number>()

function isTracked(payload: { role?: string; roles?: string[] } | undefined): boolean {
  if (!payload) return false
  const all = [payload.role, ...(payload.roles ?? [])].filter(Boolean) as string[]
  // Track counsellors and sales-heads (sales-heads are field counsellors).
  return all.some((r) => r === 'counsellor' || r === 'sales-head')
}

/**
 * Bumps User.lastActivityAt on any authenticated request from a counsellor.
 * The source ('web' | 'mobile') is read from the JWT payload's `kind` field so
 * one middleware instance handles both web and mobile mounts. Throttled
 * per-user to avoid one write per API call.
 *
 * Mount AFTER `authenticate` / `authenticateMobile` so c.get('user') is set.
 */
export function activityTracker() {
  return createMiddleware(async (c, next) => {
    await next()
    const user = c.get('user') as
      | { userId: number; role?: string; roles?: string[]; kind?: 'web' | 'mobile' }
      | undefined
    if (!user || !isTracked(user)) return
    const now = Date.now()
    const last = lastWrite.get(user.userId) ?? 0
    if (now - last < THROTTLE_MS) return
    lastWrite.set(user.userId, now)
    const source: 'web' | 'mobile' = user.kind === 'mobile' ? 'mobile' : 'web'
    // Fire-and-forget so the response isn't delayed by the activity write.
    prisma.user
      .update({
        where: { id: BigInt(user.userId) },
        data: { lastActivityAt: new Date(now), lastActivitySource: source },
      })
      .catch((err) => console.error('[activity-tracker] update failed', err))
  })
}
