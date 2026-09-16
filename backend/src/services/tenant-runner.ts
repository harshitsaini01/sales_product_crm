// ─────────────────────────────────────────────────────────────────────────────
// Running background work once per customer.
//
// Every scheduler in this app was written against a single global `prisma`.
// Wrapping each tick in forEachActiveTenant() gives each customer their own
// pass with their own schema resolved, and keeps one customer's failure from
// stopping the sweep for everybody else.
// ─────────────────────────────────────────────────────────────────────────────

import { runWithTenant, type TenantContext } from '../lib/tenant-context'
import { getPrimaryTenant, getTenantById, listActiveTenantContexts } from './tenant.service'

/**
 * Run `fn` once per active customer, sequentially.
 *
 * Sequential on purpose: these are background sweeps, and running N customers'
 * IMAP polls or campaign batches concurrently would spike both the connection
 * count and outbound mail volume.
 */
export async function forEachActiveTenant(
  label: string,
  fn: (ctx: TenantContext) => Promise<void>,
): Promise<void> {
  let tenants: TenantContext[]
  try {
    tenants = await listActiveTenantContexts()
  } catch (err) {
    console.error(`[${label}] could not list tenants:`, err)
    return
  }

  for (const ctx of tenants) {
    try {
      await runWithTenant(ctx, () => fn(ctx))
    } catch (err) {
      console.error(`[${label}] failed for ${ctx.slug}:`, err)
    }
  }
}

/**
 * Run work against the original install specifically.
 *
 * For the handful of jobs that are genuinely platform-wide rather than
 * per-customer — today that is the API usage accumulator, whose buffer is one
 * global Map and so can only be attributed to one schema.
 */
export async function runAsPrimary<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = await getPrimaryTenant()
  return runWithTenant(ctx, fn)
}

/** Run one piece of work against one customer, by id. */
export async function runForTenantId<T>(
  tenantId: number,
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<T> {
  const ctx = await getTenantById(tenantId)
  if (!ctx) throw new Error(`Tenant ${tenantId} not found`)
  return runWithTenant(ctx, () => fn(ctx))
}

/**
 * Wrap a zero-argument tick function so it runs for every customer. Lets the
 * existing schedulers keep their `setInterval(tick, ms)` shape:
 *
 *   setInterval(perTenant('campaigns', tick), 30_000)
 */
export function perTenant(label: string, tick: () => Promise<void>): () => Promise<void> {
  return () => forEachActiveTenant(label, () => tick())
}
