/**
 * Self-check for the API usage metrics pipeline. Runs entirely in-process with
 * no database — it drives a throwaway Hono app through the real middleware and
 * asserts on what the accumulator recorded.
 *
 * Run with:  npm run metrics:check
 *
 * The assertions that matter are the cardinality ones: they are what stops the
 * api_usage_stats table from growing without bound. If someone changes the
 * normaliser or the route-matching heuristic, this is what catches it.
 */
// Force the persistent-tracking window fully open BEFORE the service module is
// evaluated (it reads these at load time) so this test is clock-independent —
// otherwise it would fail whenever run outside 9am–8pm IST.
process.env.METRICS_TRACK_START_HOUR = '0'
process.env.METRICS_TRACK_END_HOUR = '0'

import { Hono } from 'hono'
// The service/middleware are imported dynamically inside main() (after the env
// above is set) — static imports would hoist above the assignments and defeat
// the override, and a top-level await isn't available under tsx's CJS output.

let failures = 0

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`),
  )
}

// Mirrors the percentile helper in metrics.routes.ts.
const BOUNDS = [0, 50, 100, 250, 500, 1000, 2500, Infinity]
function percentile(bands: number[], p: number): number {
  const total = bands.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const target = total * p
  let cum = 0
  for (let i = 0; i < bands.length; i++) {
    const next = cum + bands[i]
    if (next >= target) {
      const lo = BOUNDS[i]
      const hi = BOUNDS[i + 1]
      if (!Number.isFinite(hi)) return lo
      const within = bands[i] > 0 ? (target - cum) / bands[i] : 0
      return Math.round(lo + (hi - lo) * within)
    }
    cum = next
  }
  return BOUNDS[BOUNDS.length - 2]
}

async function main(): Promise<void> {
  const { apiMetrics } = await import('../src/middleware/api-metrics')
  const { normalizeRoute, snapshotLive, snapshotUnflushed, snapshotUnflushedStatus } = await import(
    '../src/services/api-metrics.service'
  )

  console.log('\n── route normaliser ──')
  check('numeric id', normalizeRoute('/api/leads/8321'), '/api/leads/:id')
  check('nested ids', normalizeRoute('/api/leads/8321/notes/44'), '/api/leads/:id/notes/:id')
  check('query string stripped', normalizeRoute('/api/leads?page=2&search=foo'), '/api/leads')
  check('uuid', normalizeRoute('/api/x/3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '/api/x/:uuid')
  check('email segment', normalizeRoute('/api/users/a@b.com'), '/api/users/:email')
  check('long hex', normalizeRoute('/api/t/507f1f77bcf86cd799439011abcd'), '/api/t/:hash')
  check('plain path untouched', normalizeRoute('/api/dashboard/stats'), '/api/dashboard/stats')

  console.log('\n── middleware through a mounted sub-app (mirrors app.ts) ──')
  const child = new Hono()
  child.use('*', async (_c, n) => { await n() }) // stands in for authenticate
  child.get('/leads', (c) => c.json({ ok: true }))
  child.get('/leads/:id', (c) => c.json({ ok: true }))
  child.post('/leads/:id/notes', (c) => c.json({ ok: true }, 201))
  child.get('/boom', (c) => c.json({ e: 1 }, 500))
  child.get('/nope', (c) => c.json({ e: 1 }, 403))

  const app = new Hono()
  app.use('*', apiMetrics())
  app.route('/api', child)
  app.notFound((c) => c.json({ error: 'Not found' }, 404))

  const hit = async (method: string, path: string, times = 1) => {
    for (let i = 0; i < times; i++) await app.fetch(new Request(`http://x${path}`, { method }))
  }

  await hit('GET', '/api/leads', 3)
  await hit('GET', '/api/leads/8321', 5)
  await hit('GET', '/api/leads/99999', 4) // must merge with the line above
  await hit('POST', '/api/leads/7/notes', 2)
  await hit('GET', '/api/boom', 1)
  await hit('GET', '/api/nope', 1)
  await hit('GET', '/totally/made/up/1234', 6) // must all collapse into __404__
  await hit('GET', '/another/bogus/path', 3)

  const rows = snapshotUnflushed().sort((a, b) =>
    `${a.method} ${a.route}`.localeCompare(`${b.method} ${b.route}`),
  )
  console.log('\n  accumulated rows:')
  for (const r of rows) {
    console.log(
      `    ${r.method.padEnd(5)} ${r.route.padEnd(26)} hits=${String(r.hits).padStart(2)}` +
        `  4xx=${r.errors4xx}  5xx=${r.errors5xx}  bands=[${r.bands.join(',')}]`,
    )
  }
  console.log()

  const byKey = new Map(rows.map((r) => [`${r.method} ${r.route}`, r]))
  check('static route counted', byKey.get('GET /api/leads')?.hits, 3)
  check('param route merged into ONE key', byKey.get('GET /api/leads/:id')?.hits, 9)
  check('nested param route', byKey.get('POST /api/leads/:id/notes')?.hits, 2)
  check('5xx counted separately', byKey.get('GET /api/boom')?.errors5xx, 1)
  check('4xx counted separately', byKey.get('GET /api/nope')?.errors4xx, 1)
  check('unmatched paths collapse to __404__', byKey.get('GET __404__')?.hits, 9)
  check('no raw ids leaked into keys', rows.filter((r) => /\/\d+/.test(r.route)).length, 0)
  check('total distinct keys stays bounded', rows.length, 6)

  console.log('\n── error status breakdown ──')
  const status = snapshotUnflushedStatus().sort((a, b) =>
    `${a.route} ${a.status}`.localeCompare(`${b.route} ${b.status}`),
  )
  for (const s of status) console.log(`    ${s.method} ${s.route.padEnd(22)} ${s.status} ×${s.count}`)
  const s500 = status.find((s) => s.route === '/api/boom' && s.status === 500)
  const s403 = status.find((s) => s.route === '/api/nope' && s.status === 403)
  check('500 recorded in status store', s500?.count, 1)
  check('403 recorded in status store', s403?.count, 1)
  check('2xx never recorded as an error status', status.every((s) => s.status >= 400), true)

  console.log('\n── peak requests/second ──')
  const peakRow = rows.find((r) => r.route === '/api/leads/:id')
  // All 9 hits to /api/leads/:id fire in the same test tick → same second.
  check('peak_rps tracked (all 9 hits in one second)', peakRow?.peakRps, 9)

  console.log('\n── live snapshot ──')
  const live = snapshotLive(10)
  check('totalSinceBoot', live.totalSinceBoot, 25)
  check('per-second ring length', live.perSecond.length, 59)
  check('top sorted by hits desc', live.top[0]?.route, '/api/leads/:id')
  console.log(
    `  ${live.reqPerSec} req/s avg over 59s, peak ${live.peakPerSec}/s, ` +
      `${live.trackedRoutes} routes tracked, ${live.pendingBuckets} buckets pending flush`,
  )

  console.log('\n── percentile from histogram bands ──')
  check('p95 when everything is fast', percentile([100, 0, 0, 0, 0, 0, 0], 0.95), 48)
  check('p95 with a slow tail', percentile([90, 0, 0, 0, 0, 0, 10], 0.95), 2500)
  check('p50 across two bands', percentile([50, 50, 0, 0, 0, 0, 0], 0.5), 50)
  check('empty histogram', percentile([0, 0, 0, 0, 0, 0, 0], 0.95), 0)

  console.log(`\n${failures === 0 ? '✔ ALL PASSED' : `✘ ${failures} FAILURE(S)`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
