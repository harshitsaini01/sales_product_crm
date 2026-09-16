// ─────────────────────────────────────────────────────────────────────────────
// Establishes the tenant context for every request.
//
// Runs BEFORE the per-route `authenticate` middleware, so it verifies the JWT
// itself rather than reading c.get('user'). That ordering matters: authenticate
// does a `prisma.user.findUnique` for the single-session check, which needs the
// schema already resolved.
//
// The double verify is cheap (an HMAC over a small payload) and keeps the
// existing route files untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import { createHash } from 'crypto'
import { verifyAnyToken } from './auth'
import { platformPrisma } from '../lib/platform'
import {
  runWithTenant,
  TenantUnavailableError,
  type TenantContext,
} from '../lib/tenant-context'
import {
  assertTenantUsable,
  getPrimaryTenant,
  getTenantById,
  getTenantBySlug,
  tenantsForLoginIdentifier,
} from '../services/tenant.service'
import { getTenantClient } from '../lib/prisma'

/**
 * Paths that must NOT get a tenant context from the caller's token.
 * The super admin panel talks only to the control plane.
 */
const PLATFORM_PREFIX = '/api/platform'

function withImpersonation(ctx: TenantContext, payload: { impersonatedBy?: { id: number; name: string } }): TenantContext {
  if (!payload.impersonatedBy) return ctx
  return { ...ctx, impersonatedBy: payload.impersonatedBy }
}

export function tenantMiddleware() {
  return createMiddleware(async (c, next) => {
    const path = c.req.path

    // The control plane is deliberately tenant-less.
    if (path === PLATFORM_PREFIX || path.startsWith(`${PLATFORM_PREFIX}/`)) return next()

    const authHeader = c.req.header('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      // Two cases, both fine to pass through without a context:
      //   • the public endpoints (/v1, /tracking) which mount their own
      //     tenant resolver further down the stack, and
      //   • unauthenticated requests to protected routes, which their own
      //     `authenticate` will 401 before any query runs.
      return next()
    }

    const result = verifyAnyToken(token)
    if (!result.ok) {
      // Let the route's own authenticate produce the precise 401 (it
      // distinguishes expired from invalid, which clients depend on).
      return next()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = result.payload as any

    // A platform token must never be usable against tenant routes.
    if (payload.scope === 'platform') {
      return c.json({ error: 'This token is not valid for customer endpoints' }, 403)
    }

    // Tokens minted before multi-tenancy shipped carry no tenantId. Falling back
    // to the primary customer means an existing deploy does not sign everybody
    // out the moment this ships.
    const ctx =
      (payload.tenantId != null ? await getTenantById(Number(payload.tenantId)) : null) ??
      (await getPrimaryTenant())

    if (!ctx) return c.json({ error: 'Account not found', reason: 'tenant_missing' }, 401)

    try {
      assertTenantUsable(ctx)
    } catch (err) {
      if (err instanceof TenantUnavailableError) {
        return c.json({ error: err.message, reason: err.reason }, 403)
      }
      throw err
    }

    const resolved = withImpersonation(ctx, payload)
    // Also stashed on the Hono context. AsyncLocalStorage only holds while the
    // stack is inside runWithTenant, so middleware that inspects the request
    // AFTER `await next()` returns — api-metrics, for one — has already lost it.
    c.set('tenantCtx', resolved)
    return runWithTenant(resolved, next)
  })
}

/**
 * For the public open-tracking pixels. The customer is named by a `t=<slug>`
 * query parameter that the mail builder embeds; without one we fall back to the
 * primary customer, which is what every pixel sent before this shipped has.
 */
export function publicTenantMiddleware() {
  return createMiddleware(async (c, next) => {
    const slug = c.req.query('t')
    const ctx = (slug ? await getTenantBySlug(slug) : null) ?? (await getPrimaryTenant())
    return runWithTenant(ctx, next)
  })
}

/**
 * For tokenless login endpoints that are NOT /api/auth/login — today that means
 * the mobile app's own login. Reads the identifier out of the JSON body and
 * resolves the customer from the platform directory before the handler runs, so
 * the handler itself stays exactly as it was written for a single tenant.
 *
 * Safe to read the body here: Hono caches the parsed body, so the handler's own
 * validator still sees it.
 */
export function tenantFromLoginBody(field = 'loginid') {
  return createMiddleware(async (c, next) => {
    let identifier = ''
    try {
      const body = (await c.req.json()) as Record<string, unknown>
      identifier = String(body?.[field] ?? '').trim()
    } catch {
      // Malformed body — the route's validator will reject it. Give it a
      // context anyway so it cannot trip the no-context guard.
    }

    if (!identifier) return runWithTenant(await getPrimaryTenant(), next)

    const candidates = await tenantsForLoginIdentifier(identifier)
    let blocked: TenantUnavailableError | null = null

    for (const ctx of candidates) {
      try {
        assertTenantUsable(ctx)
      } catch (err) {
        if (err instanceof TenantUnavailableError) {
          blocked = err
          continue
        }
        throw err
      }

      // Cheap existence probe. The handler re-reads the user with everything it
      // needs; all we are deciding here is which schema to run it against.
      const found = await runWithTenant(ctx, () =>
        getTenantClient(ctx.schemaName).user.findFirst({
          where: {
            status: 1,
            OR: [
              { loginid: identifier },
              { email: { equals: identifier, mode: 'insensitive' } },
              { username: identifier },
              { mobile: identifier },
            ],
          },
          select: { id: true },
        }),
      )

      if (found) return runWithTenant(ctx, next)
    }

    if (blocked) return c.json({ error: blocked.message, reason: blocked.reason }, 403)

    // Nobody matched. Run against the primary so the handler produces its own
    // "Invalid credentials" rather than a 500.
    return runWithTenant(await getPrimaryTenant(), next)
  })
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * For the /v1 lead-ingestion endpoints. Each customer gets their own key; the
 * legacy shared process.env.API_KEY still resolves to the primary customer so
 * existing website integrations keep working.
 */
export function tenantFromApiKey() {
  return createMiddleware(async (c, next) => {
    const ctx = await resolveIngestionTenant(c)

    try {
      assertTenantUsable(ctx)
    } catch (err) {
      if (err instanceof TenantUnavailableError) {
        return c.json({ success: false, message: err.message, reason: err.reason }, 403)
      }
      throw err
    }

    return runWithTenant(ctx, next)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveIngestionTenant(c: any) {
  // 1. An explicit slug always wins — the simplest thing to hand a partner who
  //    is integrating against a specific customer.
  const slug = c.req.query('t') || c.req.header('X-Tenant')
  if (slug) {
    const bySlug = await getTenantBySlug(String(slug))
    if (bySlug) return bySlug
  }

  const apiKey = c.req.header('X-API-KEY') || c.req.header('API-KEY') || ''

  // 2. The legacy shared key still means the original install, so every
  //    website integration built before this keeps working untouched.
  if (apiKey && process.env.API_KEY && apiKey === process.env.API_KEY) {
    return getPrimaryTenant()
  }

  // 3. Per-customer keys, presented either as X-API-KEY or as a Bearer token
  //    (which is how the /v1/inbound partner endpoints authenticate).
  const authHeader = c.req.header('Authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  for (const candidate of [apiKey, bearer]) {
    if (!candidate) continue
    const row = await platformPrisma.tenantApiKey.findUnique({
      where: { keyHash: hashApiKey(candidate) },
      select: { id: true, tenantId: true, status: true },
    })
    if (!row || row.status !== 1) continue

    const ctx = await getTenantById(row.tenantId)
    if (!ctx) continue

    // Fire-and-forget: a usage stamp must not slow down ingestion.
    void platformPrisma.tenantApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined)
    return ctx
  }

  // 4. Nothing matched. Fall back to the original install so the route's own
  //    key check can produce its existing 401 shape with a usable context.
  return getPrimaryTenant()
}
