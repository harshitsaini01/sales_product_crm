// ─────────────────────────────────────────────────────────────────────────────
// Keeps platform.tenant_user_directory in step with every tenant's users table.
//
// Why it exists: there is ONE login page for every customer, but each
// customer's `users` table lives in its own Postgres schema. Without a
// directory, resolving "who does this email belong to?" would mean querying
// every schema on every login attempt. The directory turns that into one
// indexed lookup.
//
// It is a cache, not a source of truth — scripts/rebuild-directory.ts can
// regenerate the whole thing from the tenant schemas at any time.
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma, type PrismaClient } from '@prisma/client'
import { platformPrisma } from './platform'
import { currentTenant, type TenantContext } from './tenant-context'

interface DirectoryRow {
  userId: bigint
  loginid: string
  email: string
  username: string | null
  name: string
  role: string
  status: number
}

const USER_SELECT = {
  id: true,
  loginid: true,
  email: true,
  username: true,
  name: true,
  role: true,
  status: true,
} as const

function toRow(u: {
  id: bigint
  loginid: string
  email: string
  username: string | null
  name: string
  role: string
  status: number
}): DirectoryRow {
  return {
    userId: u.id,
    loginid: u.loginid ?? '',
    email: u.email ?? '',
    username: u.username ?? null,
    name: u.name ?? '',
    role: u.role ?? '',
    status: u.status ?? 1,
  }
}

export async function upsertDirectoryRow(tenantId: number, row: DirectoryRow): Promise<void> {
  if (process.env.SINGLE_TENANT !== '0') return
  const data = {
    loginid: row.loginid,
    email: row.email,
    username: row.username,
    name: row.name,
    role: row.role,
    status: row.status,
  }
  await platformPrisma.tenantUserDirectory.upsert({
    where: { tenantId_userId: { tenantId, userId: row.userId } },
    create: { tenantId, userId: row.userId, ...data },
    update: data,
  })
}

export async function removeDirectoryRow(tenantId: number, userId: bigint): Promise<void> {
  if (process.env.SINGLE_TENANT !== '0') return
  await platformPrisma.tenantUserDirectory
    .delete({ where: { tenantId_userId: { tenantId, userId } } })
    .catch(() => undefined) // already gone is fine
}

/**
 * Rebuild one customer's whole directory from their users table. Safe to run
 * at any time; used by the resync debounce, by provisioning, and by
 * scripts/rebuild-directory.ts.
 */
export async function resyncTenantDirectory(base: PrismaClient, tenantId: number): Promise<number> {
  if (process.env.SINGLE_TENANT !== '0') return 0
  const users = await base.user.findMany({ select: USER_SELECT })
  const rows = users.map((u) => toRow(u as never))
  const ids = rows.map((r) => r.userId)

  // Drop anyone who no longer exists in the tenant schema.
  await platformPrisma.tenantUserDirectory.deleteMany({
    where: { tenantId, ...(ids.length ? { userId: { notIn: ids } } : {}) },
  })

  // Chunked rather than one giant transaction: a customer with a few thousand
  // staff would otherwise build a single statement list long enough to be a
  // problem in its own right.
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    await platformPrisma.$transaction(
      rows.slice(i, i + CHUNK).map((r) =>
        platformPrisma.tenantUserDirectory.upsert({
          where: { tenantId_userId: { tenantId, userId: r.userId } },
          create: { tenantId, ...r },
          update: { loginid: r.loginid, email: r.email, username: r.username, name: r.name, role: r.role, status: r.status },
        }),
      ),
    )
  }

  return rows.length
}

// ── Debounced resync, for the bulk paths (updateMany / deleteMany) where
//    picking out exactly which rows changed is not worth the complexity.
const pending = new Map<number, NodeJS.Timeout>()

function scheduleResync(base: PrismaClient, tenantId: number): void {
  const existing = pending.get(tenantId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pending.delete(tenantId)
    resyncTenantDirectory(base, tenantId).catch((err) =>
      console.error(`[directory] resync failed for tenant ${tenantId}:`, err),
    )
  }, 2_000)
  // Never hold the process open just for a directory refresh.
  timer.unref()
  pending.set(tenantId, timer)
}

/**
 * A login identifier may only belong to one customer. Checked before insert so
 * the person creating the user gets a clear message instead of a login that
 * silently resolves to somebody else's account.
 */
export async function assertLoginAvailable(
  ctx: TenantContext,
  fields: { loginid?: string | null; email?: string | null; username?: string | null },
): Promise<void> {
  const candidates = [fields.loginid, fields.email, fields.username].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  )
  if (!candidates.length) return
  if (process.env.SINGLE_TENANT !== '0') return

  const clash = await platformPrisma.tenantUserDirectory.findFirst({
    where: {
      tenantId: { not: ctx.tenantId },
      OR: [
        { loginid: { in: candidates, mode: 'insensitive' } },
        { email: { in: candidates, mode: 'insensitive' } },
        { username: { in: candidates, mode: 'insensitive' } },
      ],
    },
    select: { loginid: true, email: true },
  })

  if (clash) {
    throw new Error(
      'That login ID or email address is already in use on this platform. Please choose a different one.',
    )
  }
}

export function directoryExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'tenant-directory',
    query: {
      user: {
        async create({ args, query }) {
          const ctx = currentTenant()
          if (ctx) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = (args as any)?.data ?? {}
            await assertLoginAvailable(ctx, { loginid: d.loginid, email: d.email, username: d.username })
          }
          const result = await query(args)
          if (ctx) await syncFromResult(base, ctx, result)
          return result
        },

        async update({ args, query }) {
          const result = await query(args)
          const ctx = currentTenant()
          if (ctx) await syncFromResult(base, ctx, result)
          return result
        },

        async upsert({ args, query }) {
          const result = await query(args)
          const ctx = currentTenant()
          if (ctx) await syncFromResult(base, ctx, result)
          return result
        },

        async delete({ args, query }) {
          const result = await query(args)
          const ctx = currentTenant()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const id = (result as any)?.id ?? (args as any)?.where?.id
          if (ctx && id != null) await removeDirectoryRow(ctx.tenantId, BigInt(id)).catch(() => undefined)
          return result
        },

        async updateMany({ args, query }) {
          const result = await query(args)
          const ctx = currentTenant()
          if (ctx) scheduleResync(base, ctx.tenantId)
          return result
        },

        async deleteMany({ args, query }) {
          const result = await query(args)
          const ctx = currentTenant()
          if (ctx) scheduleResync(base, ctx.tenantId)
          return result
        },
      },
    },
  })
}

/**
 * The caller may have passed a `select`, in which case the returned object has
 * none of the fields the directory needs — re-read by id when that happens.
 */
async function syncFromResult(base: PrismaClient, ctx: TenantContext, result: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any
  if (!r || r.id == null) return
  try {
    let source = r
    if (typeof r.loginid !== 'string' || typeof r.email !== 'string') {
      source = await base.user.findUnique({ where: { id: BigInt(r.id) }, select: USER_SELECT })
      if (!source) return
    }
    await upsertDirectoryRow(ctx.tenantId, toRow(source))
  } catch (err) {
    // The directory is a cache. A failure here must never break the write that
    // already succeeded — log it and let the next resync repair it.
    console.error('[directory] sync failed:', err)
  }
}
