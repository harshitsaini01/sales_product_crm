import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Clock,
  CalendarDays,
  CheckCircle2,
  Monitor,
  Smartphone,
  Info,
  Shield,
  Phone,
} from 'lucide-react'
import { activityApi, type InactivityMe, type InactivityMeEvent } from '@/lib/api'

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dateKey(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function StageChip({ kind }: { kind: InactivityMeEvent['kind'] }) {
  const map: Record<typeof kind, { label: string; cls: string; icon: React.ReactNode }> = {
    warning: {
      label: 'Warning',
      cls: 'bg-amber-100 text-amber-700 border-amber-200',
      icon: <Clock className="w-3 h-3" />,
    },
    alert: {
      label: 'Alert',
      cls: 'bg-orange-100 text-orange-700 border-orange-200',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    halfday: {
      label: 'Half-Day',
      cls: 'bg-red-100 text-red-700 border-red-200',
      icon: <CalendarDays className="w-3 h-3" />,
    },
  }
  const v = map[kind]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${v.cls}`}
    >
      {v.icon}
      {v.label}
    </span>
  )
}

export default function MyActivity() {
  const { data, isLoading } = useQuery<InactivityMe>({
    queryKey: ['activity-me'],
    queryFn: activityApi.me,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  // Group recent events by date for the history view.
  const groupedRecent = useMemo(() => {
    if (!data) return [] as { date: string; events: InactivityMeEvent[] }[]
    const map = new Map<string, InactivityMeEvent[]>()
    for (const e of data.recentEvents) {
      const key = dateKey(e.raisedAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries()).map(([date, events]) => ({ date, events }))
  }, [data])

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        Loading your activity…
      </div>
    )
  }

  const { config, status, todayCounts, todayEvents, enabled } = data
  const inactiveSeconds = status.inactiveSeconds

  // Where in the next-stage countdown are we?
  const nextThreshold = (() => {
    if (status.stage === 'ok') return { name: 'Warning', secs: config.warningMinutes * 60 }
    if (status.stage === 'warning') return { name: 'Alert', secs: config.alertMinutes * 60 }
    if (status.stage === 'alert') return { name: 'Half-Day', secs: config.halfdayMinutes * 60 }
    return null
  })()
  const remainingToNext = nextThreshold
    ? Math.max(0, nextThreshold.secs - inactiveSeconds)
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            My Activity
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Your inactivity tracker status, today's events and your last 30 days of history.
          </p>
        </div>
        {!enabled && (
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 border border-gray-200">
            <Shield className="w-3.5 h-3.5" />
            Tracking is paused by admin
          </span>
        )}
      </div>

      {/* Live status card */}
      <div
        className={`rounded-2xl border shadow-sm overflow-hidden ${
          status.onCall
            ? 'border-blue-200'
            : !enabled || status.stage === 'ok'
              ? 'border-green-100'
              : status.stage === 'warning'
                ? 'border-amber-200'
                : status.stage === 'alert'
                  ? 'border-orange-200'
                  : 'border-red-200'
        }`}
      >
        <div
          className={`px-5 py-4 text-white flex items-center gap-3 ${
            status.onCall
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600'
              : !enabled
                ? 'bg-gradient-to-r from-gray-500 to-gray-600'
                : status.stage === 'ok'
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600'
                  : status.stage === 'warning'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600'
                    : status.stage === 'alert'
                      ? 'bg-gradient-to-r from-orange-500 to-orange-600'
                      : 'bg-gradient-to-r from-red-600 to-red-700'
          }`}
        >
          <div className="p-2 rounded-lg bg-white/20">
            {status.onCall ? (
              <Phone className="w-5 h-5" />
            ) : status.stage === 'ok' || !enabled ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : status.stage === 'halfday' ? (
              <CalendarDays className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">
              Current Status
            </p>
            <p className="text-base font-semibold">
              {status.onCall
                ? 'On a call — inactivity tracking paused'
                : !enabled
                  ? 'Tracker is off — nothing is being recorded'
                  : status.stage === 'ok'
                    ? "You're active"
                    : status.stage === 'warning'
                      ? "You've been idle — take an action soon"
                      : status.stage === 'alert'
                        ? 'Idle alert — acknowledge to clear'
                        : 'Half-day marked'}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white">
          <div>
            <p className="text-xs text-gray-500 mb-1">Idle for</p>
            <p className="text-2xl font-bold text-gray-900">{fmtDuration(inactiveSeconds)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Last activity</p>
            <p className="text-sm font-semibold text-gray-900">
              {fmtDateTime(status.lastActivityAt)}
            </p>
            {status.lastActivitySource && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 mt-1">
                {status.lastActivitySource === 'mobile' ? (
                  <Smartphone className="w-3 h-3" />
                ) : (
                  <Monitor className="w-3 h-3" />
                )}
                from {status.lastActivitySource}
              </span>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">
              {nextThreshold ? `Next: ${nextThreshold.name} in` : 'Status'}
            </p>
            {remainingToNext != null ? (
              <p className="text-2xl font-bold text-gray-900">{fmtDuration(remainingToNext)}</p>
            ) : (
              <p className="text-sm font-semibold text-red-700">No further stage</p>
            )}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Info className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold text-gray-900">How this works</h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            Your activity is measured across both the <strong>web CRM</strong> and the{' '}
            <strong>mobile app</strong>. Any meaningful action — clicking, opening a lead, making a
            call, updating a status — resets your idle timer. If you stop interacting for too long
            without acknowledging, you progress through three stages:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StageRule
              tone="amber"
              icon={<Clock className="w-4 h-4" />}
              title="Warning"
              when={`After ${config.warningMinutes} minutes idle`}
              effect="A small toast appears in the corner. Nothing else happens — just a reminder."
            />
            <StageRule
              tone="orange"
              icon={<AlertTriangle className="w-4 h-4" />}
              title="Alert"
              when={`After ${config.alertMinutes} minutes idle`}
              effect="A full-screen popup blocks the CRM until you press 'Mark as Read'. Press it to reset."
            />
            <StageRule
              tone="red"
              icon={<CalendarDays className="w-4 h-4" />}
              title="Half-Day"
              when={`After ${config.halfdayMinutes} minutes idle`}
              effect="Your day is auto-recorded as a half-day in the Leaves register. Talk to your admin to adjust."
            />
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            <strong>Tip:</strong> the mobile app counts too — making a call from the app or
            opening it keeps your timer alive on the web side, and the same in reverse.
          </p>
          <p className="text-xs text-blue-700 leading-relaxed bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 inline-flex items-start gap-2">
            <Phone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Phone calls protect you.</strong> Whenever your phone is in a call (ringing
              or in progress), inactivity warnings are paused and your timer resets when the call
              ends — so a long conversation never accidentally marks you half-day.
            </span>
          </p>
        </div>
      </div>

      {/* Today */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-bold text-gray-900">Today</h2>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-amber-700">
              <strong>{todayCounts.warning}</strong> warnings
            </span>
            <span className="text-orange-700">
              <strong>{todayCounts.alert}</strong> alerts
            </span>
            <span className="text-red-700">
              <strong>{todayCounts.halfday}</strong> half-days
            </span>
          </div>
        </div>
        <div className="px-5 py-4">
          {todayEvents.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">
              No inactivity events today — keep it up.
            </p>
          ) : (
            <ol className="space-y-2">
              {todayEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <StageChip kind={e.kind} />
                    <span className="text-sm text-gray-700">
                      idle for <strong>{fmtDuration(e.inactiveSeconds)}</strong>
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">
                    {fmtTime(e.raisedAt)}
                    {e.ackAt && (
                      <span className="ml-2 text-green-700">· acked {fmtTime(e.ackAt)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold text-gray-900">Last 30 days</h2>
        </div>
        <div className="px-5 py-4">
          {groupedRecent.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">
              Nothing recorded in the last 30 days.
            </p>
          ) : (
            <div className="space-y-5">
              {groupedRecent.map(({ date, events }) => (
                <div key={date}>
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                    {date}
                  </p>
                  <ul className="space-y-2">
                    {events.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-gray-100"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <StageChip kind={e.kind} />
                          <span className="text-sm text-gray-700">
                            idle for <strong>{fmtDuration(e.inactiveSeconds)}</strong>
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 shrink-0">{fmtTime(e.raisedAt)}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StageRule({
  tone,
  icon,
  title,
  when,
  effect,
}: {
  tone: 'amber' | 'orange' | 'red'
  icon: React.ReactNode
  title: string
  when: string
  effect: string
}) {
  const toneMap: Record<typeof tone, string> = {
    amber: 'bg-amber-50 border-amber-100 text-amber-900',
    orange: 'bg-orange-50 border-orange-100 text-orange-900',
    red: 'bg-red-50 border-red-100 text-red-900',
  }
  const iconMap: Record<typeof tone, string> = {
    amber: 'bg-amber-100 text-amber-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
  }
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`p-1.5 rounded-lg ${iconMap[tone]}`}>{icon}</span>
        <p className="font-bold text-sm">{title}</p>
      </div>
      <p className="text-xs font-semibold opacity-80">{when}</p>
      <p className="text-xs mt-1.5 opacity-90 leading-relaxed">{effect}</p>
    </div>
  )
}
