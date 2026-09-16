import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { reportsApi, SourceCallMetric } from '@/lib/api'
import { downloadBlob } from '@/lib/utils'
import {
  Award, AlertTriangle, Clock, CalendarClock, Loader2, ArrowUpRight,
  TrendingUp, TrendingDown, Minus, PhoneCall, MessageSquare,
  Activity, UserPlus, Snowflake, ChevronDown, ChevronRight, FileDown, CircleAlert,
} from 'lucide-react'
import { CounsellorDetailPanel } from './CounsellorDetailPanel'

type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'mtd' | 'custom'

interface RangeMetrics {
  newAssignments: number
  followupsLogged: number
  commentsAdded: number
  statusChanges: number
  wins: number
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  talkTimeSec: number
  callsBySource?: SourceCallMetric[]
}

interface PerfRow {
  id: number
  name: string
  role: string | null
  designation: string | null
  email: string | null
  mobile: string | null
  assignedActive: number
  enrolledLifetime: number
  conversionRate: number
  staleLeads: number
  followupsToday: number
  followupsOverdue: number
  followupsUpcoming: number
  range: RangeMetrics
  prev: RangeMetrics
}

interface PerfResponse {
  range: { key: string; from: string; to: string; prevFrom: string; prevTo: string }
  rows: PerfRow[]
}

type SortKey =
  | 'activity' | 'name' | 'assignedActive' | 'enrolledLifetime' | 'conversionRate'
  | 'callsTotal' | 'callsAnswered' | 'followupsLogged' | 'staleLeads'
  | 'followupsOverdue'

const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  mtd: 'Month to date',
  custom: 'Custom',
}

function activityScore(r: PerfRow) {
  return r.range.callsTotal + r.range.followupsLogged + r.range.statusChanges + r.range.commentsAdded
}

function fmtTalkTime(sec: number) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function CounsellorPerformanceSection({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [range, setRange] = useState<RangeKey>('today')
  const [sortKey, setSortKey] = useState<SortKey>('activity')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const params = useMemo(() => {
    if (range === 'custom') {
      return { range: 'custom', fromDate: fromDate || undefined, toDate: toDate || undefined }
    }
    return { range }
  }, [range, fromDate, toDate])

  const canFetch = range !== 'custom' || (!!fromDate && !!toDate)

  const { data, isLoading, isFetching } = useQuery<PerfResponse>({
    queryKey: ['reports', 'counsellor-performance', params.range, params.fromDate, params.toDate],
    queryFn: () => reportsApi.counsellorPerformance(params as { range: string; fromDate?: string; toDate?: string }),
    enabled: canFetch,
  })

  const rows = data?.rows ?? []

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name)
        case 'assignedActive': return b.assignedActive - a.assignedActive
        case 'enrolledLifetime': return b.enrolledLifetime - a.enrolledLifetime
        case 'conversionRate': return b.conversionRate - a.conversionRate
        case 'callsTotal': return b.range.callsTotal - a.range.callsTotal
        case 'callsAnswered': return b.range.callsAnswered - a.range.callsAnswered
        case 'followupsLogged': return b.range.followupsLogged - a.range.followupsLogged
        case 'staleLeads': return b.staleLeads - a.staleLeads
        case 'followupsOverdue': return b.followupsOverdue - a.followupsOverdue
        case 'activity':
        default:
          return activityScore(b) - activityScore(a)
      }
    })
    return copy
  }, [rows, sortKey])

  // ─── Aggregate totals across all counsellors ────────────────────────────
  const totals = useMemo(() => {
    const t = {
      assignedActive: 0,
      enrolledLifetime: 0,
      staleLeads: 0,
      followupsOverdue: 0,
      followupsToday: 0,
      newAssignments: 0,
      followupsLogged: 0,
      commentsAdded: 0,
      statusChanges: 0,
      callsTotal: 0,
      callsAnswered: 0,
      callsMissed: 0,
      talkTimeSec: 0,
      prevCallsTotal: 0,
      prevFollowupsLogged: 0,
      prevNewAssignments: 0,
    }
    for (const r of rows) {
      t.assignedActive += r.assignedActive
      t.enrolledLifetime += r.enrolledLifetime
      t.staleLeads += r.staleLeads
      t.followupsOverdue += r.followupsOverdue
      t.followupsToday += r.followupsToday
      t.newAssignments += r.range.newAssignments
      t.followupsLogged += r.range.followupsLogged
      t.commentsAdded += r.range.commentsAdded
      t.statusChanges += r.range.statusChanges
      t.callsTotal += r.range.callsTotal
      t.callsAnswered += r.range.callsAnswered
      t.callsMissed += r.range.callsMissed
      t.talkTimeSec += r.range.talkTimeSec
      t.prevCallsTotal += r.prev.callsTotal
      t.prevFollowupsLogged += r.prev.followupsLogged
      t.prevNewAssignments += r.prev.newAssignments
    }
    return t
  }, [rows])

  const maxAssigned = Math.max(1, ...rows.map((r) => r.assignedActive))
  const zeroActivityCount = rows.filter((r) => activityScore(r) === 0).length

  function handleExportCsv() {
    const header = [
      'Name', 'Role', 'Active Leads', 'Enrolled (lifetime)', 'Conversion %', 'Stale Leads',
      'Overdue Follow-ups', 'Due Today', 'Upcoming (7d)',
      'New Assignments', 'Follow-ups Logged', 'Status Changes',
      'Calls Total', 'Calls Answered', 'Calls No Answer', 'Talk Time (min)',
    ]
    const lines = [header.join(',')]
    for (const r of sorted) {
      lines.push([
        `"${r.name.replace(/"/g, '""')}"`, r.role || '', r.assignedActive, r.enrolledLifetime,
        r.conversionRate.toFixed(1), r.staleLeads,
        r.followupsOverdue, r.followupsToday, r.followupsUpcoming,
        r.range.newAssignments, r.range.followupsLogged, r.range.statusChanges,
        r.range.callsTotal, r.range.callsAnswered, r.range.callsMissed, Math.round(r.range.talkTimeSec / 60),
      ].join(','))
    }
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `counsellor-performance-${range}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          Sales Rep Performance
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold tabular-nums">
            {rows.length}
          </span>
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['today', 'yesterday', '7d', '30d', 'mtd', 'custom'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded font-medium ${
                range === r ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
          <button
            onClick={handleExportCsv}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded font-medium border bg-background hover:bg-muted disabled:opacity-40 transition-colors"
            title="Export this table to CSV"
          >
            <FileDown className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {zeroActivityCount > 0 && (
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-900">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          {zeroActivityCount} counsellor{zeroActivityCount === 1 ? '' : 's'} logged zero activity {RANGE_LABEL[range].toLowerCase()} — flagged below.
        </div>
      )}

      {range === 'custom' && !canFetch && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Pick a From / To date in the top date picker to load the custom range.
        </div>
      )}

      {/* ─── Summary tiles ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <SummaryTile
          icon={<PhoneCall className="h-3.5 w-3.5 text-indigo-500" />}
          label="Calls" value={totals.callsTotal} prev={totals.prevCallsTotal}
          hint={`${totals.callsAnswered} ans · ${fmtTalkTime(totals.talkTimeSec)}`}
        />
        <SummaryTile
          icon={<MessageSquare className="h-3.5 w-3.5 text-blue-500" />}
          label="Follow-ups Logged" value={totals.followupsLogged} prev={totals.prevFollowupsLogged}
          hint={`${totals.commentsAdded} comments`}
        />
        <SummaryTile
          icon={<UserPlus className="h-3.5 w-3.5 text-purple-500" />}
          label="New Assignments" value={totals.newAssignments} prev={totals.prevNewAssignments}
        />
        <SummaryTile
          icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
          label="Overdue" value={totals.followupsOverdue} tone="red"
          hint={`${totals.followupsToday} due today`}
        />
        <SummaryTile
          icon={<Snowflake className="h-3.5 w-3.5 text-slate-500" />}
          label="Stale Leads" value={totals.staleLeads} tone="slate"
          hint="no activity 7d+"
        />
      </div>

      {/* ─── Sort + legend ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span>Sort by</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="border rounded px-2 py-1 text-xs bg-background"
          >
            <option value="activity">Range activity (default)</option>
            <option value="callsTotal">Calls in range</option>
            <option value="callsAnswered">Calls answered</option>
            <option value="followupsLogged">Follow-ups logged</option>
            <option value="assignedActive">Active assigned</option>
            <option value="enrolledLifetime">Enrolled (lifetime)</option>
            <option value="conversionRate">Conversion %</option>
            <option value="followupsOverdue">Overdue first</option>
            <option value="staleLeads">Stale first</option>
            <option value="name">Name (A→Z)</option>
          </select>
        </div>
        <span>Click a row for a full performance breakdown · trend vs previous {RANGE_LABEL[range].toLowerCase()}</span>
      </div>

      {/* ─── Table ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No counsellors</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              {/* Grouped headers */}
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                <th rowSpan={2} className="px-3 py-2 text-left font-semibold sticky left-0 bg-muted/30 z-10 min-w-[180px]">Sales Rep</th>
                <th colSpan={4} className="px-3 py-1.5 text-center font-semibold border-l border-border/40">Pipeline (Live)</th>
                <th colSpan={3} className="px-3 py-1.5 text-center font-semibold border-l border-border/40">Follow-ups</th>
                <th colSpan={3} className="px-3 py-1.5 text-center font-semibold border-l border-border/40">
                  Activity · {RANGE_LABEL[range]}
                </th>
                <th colSpan={3} className="px-3 py-1.5 text-center font-semibold border-l border-border/40">
                  Calls · {RANGE_LABEL[range]}
                </th>
                <th rowSpan={2} className="px-2 py-2 w-8"></th>
              </tr>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                {/* Pipeline */}
                <th className="px-3 py-1.5 text-right font-semibold border-l border-border/40">Active</th>
                <th className="px-3 py-1.5 text-right font-semibold">Enrolled</th>
                <th className="px-3 py-1.5 text-right font-semibold">Conv %</th>
                <th className="px-3 py-1.5 text-right font-semibold">
                  <span className="inline-flex items-center gap-1 justify-end" title="Leads with no update in 7+ days">
                    <Snowflake className="h-3 w-3 text-slate-500" /> Stale
                  </span>
                </th>
                {/* Follow-ups */}
                <th className="px-3 py-1.5 text-right font-semibold border-l border-border/40">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <AlertTriangle className="h-3 w-3 text-red-500" /> Overdue
                  </span>
                </th>
                <th className="px-3 py-1.5 text-right font-semibold">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <Clock className="h-3 w-3 text-blue-500" /> Today
                  </span>
                </th>
                <th className="px-3 py-1.5 text-right font-semibold">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <CalendarClock className="h-3 w-3 text-emerald-500" /> Next 7d
                  </span>
                </th>
                {/* Activity */}
                <th className="px-3 py-1.5 text-right font-semibold border-l border-border/40">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <UserPlus className="h-3 w-3 text-purple-500" /> New
                  </span>
                </th>
                <th className="px-3 py-1.5 text-right font-semibold">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <MessageSquare className="h-3 w-3 text-blue-500" /> F/U
                  </span>
                </th>
                <th className="px-3 py-1.5 text-right font-semibold">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <Activity className="h-3 w-3 text-indigo-500" /> Status Δ
                  </span>
                </th>
                {/* Calls */}
                <th className="px-3 py-1.5 text-right font-semibold border-l border-border/40">Total</th>
                <th className="px-3 py-1.5 text-right font-semibold">Ans</th>
                <th className="px-3 py-1.5 text-right font-semibold">Talk</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isExpanded = expandedId === r.id
                const isZeroActivity = activityScore(r) === 0
                return (
                <Fragment key={r.id}>
                <tr
                  className={`border-t hover:bg-accent/30 transition-colors group cursor-pointer ${
                    isExpanded ? 'bg-accent/40' : isZeroActivity ? 'bg-amber-50/60 dark:bg-amber-950/10' : ''
                  }`}
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <td className={`px-3 py-2 sticky left-0 z-10 ${isExpanded ? 'bg-accent/40 group-hover:bg-accent/40' : isZeroActivity ? 'bg-amber-50/60 group-hover:bg-accent/30 dark:bg-amber-950/10' : 'bg-card group-hover:bg-accent/30'}`}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : r.id) }}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title={isExpanded ? 'Hide details' : 'Show details'}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate flex items-center gap-1.5">
                          {r.name}
                          <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                            r.role === 'admin' || r.role === 'sub-admin'
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                          }`}>
                            {r.role === 'sub-admin' ? 'sub' : (r.role?.slice(0, 4) || '—')}
                          </span>
                          {isZeroActivity && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title="No calls, follow-ups, or status changes logged in this range">
                              <CircleAlert className="h-2.5 w-2.5" /> No activity
                            </span>
                          )}
                        </div>
                        <div className="mt-1 h-1 w-24 bg-muted rounded-full overflow-hidden" title={`Workload: ${r.assignedActive} active`}>
                          <div className="h-full bg-blue-500" style={{ width: `${(r.assignedActive / maxAssigned) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Pipeline */}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold border-l border-border/40">{r.assignedActive.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.enrolledLifetime.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={`font-semibold ${r.conversionRate >= 15 ? 'text-emerald-600' : r.conversionRate >= 5 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      {r.conversionRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.staleLeads > 0 ? 'text-slate-700 font-semibold' : 'text-muted-foreground'}`}>
                    {r.staleLeads}
                  </td>
                  {/* Follow-ups */}
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold border-l border-border/40 ${r.followupsOverdue > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {r.followupsOverdue}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.followupsToday > 0 ? 'text-blue-600' : 'text-muted-foreground'}`}>
                    {r.followupsToday}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.followupsUpcoming}</td>
                  {/* Activity */}
                  <td className="px-3 py-2 text-right tabular-nums border-l border-border/40">
                    <NumWithTrend value={r.range.newAssignments} prev={r.prev.newAssignments} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <NumWithTrend value={r.range.followupsLogged} prev={r.prev.followupsLogged} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <NumWithTrend value={r.range.statusChanges} prev={r.prev.statusChanges} />
                  </td>
                  {/* Calls */}
                  <td className="px-3 py-2 text-right tabular-nums border-l border-border/40">
                    <NumWithTrend value={r.range.callsTotal} prev={r.prev.callsTotal} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={r.range.callsAnswered > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                      {r.range.callsAnswered}
                    </span>
                    {r.range.callsMissed > 0 && (
                      <span className="text-[10px] text-red-500 ml-1" title="No answer">·{r.range.callsMissed}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtTalkTime(r.range.talkTimeSec)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link
                      to="/app/profiles/counsellor/$id"
                      params={{ id: String(r.id) }}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Open profile"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-muted/20">
                    <td colSpan={15} className="p-0">
                      <CounsellorDetailPanel counsellorId={r.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SummaryTile({
  icon, label, value, prev, hint, tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  prev?: number
  hint?: string
  tone?: 'red' | 'emerald' | 'slate'
}) {
  const valueColor = tone === 'red' ? 'text-red-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'slate' ? 'text-slate-700' : 'text-foreground'
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon} {label}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <div className={`text-xl font-bold tabular-nums ${valueColor}`}>{value.toLocaleString()}</div>
        {prev !== undefined && <TrendBadge value={value} prev={prev} />}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  )
}

function TrendBadge({ value, prev }: { value: number; prev: number }) {
  if (value === prev) {
    return <span className="inline-flex items-center text-[10px] text-muted-foreground"><Minus className="h-3 w-3" /></span>
  }
  const up = value > prev
  const diff = value - prev
  const pct = prev === 0 ? null : Math.round((diff / prev) * 100)
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pct === null ? (diff > 0 ? `+${diff}` : `${diff}`) : `${pct > 0 ? '+' : ''}${pct}%`}
    </span>
  )
}

function NumWithTrend({ value, prev, tone, bold }: { value: number; prev: number; tone?: 'emerald'; bold?: boolean }) {
  const baseColor = tone === 'emerald' && value > 0 ? 'text-emerald-600' : value === 0 ? 'text-muted-foreground' : ''
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <span className={`${bold ? 'font-bold' : ''} ${baseColor}`}>{value}</span>
      {value !== prev && (value > 0 || prev > 0) && (
        value > prev
          ? <TrendingUp className="h-3 w-3 text-emerald-500" />
          : <TrendingDown className="h-3 w-3 text-red-400" />
      )}
    </span>
  )
}
