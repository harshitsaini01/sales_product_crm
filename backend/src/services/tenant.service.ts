// ─────────────────────────────────────────────────────────────────────────────
// Turning a tenant id (or slug, or API key) into the TenantContext that
// lib/prisma.ts reads on every query.
//
// Hit on essentially every request, so results are cached in memory for
// CACHE_TTL_MS. Anything in the super admin panel that edits a customer must
// call invalidateTenantCache() so the change takes effect immediately rather
// than up to a minute later.
// ─────────────────────────────────────────────────────────────────────────────

import { platformPrisma } from '../lib/platform'
import { allFeaturesOn, resolveFeatures } from '../config/features'
import { getVertical } from '../config/verticals'
import {
  TenantUnavailableError,
  type TenantContext,
  type TenantStatusValue,
} from '../lib/tenant-context'

const CACHE_TTL_MS = Number(process.env.TENANT_CACHE_TTL_MS || 60_000)

/** Default ON. This product CRM is one company, one database — not a SaaS control plane. */
export function isSingleTenant(): boolean {
  return process.env.SINGLE_TENANT !== '0'
}

export function syntheticPrimary(): TenantContext {
  const v = getVertical(process.env.PRIMARY_VERTICAL || 'product_sales')
  return {
    tenantId: 1,
    slug: process.env.PRIMARY_TENANT_SLUG || 'primary',
    schemaName: process.env.PRIMARY_TENANT_SCHEMA || 'public',
    companyName: process.env.PRIMARY_COMPANY_NAME || v.label,
    status: 'active',
    planName: 'owner',
    planExpiresAt: null,
    isPrimary: true,
    vertical: v.key,
    features: resolveFeatures({ ...allFeaturesOn(), ...v.features }),
    leadFields: v.leadFields,
    labels: v.labels,
    limits: {
      maxUsers: null,
      maxCounsellors: null,
      maxSubAdmins: null,
      maxBranches: null,
      maxLeads: null,
      maxLeadsPerMonth: null,
      maxStorageMb: null,
    },
    impersonatedBy: null,
  }
}

interface CacheEntry {
  at: number
  ctx: TenantContext
}

const byId = new Map<number, CacheEntry>()
const slugToId = new Map<string, number>()
let primaryId: number | null = null

export function invalidateTenantCache(tenantId?: number): void {
  if (tenantId == null) {
    byId.clear()
    slugToId.clear()
    primaryId = null
    return
  }
  const hit = byId.get(tenantId)
  if (hit) slugToId.delete(hit.ctx.slug)
  byId.delete(tenantId)
  if (primaryId === tenantId) primaryId = null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toContext(row: any): TenantContext {
  // A plan that ran out is "expired" from this moment on, whatever the stored
  // status says — we do not depend on a nightly job having run.
  const expired =
    row.planExpiresAt instanceof Date && row.planExpiresAt.getTime() < Date.now()
  const status: TenantStatusValue = expired && row.status === 'active' ? 'expired' : row.status

  return {
    tenantId: row.id,
    slug: row.slug,
    schemaName: row.schemaName,
    companyName: row.companyName,
    status,
    planName: row.planName,
    planExpiresAt: row.planExpiresAt ?? null,
    isPrimary: row.isPrimary,
    // Rows written before this column existed have no vertical; they are all
    // education, which is what getVertical() falls back to.
    vertical: getVertical(row.vertical).key,
    features: resolveFeatures(row.features),
    leadFields: row.leadFields ?? {},
    labels: row.labels ?? {},
    limits: {
      maxUsers: row.maxUsers ?? null,
      maxCounsellors: row.maxCounsellors ?? null,
      maxSubAdmins: row.maxSubAdmins ?? null,
      maxBranches: row.maxBranches ?? null,
      maxLeads: row.maxLeads ?? null,
      maxLeadsPerMonth: row.maxLeadsPerMonth ?? null,
      maxStorageMb: row.maxStorageMb ?? null,
    },
    impersonatedBy: null,
  }
}

function cache(ctx: TenantContext): TenantContext {
  byId.set(ctx.tenantId, { at: Date.now(), ctx })
  slugToId.set(ctx.slug, ctx.tenantId)
  if (ctx.isPrimary) primaryId = ctx.tenantId
  return ctx
}

export async function getTenantById(tenantId: number): Promise<TenantContext | null> {
  if (isSingleTenant()) return cache(syntheticPrimary())
  const hit = byId.get(tenantId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx

  try {
    const row = await platformPrisma.tenant.findUnique({ where: { id: tenantId } })
    if (!row) return cache(syntheticPrimary())
    return cache(toContext(row))
  } catch {
    return cache(syntheticPrimary())
  }
}

export async function getTenantBySlug(slug: string): Promise<TenantContext | null> {
  if (isSingleTenant()) return cache(syntheticPrimary())
  const id = slugToId.get(slug)
  if (id != null) {
    const hit = byId.get(id)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx
  }

  try {
    const row = await platformPrisma.tenant.findUnique({ where: { slug } })
    if (!row) return cache(syntheticPrimary())
    return cache(toContext(row))
  } catch {
    return cache(syntheticPrimary())
  }
}

/**
 * The original install. Used as the fallback for tokens minted before
 * multi-tenancy shipped, and for the public endpoints that have no other way
 * to say who they belong to.
 */
export async function getPrimaryTenant(): Promise<TenantContext> {
  if (isSingleTenant()) return cache(syntheticPrimary())
  if (primaryId != null) {
    const hit = byId.get(primaryId)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx
  }

  try {
    const row = await platformPrisma.tenant.findFirst({ where: { isPrimary: true } })
    if (row) return cache(toContext(row))
  } catch {
    /* one-company install: no platform schema */
  }
  return cache(syntheticPrimary())
}

/** Throws unless this customer is allowed to serve traffic right now. */
export function assertTenantUsable(ctx: TenantContext): void {
  if (ctx.status === 'suspended') {
    throw new TenantUnavailableError(
      'tenant_suspended',
      'This account has been suspended. Please contact support.',
    )
  }
  if (ctx.status === 'expired') {
    const on = ctx.planExpiresAt
      ? ctx.planExpiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : null
    throw new TenantUnavailableError(
      'tenant_expired',
      on
        ? `This subscription expired on ${on}. Please contact support to renew.`
        : 'This subscription has expired. Please contact support to renew.',
    )
  }
}

/**
 * Which customers could this login identifier belong to?
 *
 * Every customer's users live in their own Postgres schema, so the identifier
 * is looked up in the platform directory (platform.tenant_user_directory),
 * which mirrors those tables. Usually exactly one candidate comes back; more
 * than one only happens when the same address exists at two customers, and the
 * caller then tries the password against each in turn.
 *
 * Falling back to the primary customer when the directory has no answer is
 * deliberate: on a fresh deploy — before `npm run platform:bootstrap` has
 * populated the directory — the original install must still be able to log in.
 */
export async function tenantsForLoginIdentifier(_identifier: string): Promise<TenantContext[]> {
  if (isSingleTenant()) return [await getPrimaryTenant()]
  try {
    const rows = await platformPrisma.tenantUserDirectory.findMany({
      where: {
        status: 1,
        OR: [
          { loginid: { equals: _identifier, mode: 'insensitive' } },
          { email: { equals: _identifier, mode: 'insensitive' } },
          { username: { equals: _identifier, mode: 'insensitive' } },
        ],
      },
      select: { tenantId: true },
      distinct: ['tenantId'],
      take: 5,
    })

    if (!rows.length) return [await getPrimaryTenant()]

    const contexts = await Promise.all(rows.map((r) => getTenantById(r.tenantId)))
    return contexts.filter((ctx): ctx is TenantContext => ctx !== null)
  } catch {
    return [await getPrimaryTenant()]
  }
}

/** Every customer that should be included in background worker sweeps. */
export async function listActiveTenantContexts(): Promise<TenantContext[]> {
  if (isSingleTenant()) return [await getPrimaryTenant()]
  try {
    const rows = await platformPrisma.tenant.findMany({
      where: { status: 'active', provisioningStatus: 'ready' },
      orderBy: { id: 'asc' },
    })
    const list = rows
      .map(toContext)
      .filter((ctx) => ctx.status === 'active')
      .map(cache)
    return list.length ? list : [await getPrimaryTenant()]
  } catch {
    return [await getPrimaryTenant()]
  }
}
