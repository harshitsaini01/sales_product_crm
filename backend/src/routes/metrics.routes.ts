// ─────────────────────────────────────────────────────────────────────────────
// API usage metrics — a SUPER ADMIN view, mounted at /api/platform/metrics.
//
// This was originally a per-customer module, which never really fitted: the
// accumulator is one process-wide buffer, and endpoint latency and error rates
// are facts about the platform, not about any one customer. It now lives
// entirely behind the platform token, and each caller row carries the tenant it
// belongs to, so usage can be broken down BY customer instead of pretending to
// be one customer's own data.
//
// The metric tables themselves live in the primary schema, so every handler
// here runs inside the primary tenant context — see platformMetricsRoutes.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { authenticatePlatform } from '../middleware/platform-auth'
import { prisma, getTenantClient } from '../lib/prisma'
import { runWithTenant } from '../lib/tenant-context'
import { getPrimaryTenant, getTenantById } from '../services/tenant.service'
import { platformPrisma } from '../lib/platform'
import {
  BAND_BOUNDS,
  flushNow,
  rollupAndPrune,
  snapshotLive,
  snapshotUnflushed,
  snapshotUnflushedStatus,
  withinTrackingWindow,
  TRACKING_WINDOW,
  isTrackingEnabled,
  setTrackingEnabled,
} from '../services/api-metrics.service'

export const metricsRoutes = new Hono()

// Super admin only. A customer's token cannot reach these — it is signed with a
// different secret and rejected by authenticatePlatform.
metricsRoutes.use('*', authenticatePlatform)

// The api_usage_* tables live in the primary schema. Establishing that context
// here is what lets every handler below keep using the plain `prisma` import.
metricsRoutes.use(
  '*',
  createMiddleware(async (c, next) => {
    const primary = await getPrimaryTenant()
    return runWithTenant(primary, next)
  }),
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick the coarsest granularity that still covers the requested window.
 * m5 only exists for 7 days and h1 for 90, so asking for a year has to read d1.
 */
function pickGranularity(hours: number): 'm5' | 'h1' | 'd1' {
  if (hours <= 48) return 'm5'
  if (hours <= 90 * 24) return 'h1'
  return 'd1'
}

/**
 * Approximate percentile from the stored latency histogram.
 *
 * bands[i] is the count of requests in (BOUNDS[i], BOUNDS[i+1]] ms. We find the
 * band the target rank falls in and interpolate linearly inside it. The last
 * band is open-ended so it can only report its lower bound — a request slower
 * than 2500 ms reads as "at least 2500 ms", which is the honest answer given we
 * deliberately do not keep raw samples.
 */
function percentile(bands: number[], p: number): number {
  const bounds = [0, ...BAND_BOUNDS, Infinity]
  const total = bands.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const target = total * p
  let cum = 0
  for (let i = 0; i < bands.length; i++) {
    const next = cum + bands[i]
    if (next >= target) {
      const lo = bounds[i]
      const hi = bounds[i + 1]
      if (!Number.isFinite(hi)) return lo
      const within = bands[i] > 0 ? (target - cum) / bands[i] : 0
      return Math.round(lo + (hi - lo) * within)
    }
    cum = next
  }
  return bounds[bounds.length - 2]
}

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  return Number(v ?? 0)
}

function parseHours(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, 365 * 24)
}

// ─── GET /api/metrics/live ───────────────────────────────────────────────────
// Pure RAM read — no DB query at all. This is where second-resolution data
// lives; persisting it would cost ~13M rows/day for no real benefit.
metricsRoutes.get('/live', (c) => {
  const topN = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20))
  return c.json({
    ...snapshotLive(topN),
    trackingWindow: TRACKING_WINDOW,
    trackingActive: withinTrackingWindow(Date.now()),
    trackingEnabled: isTrackingEnabled(),
  })
})

// ─── GET/POST /api/metrics/config ────────────────────────────────────────────
// The admin kill switch. GET reports current state; POST { enabled } flips it.
metricsRoutes.get('/config', (c) =>
  c.json({
    enabled: isTrackingEnabled(),
    trackingWindow: TRACKING_WINDOW,
    trackingActive: withinTrackingWindow(Date.now()),
  }),
)

metricsRoutes.post('/config', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'Body must be { enabled: boolean }' }, 400)
  }
  await setTrackingEnabled(body.enabled)
  return c.json({ ok: true, enabled: isTrackingEnabled() })
})

// ─── GET /api/metrics/summary ────────────────────────────────────────────────
// Top endpoints over a window, merged with counters not yet flushed so the
// dashboard is current instead of lagging a bucket behind.
metricsRoutes.get('/summary', async (c) => {
  const hours = parseHours(c.req.query('hours'), 24)
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 50))
  const granularity = pickGranularity(hours)
  const since = new Date(Date.now() - hours * 3600_000)

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "method", "route",
            SUM("hits")::bigint       AS hits,
            SUM("errors_4xx")::bigint AS e4,
            SUM("errors_5xx")::bigint AS e5,
            SUM("total_ms")::bigint   AS total_ms,
            MAX("max_ms")::int        AS max_ms,
            MAX("peak_rps")::int      AS peak_rps,
            SUM("ms50")::bigint   AS b0, SUM("ms100")::bigint  AS b1,
            SUM("ms250")::bigint  AS b2, SUM("ms500")::bigint  AS b3,
            SUM("ms1000")::bigint AS b4, SUM("ms2500")::bigint AS b5,
            SUM("ms_inf")::bigint AS b6
       FROM "api_usage_stats"
      WHERE "granularity" = $1 AND "bucket_start" >= $2
      GROUP BY "method", "route"`,
    granularity,
    since,
  )

  interface Agg {
    method: string
    route: string
    hits: number
    errors4xx: number
    errors5xx: number
    totalMs: number
    maxMs: number
    peakRps: number
    bands: number[]
  }

  const merged = new Map<string, Agg>()
  const put = (a: Agg) => {
    const key = `${a.method} ${a.route}`
    const cur = merged.get(key)
    if (!cur) {
      merged.set(key, a)
      return
    }
    cur.hits += a.hits
    cur.errors4xx += a.errors4xx
    cur.errors5xx += a.errors5xx
    cur.totalMs += a.totalMs
    cur.maxMs = Math.max(cur.maxMs, a.maxMs)
    cur.peakRps = Math.max(cur.peakRps, a.peakRps)
    for (let i = 0; i < cur.bands.length; i++) cur.bands[i] += a.bands[i] ?? 0
  }

  for (const r of rows) {
    put({
      method: String(r.method),
      route: String(r.route),
      hits: num(r.hits),
      errors4xx: num(r.e4),
      errors5xx: num(r.e5),
      totalMs: num(r.total_ms),
      maxMs: num(r.max_ms),
      peakRps: num(r.peak_rps),
      bands: [num(r.b0), num(r.b1), num(r.b2), num(r.b3), num(r.b4), num(r.b5), num(r.b6)],
    })
  }
  // Only the m5 view is fine-grained enough for the unflushed tail to matter.
  if (granularity === 'm5') for (const u of snapshotUnflushed()) put({ ...u })

  const endpoints = [...merged.values()]
    .map((a) => ({
      method: a.method,
      route: a.route,
      hits: a.hits,
      errors4xx: a.errors4xx,
      errors5xx: a.errors5xx,
      errorRate: a.hits ? Math.round(((a.errors4xx + a.errors5xx) / a.hits) * 1000) / 10 : 0,
      avgMs: a.hits ? Math.round(a.totalMs / a.hits) : 0,
      // Clamp to the real max — a histogram p95 is interpolated within a band
      // and can otherwise read higher than the actual slowest request on
      // low-traffic endpoints. The stored max_ms is exact, so it's the ceiling.
      p95Ms: Math.min(a.maxMs, percentile(a.bands, 0.95)),
      p99Ms: Math.min(a.maxMs, percentile(a.bands, 0.99)),
      maxMs: a.maxMs,
      peakRps: a.peakRps,
      totalMs: a.totalMs,
    }))
    .sort((x, y) => y.hits - x.hits)

  const totals = endpoints.reduce(
    (acc, e) => {
      acc.hits += e.hits
      acc.errors += e.errors4xx + e.errors5xx
      acc.totalMs += e.totalMs
      return acc
    },
    { hits: 0, errors: 0, totalMs: 0 },
  )

  return c.json({
    hours,
    granularity,
    since: since.toISOString(),
    totals: {
      hits: totals.hits,
      errors: totals.errors,
      errorRate: totals.hits ? Math.round((totals.errors / totals.hits) * 1000) / 10 : 0,
      avgMs: totals.hits ? Math.round(totals.totalMs / totals.hits) : 0,
      distinctRoutes: endpoints.length,
      avgPerHour: Math.round(totals.hits / hours),
    },
    endpoints: endpoints.slice(0, limit),
  })
})

// ─── GET /api/metrics/timeseries ─────────────────────────────────────────────
metricsRoutes.get('/timeseries', async (c) => {
  const hours = parseHours(c.req.query('hours'), 24)
  const granularity = pickGranularity(hours)
  const since = new Date(Date.now() - hours * 3600_000)
  const route = c.req.query('route')
  const method = c.req.query('method')

  const where: string[] = ['"granularity" = $1', '"bucket_start" >= $2']
  const params: unknown[] = [granularity, since]
  if (route) {
    params.push(route)
    where.push(`"route" = $${params.length}`)
  }
  if (method) {
    params.push(method)
    where.push(`"method" = $${params.length}`)
  }

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "bucket_start" AS t,
            SUM("hits")::bigint AS hits,
            SUM("errors_4xx" + "errors_5xx")::bigint AS errors,
            SUM("total_ms")::bigint AS total_ms
       FROM "api_usage_stats"
      WHERE ${where.join(' AND ')}
      GROUP BY 1
      ORDER BY 1 ASC`,
    ...params,
  )

  return c.json({
    hours,
    granularity,
    points: rows.map((r) => {
      const hits = num(r.hits)
      return {
        t: new Date(r.t as string).toISOString(),
        hits,
        errors: num(r.errors),
        avgMs: hits ? Math.round(num(r.total_ms) / hits) : 0,
      }
    }),
  })
})

// ─── GET /api/metrics/errors ─────────────────────────────────────────────────
// Error breakdown by HTTP status code. With ?route=&method= it drills into one
// endpoint (what the UI calls when you click an error count); without, it
// returns the whole error picture grouped by endpoint + status.
metricsRoutes.get('/errors', async (c) => {
  const hours = parseHours(c.req.query('hours'), 24)
  const granularity = pickGranularity(hours)
  const since = new Date(Date.now() - hours * 3600_000)
  const route = c.req.query('route')
  const method = c.req.query('method')

  const where: string[] = ['"granularity" = $1', '"bucket_start" >= $2']
  const params: unknown[] = [granularity, since]
  if (route) {
    params.push(route)
    where.push(`"route" = $${params.length}`)
  }
  if (method) {
    params.push(method)
    where.push(`"method" = $${params.length}`)
  }

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "method","route","status", SUM("count")::bigint AS count
       FROM "api_usage_status"
      WHERE ${where.join(' AND ')}
      GROUP BY 1, 2, 3`,
    ...params,
  )

  // Fold in errors still sitting in memory (only meaningful for the m5 window).
  const agg = new Map<string, { method: string; route: string; status: number; count: number }>()
  const put = (method_: string, route_: string, status: number, count: number) => {
    const k = `${method_}\t${route_}\t${status}`
    const cur = agg.get(k)
    if (cur) cur.count += count
    else agg.set(k, { method: method_, route: route_, status, count })
  }
  for (const r of rows) put(String(r.method), String(r.route), num(r.status), num(r.count))
  if (granularity === 'm5') {
    for (const u of snapshotUnflushedStatus()) {
      if (route && u.route !== route) continue
      if (method && u.method !== method) continue
      put(u.method, u.route, u.status, u.count)
    }
  }

  const all = [...agg.values()]

  // Group by endpoint so the UI can show "GET /api/x → 403×4, 500×2".
  const byEndpoint = new Map<
    string,
    { method: string; route: string; total: number; statuses: { status: number; count: number }[] }
  >()
  for (const r of all) {
    const k = `${r.method} ${r.route}`
    let e = byEndpoint.get(k)
    if (!e) {
      e = { method: r.method, route: r.route, total: 0, statuses: [] }
      byEndpoint.set(k, e)
    }
    e.total += r.count
    e.statuses.push({ status: r.status, count: r.count })
  }

  const endpoints = [...byEndpoint.values()]
    .map((e) => ({ ...e, statuses: e.statuses.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.total - a.total)

  // Overall distribution across every status code in the window.
  const byStatus = new Map<number, number>()
  for (const r of all) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + r.count)

  return c.json({
    hours,
    granularity,
    scope: route ? { method: method ?? null, route } : null,
    totalErrors: all.reduce((a, r) => a + r.count, 0),
    byStatus: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    endpoints,
  })
})

// ─── GET /api/metrics/callers ────────────────────────────────────────────────
// Who is generating the load. Day granularity on purpose — see the schema note.
metricsRoutes.get('/callers', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 7))
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 25))
  const since = new Date(Date.now() - days * 86_400_000)

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "tenant_id"          AS tenant_id,
            "user_id"            AS user_id,
            SUM("hits")::bigint  AS hits,
            SUM("errors")::bigint AS errors,
            SUM("total_ms")::bigint AS total_ms
       FROM "api_usage_user_daily"
      WHERE "day" >= $1::date
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT ${limit}`,
    since,
  )

  // Names live in each customer's own schema, so resolving them means one
  // lookup per customer present in the result — not one per row.
  const wanted = new Map<number, Set<number>>()
  for (const r of rows) {
    const tid = num(r.tenant_id)
    const uid = num(r.user_id)
    if (uid <= 0) continue
    if (!wanted.has(tid)) wanted.set(tid, new Set())
    wanted.get(tid)!.add(uid)
  }

  const names = new Map<string, { name: string; email: string | null; role: string | null }>()
  const tenantNames = new Map<number, string>()

  for (const [tenantId, ids] of wanted) {
    const ctx = tenantId ? await getTenantById(tenantId) : await getPrimaryTenant()
    if (!ctx) continue
    tenantNames.set(tenantId, ctx.companyName)

    try {
      const db = getTenantClient(ctx.schemaName)
      const users = await runWithTenant(ctx, () =>
        db.user.findMany({
          where: { id: { in: [...ids].map((id) => BigInt(id)) } },
          select: { id: true, name: true, email: true, role: true },
        }),
      )
      for (const u of users) {
        names.set(`${tenantId}:${Number(u.id)}`, {
          name: u.name,
          email: u.email,
          role: u.role,
        })
      }
    } catch (err) {
      // A customer whose schema is mid-migration or already deleted must not
      // take down the whole report — their rows just show as "User #n".
      console.error(`[metrics] could not resolve callers for tenant ${tenantId}:`, err)
    }
  }

  return c.json({
    days,
    callers: rows.map((r) => {
      const tenantId = num(r.tenant_id)
      const userId = num(r.user_id)
      const hits = num(r.hits)
      const u = names.get(`${tenantId}:${userId}`)
      return {
        tenantId,
        tenantName: tenantId === 0 ? null : tenantNames.get(tenantId) ?? `Customer #${tenantId}`,
        userId,
        name: userId === 0 ? 'Unauthenticated / public' : u?.name ?? `User #${userId}`,
        email: u?.email ?? null,
        role: u?.role ?? null,
        hits,
        errors: num(r.errors),
        avgMs: hits ? Math.round(num(r.total_ms) / hits) : 0,
      }
    }),
  })
})

// ─── GET /api/platform/metrics/customers ─────────────────────────────────────
// Request volume broken down BY CUSTOMER. The question a platform operator
// actually has — "who is hammering the API?" — which the per-user view could
// never answer once there was more than one company on the box.
metricsRoutes.get('/customers', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 7))
  const since = new Date(Date.now() - days * 86_400_000)

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "tenant_id"              AS tenant_id,
            SUM("hits")::bigint      AS hits,
            SUM("errors")::bigint    AS errors,
            SUM("total_ms")::bigint  AS total_ms,
            COUNT(DISTINCT "user_id")::int AS callers
       FROM "api_usage_user_daily"
      WHERE "day" >= $1::date
      GROUP BY 1
      ORDER BY 2 DESC`,
    since,
  )

  const tenants = await platformPrisma.tenant.findMany({
    select: { id: true, companyName: true, slug: true, planName: true },
  })
  const byId = new Map(tenants.map((t) => [t.id, t]))
  const grandTotal = rows.reduce((sum, r) => sum + num(r.hits), 0)

  return c.json({
    days,
    total: grandTotal,
    customers: rows.map((r) => {
      const tenantId = num(r.tenant_id)
      const hits = num(r.hits)
      const t = byId.get(tenantId)
      return {
        tenantId,
        name:
          tenantId === 0
            ? 'Unattributed (public API, pixels, failed auth)'
            : t?.companyName ?? `Deleted customer #${tenantId}`,
        slug: t?.slug ?? null,
        planName: t?.planName ?? null,
        hits,
        errors: num(r.errors),
        callers: Number(r.callers ?? 0),
        avgMs: hits ? Math.round(num(r.total_ms) / hits) : 0,
        // Share of all traffic in the window, for the bar in the UI.
        share: grandTotal ? Math.round((hits / grandTotal) * 1000) / 10 : 0,
      }
    }),
  })
})

// ─── GET /api/metrics/storage ────────────────────────────────────────────────
// What the tracking itself costs. Included so the "negligible overhead" claim
// stays verifiable rather than assumed.
metricsRoutes.get('/storage', async (c) => {
  const [sizes] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT pg_total_relation_size('api_usage_stats')      AS stats_bytes,
            pg_total_relation_size('api_usage_user_daily') AS user_bytes,
            pg_total_relation_size('api_usage_status')     AS status_bytes`,
  )

  const counts = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "granularity",
            COUNT(*)::bigint       AS rows,
            MIN("bucket_start")    AS oldest,
            MAX("bucket_start")    AS newest
       FROM "api_usage_stats"
      GROUP BY 1
      ORDER BY 1`,
  )

  const [userRows] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT COUNT(*)::bigint AS rows FROM "api_usage_user_daily"`,
  )

  return c.json({
    statsBytes: num(sizes?.stats_bytes),
    userDailyBytes: num(sizes?.user_bytes),
    statusBytes: num(sizes?.status_bytes),
    totalBytes: num(sizes?.stats_bytes) + num(sizes?.user_bytes) + num(sizes?.status_bytes),
    userDailyRows: num(userRows?.rows),
    byGranularity: counts.map((r) => ({
      granularity: String(r.granularity),
      rows: num(r.rows),
      oldest: r.oldest ? new Date(r.oldest as string).toISOString() : null,
      newest: r.newest ? new Date(r.newest as string).toISOString() : null,
    })),
    retention: {
      m5: '7 days',
      h1: '90 days',
      d1: 'forever',
      userDaily: '365 days',
    },
  })
})

// ─── POST /api/metrics/flush ─────────────────────────────────────────────────
// Force the in-memory buffer to disk. Useful right after deploying this, when
// you do not want to wait 5 minutes to confirm rows are landing.
metricsRoutes.post('/flush', async (c) => {
  const result = await flushNow(true)
  return c.json({ ok: true, ...result })
})

// ─── POST /api/metrics/rollup ────────────────────────────────────────────────
// Run the rollup + prune on demand. Idempotent; the daily timer calls the same
// function.
metricsRoutes.post('/rollup', async (c) => {
  const result = await rollupAndPrune()
  return c.json({ ok: true, ...result })
})
