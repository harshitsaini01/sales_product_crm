import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { record, normalizeRoute } from '../services/api-metrics.service'
import '../lib/tenant-context' // registers the `tenantCtx` context variable

/**
 * Counts every request into the in-memory metrics accumulator.
 *
 * Mount ONCE, as early as possible in app.ts — above the /api mount so it also
 * sees 404s, static /uploads reads and the public /v1 ingestion endpoints.
 *
 * Costs nothing on the DB: `record()` is a Map lookup and a few integer adds.
 * Everything here is wrapped so a metrics bug can never take down a request.
 */

/**
 * Ask Hono which registered route actually matched.
 *
 * This is far better than guessing from the raw path, because it gives the real
 * pattern (`/api/leads/:id`) including params we would otherwise have to infer.
 * Middleware entries are registered on wildcards, so the last non-wildcard match
 * is the handler that served the request.
 */
function matchedPattern(c: Context): string | null {
  const matched = (c.req as unknown as { matchedRoutes?: { path?: string }[] }).matchedRoutes
  if (!Array.isArray(matched) || matched.length === 0) return null
  for (let i = matched.length - 1; i >= 0; i--) {
    const p = matched[i]?.path
    if (p && !p.endsWith('*')) return p.length > 180 ? p.slice(0, 180) : p
  }
  return null
}

export function apiMetrics() {
  return createMiddleware(async (c, next) => {
    const started = Date.now()
    try {
      await next()
    } finally {
      try {
        const status = c.res?.status ?? 0
        // Every unmatched path collapses into one key. Scanners probing random
        // URLs are the classic way a metrics table explodes; this caps them at
        // a single row per bucket while still surfacing that they happened.
        const route =
          status === 404 && !matchedPattern(c)
            ? '__404__'
            : matchedPattern(c) ?? normalizeRoute(c.req.path)

        const user = c.get('user') as { userId?: number } | undefined

        // Read the tenant from the request, not from AsyncLocalStorage: by the
        // time this finally-block runs `await next()` has already returned, so
        // the ALS context is no longer active and currentTenant() would always
        // come back undefined here.
        //
        // Every customer's traffic is counted. API usage is a platform-wide
        // view owned by the super admin, and each caller row carries the tenant
        // id, so one customer's users are never merged with another's.
        const tenant = c.get('tenantCtx')

        record({
          method: c.req.method,
          route,
          status,
          durationMs: Date.now() - started,
          userId: user?.userId ?? 0,
          tenantId: tenant?.tenantId ?? 0,
        })
      } catch (err) {
        // Metrics must never break a response.
        console.error('[api-metrics] record failed', err)
      }
    }
  })
}
