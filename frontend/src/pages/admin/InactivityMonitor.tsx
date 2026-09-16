import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Clock,
  CalendarDays,
  Smartphone,
  Monitor,
  X,
  Filter,
  Activity,
  Power,
  PowerOff,
  Loader2,
  Phone,
} from 'lucide-react'
import {
  activityApi,
  type InactivityConfig,
  type InactivitySummary,
  type InactivitySummaryRow,
  type InactivityEventRow,
} from '@/lib/api'

// Date inputs send `YYYY-MM-DD`; the backend takes any ISO. Format helpers.
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtSecs(s: number | null): string {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString()
}

function StageBadge({ stage }: { stage: InactivitySummaryRow['currentStage'] }) {
  const map: Record<typeof stage, { label: string; cls: string }> = {
    ok: { label: 'Active', cls: 'bg-green-100 text-green-700 border-green-200' },
    warning: { label: 'Idle', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    alert: { label: 'Alert', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    halfday: { label: 'Half-Day', cls: 'bg-red-100 text-red-700 border-red-200' },
    unknown: { label: 'Never seen', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  }
  const v = map[stage]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${v.cls}`}>
      {v.label}
    </span>
  )
}

function KindBadge({ kind }: { kind: InactivityEventRow['kind'] }) {
  const map: Record<typeof kind, string> = {
    warning: 'bg-amber-100 text-amber-700',
    alert: 'bg-orange-100 text-orange-700',
    halfday: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${map[kind]}`}>
      {kind}
    </span>
  )
}

export default function InactivityMonitor() {
  const today = new Date()
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [from, setFrom] = useState(toISODate(sevenDaysAgo))
  const [to, setTo] = useState(toISODate(today))
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | 'idle' | 'flagged'>('all')
  const [detailUserId, setDetailUserId] = useState<number | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<null | 'on' | 'off'>(null)

  const qc = useQueryClient()
  const { data: config } = useQuery<InactivityConfig>({
    queryKey: ['activity-config'],
    queryFn: activityApi.config,
  })

  const toggleTracking = useMutation({
    mutationFn: (enabled: boolean) => activityApi.saveConfig({ enabled }),
    onSuccess: (cfg) => {
      qc.setQueryData(['activity-config'], cfg)
      qc.invalidateQueries({ queryKey: ['activity-summary'] })
      toast.success(cfg.enabled ? 'Tracking started' : 'Tracking stopped', {
        description: cfg.enabled
          ? 'Counsellors will be monitored for inactivity again.'
          : 'No new warnings or half-days will be raised until you turn this back on.',
      })
      setConfirmToggle(null)
    },
    onError: () => {
      toast.error('Could not change tracking state. Try again.')
      setConfirmToggle(null)
    },
  })

  // Build ISO bounds — `to` should be end-of-day so events on that day are included.
  const fromISO = useMemo(() => new Date(`${from}T00:00:00`).toISOString(), [from])
  const toISO = useMemo(() => new Date(`${to}T23:59:59`).toISOString(), [to])

  const { data: summary, isLoading } = useQuery<InactivitySummary>({
    queryKey: ['activity-summary', fromISO, toISO],
    queryFn: () => activityApi.summary({ from: fromISO, to: toISO }),
    refetchInterval: 60_000,
  })

  const filteredRows = useMemo(() => {
    if (!summary) return []
    const q = search.trim().toLowerCase()
    return summary.rows.filter((r) => {
      if (q) {
        const hay = `${r.name} ${r.email} ${r.mobile ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (stageFilter === 'idle' && r.currentStage === 'ok') return false
      if (stageFilter === 'flagged' && r.total === 0) return false
      return true
    })
  }, [summary, search, stageFilter])

  // Pre-sort: rows with the most events first, then by current stage severity.
  const sorted = useMemo(() => {
    const stageRank: Record<string, number> = { halfday: 4, alert: 3, warning: 2, ok: 1, unknown: 0 }
    return [...filteredRows].sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return stageRank[b.currentStage] - stageRank[a.currentStage]
    })
  }, [filteredRows])

  const totals = useMemo(() => {
    if (!summary) return { warning: 0, alert: 0, halfday: 0, flagged: 0 }
    return summary.rows.reduce(
      (acc, r) => {
        acc.warning += r.counts.warning
        acc.alert += r.counts.alert
        acc.halfday += r.counts.halfday
        if (r.total > 0) acc.flagged += 1
        return acc
      },
      { warning: 0, alert: 0, halfday: 0, flagged: 0 },
    )
  }, [summary])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Inactivity Monitor
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Counsellor warnings, alerts and auto-marked half-days — combined web + mobile activity.
          </p>
          {config && (
            <p className="text-xs mt-2 inline-flex items-center gap-1.5 text-gray-600">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  config.enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
                }`}
              />
              Tracking is currently{' '}
              <strong className={config.enabled ? 'text-green-700' : 'text-gray-700'}>
                {config.enabled ? 'ON' : 'OFF'}
              </strong>
              {config.enabled && (
                <span className="text-gray-400">
                  · warn {config.warningMinutes}m · alert {config.alertMinutes}m · half-day {config.halfdayMinutes}m
                </span>
              )}
            </p>
          )}
        </div>
        {config && (
          <button
            onClick={() => setConfirmToggle(config.enabled ? 'off' : 'on')}
            disabled={toggleTracking.isPending}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm shadow-sm transition-all disabled:opacity-40 ${
              config.enabled
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20'
                : 'bg-green-600 hover:bg-green-700 text-white shadow-green-500/20'
            }`}
          >
            {toggleTracking.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : config.enabled ? (
              <PowerOff className="w-4 h-4" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            {config.enabled ? 'Stop Tracking' : 'Start Tracking'}
          </button>
        )}
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Counsellors flagged"
          value={totals.flagged}
          icon={<Activity className="w-4 h-4" />}
          tone="gray"
        />
        <StatCard
          label="Warnings"
          value={totals.warning}
          icon={<Clock className="w-4 h-4" />}
          tone="amber"
        />
        <StatCard
          label="Alerts"
          value={totals.alert}
          icon={<AlertTriangle className="w-4 h-4" />}
          tone="orange"
        />
        <StatCard
          label="Half-days marked"
          value={totals.halfday}
          icon={<CalendarDays className="w-4 h-4" />}
          tone="red"
        />
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-end gap-3 flex-wrap">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none"
          />
        </div>
        <div className="flex flex-col flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 mb-1">Search</label>
          <input
            type="text"
            placeholder="Name, email, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">Show</label>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as 'all' | 'idle' | 'flagged')}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none"
          >
            <option value="all">All counsellors</option>
            <option value="idle">Currently idle</option>
            <option value="flagged">Flagged in range</option>
          </select>
        </div>
      </div>

      {/* Main table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Sales Rep</th>
                <th className="text-left px-4 py-3">Current Status</th>
                <th className="text-left px-4 py-3">Last Activity</th>
                <th className="text-center px-4 py-3">Warnings</th>
                <th className="text-center px-4 py-3">Alerts</th>
                <th className="text-center px-4 py-3">Half-Days</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    No counsellors match the current filters.
                  </td>
                </tr>
              )}
              {sorted.map((r) => (
                <tr key={r.userId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.onCall ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border bg-blue-100 text-blue-700 border-blue-200">
                          <Phone className="w-3 h-3" />
                          On call
                        </span>
                      ) : (
                        <StageBadge stage={r.currentStage} />
                      )}
                      {!r.onCall && r.inactiveSeconds != null && r.currentStage !== 'ok' && (
                        <span className="text-xs text-gray-500">
                          idle {fmtSecs(r.inactiveSeconds)}
                        </span>
                      )}
                      {r.onCall && r.onCallSince && (
                        <span className="text-xs text-gray-500">
                          since {fmtDateTime(r.onCallSince)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900 text-xs">{fmtDateTime(r.lastActivityAt)}</div>
                    {r.lastActivitySource && (
                      <div className="inline-flex items-center gap-1 text-xs text-gray-500 mt-1">
                        {r.lastActivitySource === 'mobile' ? (
                          <Smartphone className="w-3 h-3" />
                        ) : (
                          <Monitor className="w-3 h-3" />
                        )}
                        {r.lastActivitySource}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={r.counts.warning > 0 ? 'font-semibold text-amber-700' : 'text-gray-400'}>
                      {r.counts.warning}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={r.counts.alert > 0 ? 'font-semibold text-orange-700' : 'text-gray-400'}>
                      {r.counts.alert}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={r.counts.halfday > 0 ? 'font-semibold text-red-700' : 'text-gray-400'}>
                      {r.counts.halfday}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDetailUserId(r.userId)}
                      className="text-xs font-medium text-gray-700 hover:text-black border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg"
                      disabled={r.total === 0}
                    >
                      View events
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailUserId != null && (
        <EventDrawer
          userId={detailUserId}
          userName={sorted.find((r) => r.userId === detailUserId)?.name || ''}
          fromISO={fromISO}
          toISO={toISO}
          onClose={() => setDetailUserId(null)}
        />
      )}

      {confirmToggle && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div
              className={`px-5 py-4 text-white flex items-center gap-3 ${
                confirmToggle === 'off'
                  ? 'bg-gradient-to-r from-red-600 to-red-700'
                  : 'bg-gradient-to-r from-green-600 to-green-700'
              }`}
            >
              <div className="p-2 rounded-lg bg-white/20">
                {confirmToggle === 'off' ? (
                  <PowerOff className="w-5 h-5" />
                ) : (
                  <Power className="w-5 h-5" />
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                  Confirm
                </p>
                <p className="text-sm font-semibold">
                  {confirmToggle === 'off' ? 'Stop inactivity tracking?' : 'Start inactivity tracking?'}
                </p>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-2">
              {confirmToggle === 'off' ? (
                <>
                  <p>
                    This will <strong>stop tracking inactivity for every counsellor</strong>. No new
                    warnings, alerts, or auto half-days will be raised until you start it again.
                  </p>
                  <p className="text-xs text-gray-500">
                    Existing events stay in the audit log. You can flip this back on at any time.
                  </p>
                </>
              ) : (
                <p>
                  This will resume tracking using the current thresholds
                  {config && (
                    <>
                      {' '}
                      (warn {config.warningMinutes}m · alert {config.alertMinutes}m · half-day{' '}
                      {config.halfdayMinutes}m)
                    </>
                  )}
                  . Counsellors will start receiving warnings again on the next idle window.
                </p>
              )}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmToggle(null)}
                disabled={toggleTracking.isPending}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => toggleTracking.mutate(confirmToggle === 'on')}
                disabled={toggleTracking.isPending}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-sm disabled:opacity-40 ${
                  confirmToggle === 'off'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {toggleTracking.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {confirmToggle === 'off' ? 'Yes, stop tracking' : 'Yes, start tracking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'gray' | 'amber' | 'orange' | 'red'
}) {
  const map: Record<typeof tone, string> = {
    gray: 'bg-gray-100 text-gray-700',
    amber: 'bg-amber-100 text-amber-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
  }
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
      <div className={`p-2 rounded-xl ${map[tone]}`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  )
}

function EventDrawer({
  userId,
  userName,
  fromISO,
  toISO,
  onClose,
}: {
  userId: number
  userName: string
  fromISO: string
  toISO: string
  onClose: () => void
}) {
  const { data: events = [], isLoading } = useQuery<InactivityEventRow[]>({
    queryKey: ['activity-events', userId, fromISO, toISO],
    queryFn: () => activityApi.events({ userId, from: fromISO, to: toISO, limit: 500 }),
  })

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-xl overflow-y-auto flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">{userName}</h2>
            <p className="text-xs text-gray-500">Inactivity events in selected range</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {!isLoading && events.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-10 flex flex-col items-center gap-2">
              <Filter className="w-6 h-6" />
              No events recorded in this range.
            </div>
          )}
          {events.map((e) => (
            <div
              key={e.id}
              className="border border-gray-100 rounded-xl p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <KindBadge kind={e.kind} />
                <span className="text-xs text-gray-500">{fmtDateTime(e.raisedAt)}</span>
              </div>
              <div className="mt-2 text-sm text-gray-700">
                Idle for <strong>{fmtSecs(e.inactiveSeconds)}</strong> when raised
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {e.ackAt ? (
                  <>Acknowledged at {fmtDateTime(e.ackAt)}</>
                ) : (
                  <>Not acknowledged</>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
