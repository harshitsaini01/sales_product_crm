import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { serveStatic } from '@hono/node-server/serve-static'
import { routes } from './routes'
import { apiMetrics } from './middleware/api-metrics'
import { tenantScopedUploads } from './middleware/uploads-guard'
import {
  FeatureDisabledError,
  NoTenantContextError,
  QuotaExceededError,
  TenantUnavailableError,
} from './lib/tenant-context'

export const app = new Hono()

// ─── Global Middleware ────────────────────────────────────────────────────────
// Counts every request into an in-memory accumulator (no DB work on the request
// path). Mounted here rather than inside `routes` so it also sees 404s, static
// /uploads reads and the public /v1 ingestion endpoints.
app.use('*', apiMetrics())
app.use('*', logger())
app.use('*', prettyJSON())
app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-KEY'],
  })
)

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }))

// ─── Uploaded Files ───────────────────────────────────────────────────────────
// Files are stored per customer: the original install keeps writing to
// uploads/ root, every customer onboarded since writes to uploads/t/<slug>/
// (see utils/tenant-paths.ts).
//
// Root-level files stay public exactly as before — they are referenced by
// <img src> all over the SPA and embedded in already-sent email, and making
// them require a token would break both. Anything under t/<slug>/ is new, so
// it can be guarded properly from day one: only that customer may read it.
app.use('/uploads/*', tenantScopedUploads('/uploads/'))
// Production proxies reliably forward /api/* to this service. This public
// alias prevents email assets from being sent to the SPA's /uploads route.
app.use('/api/uploads/*', tenantScopedUploads('/api/uploads/'))
app.use('/uploads/*', serveStatic({ root: './' }))
app.use('/api/uploads/*', serveStatic({ root: './' }))

// ─── API Routes ───────────────────────────────────────────────────────────────
app.route('/api', routes)

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// ─── Error Handler ────────────────────────────────────────────────────────────
app.onError((err, c) => {
  // ── Plan limit reached. 403 with the numbers, so the UI can say exactly
  //    which limit was hit and what the customer is currently using.
  if (err instanceof QuotaExceededError) {
    return c.json(
      {
        error: err.message,
        reason: 'quota_exceeded',
        limitKey: err.limitKey,
        limit: err.limit,
        current: err.current,
        planName: err.planName,
      },
      403,
    )
  }

  if (err instanceof FeatureDisabledError) {
    return c.json({ error: err.message, reason: 'feature_disabled', feature: err.featureKey }, 403)
  }

  if (err instanceof TenantUnavailableError) {
    return c.json({ error: err.message, reason: err.reason }, 403)
  }

  // ── A code path reached the database without establishing tenant context.
  //    Always a bug, never the caller's fault, and worth shouting about: the
  //    alternative to this throw would have been silently reading the wrong
  //    customer's data.
  if (err instanceof NoTenantContextError) {
    console.error('[tenant] MISSING CONTEXT on', c.req.method, c.req.path, '—', err.message)
    return c.json({ error: 'Internal server error', reason: 'tenant_context_missing' }, 500)
  }

  console.error(err)
  return c.json({ error: err.message || 'Internal server error' }, 500)
})
