// ─────────────────────────────────────────────────────────────────────────────
// The per-request "which customer is this?" context.
//
// Held in an AsyncLocalStorage rather than passed around, which is what lets
// all ~1077 existing `prisma.x.y()` call sites stay byte-for-byte identical:
// lib/prisma.ts reads this store to decide which schema to talk to.
//
// Set in exactly two places:
//   • middleware/tenant.ts — for every HTTP request
//   • services/tenant-runner.ts — for every background worker tick
//
// Anything that runs outside both will throw NoTenantContextError on its first
// DB call. That is deliberate: failing loudly beats silently reading the
// primary customer's live data.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from 'node:async_hooks'
import type { VerticalKey } from '../config/verticals'

export type TenantStatusValue = 'active' | 'suspended' | 'expired'

export interface TenantLimits {
  /** NULL/undefined everywhere means "unlimited". */
  maxUsers: number | null
  maxCounsellors: number | null
  maxSubAdmins: number | null
  maxBranches: number | null
  maxLeads: number | null
  maxLeadsPerMonth: number | null
  maxStorageMb: number | null
}

export interface TenantContext {
  tenantId: number
  slug: string
  /** Postgres schema holding this customer's data. "public" for the original install. */
  schemaName: string
  companyName: string
  status: TenantStatusValue
  planName: string
  planExpiresAt: Date | null
  isPrimary: boolean
  /** "education" | "b2b_sales" — which preset built this customer's setup. */
  vertical: VerticalKey
  features: Record<string, boolean>
  /** Raw stored Lead Information field config; resolved via config/lead-fields.ts. */
  leadFields: unknown
  /** Raw stored terminology overrides; resolved via config/terminology.ts. */
  labels: unknown
  limits: TenantLimits
  /** Set only while a super admin is acting as this customer. */
  impersonatedBy?: { id: number; name: string } | null
}

declare module 'hono' {
  interface ContextVariableMap {
    /**
     * The same context the AsyncLocalStorage holds, mirrored onto the request.
     *
     * ALS is only live while the stack is inside runWithTenant(); middleware
     * that inspects a request after `await next()` has returned (api-metrics)
     * is outside it again by then and must read this instead.
     */
    tenantCtx: TenantContext
  }
}

const store = new AsyncLocalStorage<TenantContext>()

export class NoTenantContextError extends Error {
  constructor(what: string) {
    super(
      `No tenant context while accessing "${what}". Every database call must run ` +
        `inside runWithTenant() — see middleware/tenant.ts and services/tenant-runner.ts.`,
    )
    this.name = 'NoTenantContextError'
  }
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly limitKey: keyof TenantLimits,
    public readonly limit: number,
    public readonly current: number,
    public readonly planName: string,
    message: string,
  ) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

export class FeatureDisabledError extends Error {
  constructor(public readonly featureKey: string, message: string) {
    super(message)
    this.name = 'FeatureDisabledError'
  }
}

export class TenantUnavailableError extends Error {
  constructor(
    public readonly reason: 'tenant_suspended' | 'tenant_expired' | 'tenant_provisioning',
    message: string,
  ) {
    super(message)
    this.name = 'TenantUnavailableError'
  }
}

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return store.run(ctx, fn)
}

export function currentTenant(): TenantContext | undefined {
  return store.getStore()
}

export function requireTenant(): TenantContext {
  const ctx = store.getStore()
  if (!ctx) throw new NoTenantContextError('requireTenant()')
  return ctx
}

export function hasFeature(key: string): boolean {
  return currentTenant()?.features?.[key] === true
}

/**
 * Run `fn` outside any tenant context. Used by the platform routes, which talk
 * to the control-plane client only and must never inherit a caller's schema.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  // AsyncLocalStorage has no "clear", but exit() detaches for the callback.
  return store.exit(fn)
}
