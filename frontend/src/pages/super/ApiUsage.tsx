import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  RefreshCw,
  Timer,
  Users,
  X,
  Zap,
  CircleStop,
  Play,
  Building2,
} from 'lucide-react'
import { metricsApi, type ApiEndpointStat } from '@/lib/api'

// HTTP status → short human label, for the error drilldown.
const STATUS_LABEL: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable',
  429: 'Too Many Requests',
  500: 'Server Error',
  502: 'Bad Gateway',
  503: 'Unavailable',
  504: 'Gateway Timeout',
}

// Blue = served, red = errored. Validated as a categorical pair (CVD ΔE 26.7,
// well clear of the 8 floor) and matching the hexes already used by the
// Dashboard and Calls charts.
const C_OK = '#3b82f6'
const C_ERR = '#ef4444'
const C_GRID = '#e5e7eb'
const C_TICK = '#6b7280'

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

const GRANULARITY_LABEL: Record<string, string> = {
  m5: '5-minute buckets',
  h1: 'hourly buckets',
  d1: 'daily buckets',
}

// ─── formatters ──────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${b} B`
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms}ms`
}

function fmtTick(iso: string, granularity: string): string {
  const d = new Date(iso)
  if (granularity === 'd1') {
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const METHOD_CLS: Record<string, string> = {
  GET: 'bg-sky-100 text-sky-700',
  POST: 'bg-emerald-100 text-emerald-700',
  PATCH: 'bg-amber-100 text-amber-700',
  PUT: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wide ${
        METHOD_CLS[method] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {method}
    </span>
  )
}

// ─── stat tile ───────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'default',
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'warn' | 'bad'
  onClick?: () => void
}) {
  const valueCls =
    tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900'
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-lg p-4 ${
        onClick ? 'cursor-pointer hover:border-gray-300 hover:shadow-sm transition' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueCls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

// ─── chart tooltip ───────────────────────────────────────────────────────────

interface TipEntry {
  name?: string
  value?: number
  color?: string
  payload?: { avgMs?: number }
}

function ChartTip({
  active,
  payload,
  label,
  footer,
}: {
  active?: boolean
  payload?: TipEntry[]
  label?: string
  footer?: (p: TipEntry[]) => string | null
}) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((a, p) => a + (p.value ?? 0), 0)
  const extra = footer?.(payload)
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-gray-900 mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-gray-600">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
          <span className="flex-1">{p.name}</span>
          <span className="font-semibold tabular-nums text-gray-900">
            {(p.value ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t border-gray-100 flex justify-between gap-4 text-gray-500">
        <span>Total</span>
        <span className="font-semibold text-gray-900">{total.toLocaleString()}</span>
      </div>
      {extra && <div className="mt-0.5 text-gray-500">{extra}</div>}
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function ApiUsage() {
  const qc = useQueryClient()
  const [hours, setHours] = useState(24)
  const [selected, setSelected] = useState<{ method: string; route: string } | null>(null)
  // Errors drilldown. null = closed; {} = all endpoints; {method,route} = one.
  const [errorScope, setErrorScope] = useState<{ method?: string; route?: string } | null>(null)
  // The page polls /metrics/live every 2s, and that traffic is counted like any
  // other. Hiding it by default keeps the tracker from topping its own chart.
  const [hideSelf, setHideSelf] = useState(true)
  const [tab, setTab] = useState<'endpoints' | 'customers' | 'callers' | 'storage'>('endpoints')
  // Trend chart: fine-grained buckets vs one bar per calendar day (IST).
  const [trendMode, setTrendMode] = useState<'detailed' | 'daily'>('detailed')

  const live = useQuery({
    queryKey: ['metrics', 'live'],
    queryFn: () => metricsApi.live(20),
    // 4s, not 2s — this page's own polling was showing up as a top endpoint.
    refetchInterval: 4000,
  })

  const errorDetail = useQuery({
    queryKey: ['metrics', 'errors', hours, errorScope?.route, errorScope?.method],
    queryFn: () => metricsApi.errors({ hours, route: errorScope?.route, method: errorScope?.method }),
    enabled: errorScope !== null,
    refetchInterval: 15_000,
  })

  const summary = useQuery({
    queryKey: ['metrics', 'summary', hours],
    queryFn: () => metricsApi.summary({ hours, limit: 200 }),
    refetchInterval: 30_000,
  })

  const series = useQuery({
    queryKey: ['metrics', 'series', hours, selected?.route, selected?.method],
    queryFn: () =>
      metricsApi.timeseries({
        hours,
        route: selected?.route,
        method: selected?.method,
      }),
    refetchInterval: 30_000,
  })

  // Request volume by customer — the question a platform operator actually has,
  // and the one the per-user view could never answer once there was more than
  // one company on the box.
  const customers = useQuery({
    queryKey: ['metrics', 'customers', hours],
    queryFn: () => metricsApi.customers({ days: Math.max(1, Math.ceil(hours / 24)) }),
    enabled: tab === 'customers',
  })

  const callers = useQuery({
    queryKey: ['metrics', 'callers', hours],
    queryFn: () => metricsApi.callers({ days: Math.max(1, Math.ceil(hours / 24)), limit: 50 }),
    enabled: tab === 'callers',
  })

  const storage = useQuery({
    queryKey: ['metrics', 'storage'],
    queryFn: () => metricsApi.storage(),
    enabled: tab === 'storage',
  })

  const flush = useMutation({
    mutationFn: () => metricsApi.flush(),
    onSuccess: (r) => {
      toast.success(`Flushed ${r.rows} rows across ${r.buckets} bucket(s)`)
      qc.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: () => toast.error('Flush failed'),
  })

  const toggleTracking = useMutation({
    mutationFn: (enabled: boolean) => metricsApi.setEnabled(enabled),
    onSuccess: (r) => {
      toast.success(r.enabled ? 'API tracking resumed' : 'API tracking stopped')
      qc.invalidateQueries({ queryKey: ['metrics', 'live'] })
    },
    onError: () => toast.error('Could not change tracking'),
  })

  const trackingEnabled = live.data?.trackingEnabled ?? true

  const endpoints: ApiEndpointStat[] = useMemo(() => {
    const rows = summary.data?.endpoints ?? []
    return hideSelf ? rows.filter((e) => !e.route.startsWith('/api/metrics')) : rows
  }, [summary.data, hideSelf])

  const maxHits = endpoints[0]?.hits ?? 1

  const liveBars = useMemo(() => {
    return (live.data?.perSecond ?? []).map((p) => ({
      t: new Date(p.t).toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' }),
      ok: Math.max(0, p.hits - p.errors),
      errors: p.errors,
    }))
  }, [live.data])

  const areaData = useMemo(() => {
    const g = series.data?.granularity ?? 'm5'
    return (series.data?.points ?? []).map((p) => ({
      t: fmtTick(p.t, g),
      ok: Math.max(0, p.hits - p.errors),
      errors: p.errors,
      avgMs: p.avgMs,
    }))
  }, [series.data])

  // Day-wise view: fold whatever buckets we have into one bar per IST calendar
  // day. Purely client-side over the same data — nothing extra is stored.
  const dailyData = useMemo(() => {
    const byDay = new Map<string, { ok: number; errors: number; totalMs: number; hits: number }>()
    for (const p of series.data?.points ?? []) {
      const day = new Date(p.t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const d = byDay.get(day) ?? { ok: 0, errors: 0, totalMs: 0, hits: 0 }
      d.ok += Math.max(0, p.hits - p.errors)
      d.errors += p.errors
      d.totalMs += p.avgMs * p.hits
      d.hits += p.hits
      byDay.set(day, d)
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({
        t: new Date(day + 'T00:00:00').toLocaleDateString(undefined, {
          day: '2-digit',
          month: 'short',
        }),
        ok: d.ok,
        errors: d.errors,
        avgMs: d.hits ? Math.round(d.totalMs / d.hits) : 0,
      }))
  }, [series.data])

  const totals = summary.data?.totals

  return (
    <div className="p-6 space-y-6">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-600" />
            API Usage
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Which endpoints are being hit, how often, and how fast they respond.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setHours(r.hours)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  hours === r.hours
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => flush.mutate()}
            disabled={flush.isPending || !trackingEnabled}
            title="Write the in-memory buffer to the database now instead of waiting for the next 5-minute flush"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {flush.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Flush now
          </button>
          <button
            onClick={() => toggleTracking.mutate(!trackingEnabled)}
            disabled={toggleTracking.isPending || live.isLoading}
            title={
              trackingEnabled
                ? 'Stop recording API calls entirely (persists across restarts)'
                : 'Resume recording API calls'
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border disabled:opacity-50 ${
              trackingEnabled
                ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
                : 'border-green-200 bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {toggleTracking.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : trackingEnabled ? (
              <CircleStop className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {trackingEnabled ? 'Stop tracking' : 'Start tracking'}
          </button>
        </div>
      </div>

      {/* ── stat tiles ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile
          icon={Zap}
          label="Live"
          value={`${live.data?.reqPerSec ?? 0}/s`}
          sub={`peak ${live.data?.peakPerSec ?? 0}/s in last 60s`}
        />
        <StatTile
          icon={Gauge}
          label={`Requests · ${hours}h`}
          value={fmtNum(totals?.hits ?? 0)}
          sub={`~${fmtNum(totals?.avgPerHour ?? 0)}/hour`}
        />
        <StatTile
          icon={Timer}
          label="Avg latency"
          value={fmtMs(totals?.avgMs ?? 0)}
          sub={`across ${totals?.distinctRoutes ?? 0} endpoints`}
          tone={(totals?.avgMs ?? 0) > 500 ? 'warn' : 'default'}
        />
        <StatTile
          icon={AlertTriangle}
          label="Error rate"
          value={`${totals?.errorRate ?? 0}%`}
          sub={`${fmtNum(totals?.errors ?? 0)} failed — click to inspect`}
          tone={(totals?.errorRate ?? 0) > 5 ? 'bad' : (totals?.errorRate ?? 0) > 1 ? 'warn' : 'default'}
          onClick={() => setErrorScope({})}
        />
        <StatTile
          icon={Activity}
          label="Server uptime"
          value={fmtUptime(live.data?.uptimeSec ?? 0)}
          sub={`${fmtNum(live.data?.totalSinceBoot ?? 0)} reqs since boot`}
        />
      </div>

      {live.data && !trackingEnabled && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          <CircleStop className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            API tracking is <strong>stopped</strong>. No requests are being recorded — not even the
            live view. Press <strong>Start tracking</strong> to resume. Existing history is
            preserved.
          </span>
        </div>
      )}

      {live.data && trackingEnabled && !live.data.trackingActive && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-slate-50 border border-slate-200 text-sm text-slate-600">
          <Timer className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Outside the tracking window ({live.data.trackingWindow.startHour}:00–
            {live.data.trackingWindow.endHour}:00 {live.data.trackingWindow.tz}) — persistent
            counters are paused, so no rows are being written right now. The live graph above still
            updates. Stored history below reflects in-window traffic only.
          </span>
        </div>
      )}

      {live.data && live.data.droppedBuckets > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {live.data.droppedBuckets} bucket(s) were dropped from the in-memory buffer — the
            database has been unreachable long enough for the flush backlog to overflow. Counts for
            those windows are lost; check the backend logs for <code>[api-metrics] flush failed</code>.
          </span>
        </div>
      )}

      {/* ── live per-second ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Live traffic — last 60 seconds</h2>
            <p className="text-xs text-gray-500">
              Read straight from server memory, never stored. Per-second history would cost ~13M
              rows a day for no real benefit.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            updating every 2s
          </span>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={liveBars} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C_GRID} />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 10, fill: C_TICK }}
                axisLine={false}
                tickLine={false}
                interval={9}
              />
              <YAxis
                tick={{ fontSize: 11, fill: C_TICK }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend
                iconType="square"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, color: C_TICK }}
              />
              <Bar dataKey="ok" name="Served" stackId="a" fill={C_OK} radius={[0, 0, 0, 0]} />
              <Bar dataKey="errors" name="Errors" stackId="a" fill={C_ERR} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── historical trend ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Request volume{' '}
              {selected ? (
                <span className="font-normal text-gray-500">
                  — {selected.method} {selected.route}
                </span>
              ) : (
                <span className="font-normal text-gray-500">— all endpoints</span>
              )}
            </h2>
            <p className="text-xs text-gray-500">
              {trendMode === 'daily'
                ? 'one bar per day (IST)'
                : GRANULARITY_LABEL[series.data?.granularity ?? 'm5']}{' '}
              · last {hours}h
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
              {(['detailed', 'daily'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTrendMode(m)}
                  className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    trendMode === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {m === 'daily' ? 'By day' : 'Detailed'}
                </button>
              ))}
            </div>
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                <X className="w-3 h-3" />
                Clear filter
              </button>
            )}
          </div>
        </div>
        <div className="h-56">
          {series.isLoading ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (trendMode === 'daily' ? dailyData : areaData).length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              No data in this window yet — counters flush every 5 minutes.
            </div>
          ) : trendMode === 'daily' ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C_GRID} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 11, fill: C_TICK }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={8}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: C_TICK }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtNum}
                />
                <Tooltip
                  content={
                    <ChartTip
                      footer={(p) => {
                        const avg = p[0]?.payload?.avgMs
                        return avg == null ? null : `avg ${fmtMs(avg)}`
                      }}
                    />
                  }
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Legend
                  iconType="square"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: C_TICK }}
                />
                <Bar dataKey="ok" name="Served" stackId="a" fill={C_OK} radius={[0, 0, 0, 0]} />
                <Bar dataKey="errors" name="Errors" stackId="a" fill={C_ERR} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={areaData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="gOk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C_OK} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C_OK} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C_GRID} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 11, fill: C_TICK }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: C_TICK }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtNum}
                />
                <Tooltip
                  content={
                    <ChartTip
                      footer={(p) => {
                        // Recharts hands each entry the whole datum, so read the
                        // bucket's average latency straight off it.
                        const avg = p[0]?.payload?.avgMs
                        return avg == null ? null : `avg ${fmtMs(avg)}`
                      }}
                    />
                  }
                />
                <Legend
                  iconType="square"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: C_TICK }}
                />
                <Area
                  type="monotone"
                  dataKey="ok"
                  name="Served"
                  stackId="a"
                  stroke={C_OK}
                  strokeWidth={2}
                  fill="url(#gOk)"
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  name="Errors"
                  stackId="a"
                  stroke={C_ERR}
                  strokeWidth={2}
                  fill={C_ERR}
                  fillOpacity={0.25}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── tabs ── */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between border-b border-gray-200 px-4">
          <div className="flex">
            {(
              [
                ['endpoints', 'Endpoints', Gauge],
                ['customers', 'By customer', Building2],
                ['callers', 'Top callers', Users],
                ['storage', 'What this costs', HardDrive],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
          {tab === 'endpoints' && (
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={hideSelf}
                onChange={(e) => setHideSelf(e.target.checked)}
                className="rounded border-gray-300"
              />
              Hide this page&apos;s own polling
            </label>
          )}
        </div>

        {/* ── endpoints table ── */}
        {tab === 'endpoints' && (
          <div className="overflow-x-auto">
            {summary.isLoading ? (
              <div className="p-10 flex justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : endpoints.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-400">
                Nothing recorded yet. Counters flush to the database every 5 minutes — or hit
                &ldquo;Flush now&rdquo; above.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="px-4 py-2 font-medium">Endpoint</th>
                    <th className="px-4 py-2 font-medium text-right">Hits</th>
                    <th className="px-4 py-2 font-medium text-right" title="Peak requests in any single second within the window">
                      Peak/s
                    </th>
                    <th className="px-4 py-2 font-medium text-right">Avg</th>
                    <th className="px-4 py-2 font-medium text-right">p95</th>
                    <th className="px-4 py-2 font-medium text-right">p99</th>
                    <th className="px-4 py-2 font-medium text-right">Max</th>
                    <th className="px-4 py-2 font-medium text-right">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {endpoints.map((e) => {
                    const isSel = selected?.route === e.route && selected?.method === e.method
                    return (
                      <tr
                        key={`${e.method} ${e.route}`}
                        onClick={() =>
                          setSelected(isSel ? null : { method: e.method, route: e.route })
                        }
                        className={`cursor-pointer transition-colors ${
                          isSel ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <MethodBadge method={e.method} />
                            <span className="font-mono text-xs text-gray-800">{e.route}</span>
                          </div>
                          {/* magnitude bar — same hue as the charts, recessive */}
                          <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden max-w-md">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(1, (e.hits / maxHits) * 100)}%`,
                                background: C_OK,
                                opacity: 0.5,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                          {e.hits.toLocaleString()}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${
                            e.peakRps >= 5 ? 'text-amber-600 font-semibold' : 'text-gray-500'
                          }`}
                        >
                          {e.peakRps || '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {fmtMs(e.avgMs)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${
                            e.p95Ms > 1000 ? 'text-amber-600 font-semibold' : 'text-gray-600'
                          }`}
                        >
                          {fmtMs(e.p95Ms)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {fmtMs(e.p99Ms)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-400">
                          {fmtMs(e.maxMs)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {e.errors4xx + e.errors5xx === 0 ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setErrorScope({ method: e.method, route: e.route })
                              }}
                              title="Click to see which errors"
                              className={`underline decoration-dotted underline-offset-2 hover:opacity-70 ${
                                e.errors5xx > 0 ? 'text-red-600 font-semibold' : 'text-amber-600'
                              }`}
                            >
                              {(e.errors4xx + e.errors5xx).toLocaleString()}
                              <span className="text-gray-400 font-normal"> ({e.errorRate}%)</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {endpoints.length > 0 && (
              <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                Click a row to filter the chart above. Paths are normalised —{' '}
                <code>/api/leads/8321</code> and <code>/api/leads/9022</code> both count as{' '}
                <code>/api/leads/:id</code>.
              </div>
            )}
          </div>
        )}

        {/* ── callers table ── */}
        {tab === 'callers' && (
          <div className="overflow-x-auto">
            {callers.isLoading ? (
              <div className="p-10 flex justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (callers.data?.callers.length ?? 0) === 0 ? (
              <div className="p-10 text-center text-sm text-gray-400">No caller data yet.</div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                      <th className="px-4 py-2 font-medium">User</th>
                      <th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium text-right">Requests</th>
                      <th className="px-4 py-2 font-medium text-right">Avg</th>
                      <th className="px-4 py-2 font-medium text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {callers.data?.callers.map((u) => (
                      <tr key={`${u.tenantId}:${u.userId}`} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900">{u.name}</div>
                          {u.email && <div className="text-xs text-gray-500">{u.email}</div>}
                        </td>
                        <td className="px-4 py-2">
                          {u.tenantName ? (
                            <span className="text-gray-700">{u.tenantName}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{u.role ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                          {u.hits.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {fmtMs(u.avgMs)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {u.errors === 0 ? <span className="text-gray-300">—</span> : u.errors}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                  Per-caller totals are kept at day granularity only — user × endpoint × 5-minute
                  bucket would multiply into millions of rows for a question that never needs finer
                  resolution. Rows recorded before API usage moved to this panel carry no customer;
                  they all belong to the original install.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── by-customer table ── */}
        {tab === 'customers' && (
          <div className="overflow-x-auto">
            {customers.isLoading ? (
              <div className="p-10 flex justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (customers.data?.customers.length ?? 0) === 0 ? (
              <div className="p-10 text-center text-sm text-gray-400">No traffic recorded yet.</div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                      <th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Plan</th>
                      <th className="px-4 py-2 font-medium text-right">Requests</th>
                      <th className="px-4 py-2 font-medium">Share</th>
                      <th className="px-4 py-2 font-medium text-right">Callers</th>
                      <th className="px-4 py-2 font-medium text-right">Avg</th>
                      <th className="px-4 py-2 font-medium text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customers.data?.customers.map((row) => (
                      <tr key={row.tenantId} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900">{row.name}</div>
                          {row.slug && (
                            <div className="font-mono text-xs text-gray-400">{row.slug}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 capitalize text-gray-600">{row.planName ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                          {row.hits.toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-violet-500"
                                style={{ width: `${Math.min(100, row.share)}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-xs text-gray-500">{row.share}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {row.callers.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {fmtMs(row.avgMs)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {row.errors === 0 ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <span className="text-red-600">{row.errors.toLocaleString()}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                  Share is of all traffic in the selected window. Unattributed covers the public /v1
                  ingestion endpoints, tracking pixels, and requests that failed authentication
                  before a customer could be resolved.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── storage tab ── */}
        {tab === 'storage' && (
          <div className="p-4">
            {storage.isLoading ? (
              <div className="p-10 flex justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatTile
                    icon={Database}
                    label="Total on disk"
                    value={fmtBytes(storage.data?.totalBytes ?? 0)}
                    sub="tables + indexes"
                  />
                  <StatTile
                    icon={HardDrive}
                    label="Endpoint stats"
                    value={fmtBytes(storage.data?.statsBytes ?? 0)}
                  />
                  <StatTile
                    icon={Users}
                    label="Caller stats"
                    value={fmtBytes(storage.data?.userDailyBytes ?? 0)}
                    sub={`${fmtNum(storage.data?.userDailyRows ?? 0)} rows`}
                  />
                  <StatTile
                    icon={Timer}
                    label="DB writes"
                    value="~288/day"
                    sub="fixed by the clock, not traffic"
                  />
                </div>

                <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2 font-medium">Granularity</th>
                      <th className="px-4 py-2 font-medium text-right">Rows</th>
                      <th className="px-4 py-2 font-medium">Oldest</th>
                      <th className="px-4 py-2 font-medium">Newest</th>
                      <th className="px-4 py-2 font-medium">Retention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(storage.data?.byGranularity ?? []).map((g) => (
                      <tr key={g.granularity}>
                        <td className="px-4 py-2 font-mono text-xs text-gray-800">
                          {g.granularity}
                          <span className="ml-2 text-gray-500 font-sans">
                            {GRANULARITY_LABEL[g.granularity]}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                          {g.rows.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-gray-600 text-xs">
                          {g.oldest ? new Date(g.oldest).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-600 text-xs">
                          {g.newest ? new Date(g.newest).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-600 text-xs">
                          {storage.data?.retention[
                            g.granularity as keyof NonNullable<typeof storage.data>['retention']
                          ] ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="text-xs text-gray-500 leading-relaxed">
                  Requests are counted in memory and written as pre-aggregated 5-minute buckets, so
                  database write volume is set by the clock rather than by traffic — tripling the
                  number of users does not add a single extra write, the numbers in the columns just
                  get bigger. A nightly job rolls 5-minute rows into hourly, then daily, and prunes
                  the fine-grained ones in 10k chunks so autovacuum never gets a bloat spike.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── error drilldown modal ── */}
      {errorScope !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setErrorScope(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  {errorScope.route ? 'Endpoint errors' : 'All errors'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {errorScope.route ? (
                    <span className="font-mono">
                      {errorScope.method} {errorScope.route}
                    </span>
                  ) : (
                    'Every failing endpoint'
                  )}{' '}
                  · last {hours}h
                </p>
              </div>
              <button
                onClick={() => setErrorScope(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-5">
              {errorDetail.isLoading ? (
                <div className="py-10 flex justify-center text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (errorDetail.data?.totalErrors ?? 0) === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">
                  No errors recorded in this window.
                </div>
              ) : (
                <>
                  {/* status distribution */}
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">
                      By status code · {errorDetail.data?.totalErrors} total
                    </div>
                    <div className="space-y-1.5">
                      {errorDetail.data?.byStatus.map((s) => {
                        const pct = errorDetail.data!.totalErrors
                          ? (s.count / errorDetail.data!.totalErrors) * 100
                          : 0
                        const isServer = s.status >= 500
                        return (
                          <div key={s.status} className="flex items-center gap-3">
                            <span
                              className={`font-mono text-xs font-bold w-9 ${
                                isServer ? 'text-red-600' : 'text-amber-600'
                              }`}
                            >
                              {s.status}
                            </span>
                            <span className="text-xs text-gray-500 w-32 truncate">
                              {STATUS_LABEL[s.status] ?? 'HTTP error'}
                            </span>
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  isServer ? 'bg-red-500' : 'bg-amber-500'
                                }`}
                                style={{ width: `${Math.max(2, pct)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-gray-700 font-semibold w-10 text-right">
                              {s.count}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* per-endpoint breakdown (only meaningful in the "all" view) */}
                  {!errorScope.route && (errorDetail.data?.endpoints.length ?? 0) > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">
                        By endpoint
                      </div>
                      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                        {errorDetail.data?.endpoints.slice(0, 30).map((ep) => (
                          <div
                            key={`${ep.method} ${ep.route}`}
                            className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-gray-50 cursor-pointer"
                            onClick={() =>
                              setErrorScope({ method: ep.method, route: ep.route })
                            }
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <MethodBadge method={ep.method} />
                              <span className="font-mono text-xs text-gray-800 truncate">
                                {ep.route}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {ep.statuses.slice(0, 4).map((s) => (
                                <span
                                  key={s.status}
                                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                                    s.status >= 500
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-amber-100 text-amber-700'
                                  }`}
                                >
                                  {s.status}×{s.count}
                                </span>
                              ))}
                              <span className="text-xs font-semibold text-gray-900 tabular-nums w-8 text-right">
                                {ep.total}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    Errors are counted by HTTP status only — no request bodies or lead data are
                    stored. For the exact failing request, check the backend logs at that time.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
