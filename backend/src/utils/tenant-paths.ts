// ─────────────────────────────────────────────────────────────────────────────
// Where each customer's uploaded files live.
//
//   uploads/                 ← the ORIGINAL install (unchanged)
//   uploads/t/<slug>/        ← every customer onboarded after this
//
// Keeping the primary customer at the root is what makes this a zero-migration
// change: every path already stored in their database still resolves.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path'
import { currentTenant, type TenantContext } from '../lib/tenant-context'

export const UPLOADS_ROOT = path.join(process.cwd(), 'uploads')

/** The sub-path a customer's files sit under, relative to uploads/. */
export function uploadsPrefixFor(ctx: Pick<TenantContext, 'isPrimary' | 'slug'> | undefined): string {
  if (!ctx || ctx.isPrimary) return ''
  return path.posix.join('t', ctx.slug)
}

export function uploadsDirFor(ctx: Pick<TenantContext, 'isPrimary' | 'slug'> | undefined): string {
  const prefix = uploadsPrefixFor(ctx)
  return prefix ? path.join(UPLOADS_ROOT, ...prefix.split('/')) : UPLOADS_ROOT
}

/** The directory the current request's uploads should be written to. */
export function currentUploadsDir(): string {
  return uploadsDirFor(currentTenant())
}

/**
 * Decide whether a caller may read a path under /uploads.
 *
 * The rule is positional: anything under `t/<slug>/` belongs to that customer
 * and nobody else; anything else belongs to the original install.
 */
export function canAccessUploadPath(ctx: TenantContext | undefined, relativePath: string): boolean {
  if (!ctx) return false

  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  // Reject traversal outright rather than trying to resolve it.
  if (normalized.split('/').includes('..')) return false

  const match = /^t\/([a-z0-9_]+)\//.exec(normalized)

  if (!match) {
    // Root-level file: the original install's territory.
    return ctx.isPrimary
  }
  return match[1] === ctx.slug
}
