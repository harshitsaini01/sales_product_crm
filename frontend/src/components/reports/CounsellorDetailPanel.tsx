import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { reportsApi, SourceCallMetric, DepartmentCallMetric } from '@/lib/api'
import {
  Loader2, PhoneCall, MessageSquare, Activity, UserPlus, Award,
  AlertTriangle, Clock, CalendarClock, CheckCircle2, CircleDot,
  ArrowUpRight, Snowflake, Globe, Building2,
} from 'lucide-react'

interface PeriodMetrics {
  newAssignments: number
  followupsLogged: number
  commentsAdded: number
  statusChanges: number
  wins: number
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  talkTimeSec: number
  followups?: { due: number; done: number; pending: number }
  callsBySource?: SourceCallMetric[]
  callsByDepartment?: DepartmentCallMetric[]
}

interface DetailResponse {
  user: {
    id: number
    name: string
    designation: string | null
    role: string | null
    branch: { id: number; name: string; city: string | null } | null
  }
  pipeline: {
    assignedActive: number
    enrolledLifetime: number
    conversionRate: number
    staleLeads: number
    followupsOverdue: number
    followupsToday: number
    followupsUpcoming: number
    overdueBuckets: { d1to7: number; d8to30: number; d30plus: number }
  }
  periods: {
    today: PeriodMetrics
    yesterday: PeriodMetrics
    last7days: PeriodMetrics
    last30days: PeriodMetrics
    mtd: PeriodMetrics
  }
  activity: {
    kind: 'followup' | 'comment' | 'status' | 'call'
    at: string
    leadId: number | null
    leadName: string | null
    text: string
  }[]
  selectedDate?: string
  prevDate?: string
  isToday?: boolean
}

function formatDateDisplay(iso?: string) {
  if (!iso) return ''
  const parts = iso.slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  const [y, m, d] = parts
  return `${d}-${m}-${y}`
}

function fmtTalkTime(sec: number) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function CounsellorDetailPanel({ counsellorId, date }: { counsellorId: number; date?: string }) {
  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: ['reports', 'counsellor-detail', counsellorId, date],
    queryFn: () => reportsApi.counsellorPerformanceDetail(counsellorId, date),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading details…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="text-sm text-red-600 px-3 py-2">Failed to load details.</div>
    )
  }

  const isToday = data.isToday ?? (!date || date === new Date().toISOString().slice(0, 10))
  const selectedDateLabel = data.selectedDate ? formatDateDisplay(data.selectedDate) : (date ? formatDateDisplay(date) : 'Today')
  const prevDateLabel = data.prevDate ? formatDateDisplay(data.prevDate) : 'Yesterday'

  const t = data.periods.today
  const y = data.periods.yesterday
  const w = data.periods.last7days
  const m = data.periods.last30days
  const mtd = data.periods.mtd
  const p = data.pipeline

  const todayDone = t.followups?.done ?? 0
  const todayDue = t.followups?.due ?? 0
  const todayPending = t.followups?.pending ?? 0
  const todayPct = todayDue > 0 ? Math.round((todayDone / todayDue) * 100) : 0

  const yDone = y.followups?.done ?? 0
  const yDue = y.followups?.due ?? 0
  const yPending = y.followups?.pending ?? 0
  const yPct = yDue > 0 ? Math.round((yDone / yDue) * 100) : 0

  return (
    <div className="bg-muted/20 border-t border-border/60 p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" />
            {data.user.name} — performance breakdown
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {[data.user.designation, data.user.role, data.user.branch?.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/app/daily-reports/activity/$userId"
            params={{ userId: String(counsellorId) }}
            search={date ? { date } : undefined}
            onClick={(e) => {
              const el = document.getElementById('activity-timeline')
              if (el) {
                e.preventDefault()
                el.scrollIntoView({ behavior: 'smooth' })
              }
            }}
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            Full activity log <ArrowUpRight className="h-3 w-3" />
          </Link>
          <Link
            to="/app/profiles/counsellor/$id"
            params={{ id: String(counsellorId) }}
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            Open profile <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* ─── Today / Selected Date follow-up split (hero) ────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FollowupCard
          title={isToday ? "Today's follow-ups" : `${selectedDateLabel} follow-ups`}
          due={todayDue}
          done={todayDone}
          pending={todayPending}
          pct={todayPct}
          tone="blue"
        />
        <FollowupCard
          title={isToday ? "Yesterday's follow-ups" : `${prevDateLabel} follow-ups`}
          due={yDue}
          done={yDone}
          pending={yPending}
          pct={yPct}
          tone="slate"
          subtitle={isToday ? "of leads that were due yesterday" : `of leads that were due on ${prevDateLabel}`}
        />
      </div>

      {/* ─── Pipeline (live snapshot) ─────────────────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Pipeline (live)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <MiniTile label="Active" value={p.assignedActive} icon={<CircleDot className="h-3 w-3 text-blue-500" />} />
          <MiniTile label="Enrolled" value={p.enrolledLifetime} icon={<Award className="h-3 w-3 text-emerald-500" />} />
          <MiniTile label="Conv %" value={`${p.conversionRate.toFixed(1)}%`} icon={<Activity className="h-3 w-3 text-emerald-500" />} />
          <MiniTile label="Overdue" value={p.followupsOverdue} tone="red"
            icon={<AlertTriangle className="h-3 w-3 text-red-500" />}
            hint={`${p.overdueBuckets.d1to7} / ${p.overdueBuckets.d8to30} / ${p.overdueBuckets.d30plus}`}
            hintTitle="1-7d / 8-30d / 30+d overdue"
          />
          <MiniTile label="Today due" value={p.followupsToday} tone="blue"
            icon={<Clock className="h-3 w-3 text-blue-500" />} />
          <MiniTile label="Next 7d" value={p.followupsUpcoming} tone="emerald"
            icon={<CalendarClock className="h-3 w-3 text-emerald-500" />} />
          <MiniTile label="Stale (7d+)" value={p.staleLeads} tone="slate"
            icon={<Snowflake className="h-3 w-3 text-slate-500" />} />
        </div>
      </div>

      {/* ─── Period comparison table ─────────────────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Activity by period
        </div>
        <div className="overflow-x-auto border rounded-lg bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="px-3 py-2 text-left font-semibold">Metric</th>
                <th className="px-3 py-2 text-right font-semibold">{isToday ? 'Today' : selectedDateLabel}</th>
                <th className="px-3 py-2 text-right font-semibold">{isToday ? 'Yesterday' : prevDateLabel}</th>
                <th className="px-3 py-2 text-right font-semibold">Last 7d</th>
                <th className="px-3 py-2 text-right font-semibold">Last 30d</th>
                <th className="px-3 py-2 text-right font-semibold">MTD</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow icon={<UserPlus className="h-3 w-3 text-purple-500" />} label="New assignments"
                values={[t.newAssignments, y.newAssignments, w.newAssignments, m.newAssignments, mtd.newAssignments]} />
              <MetricRow icon={<MessageSquare className="h-3 w-3 text-blue-500" />} label="Follow-ups logged"
                values={[t.followupsLogged, y.followupsLogged, w.followupsLogged, m.followupsLogged, mtd.followupsLogged]} />
              <MetricRow icon={<MessageSquare className="h-3 w-3 text-slate-500" />} label="Comments added"
                values={[t.commentsAdded, y.commentsAdded, w.commentsAdded, m.commentsAdded, mtd.commentsAdded]} />
              <MetricRow icon={<Activity className="h-3 w-3 text-indigo-500" />} label="Status changes"
                values={[t.statusChanges, y.statusChanges, w.statusChanges, m.statusChanges, mtd.statusChanges]} />
              <MetricRow icon={<Award className="h-3 w-3 text-emerald-500" />} label="Enrolment wins"
                values={[t.wins, y.wins, w.wins, m.wins, mtd.wins]} highlight />
              <MetricRow icon={<PhoneCall className="h-3 w-3 text-indigo-500" />} label="Calls total"
                values={[t.callsTotal, y.callsTotal, w.callsTotal, m.callsTotal, mtd.callsTotal]} />
              <MetricRow icon={<PhoneCall className="h-3 w-3 text-emerald-500" />} label="Calls answered"
                values={[t.callsAnswered, y.callsAnswered, w.callsAnswered, m.callsAnswered, mtd.callsAnswered]} />
              <MetricRow icon={<PhoneCall className="h-3 w-3 text-red-500" />} label="Calls no answer"
                values={[t.callsMissed, y.callsMissed, w.callsMissed, m.callsMissed, mtd.callsMissed]} />
              <tr className="border-t bg-muted/10">
                <td className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-indigo-500" /> Talk time
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtTalkTime(t.talkTimeSec)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtTalkTime(y.talkTimeSec)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtTalkTime(w.talkTimeSec)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtTalkTime(m.talkTimeSec)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtTalkTime(mtd.talkTimeSec)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Source-wise Calls (Calls by Source) ───────────────────────── */}
      <CounsellorSourceCallsSection periods={data.periods} />

      {/* ─── Department-wise Calls (Calls by Department) ───────────────── */}
      <CounsellorDeptCallsSection periods={data.periods} />
    </div>
  )
}

function FollowupCard({
  title, due, done, pending, pct, tone, subtitle,
}: {
  title: string
  due: number
  done: number
  pending: number
  pct: number
  tone: 'blue' | 'slate'
  subtitle?: string
}) {
  const toneBg = tone === 'blue' ? 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/60' : 'bg-slate-50/60 dark:bg-slate-950/20 border-slate-200/60'
  const barColor = tone === 'blue' ? 'bg-blue-500' : 'bg-slate-500'
  return (
    <div className={`rounded-lg border ${toneBg} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-semibold text-foreground">{title}</div>
          {subtitle && <div className="text-[10px] text-muted-foreground">{subtitle}</div>}
        </div>
        <span className="text-xs font-bold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 bg-background/60 rounded-full overflow-hidden mb-3">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xl font-bold tabular-nums">{due}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Due</div>
        </div>
        <div>
          <div className="text-xl font-bold tabular-nums text-emerald-600 flex items-center justify-center gap-1">
            <CheckCircle2 className="h-4 w-4" /> {done}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Done</div>
        </div>
        <div>
          <div className={`text-xl font-bold tabular-nums flex items-center justify-center gap-1 ${pending > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
            <Clock className="h-4 w-4" /> {pending}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pending</div>
        </div>
      </div>
    </div>
  )
}

function MiniTile({
  label, value, icon, tone, hint, hintTitle,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  tone?: 'red' | 'blue' | 'emerald' | 'slate'
  hint?: string
  hintTitle?: string
}) {
  const valueColor =
    tone === 'red' ? 'text-red-600'
      : tone === 'blue' ? 'text-blue-700'
        : tone === 'emerald' ? 'text-emerald-700'
          : tone === 'slate' ? 'text-slate-700'
            : 'text-foreground'
  return (
    <div className="bg-card border rounded-md px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon} {label}
      </div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${valueColor}`}>{value}</div>
      {hint && (
        <div className="text-[10px] text-muted-foreground tabular-nums" title={hintTitle}>{hint}</div>
      )}
    </div>
  )
}

function MetricRow({
  icon, label, values, highlight,
}: {
  icon: React.ReactNode
  label: string
  values: number[]
  highlight?: boolean
}) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
        {icon} {label}
      </td>
      {values.map((v, i) => (
        <td key={i} className={`px-3 py-2 text-right tabular-nums ${highlight && v > 0 ? 'text-emerald-600 font-semibold' : v === 0 ? 'text-muted-foreground' : ''}`}>
          {v.toLocaleString()}
        </td>
      ))}
    </tr>
  )
}

function CounsellorSourceCallsSection({ periods }: { periods: DetailResponse['periods'] }) {
  const [selectedPeriod, setSelectedPeriod] = useState<'last7days' | 'today' | 'yesterday' | 'last30days' | 'mtd'>('today')

  const periodData = periods[selectedPeriod]
  const callsBySource = periodData?.callsBySource ?? []

  const sumCallsAcrossSources = useMemo(() => {
    return callsBySource.reduce((acc, c) => acc + c.callsTotal, 0)
  }, [callsBySource])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-indigo-500" /> Calls by Lead Source (Source-wise Calls)
        </div>
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded text-xs">
          {(
            [
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'last7days', label: 'Last 7d' },
              { key: 'last30days', label: 'Last 30d' },
              { key: 'mtd', label: 'MTD' },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              onClick={() => setSelectedPeriod(p.key)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${selectedPeriod === p.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {callsBySource.length === 0 ? (
        <div className="text-xs text-muted-foreground bg-card border rounded-lg p-4 text-center">
          No source-wise calls recorded for this period.
        </div>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden space-y-3 p-4">
          {/* Visual Distribution Bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Source Volume Share</span>
              <span className="font-semibold text-foreground">{sumCallsAcrossSources} calls total</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden flex">
              {callsBySource.map((s, idx) => {
                const pct = sumCallsAcrossSources > 0 ? (s.callsTotal / sumCallsAcrossSources) * 100 : 0
                const colors = [
                  'bg-indigo-500',
                  'bg-blue-500',
                  'bg-emerald-500',
                  'bg-purple-500',
                  'bg-amber-500',
                  'bg-rose-500',
                  'bg-cyan-500',
                  'bg-slate-400',
                ]
                const color = colors[idx % colors.length]
                if (pct <= 0) return null
                return (
                  <div
                    key={s.source}
                    className={`${color} h-full transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${s.source}: ${s.callsTotal} calls (${pct.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
                  <th className="px-3 py-2 text-left font-semibold">Lead Source</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Calls</th>
                  <th className="px-3 py-2 text-right font-semibold">Answered</th>
                  <th className="px-3 py-2 text-right font-semibold">No Answer</th>
                  <th className="px-3 py-2 text-right font-semibold">Talk Time</th>
                  <th className="px-3 py-2 text-left font-semibold min-w-[120px]">Share %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {callsBySource.map((s) => {
                  const pct = sumCallsAcrossSources > 0 ? (s.callsTotal / sumCallsAcrossSources) * 100 : 0
                  const ansRate = s.callsTotal > 0 ? Math.round((s.callsAnswered / s.callsTotal) * 100) : 0
                  return (
                    <tr key={s.source} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-semibold text-foreground flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-primary/70 shrink-0" />
                        {s.source}
                      </td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{s.callsTotal}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={s.callsAnswered > 0 ? 'text-emerald-600 font-semibold' : 'text-muted-foreground'}>
                          {s.callsAnswered}
                        </span>
                        {s.callsTotal > 0 && (
                          <span className="text-[10px] text-muted-foreground ml-1">({ansRate}%)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={s.callsMissed > 0 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}>
                          {s.callsMissed}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {fmtTalkTime(s.talkTimeSec)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right font-semibold">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function CounsellorDeptCallsSection({ periods }: { periods: DetailResponse['periods'] }) {
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'yesterday' | 'last7days' | 'last30days' | 'mtd'>('today')

  const periodData = periods[selectedPeriod]
  const callsByDepartment = periodData?.callsByDepartment ?? []

  const sumCallsAcrossDepts = useMemo(() => {
    return callsByDepartment.reduce((acc, c) => acc + c.callsTotal, 0)
  }, [callsByDepartment])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <Building2 className="h-3 w-3 text-purple-500" /> Calls by Department (Department Volume Share)
        </div>
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded text-xs">
          {(
            [
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'last7days', label: 'Last 7d' },
              { key: 'last30days', label: 'Last 30d' },
              { key: 'mtd', label: 'MTD' },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              onClick={() => setSelectedPeriod(p.key)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                selectedPeriod === p.key ? 'bg-card text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {callsByDepartment.length === 0 ? (
        <div className="text-xs text-muted-foreground bg-card border rounded-lg p-4 text-center">
          No calls recorded for any department in this period.
        </div>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden space-y-3 p-4">
          {/* Visual Distribution Bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Department Volume Share</span>
              <span className="font-semibold text-foreground">{sumCallsAcrossDepts} calls total</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden flex">
              {callsByDepartment.map((s, idx) => {
                const pct = sumCallsAcrossDepts > 0 ? (s.callsTotal / sumCallsAcrossDepts) * 100 : 0
                const colors = [
                  'bg-purple-500',
                  'bg-indigo-500',
                  'bg-blue-500',
                  'bg-emerald-500',
                  'bg-amber-500',
                  'bg-rose-500',
                  'bg-cyan-500',
                  'bg-slate-400',
                ]
                const color = colors[idx % colors.length]
                if (pct <= 0) return null
                return (
                  <div
                    key={s.departmentName}
                    className={`${color} h-full transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${s.departmentName}: ${s.callsTotal} calls (${pct.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
                  <th className="px-3 py-2 text-left font-semibold">Department</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Calls</th>
                  <th className="px-3 py-2 text-right font-semibold">Answered</th>
                  <th className="px-3 py-2 text-right font-semibold">No Answer</th>
                  <th className="px-3 py-2 text-right font-semibold">Talk Time</th>
                  <th className="px-3 py-2 text-left font-semibold min-w-[120px]">Share %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {callsByDepartment.map((s) => {
                  const pct = sumCallsAcrossDepts > 0 ? (s.callsTotal / sumCallsAcrossDepts) * 100 : 0
                  const ansRate = s.callsTotal > 0 ? Math.round((s.callsAnswered / s.callsTotal) * 100) : 0
                  return (
                    <tr key={s.departmentName} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-semibold text-foreground flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-purple-500 shrink-0" />
                        {s.departmentName}
                      </td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{s.callsTotal}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={s.callsAnswered > 0 ? 'text-emerald-600 font-semibold' : 'text-muted-foreground'}>
                          {s.callsAnswered}
                        </span>
                        {s.callsTotal > 0 && (
                          <span className="text-[10px] text-muted-foreground ml-1">({ansRate}%)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={s.callsMissed > 0 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}>
                          {s.callsMissed}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {fmtTalkTime(s.talkTimeSec)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right font-semibold">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
