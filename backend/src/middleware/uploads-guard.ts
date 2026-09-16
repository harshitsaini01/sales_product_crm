// ─────────────────────────────────────────────────────────────────────────────
// Stops one customer reading another customer's uploaded files.
//
// Deliberately narrow. Root-level files (uploads/xyz.pdf) belong to the
// original install and stay public, because the SPA references them from plain
// <img src> tags and already-sent emails embed them — putting a token
// requirement in front of those would break both, today, for no gain against an
// attacker who would still need to guess the filename.
//
// Files under uploads/t/<slug>/ are new territory. Nothing references them yet,
// so they are guarded from the start: you must present a token for that
// customer to read them.
// ─────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import { verifyAnyToken } from './auth'
import { canAccessUploadPath } from '../utils/tenant-paths'
import { getTenantById, getPrimaryTenant } from '../services/tenant.service'
import type { TenantContext } from '../lib/tenant-context'

const TENANT_PATH = /^t\/([a-z0-9_]+)\//

export function tenantScopedUploads(mountPrefix: string) {
  return createMiddleware(async (c, next) => {
    const raw = decodeURIComponent(new URL(c.req.url).pathname)
    const relative = raw.startsWith(mountPrefix) ? raw.slice(mountPrefix.length) : raw

    // Not a per-customer path → the original install's public files. Unchanged.
    if (!TENANT_PATH.test(relative.replace(/\\/g, '/'))) return next()

    // <img> and <a download> cannot set headers, so a query token is accepted
    // here the same way the existing recording/app-release downloads do it.
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : c.req.query('token')

    if (!token) return c.json({ error: 'Not found' }, 404)

    const result = verifyAnyToken(token)
    if (!result.ok) return c.json({ error: 'Not found' }, 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = result.payload as any
    const ctx: TenantContext | null =
      payload.tenantId != null ? await getTenantById(Number(payload.tenantId)) : await getPrimaryTenant()

    // 404 rather than 403 — a wrong-customer request should not confirm that
    // the file exists at all.
    if (!ctx || !canAccessUploadPath(ctx, relative)) return c.json({ error: 'Not found' }, 404)

    await next()
  })
}
