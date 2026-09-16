// ─────────────────────────────────────────────────────────────────────────────
// Plan limits, enforced in ONE place.
//
// There are 3 user-create sites and 10 lead-create sites in this codebase today
// and there will be more tomorrow. Rather than trust every future one to
// remember a check, the limits are enforced as a Prisma client extension: any
// insert that would push a customer past their plan throws QuotaExceededError
// before it reaches the database.
//
// Counts are cached per schema for CACHE_TTL_MS and incremented locally on each
// successful insert, so a 5,000-row CSV import costs one COUNT, not 5,000.
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma, type PrismaClient } from '@prisma/client'
import { currentTenant, QuotaExceededError, type TenantContext, type TenantLimits } from './tenant-context'

const CACHE_TTL_MS = 60_000

interface Counts {
  users: number
  counsellors: number
  subAdmins: number
  branches: number
  leads: number
  leadsThisMonth: number
}

interface CacheEntry {
  at: number
  counts: Counts
}

const cache = new Map<string, CacheEntry>()

export function invalidateQuotaCache(schemaName?: string): void {
  if (schemaName) cache.delete(schemaName)
  else cache.clear()
}

function startOfMonth(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function loadCounts(base: PrismaClient): Promise<Counts> {
  const [users, counsellors, subAdmins, branches, leads, leadsThisMonth] = await Promise.all([
    base.user.count({ where: { status: 1 } }),
    base.user.count({ where: { status: 1, role: 'counsellor' } }),
    base.user.count({ where: { status: 1, role: 'sub-admin' } }),
    base.branch.count({ where: { status: 1 } }),
    base.lead.count({ where: { trash: 0 } }),
    base.lead.count({ where: { trash: 0, createdAt: { gte: startOfMonth() } } }),
  ])
  return { users, counsellors, subAdmins, branches, leads, leadsThisMonth }
}

async function getCounts(base: PrismaClient, schemaName: string): Promise<Counts> {
  const hit = cache.get(schemaName)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.counts
  const counts = await loadCounts(base)
  cache.set(schemaName, { at: Date.now(), counts })
  return counts
}

function bump(schemaName: string, patch: Partial<Counts>): void {
  const hit = cache.get(schemaName)
  if (!hit) return
  for (const [k, v] of Object.entries(patch)) {
    hit.counts[k as keyof Counts] += v as number
  }
}

const LABELS: Record<keyof TenantLimits, string> = {
  maxUsers: 'team members',
  maxCounsellors: 'counsellors',
  maxSubAdmins: 'sub-admins',
  maxBranches: 'branches',
  maxLeads: 'leads',
  maxLeadsPerMonth: 'leads this month',
  maxStorageMb: 'storage',
}

function deny(ctx: TenantContext, key: keyof TenantLimits, limit: number, current: number, adding: number): never {
  const noun = LABELS[key]
  const message =
    adding > 1
      ? `Adding ${adding} ${noun} would take you past your plan limit of ${limit} — you are using ${current}. Upgrade your plan to continue.`
      : `Your plan allows ${limit} ${noun} and you already have ${current}. Upgrade your plan to add more.`
  throw new QuotaExceededError(key, limit, current, ctx.planName, message)
}

/**
 * Check a limit without inserting anything. Used by the CSV/bulk import
 * pre-flight so the customer is told up front rather than half way through.
 */
export async function assertHeadroom(
  base: PrismaClient,
  key: keyof TenantLimits,
  adding: number,
): Promise<void> {
  const ctx = currentTenant()
  if (!ctx) return
  const limit = ctx.limits[key]
  if (limit == null) return

  const counts = await getCounts(base, ctx.schemaName)
  const current = countFor(counts, key)
  if (current + adding > limit) deny(ctx, key, limit, current, adding)
}

function countFor(counts: Counts, key: keyof TenantLimits): number {
  switch (key) {
    case 'maxUsers': return counts.users
    case 'maxCounsellors': return counts.counsellors
    case 'maxSubAdmins': return counts.subAdmins
    case 'maxBranches': return counts.branches
    case 'maxLeads': return counts.leads
    case 'maxLeadsPerMonth': return counts.leadsThisMonth
    default: return 0
  }
}

/** How much room is left, for the customer's own "plan usage" screen. */
export async function usageSnapshot(base: PrismaClient): Promise<{
  counts: Counts
  limits: TenantLimits | null
}> {
  const ctx = currentTenant()
  const counts = await loadCounts(base)
  cache.set(ctx?.schemaName ?? '__anon__', { at: Date.now(), counts })
  return { counts, limits: ctx?.limits ?? null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(data: any): any[] {
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

export function quotaExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'tenant-quota',
    query: {
      user: {
        async create({ args, query }) {
          const ctx = currentTenant()
          if (ctx) {
            await assertHeadroom(base, 'maxUsers', 1)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const role = String((args as any)?.data?.role || '')
            if (role === 'counsellor') await assertHeadroom(base, 'maxCounsellors', 1)
            if (role === 'sub-admin') await assertHeadroom(base, 'maxSubAdmins', 1)
          }
          const result = await query(args)
          if (ctx) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const role = String((args as any)?.data?.role || '')
            bump(ctx.schemaName, {
              users: 1,
              counsellors: role === 'counsellor' ? 1 : 0,
              subAdmins: role === 'sub-admin' ? 1 : 0,
            })
          }
          return result
        },
        async createMany({ args, query }) {
          const ctx = currentTenant()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = rowsOf((args as any)?.data)
          if (ctx && rows.length) {
            await assertHeadroom(base, 'maxUsers', rows.length)
            const counsellors = rows.filter((r) => r?.role === 'counsellor').length
            const subAdmins = rows.filter((r) => r?.role === 'sub-admin').length
            if (counsellors) await assertHeadroom(base, 'maxCounsellors', counsellors)
            if (subAdmins) await assertHeadroom(base, 'maxSubAdmins', subAdmins)
          }
          const result = await query(args)
          if (ctx && rows.length) {
            bump(ctx.schemaName, {
              users: rows.length,
              counsellors: rows.filter((r) => r?.role === 'counsellor').length,
              subAdmins: rows.filter((r) => r?.role === 'sub-admin').length,
            })
          }
          return result
        },
      },

      lead: {
        async create({ args, query }) {
          const ctx = currentTenant()
          if (ctx) {
            await assertHeadroom(base, 'maxLeads', 1)
            await assertHeadroom(base, 'maxLeadsPerMonth', 1)
          }
          const result = await query(args)
          if (ctx) bump(ctx.schemaName, { leads: 1, leadsThisMonth: 1 })
          return result
        },
        async createMany({ args, query }) {
          const ctx = currentTenant()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = rowsOf((args as any)?.data)
          if (ctx && rows.length) {
            await assertHeadroom(base, 'maxLeads', rows.length)
            await assertHeadroom(base, 'maxLeadsPerMonth', rows.length)
          }
          const result = await query(args)
          if (ctx && rows.length) bump(ctx.schemaName, { leads: rows.length, leadsThisMonth: rows.length })
          return result
        },
      },

      branch: {
        async create({ args, query }) {
          const ctx = currentTenant()
          if (ctx) await assertHeadroom(base, 'maxBranches', 1)
          const result = await query(args)
          if (ctx) bump(ctx.schemaName, { branches: 1 })
          return result
        },
      },
    },
  })
}
