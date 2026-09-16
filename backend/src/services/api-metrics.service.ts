import { prisma } from '../lib/prisma'
import { runAsPrimary } from './tenant-runner'

/**
 * API usage metrics — in-memory accumulation, pre-aggregated flush.
 *
 * The design constraint is that this must not add measurable load to a DB that
 * is already serving the app. So NOTHING here touches Postgres on the request
 * path: `record()` is a Map lookup plus a handful of integer adds. The DB only
 * sees a batched upsert once per 5-minute bucket, which means write volume is
 * fixed by the clock rather than by traffic — 10x the requests still costs the
 * same ~288 statements/day, the integers in the columns just get bigger.
 *
 * Layers:
 *   0. RAM     — current bucket + a 60-slot per-second ring for the live view
 *   1. m5 rows — flushed every bucket, kept 7 days
 *   2. h1 / d1 — recomputed from m5 / h1 by the daily rollup, pruned on a
 *                schedule (see rollupAndPrune)
 */

// ─── Tunables ────────────────────────────────────────────────────────────────

const BUCKET_MS = 5 * 60_000
const FLUSH_INTERVAL_MS = 60_000
/** Distinct method+route keys held in one bucket before overflowing to __other__. */
const MAX_KEYS = 2000
/** Distinct users tracked per day-buffer before overflowing to userId 0. */
const MAX_USER_KEYS = 5000
/** Buckets held in memory when the DB is unreachable, before dropping the oldest. */
const MAX_PENDING_BUCKETS = 24
const LIVE_SECONDS = 60

// Persistent tracking window (IST). Outside these hours the DB-bound counters
// are not accumulated at all, so no rows are ever written for off-hours traffic
// — the live RAM view still works round the clock because it costs nothing.
// Override with METRICS_TRACK_START_HOUR / METRICS_TRACK_END_HOUR (0 = always).
const IST_OFFSET_MS = 5.5 * 3600_000
const TRACK_START_HOUR = Number(process.env.METRICS_TRACK_START_HOUR ?? 9)
const TRACK_END_HOUR = Number(process.env.METRICS_TRACK_END_HOUR ?? 20)

/** True when `now` falls inside the persistent-tracking window, in IST. */
export function withinTrackingWindow(now: number): boolean {
  if (TRACK_START_HOUR === 0 && TRACK_END_HOUR === 0) return true
  const istHour = new Date(now + IST_OFFSET_MS).getUTCHours()
  return istHour >= TRACK_START_HOUR && istHour < TRACK_END_HOUR
}

export const TRACKING_WINDOW = { startHour: TRACK_START_HOUR, endHour: TRACK_END_HOUR, tz: 'IST' }

// Admin kill switch, persisted in system_settings so it survives restarts.
// Distinct from the business-hours window: this is a hard on/off the admin
// controls from the UI. When off, record() does nothing at all.
const SETTING_KEY_ENABLED = 'api_metrics.enabled'
let trackingEnabled = true

export function isTrackingEnabled(): boolean {
  return trackingEnabled
}

/** Hydrate the kill switch from the DB at boot. Defaults to on if unset. */
export async function loadTrackingEnabled(): Promise<void> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY_ENABLED } })
    if (row) trackingEnabled = row.value === 'true'
  } catch (err) {
    console.error('[api-metrics] failed to load enabled flag', err)
  }
}

/** Flip the kill switch and persist it. Flushes the buffer when turning off. */
export async function setTrackingEnabled(value: boolean): Promise<void> {
  const was = trackingEnabled
  trackingEnabled = value
  // When switching off, drain whatever is buffered so no in-window counts are
  // silently discarded by the stop.
  if (was && !value) await flushNow(true).catch((err) => console.error('[api-metrics] stop flush', err))
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_ENABLED },
    update: { value: String(value) },
    create: { key: SETTING_KEY_ENABLED, value: String(value) },
  })
  console.log(`[api-metrics] tracking ${value ? 'ENABLED' : 'DISABLED'} by admin`)
}

const RETAIN_M5_DAYS = 7
const RETAIN_H1_DAYS = 90
const RETAIN_USER_DAILY_DAYS = 365
/** Delete batch size — big deletes take long locks and dump bloat on autovacuum. */
const DELETE_CHUNK = 10_000

/**
 * Latency histogram band upper bounds in ms; a 7th open-ended band catches the
 * rest. Bands are stored as counts and summed on rollup, which is what makes
 * percentiles computable over any time range — a stored p95 could not be
 * re-aggregated.
 */
export const BAND_BOUNDS = [50, 100, 250, 500, 1000, 2500]
export const BAND_COUNT = BAND_BOUNDS.length + 1

function bandIndex(ms: number): number {
  for (let i = 0; i < BAND_BOUNDS.length; i++) if (ms <= BAND_BOUNDS[i]) return i
  return BAND_BOUNDS.length
}

// ─── Route normalisation ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_RE = /^[0-9a-f]{24,}$/i

/**
 * Collapse a raw request path into a stable route pattern.
 *
 * This is the most important function in the file. Keying on raw paths would
 * make the table unbounded — `/api/leads/8321` and `/api/leads/8322` are
 * different strings, and a few weeks of traffic would produce millions of
 * distinct rows and no usable aggregate. Used only as a fallback; when Hono can
 * tell us the matched route pattern we prefer that (see middleware).
 */
export function normalizeRoute(rawPath: string): string {
  // Query strings never belong in the key — ?page=2&search=foo is an infinite
  // key generator on its own.
  const path = rawPath.split('?')[0]
  const out = path
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (/^\d+$/.test(seg)) return ':id'
      if (UUID_RE.test(seg)) return ':uuid'
      if (HEX_RE.test(seg)) return ':hash'
      if (seg.includes('@')) return ':email'
      // Long opaque segments are almost always tokens or generated filenames.
      if (seg.length > 40) return ':token'
      return seg
    })
    .join('/')
  return out.length > 180 ? out.slice(0, 180) : out
}

// ─── In-memory state ─────────────────────────────────────────────────────────

interface Stat {
  hits: number
  e4: number
  e5: number
  totalMs: number
  maxMs: number
  bands: number[]
  // Peak requests/second within the bucket, tracked live: curSec is the second
  // currently being counted, curCount its running tally, peakRps the max seen.
  curSec: number
  curCount: number
  peakRps: number
}

interface UserStat {
  hits: number
  errors: number
  totalMs: number
}

function emptyStat(): Stat {
  return {
    hits: 0,
    e4: 0,
    e5: 0,
    totalMs: 0,
    maxMs: 0,
    bands: new Array(BAND_COUNT).fill(0),
    curSec: 0,
    curCount: 0,
    peakRps: 0,
  }
}

function bucketOf(ts: number): number {
  return Math.floor(ts / BUCKET_MS) * BUCKET_MS
}

function dayKeyOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

const OVERFLOW_KEY = 'OTHER __other__'

// Error responses only, keyed `method\troute\tstatus` → count. Populated
// alongside `store`; travels with the same pending buckets so it flushes in
// lockstep. Kept separate from Stat so a 200-heavy endpoint costs nothing here.
let statusStore = new Map<string, number>()

interface PendingBucket {
  bucketStart: number
  store: Map<string, Stat>
  statusStore: Map<string, number>
}

let bucketStart = bucketOf(Date.now())
let store = new Map<string, Stat>()
const pending: PendingBucket[] = []

let userDay = dayKeyOf(Date.now())
// Keyed "<tenantId>:<userId>". API usage is a platform-wide view, and user id 5
// is a different person at every customer — a bare user id would merge them.
let userStore = new Map<string, UserStat>()
const pendingUsers: { day: string; store: Map<string, UserStat> }[] = []

// Per-second ring for the live view. Answers "what is hitting me right now" at
// 1-second resolution without ever writing a row — which is the honest place
// for second-granularity data. Persisting it would be ~13M rows/day.
const liveStamp = new Array<number>(LIVE_SECONDS).fill(0)
const liveHits = new Array<number>(LIVE_SECONDS).fill(0)
const liveErrs = new Array<number>(LIVE_SECONDS).fill(0)

let bootedAt = Date.now()
let totalSinceBoot = 0
let droppedBuckets = 0

// ─── Recording (request path — must stay allocation-light) ───────────────────

export interface RecordInput {
  method: string
  route: string
  status: number
  durationMs: number
  userId?: number | null
  /** Which customer the caller belongs to. 0/undefined = unattributed. */
  tenantId?: number | null
}

export function record({ method, route, status, durationMs, userId, tenantId }: RecordInput): void {
  // Admin kill switch — a hard stop. Nothing is recorded, not even the live ring.
  if (!trackingEnabled) return
  const now = Date.now()
  rollIfNeeded(now)

  const ms = durationMs < 0 ? 0 : durationMs
  const isErr = status >= 400

  // ── per-second ring ──
  const sec = Math.floor(now / 1000)
  const slot = sec % LIVE_SECONDS
  if (liveStamp[slot] !== sec) {
    liveStamp[slot] = sec
    liveHits[slot] = 0
    liveErrs[slot] = 0
  }
  liveHits[slot]++
  if (isErr) liveErrs[slot]++
  totalSinceBoot++

  // Off-hours: the live ring above is updated (it's free), but nothing below is
  // accumulated — so no DB rows are ever written for traffic outside the window.
  if (!withinTrackingWindow(now)) return

  // ── endpoint counters ──
  const key = `${method} ${route}`
  let s = store.get(key)
  if (!s) {
    // Cardinality guard. Without it, a scanner spraying random URLs — or a route
    // shape the normaliser misses — could blow this table up 100x.
    if (store.size >= MAX_KEYS) {
      s = store.get(OVERFLOW_KEY)
      if (!s) {
        s = emptyStat()
        store.set(OVERFLOW_KEY, s)
      }
    } else {
      s = emptyStat()
      store.set(key, s)
    }
  }
  s.hits++
  s.totalMs += ms
  if (ms > s.maxMs) s.maxMs = ms
  s.bands[bandIndex(ms)]++
  if (status >= 500) s.e5++
  else if (status >= 400) s.e4++

  // Peak requests/second for this endpoint. Reset the running count when the
  // wall-clock second advances, then track the high-water mark.
  if (s.curSec !== sec) {
    s.curSec = sec
    s.curCount = 0
  }
  s.curCount++
  if (s.curCount > s.peakRps) s.peakRps = s.curCount

  // Error-only status breakdown for the drilldown. 2xx/3xx are the common case
  // and need no explanation, so they're never stored here.
  if (status >= 400) {
    const skey = `${method}\t${route}\t${status}`
    statusStore.set(skey, (statusStore.get(skey) ?? 0) + 1)
  }

  // ── per-caller daily counters ──
  let ukey = `${tenantId ?? 0}:${userId ?? 0}`
  // Cardinality guard: overflow collapses into the unattributed bucket rather
  // than growing the map without bound.
  if (!userStore.has(ukey) && userStore.size >= MAX_USER_KEYS) ukey = '0:0'
  let u = userStore.get(ukey)
  if (!u) {
    u = { hits: 0, errors: 0, totalMs: 0 }
    userStore.set(ukey, u)
  }
  u.hits++
  u.totalMs += ms
  if (isErr) u.errors++
}

/**
 * Swap the live buffers out when the clock crosses a bucket/day boundary, so
 * counts never smear across two buckets. Cheap enough to run per request — an
 * integer division and a compare.
 */
function rollIfNeeded(now: number): void {
  const b = bucketOf(now)
  if (b !== bucketStart) {
    if (store.size > 0 || statusStore.size > 0) {
      pending.push({ bucketStart, store, statusStore })
      while (pending.length > MAX_PENDING_BUCKETS) {
        pending.shift()
        droppedBuckets++
      }
    }
    store = new Map()
    statusStore = new Map()
    bucketStart = b
  }

  const d = dayKeyOf(now)
  if (d !== userDay) {
    if (userStore.size > 0) {
      pendingUsers.push({ day: userDay, store: userStore })
      while (pendingUsers.length > MAX_PENDING_BUCKETS) pendingUsers.shift()
    }
    userStore = new Map()
    userDay = d
  }
}

// ─── Live snapshot (RAM only, zero DB) ───────────────────────────────────────

export interface LiveTopRow {
  method: string
  route: string
  hits: number
  avgMs: number
  maxMs: number
  peakRps: number
  errors: number
}

export interface LiveSnapshot {
  perSecond: { t: number; hits: number; errors: number }[]
  reqPerSec: number
  peakPerSec: number
  totalSinceBoot: number
  uptimeSec: number
  trackedRoutes: number
  pendingBuckets: number
  droppedBuckets: number
  currentBucketStart: string
  top: LiveTopRow[]
}

export function snapshotLive(topN = 20): LiveSnapshot {
  const nowSec = Math.floor(Date.now() / 1000)
  const perSecond: { t: number; hits: number; errors: number }[] = []
  let sum = 0
  let peak = 0
  // Walk oldest → newest, skipping the current (incomplete) second. A slot whose
  // stamp is stale means that second genuinely had no traffic, not missing data.
  for (let i = LIVE_SECONDS - 1; i >= 1; i--) {
    const sec = nowSec - i
    const slot = ((sec % LIVE_SECONDS) + LIVE_SECONDS) % LIVE_SECONDS
    const fresh = liveStamp[slot] === sec
    const hits = fresh ? liveHits[slot] : 0
    const errors = fresh ? liveErrs[slot] : 0
    perSecond.push({ t: sec * 1000, hits, errors })
    sum += hits
    if (hits > peak) peak = hits
  }

  const top: LiveTopRow[] = [...store.entries()]
    .map(([key, s]) => {
      const sp = key.indexOf(' ')
      return {
        method: key.slice(0, sp),
        route: key.slice(sp + 1),
        hits: s.hits,
        avgMs: s.hits ? Math.round(s.totalMs / s.hits) : 0,
        maxMs: s.maxMs,
        peakRps: s.peakRps,
        errors: s.e4 + s.e5,
      }
    })
    .sort((a, b) => b.hits - a.hits)
    .slice(0, topN)

  return {
    perSecond,
    reqPerSec: Math.round((sum / (LIVE_SECONDS - 1)) * 10) / 10,
    peakPerSec: peak,
    totalSinceBoot,
    uptimeSec: Math.round((Date.now() - bootedAt) / 1000),
    trackedRoutes: store.size,
    pendingBuckets: pending.length,
    droppedBuckets,
    currentBucketStart: new Date(bucketStart).toISOString(),
    top,
  }
}

export interface UnflushedRow {
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

/**
 * The not-yet-flushed counters, shaped like DB rows. Merged into summary
 * responses so the dashboard reflects the last few minutes instead of lagging
 * a whole bucket behind.
 */
export function snapshotUnflushed(): UnflushedRow[] {
  const rows: UnflushedRow[] = []
  const merge = (m: Map<string, Stat>) => {
    for (const [key, s] of m) {
      const sp = key.indexOf(' ')
      rows.push({
        method: key.slice(0, sp),
        route: key.slice(sp + 1),
        hits: s.hits,
        errors4xx: s.e4,
        errors5xx: s.e5,
        totalMs: s.totalMs,
        maxMs: s.maxMs,
        peakRps: s.peakRps,
        bands: [...s.bands],
      })
    }
  }
  for (const p of pending) merge(p.store)
  merge(store)
  return rows
}

/** Not-yet-flushed error counts by status, shaped like api_usage_status rows. */
export function snapshotUnflushedStatus(): {
  method: string
  route: string
  status: number
  count: number
}[] {
  const out: ReturnType<typeof snapshotUnflushedStatus> = []
  const merge = (m: Map<string, number>) => {
    for (const [key, count] of m) {
      const [method, route, status] = key.split('\t')
      out.push({ method, route, status: Number(status), count })
    }
  }
  for (const p of pending) merge(p.statusStore)
  merge(statusStore)
  return out
}

/** Per-second series only — cheap enough to poll every couple of seconds. */
export function unflushedSince(fromMs: number): boolean {
  return bucketStart + BUCKET_MS > fromMs
}

// ─── Flush ───────────────────────────────────────────────────────────────────

const STAT_COLS = [
  'granularity',
  'bucket_start',
  'method',
  'route',
  'hits',
  'errors_4xx',
  'errors_5xx',
  'total_ms',
  'max_ms',
  'ms50',
  'ms100',
  'ms250',
  'ms500',
  'ms1000',
  'ms2500',
  'ms_inf',
  'peak_rps',
]

interface StatRow {
  bucketStart: Date
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

/**
 * One statement per flush, not one per row. Prisma has no bulk upsert, so this
 * builds a parameterised multi-row INSERT ... ON CONFLICT DO UPDATE by hand.
 * The `+ EXCLUDED` accumulation is what lets a second PM2 worker (or a retried
 * flush) merge into an existing bucket instead of clobbering it.
 */
async function upsertStatRows(granularity: string, rows: StatRow[]): Promise<void> {
  if (rows.length === 0) return

  const CHUNK = 500
  for (let off = 0; off < rows.length; off += CHUNK) {
    const slice = rows.slice(off, off + CHUNK)
    const params: unknown[] = []
    const tuples: string[] = []

    for (const r of slice) {
      const base = params.length
      params.push(
        granularity,
        r.bucketStart,
        r.method,
        r.route,
        r.hits,
        r.errors4xx,
        r.errors5xx,
        r.totalMs,
        r.maxMs,
        ...r.bands,
        r.peakRps,
      )
      tuples.push(`(${STAT_COLS.map((_, i) => `$${base + i + 1}`).join(',')})`)
    }

    const sql = `
      INSERT INTO "api_usage_stats" (${STAT_COLS.map((c) => `"${c}"`).join(',')})
      VALUES ${tuples.join(',')}
      ON CONFLICT ("granularity","bucket_start","method","route") DO UPDATE SET
        "hits"       = "api_usage_stats"."hits"       + EXCLUDED."hits",
        "errors_4xx" = "api_usage_stats"."errors_4xx" + EXCLUDED."errors_4xx",
        "errors_5xx" = "api_usage_stats"."errors_5xx" + EXCLUDED."errors_5xx",
        "total_ms"   = "api_usage_stats"."total_ms"   + EXCLUDED."total_ms",
        "max_ms"     = GREATEST("api_usage_stats"."max_ms", EXCLUDED."max_ms"),
        "ms50"       = "api_usage_stats"."ms50"   + EXCLUDED."ms50",
        "ms100"      = "api_usage_stats"."ms100"  + EXCLUDED."ms100",
        "ms250"      = "api_usage_stats"."ms250"  + EXCLUDED."ms250",
        "ms500"      = "api_usage_stats"."ms500"  + EXCLUDED."ms500",
        "ms1000"     = "api_usage_stats"."ms1000" + EXCLUDED."ms1000",
        "ms2500"     = "api_usage_stats"."ms2500" + EXCLUDED."ms2500",
        "ms_inf"     = "api_usage_stats"."ms_inf" + EXCLUDED."ms_inf",
        "peak_rps"   = GREATEST("api_usage_stats"."peak_rps", EXCLUDED."peak_rps")
    `
    await prisma.$executeRawUnsafe(sql, ...params)
  }
}

/** Upsert error-status counts (accumulating), mirroring upsertStatRows. */
async function upsertStatusRows(
  granularity: string,
  rows: { bucketStart: Date; method: string; route: string; status: number; count: number }[],
): Promise<void> {
  if (rows.length === 0) return
  const CHUNK = 500
  for (let off = 0; off < rows.length; off += CHUNK) {
    const slice = rows.slice(off, off + CHUNK)
    const params: unknown[] = []
    const tuples: string[] = []
    for (const r of slice) {
      const base = params.length
      params.push(granularity, r.bucketStart, r.method, r.route, r.status, r.count)
      tuples.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`,
      )
    }
    const sql = `
      INSERT INTO "api_usage_status"
        ("granularity","bucket_start","method","route","status","count")
      VALUES ${tuples.join(',')}
      ON CONFLICT ("granularity","bucket_start","method","route","status") DO UPDATE SET
        "count" = "api_usage_status"."count" + EXCLUDED."count"
    `
    await prisma.$executeRawUnsafe(sql, ...params)
  }
}

async function upsertUserRows(day: string, entries: [string, UserStat][]): Promise<void> {
  if (entries.length === 0) return
  const CHUNK = 500
  for (let off = 0; off < entries.length; off += CHUNK) {
    const slice = entries.slice(off, off + CHUNK)
    const params: unknown[] = []
    const tuples: string[] = []
    for (const [ukey, s] of slice) {
      const sep = ukey.indexOf(':')
      const tenantId = Number(ukey.slice(0, sep)) || 0
      const uid = Number(ukey.slice(sep + 1)) || 0
      const base = params.length
      params.push(day, tenantId, uid, s.hits, s.errors, s.totalMs)
      tuples.push(
        `($${base + 1}::date,$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`,
      )
    }
    const sql = `
      INSERT INTO "api_usage_user_daily" ("day","tenant_id","user_id","hits","errors","total_ms")
      VALUES ${tuples.join(',')}
      ON CONFLICT ("day","tenant_id","user_id") DO UPDATE SET
        "hits"     = "api_usage_user_daily"."hits"     + EXCLUDED."hits",
        "errors"   = "api_usage_user_daily"."errors"   + EXCLUDED."errors",
        "total_ms" = "api_usage_user_daily"."total_ms" + EXCLUDED."total_ms"
    `
    await prisma.$executeRawUnsafe(sql, ...params)
  }
}

let flushing = false

/**
 * Drain every sealed bucket to Postgres. Safe to call concurrently — the guard
 * makes an overlapping call a no-op rather than a double write.
 *
 * @param force also seal the in-progress bucket (used on shutdown)
 */
export async function flushNow(force = false): Promise<{ buckets: number; rows: number }> {
  if (flushing) return { buckets: 0, rows: 0 }
  flushing = true
  try {
    rollIfNeeded(Date.now())

    if (force && (store.size > 0 || statusStore.size > 0)) {
      pending.push({ bucketStart, store, statusStore })
      store = new Map()
      statusStore = new Map()
    }
    if (force && userStore.size > 0) {
      pendingUsers.push({ day: userDay, store: userStore })
      userStore = new Map()
    }

    let buckets = 0
    let rowCount = 0

    while (pending.length > 0) {
      const batch = pending[0]
      const rows: StatRow[] = [...batch.store.entries()].map(([key, s]) => {
        const sp = key.indexOf(' ')
        return {
          bucketStart: new Date(batch.bucketStart),
          method: key.slice(0, sp),
          route: key.slice(sp + 1),
          hits: s.hits,
          errors4xx: s.e4,
          errors5xx: s.e5,
          totalMs: s.totalMs,
          maxMs: s.maxMs,
          peakRps: s.peakRps,
          bands: s.bands,
        }
      })
      const statusRows = [...batch.statusStore.entries()].map(([key, count]) => {
        const [method, route, status] = key.split('\t')
        return {
          bucketStart: new Date(batch.bucketStart),
          method,
          route,
          status: Number(status),
          count,
        }
      })
      // Only shift after both writes land — a failed flush keeps the bucket in
      // memory and retries on the next tick instead of losing it.
      await upsertStatRows('m5', rows)
      await upsertStatusRows('m5', statusRows)
      pending.shift()
      buckets++
      rowCount += rows.length
    }

    while (pendingUsers.length > 0) {
      const batch = pendingUsers[0]
      await upsertUserRows(batch.day, [...batch.store.entries()])
      pendingUsers.shift()
    }

    return { buckets, rows: rowCount }
  } finally {
    flushing = false
  }
}

// ─── Rollup + retention ──────────────────────────────────────────────────────

const ROLLUP_SET_CLAUSE = `
  "hits" = EXCLUDED."hits", "errors_4xx" = EXCLUDED."errors_4xx",
  "errors_5xx" = EXCLUDED."errors_5xx", "total_ms" = EXCLUDED."total_ms",
  "max_ms" = EXCLUDED."max_ms",
  "ms50" = EXCLUDED."ms50", "ms100" = EXCLUDED."ms100", "ms250" = EXCLUDED."ms250",
  "ms500" = EXCLUDED."ms500", "ms1000" = EXCLUDED."ms1000",
  "ms2500" = EXCLUDED."ms2500", "ms_inf" = EXCLUDED."ms_inf",
  "peak_rps" = EXCLUDED."peak_rps"
`

function rollupSql(target: string, source: string, unit: string, window: string): string {
  return `
    INSERT INTO "api_usage_stats" (
      "granularity","bucket_start","method","route","hits","errors_4xx","errors_5xx",
      "total_ms","max_ms","ms50","ms100","ms250","ms500","ms1000","ms2500","ms_inf","peak_rps"
    )
    SELECT '${target}', date_trunc('${unit}', "bucket_start"), "method", "route",
           SUM("hits")::int, SUM("errors_4xx")::int, SUM("errors_5xx")::int,
           SUM("total_ms")::bigint, MAX("max_ms")::int,
           SUM("ms50")::int, SUM("ms100")::int, SUM("ms250")::int, SUM("ms500")::int,
           SUM("ms1000")::int, SUM("ms2500")::int, SUM("ms_inf")::int,
           MAX("peak_rps")::int
      FROM "api_usage_stats"
     WHERE "granularity" = '${source}'
       AND "bucket_start" >= now() - interval '${window}'
       AND "bucket_start" <  date_trunc('${unit}', now())
     GROUP BY 2, 3, 4
    ON CONFLICT ("granularity","bucket_start","method","route")
    DO UPDATE SET ${ROLLUP_SET_CLAUSE}
  `
}

/** Same idempotent recompute shape, for the error-status table. */
function statusRollupSql(target: string, source: string, unit: string, window: string): string {
  return `
    INSERT INTO "api_usage_status" (
      "granularity","bucket_start","method","route","status","count"
    )
    SELECT '${target}', date_trunc('${unit}', "bucket_start"), "method", "route", "status",
           SUM("count")::int
      FROM "api_usage_status"
     WHERE "granularity" = '${source}'
       AND "bucket_start" >= now() - interval '${window}'
       AND "bucket_start" <  date_trunc('${unit}', now())
     GROUP BY 2, 3, 4, 5
    ON CONFLICT ("granularity","bucket_start","method","route","status")
    DO UPDATE SET "count" = EXCLUDED."count"
  `
}

/**
 * Recompute h1 from m5 and d1 from h1, then prune.
 *
 * Both rollups are idempotent recomputes (SET =, not +=) over a small recent
 * window, so a re-run or an overlapping run cannot double-count. Only recent
 * windows are touched: older data is already final, and recomputing a period
 * whose source rows had been pruned would zero it out.
 */
export async function rollupAndPrune(): Promise<{
  hourlyRows: number
  dailyRows: number
  prunedM5: number
  prunedH1: number
  prunedUsers: number
}> {
  const hourlyRows = await prisma.$executeRawUnsafe(rollupSql('h1', 'm5', 'hour', '48 hours'))
  const dailyRows = await prisma.$executeRawUnsafe(rollupSql('d1', 'h1', 'day', '7 days'))

  await prisma.$executeRawUnsafe(statusRollupSql('h1', 'm5', 'hour', '48 hours'))
  await prisma.$executeRawUnsafe(statusRollupSql('d1', 'h1', 'day', '7 days'))

  const prunedM5 = await pruneChunked('m5', RETAIN_M5_DAYS)
  const prunedH1 = await pruneChunked('h1', RETAIN_H1_DAYS)
  await pruneStatusChunked('m5', RETAIN_M5_DAYS)
  await pruneStatusChunked('h1', RETAIN_H1_DAYS)

  let prunedUsers = 0
  for (;;) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "api_usage_user_daily" WHERE "ctid" IN (
         SELECT "ctid" FROM "api_usage_user_daily"
          WHERE "day" < (now() - interval '${RETAIN_USER_DAILY_DAYS} days')::date
          LIMIT ${DELETE_CHUNK})`,
    )
    prunedUsers += n
    if (n < DELETE_CHUNK) break
  }

  console.log(
    `[api-metrics] rollup: ${hourlyRows} hourly, ${dailyRows} daily; ` +
      `pruned ${prunedM5} m5 / ${prunedH1} h1 / ${prunedUsers} user rows`,
  )
  return { hourlyRows, dailyRows, prunedM5, prunedH1, prunedUsers }
}

/**
 * Chunked delete. A single unbounded DELETE would hold a long lock and hand
 * autovacuum a bloat spike; 10k at a time keeps both bounded.
 */
async function pruneChunked(granularity: string, days: number): Promise<number> {
  let total = 0
  for (;;) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "api_usage_stats" WHERE "ctid" IN (
         SELECT "ctid" FROM "api_usage_stats"
          WHERE "granularity" = $1 AND "bucket_start" < now() - interval '${days} days'
          LIMIT ${DELETE_CHUNK})`,
      granularity,
    )
    total += n
    if (n < DELETE_CHUNK) break
  }
  return total
}

async function pruneStatusChunked(granularity: string, days: number): Promise<number> {
  let total = 0
  for (;;) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "api_usage_status" WHERE "ctid" IN (
         SELECT "ctid" FROM "api_usage_status"
          WHERE "granularity" = $1 AND "bucket_start" < now() - interval '${days} days'
          LIMIT ${DELETE_CHUNK})`,
      granularity,
    )
    total += n
    if (n < DELETE_CHUNK) break
  }
  return total
}

// ─── Schedulers ──────────────────────────────────────────────────────────────

let flushTimer: NodeJS.Timeout | null = null
let rollupTimer: NodeJS.Timeout | null = null
let shutdownHooked = false

export function startApiMetrics(): void {
  if (flushTimer) return
  bootedAt = Date.now()

  // Restore the admin kill switch from the DB before the first flush.
  runAsPrimary(() => loadTrackingEnabled()).catch((err) =>
    console.error('[api-metrics] loadTrackingEnabled', err),
  )

  // The accumulator is one global buffer, so it can only be attributed to one
  // schema — the original install's. See middleware/api-metrics.ts, which stops
  // other customers' traffic entering the buffer at all.
  flushTimer = setInterval(() => {
    runAsPrimary(() => flushNow()).catch((err) => console.error('[api-metrics] flush failed', err))
  }, FLUSH_INTERVAL_MS)
  flushTimer.unref?.()

  // First rollup 5 min after boot (so a restart loop does not hammer it), then daily.
  setTimeout(() => {
    runAsPrimary(() => rollupAndPrune()).catch((err) => console.error('[api-metrics] rollup failed', err))
  }, 5 * 60_000).unref?.()

  rollupTimer = setInterval(() => {
    runAsPrimary(() => rollupAndPrune()).catch((err) => console.error('[api-metrics] rollup failed', err))
  }, 24 * 60 * 60_000)
  rollupTimer.unref?.()

  if (!shutdownHooked) {
    shutdownHooked = true
    // Without this, every `pm2 restart` silently drops up to 5 minutes of counts.
    const onExit = (code: number) => {
      runAsPrimary(() => flushNow(true))
        .catch((err) => console.error('[api-metrics] shutdown flush failed', err))
        .finally(() => process.exit(code))
    }
    process.once('SIGTERM', () => onExit(143))
    process.once('SIGINT', () => onExit(130))
  }

  console.log(
    `[api-metrics] tracking started — ${BUCKET_MS / 60_000}min buckets, ` +
      `flush every ${FLUSH_INTERVAL_MS / 1000}s`,
  )
}
