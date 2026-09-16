import { createMiddleware } from 'hono/factory'
import { currentTenant } from '../lib/tenant-context'
import { getFeature } from '../config/features'

/**
 * Blocks a whole route group when the customer's plan does not include it.
 *
 * Mounted one line per module in routes/index.ts. The frontend hides the same
 * modules from the sidebar and redirects their routes, so this is the backstop
 * for someone calling the API directly.
 */
export function requireFeature(key: string) {
  const def = getFeature(key)
  const label = def?.label ?? key

  return createMiddleware(async (c, next) => {
    const ctx = currentTenant()
    // No context means an unauthenticated request on its way to a 401 — let the
    // route's own auth answer, so we never leak which modules exist.
    if (!ctx) return next()

    if (ctx.features[key] !== true) {
      return c.json(
        {
          error: `${label} is not included in your plan. Contact your administrator to enable it.`,
          reason: 'feature_disabled',
          feature: key,
        },
        403,
      )
    }
    await next()
  })
}
