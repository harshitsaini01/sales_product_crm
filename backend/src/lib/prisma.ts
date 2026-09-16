// ─────────────────────────────────────────────────────────────────────────────
// The tenant-aware Prisma client.
//
// This used to be a plain singleton. It is now a Proxy that forwards every
// property access to whichever customer's client belongs to the current
// AsyncLocalStorage context — which is precisely why the ~1077 existing
// `prisma.x.y()` call sites across 80 files did not have to change at all.
//
//   import { prisma } from '../lib/prisma'   ← unchanged everywhere
//
// Each customer's data lives in its own Postgres schema, and each gets its own
// PrismaClient built with `?schema=<theirs>`. Prisma sets the connection's
// search_path from that parameter, so raw SQL resolves to the right schema too.
//
// Accessing `prisma` with no tenant context throws. That is on purpose: a code
// path that forgets to establish context must fail loudly rather than silently
// read the primary customer's live data.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client'
import { NoTenantContextError, currentTenant } from './tenant-context'
import { quotaExtension } from './tenant-quota'
import { directoryExtension } from './tenant-directory'

export const PRIMARY_SCHEMA = process.env.PRIMARY_TENANT_SCHEMA || 'public'

interface Entry {
  base: PrismaClient
  client: PrismaClient
  lastUsed: number
}

const globalForPrisma = globalThis as unknown as { tenantClients?: Map<string, Entry> }
const clients: Map<string, Entry> = globalForPrisma.tenantClients ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForPrisma.tenantClients = clients

const IDLE_MS = Number(process.env.TENANT_CLIENT_IDLE_MS || 15 * 60_000)
const MAX_CLIENTS = Number(process.env.TENANT_CLIENT_CACHE || 25)

/**
 * Build the connection URL for one schema.
 *
 * The primary schema keeps the URL exactly as configured (including its
 * connection_limit), so the original install's pool behaviour does not change.
 * Additional customers get a smaller pool — with N customers on one Postgres,
 * N × 20 connections would exhaust max_connections long before the app does.
 */
export function urlForSchema(schemaName: string): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set')

  const url = new URL(base)
  url.searchParams.set('schema', schemaName)
  if (schemaName !== PRIMARY_SCHEMA) {
    url.searchParams.set('connection_limit', process.env.TENANT_CONNECTION_LIMIT || '5')
  }
  return url.toString()
}

function evictIdle(): void {
  const now = Date.now()
  for (const [schema, entry] of clients) {
    // The primary customer is always hot; disconnecting it just costs a
    // reconnect on the very next request.
    if (schema === PRIMARY_SCHEMA) continue
    if (now - entry.lastUsed > IDLE_MS) {
      clients.delete(schema)
      void entry.base.$disconnect().catch(() => undefined)
    }
  }

  while (clients.size > MAX_CLIENTS) {
    let oldest: [string, Entry] | null = null
    for (const pair of clients) {
      if (pair[0] === PRIMARY_SCHEMA) continue
      if (!oldest || pair[1].lastUsed < oldest[1].lastUsed) oldest = pair
    }
    if (!oldest) break
    clients.delete(oldest[0])
    void oldest[1].base.$disconnect().catch(() => undefined)
  }
}

function createClient(schemaName: string): Entry {
  const base = new PrismaClient({
    datasources: { db: { url: urlForSchema(schemaName) } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

  // Both extensions are given the *unextended* client for their own internal
  // reads, so a quota COUNT or a directory re-read can never re-enter the hooks.
  const client = base
    .$extends(quotaExtension(base))
    .$extends(directoryExtension(base)) as unknown as PrismaClient

  return { base, client, lastUsed: Date.now() }
}

/** Get (or lazily open) the client for one Postgres schema. */
export function getTenantClient(schemaName: string): PrismaClient {
  let entry = clients.get(schemaName)
  if (!entry) {
    evictIdle()
    entry = createClient(schemaName)
    clients.set(schemaName, entry)
  }
  entry.lastUsed = Date.now()
  return entry.client
}

/** The raw, unextended client — for maintenance paths that must skip quotas. */
export function getRawTenantClient(schemaName: string): PrismaClient {
  getTenantClient(schemaName)
  return clients.get(schemaName)!.base
}

export async function disconnectTenant(schemaName: string): Promise<void> {
  const entry = clients.get(schemaName)
  if (!entry) return
  clients.delete(schemaName)
  await entry.base.$disconnect().catch(() => undefined)
}

export async function disconnectAllTenants(): Promise<void> {
  const entries = [...clients.values()]
  clients.clear()
  await Promise.all(entries.map((e) => e.base.$disconnect().catch(() => undefined)))
}

export function connectedSchemas(): { schema: string; idleMs: number }[] {
  const now = Date.now()
  return [...clients.entries()].map(([schema, e]) => ({ schema, idleMs: now - e.lastUsed }))
}

/**
 * The drop-in replacement for the old singleton.
 *
 * Typed as PrismaClient because the extensions only add query hooks — they do
 * not change any model or method signature — so every existing call site keeps
 * exactly the types it had before.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // Node and various libraries probe for these on unknown objects; answering
    // truthfully avoids a spurious "no tenant context" throw during logging,
    // promise resolution or util.inspect.
    if (prop === 'then' || prop === Symbol.toStringTag || prop === 'constructor') return undefined
    if (typeof prop === 'symbol') return undefined

    const ctx = currentTenant()
    if (!ctx) throw new NoTenantContextError(String(prop))

    const client = getTenantClient(ctx.schemaName)
    // Receiver is the real client, not the proxy: a getter on the delegate must
    // never re-enter this trap.
    const value = Reflect.get(client as object, prop, client)
    return typeof value === 'function' ? value.bind(client) : value
  },

  has(_target, prop) {
    const ctx = currentTenant()
    if (!ctx) return false
    return prop in (getTenantClient(ctx.schemaName) as object)
  },
})
