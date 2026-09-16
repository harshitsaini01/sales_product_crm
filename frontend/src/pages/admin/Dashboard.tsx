import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { Users, TrendingUp, CalendarClock, UserPlus, Calendar, ChevronRight, AlertCircle, Activity, ArrowUpRight, GitBranch, Radio, ArrowUp, ArrowDown, Minus, Sparkles, Gauge, Target } from 'lucide-react'
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts'
import type { DashboardStats } from '@/types'
import { Link } from '@tanstack/react-router'
import { PendingFollowupsWidget } from '@/components/dashboard/PendingFollowupsWidget'
import { TodaysCallList } from '@/components/dashboard/TodaysCallList'
import { CallStatsWidget } from '@/components/dashboard/CallStatsWidget'
import { AssignedTodayWidget } from '@/components/dashboard/AssignedTodayWidget'
import { AnnouncementsWidget } from '@/components/dashboard/AnnouncementsWidget'
import { SalesPulse } from '@/components/dashboard/SalesPulse'

// Helpers ─────────────────────────────────────────────────────────────────────
function todayISO(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function monthStartISO(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${month}-01`
}

function getPercentageChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function TrendBadge({ value, compact = false }: { value: number | null; compact?: boolean }) {
  if (value === null) {
    return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-black text-blue-600">NEW</span>
  }
  const isUp = value > 0
  const isDown = value < 0
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : Minus
  const color = isUp ? 'text-emerald-600 bg-emerald-500/10' : isDown ? 'text-red-600 bg-red-500/10' : 'text-muted-foreground bg-muted'
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-1 font-black ${compact ? 'text-[10px]' : 'text-xs'} ${color}`}>
      <Icon className="h-3 w-3" />{Math.abs(value).toFixed(1)}%
    </span>
  )
}

function StatCard({ title, value, icon: Icon, color, description, to }: {
  title: string; value: number; icon: React.ComponentType<{ className?: string }>; color: string; description?: string; to?: string
}) {
  const body = (
    <div className="bg-card border rounded-xl p-5 shadow-sm hover:shadow-md hover:border-primary/30 transition-all h-full">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-3xl font-black">{value.toLocaleString()}</p>
            {description && <span className="text-[10px] text-muted-foreground font-medium">{description}</span>}
          </div>
        </div>
        <div className={`p-3 rounded-2xl ${color} bg-opacity-10`}>
          <Icon className={`h-6 w-6 ${color.replace('bg-', 'text-')}`} />
        </div>
      </div>
    </div>
  )
  return to ? <Link to={to} className="block">{body}</Link> : body
}

export function Dashboard() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'sub-admin'

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.stats,
  })

  const [trendPeriod, setTrendPeriod] = useState<'week' | 'month'>('month')
  const { data: trendByWebsite, isLoading: trendLoading, isError: trendError } = useQuery<{ websites: string[]; rows: Array<Record<string, string | number>> }>({
    queryKey: ['leads-intelligence-trend'],
    queryFn: () => dashboardApi.leadsTrendByWebsite('year', 8),
    retry: 1,
  })
  const { data: byStatus } = useQuery<Array<{ id: number; title: string; count: number }>>({
    queryKey: ['leads-by-status'],
    queryFn: dashboardApi.leadsByStatus,
  })

  const { data: bySource } = useQuery<Array<{ source: string; count: number }>>({
    queryKey: ['leads-by-source'],
    queryFn: dashboardApi.leadsBySource,
  })

  const { data: todayBySource } = useQuery<Array<{ source: string; count: number }>>({
    queryKey: ['today-by-source'],
    queryFn: dashboardApi.todayBySource,
  })
  const todaySourceData = (todayBySource || [])
    .filter((s) => s.count > 0)
    .map((s) => ({ name: s.source || 'Direct / Organic', source: s.source || '', count: s.count }))
    .sort((a, b) => b.count - a.count)
  const todaySourceTotal = todaySourceData.reduce((sum, d) => sum + d.count, 0)

  const topTodaySource = todaySourceData[0]

  const sourceData = (bySource || [])
    .filter((s) => s.count > 0)
    .map((s) => ({ name: s.source || 'Direct / Organic', source: s.source || '', count: s.count }))
    .sort((a, b) => b.count - a.count)
  const totalSourceLeads = sourceData.reduce((sum, d) => sum + d.count, 0)
  const topSource = sourceData[0]

  const pipelineData = (byStatus || []).filter((s) => s.count > 0)
  const pipelineTotal = pipelineData.reduce((sum, s) => sum + s.count, 0)
  const pipelineBottleneck = pipelineData.reduce<(typeof pipelineData)[number] | null>(
    (largest, status) => (!largest || status.count > largest.count ? status : largest),
    null,
  )
  const outsideActivePipeline = Math.max(0, (stats?.totalLeads || 0) - pipelineTotal)
  const periodDays = trendPeriod === 'week' ? 7 : 30
  const currentPeriodStart = todayISO(-periodDays + 1)

  const trendRows = (() => {
    if (!trendByWebsite) return [] as Array<{ date: string; total: number }>
    const totalsByDate = new Map(
      trendByWebsite.rows.map((row) => [
        String(row.date),
        trendByWebsite.websites.reduce((sum, website) => sum + Number(row[website] || 0), 0),
      ]),
    )
    return Array.from({ length: periodDays }, (_, index) => {
      const date = todayISO(index - periodDays + 1)
      return { date, total: totalsByDate.get(date) || 0 }
    })
  })()
  const previousTrendRows = (() => {
    if (!trendByWebsite) return [] as Array<{ date: string; total: number }>
    const totalsByDate = new Map(
      trendByWebsite.rows.map((row) => [
        String(row.date),
        trendByWebsite.websites.reduce((sum, website) => sum + Number(row[website] || 0), 0),
      ]),
    )
    return Array.from({ length: periodDays }, (_, index) => {
      const date = todayISO(index - (periodDays * 2) + 1)
      return { date, total: totalsByDate.get(date) || 0 }
    })
  })()
  const trendTotal = trendRows.reduce((sum, row) => sum + row.total, 0)
  const previousTrendTotal = previousTrendRows.reduce((sum, row) => sum + row.total, 0)
  const trendChange = getPercentageChange(trendTotal, previousTrendTotal)
  const comparisonRows = trendRows.map((row, index) => ({
    date: row.date,
    current: row.total,
    previous: previousTrendRows[index]?.total || 0,
  }))
  const trendAverage = trendRows.length ? trendTotal / trendRows.length : 0
  const peakDay = trendRows.reduce<{ date: string; total: number } | null>(
    (peak, row) => (!peak || row.total > peak.total ? row : peak),
    null,
  )
  const hasTrendData = trendTotal > 0

  const sourceMomentum = (() => {
    if (!trendByWebsite) return [] as Array<{ key: string; name: string; current: number; previous: number; share: number; change: number | null }>
    const currentDates = new Set(trendRows.map((row) => row.date))
    const previousDates = new Set(previousTrendRows.map((row) => row.date))
    return trendByWebsite.websites
      .map((website) => {
        let current = 0
        let previous = 0
        for (const row of trendByWebsite.rows) {
          const date = String(row.date)
          if (currentDates.has(date)) current += Number(row[website] || 0)
          if (previousDates.has(date)) previous += Number(row[website] || 0)
        }
        return {
          key: website,
          name: website === '__other__' ? 'Other sources' : website === 'other' ? 'Direct / Organic' : website,
          current,
          previous,
          share: trendTotal ? (current / trendTotal) * 100 : 0,
          change: getPercentageChange(current, previous),
        }
      })
      .filter((source) => source.current > 0 || source.previous > 0)
      .sort((a, b) => b.current - a.current)
  })()
  const activePeriodSources = sourceMomentum.filter((source) => source.current > 0).length
  const topPeriodSource = sourceMomentum.find((source) => source.current > 0)
  const todayPace = trendAverage > 0 ? (todaySourceTotal / trendAverage) * 100 : 0

  const formatShortDate = (value: string) => {
    const date = new Date(`${value}T00:00:00`)
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            Welcome back, <span className="text-primary">{user?.name.split(' ')[0]}</span>
          </h1>
          <p className="text-muted-foreground mt-1 font-medium">
            {isAdmin ? "Here's what's happening across the organization today." : "Here are your personal performance metrics and follow-ups."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/leads/new" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add New Lead
          </Link>
        </div>
      </div>

      {/* The B2B half: funnel, what is stuck, projects waiting on me. Renders
          nothing for a customer without those modules. */}
      <SalesPulse />

      {/* Stats Grid — every card is a deep-link to filtered leads */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={isAdmin ? "Total Leads" : "My Leads"}
          value={stats?.totalLeads || 0}
          icon={Users}
          color="bg-blue-600"
          to="/app/leads"
        />
        <StatCard
          title="New Today"
          value={stats?.todayLeads || 0}
          icon={UserPlus}
          color="bg-emerald-600"
          to={`/app/leads?fromDate=${todayISO()}&toDate=${todayISO()}`}
        />
        <StatCard
          title="This Week"
          value={stats?.weekLeads || 0}
          icon={TrendingUp}
          color="bg-violet-600"
          to={`/app/leads?fromDate=${todayISO(-7)}`}
        />
        <StatCard
          title="This Month"
          value={stats?.monthLeads || 0}
          icon={Calendar}
          color="bg-orange-600"
          to={`/app/leads?fromDate=${monthStartISO()}`}
        />
        <StatCard
          title="Follow-ups"
          value={stats?.todayFollowups || 0}
          icon={CalendarClock}
          color="bg-amber-600"
          description="Due Today"
          to={`/app/leads?followupFrom=${todayISO()}&followupTo=${todayISO()}`}
        />
        <StatCard
          title="Overdue"
          value={stats?.overdueFollowups || 0}
          icon={AlertCircle}
          color="bg-red-600"
          description="Follow-ups"
          to="/app/leads?overdue=1"
        />
        <StatCard
          title="Active Pipeline"
          value={stats?.activeLeads || 0}
          icon={Activity}
          color="bg-indigo-600"
          description="Open leads"
          to="/app/leads"
        />
      </div>

      {/* Announcements — visible to every role, sits above the role-specific
          widgets so important notices land in front of users immediately. */}
      <AnnouncementsWidget />

      {/* Calling tasks (assign + live task board) live only on /app/tasks now —
          they used to be mirrored here, which showed the same work twice. */}

      {/* Assigned to me today (counsellor focus) — surface fresh leads first */}
      {!isAdmin && <AssignedTodayWidget />}

      <CallStatsWidget />

      {/* Today's acquisition snapshot — ranked, scannable and filterable. */}
      <div className="bg-card border rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black">Lead Intelligence</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                Acquisition momentum, source health and operational signals from real lead data
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs font-semibold text-muted-foreground">Compare performance</span>
            <select
              value={trendPeriod}
              onChange={(e) => setTrendPeriod(e.target.value as 'week' | 'month')}
              className="rounded-lg border bg-background px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-primary/20"
            >
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-7">
          <div className="rounded-xl border bg-gradient-to-br from-primary/[0.08] to-transparent p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Period intake</p>
                <p className="mt-2 text-3xl font-black tabular-nums">{trendTotal.toLocaleString()}</p>
              </div>
              <TrendBadge value={trendChange} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">vs {previousTrendTotal.toLocaleString()} in previous period</p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Daily run rate</p>
              <Gauge className="h-4 w-4 text-blue-500" />
            </div>
            <p className="mt-2 text-3xl font-black tabular-nums">{trendAverage.toFixed(1)}</p>
            <p className="mt-2 text-xs text-muted-foreground">leads per calendar day</p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Today's pace</p>
              <Radio className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-3xl font-black tabular-nums">{todaySourceTotal.toLocaleString()}</p>
            <p className="mt-2 text-xs text-muted-foreground">{trendAverage > 0 ? `${todayPace.toFixed(0)}% of the daily run rate` : 'Awaiting a comparison baseline'}</p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Source reach</p>
              <Target className="h-4 w-4 text-violet-500" />
            </div>
            <p className="mt-2 text-3xl font-black tabular-nums">{activePeriodSources}</p>
            <p className="mt-2 truncate text-xs text-muted-foreground">Top: {topPeriodSource?.name || 'No active source'}</p>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black">Today's Source Pulse</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {todaySourceTotal > 0
                ? `${todaySourceTotal.toLocaleString()} lead${todaySourceTotal === 1 ? '' : 's'} received across ${todaySourceData.length} source${todaySourceData.length === 1 ? '' : 's'}`
                : 'Source activity for today'}
            </p>
          </div>
          <Link
            to={(`/app/leads?fromDate=${todayISO()}&toDate=${todayISO()}`) as string}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            View today <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {todaySourceData.length === 0 ? (
          <div className="h-48 rounded-xl border border-dashed flex flex-col items-center justify-center text-center px-4">
            <Radio className="h-7 w-7 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-bold">No leads received today</p>
            <p className="text-xs text-muted-foreground mt-1">New source activity will appear here as leads arrive.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
            {todaySourceData.map((entry, index) => {
              const percentage = (entry.count / todaySourceTotal) * 100
              const href = entry.source
                ? `/app/leads?fromDate=${todayISO()}&toDate=${todayISO()}&website=${encodeURIComponent(entry.source)}`
                : `/app/leads?fromDate=${todayISO()}&toDate=${todayISO()}`
              return (
                <Link key={`${entry.source}-${index}`} to={href} className="group block rounded-xl border p-3.5 hover:border-primary/40 hover:bg-primary/[0.03] transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-black text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-bold group-hover:text-primary">{entry.name}</span>
                        <span className="text-sm font-black tabular-nums">{entry.count.toLocaleString()}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
                        </div>
                        <span className="w-10 text-right text-[11px] font-bold tabular-nums text-muted-foreground">{percentage.toFixed(0)}%</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
                  </div>
                </Link>
              )
            })}
            {topTodaySource && (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <span>Leading source today</span>
                <span className="font-bold text-foreground">{topTodaySource.name}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-7 border-t pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-black">Signals worth attention</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black">Acquisition momentum</p>
                <TrendBadge value={trendChange} compact />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {trendChange === null
                  ? `${trendTotal.toLocaleString()} leads established a new comparison baseline.`
                  : trendChange > 0
                    ? `Lead intake is ahead of the previous ${trendPeriod === 'week' ? '7-day' : '30-day'} period.`
                    : trendChange < 0
                      ? `Lead intake is behind the previous period and needs source review.`
                      : 'Lead intake is holding level with the previous period.'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black">Source concentration</p>
                <span className="text-xs font-black tabular-nums text-primary">{topPeriodSource ? `${topPeriodSource.share.toFixed(0)}%` : '—'}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {topPeriodSource
                  ? `${topPeriodSource.name} is the strongest current channel with ${topPeriodSource.current.toLocaleString()} leads.`
                  : 'No source has contributed leads during this period.'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black">Pipeline pressure</p>
                <span className="text-xs font-black tabular-nums text-violet-600">{pipelineBottleneck && pipelineTotal ? `${((pipelineBottleneck.count / pipelineTotal) * 100).toFixed(0)}%` : '—'}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {pipelineBottleneck
                  ? `${pipelineBottleneck.title} holds the largest share with ${pipelineBottleneck.count.toLocaleString()} categorized leads.`
                  : 'Pipeline pressure will appear once leads are categorized.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Lead volume and current pipeline position. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Trend */}
        <div className="bg-card border rounded-xl p-6 shadow-sm lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-lg font-bold">Acquisition Velocity</h2>
              <p className="text-xs text-muted-foreground mt-1 font-medium">Day-by-day performance against the previous period</p>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Current</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-muted-foreground" /> Previous</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Current period</p>
              <p className="mt-1 text-lg font-black tabular-nums">{trendTotal.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Previous period</p>
              <p className="mt-1 text-lg font-black tabular-nums">{previousTrendTotal.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Peak day</p>
              <p className="mt-1 truncate text-sm font-black">{peakDay ? `${formatShortDate(peakDay.date)} · ${peakDay.total}` : '—'}</p>
            </div>
          </div>
          <div className="h-[300px]">
            {trendLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground font-medium">Loading…</div>
            ) : trendError ? (
              <div className="h-full flex flex-col items-center justify-center text-sm font-medium gap-2">
                <span className="text-red-600">Failed to load leads trend</span>
                <span className="text-xs text-muted-foreground">Refresh the dashboard to try again.</span>
              </div>
            ) : !hasTrendData ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground font-medium">
                No leads in the selected period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={comparisonRows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatShortDate}
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                    minTickGap={24}
                  />
                  <YAxis tick={{ fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                  <Tooltip
                    labelFormatter={(label) => formatShortDate(String(label))}
                    formatter={(value: number, name: string) => [`${value.toLocaleString()} leads`, name]}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontWeight: 700 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    name="Current period"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    fill="url(#leadTrendFill)"
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, fill: 'hsl(var(--card))' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    name="Previous period"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.75}
                    strokeDasharray="5 5"
                    fill="transparent"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, fill: 'hsl(var(--card))' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* By Status — each row deep-links */}
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <div className="mb-6 flex items-start gap-3">
            <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-600">
              <GitBranch className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Pipeline Distribution</h2>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                {pipelineTotal.toLocaleString()} categorized lead{pipelineTotal === 1 ? '' : 's'} across {pipelineData.length} active stage{pipelineData.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          {pipelineBottleneck && (
            <div className="mb-5 rounded-xl border border-violet-500/15 bg-violet-500/[0.06] p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-violet-600">Largest pipeline stage</p>
              <div className="mt-1.5 flex items-end justify-between gap-3">
                <span className="truncate text-sm font-black">{pipelineBottleneck.title}</span>
                <span className="shrink-0 text-lg font-black tabular-nums">{pipelineBottleneck.count.toLocaleString()}</span>
              </div>
            </div>
          )}
          {pipelineData.length === 0 ? (
            <div className="h-48 rounded-xl border border-dashed flex items-center justify-center text-sm font-medium text-muted-foreground">
              No categorized leads yet.
            </div>
          ) : (
            <div className="space-y-4 overflow-y-auto max-h-[332px] pr-2 custom-scrollbar">
              {pipelineData.map((status) => {
                const percentage = pipelineTotal ? (status.count / pipelineTotal) * 100 : 0
                return (
                  <Link key={status.id} to={('/app/leads?leadStatusId=' + status.id) as string} className="group block">
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-bold group-hover:text-primary transition-colors">{status.title}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span className="text-xs font-semibold text-muted-foreground">{percentage.toFixed(0)}%</span>
                        <span className="min-w-8 text-right font-black">{status.count.toLocaleString()}</span>
                      </span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${percentage}%` }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          <div className="mt-7 border-t pt-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Outside active stages</span>
              <span className="font-black tabular-nums">{outsideActivePipeline.toLocaleString()}</span>
            </div>
            <Link to="/app/leads" className="flex items-center justify-center gap-1.5 text-sm font-bold text-primary hover:underline">
              Open pipeline <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Source movement, contribution and period-over-period health. */}
      {isAdmin && sourceData.length > 0 && (
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold">Source Momentum</h2>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                Channel contribution and movement versus the previous {periodDays}-day period
              </p>
            </div>
            <Link to="/app/leads" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
              View leads <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
            {/* Source summary */}
            <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-3">
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Current period</p>
                  <TrendBadge value={trendChange} compact />
                </div>
                <p className="mt-2 text-3xl font-black tabular-nums">{trendTotal.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Previous period</p>
                <p className="mt-2 text-3xl font-black tabular-nums">{previousTrendTotal.toLocaleString()}</p>
              </div>
              <div className="col-span-2 lg:col-span-1 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Lifetime footprint</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black">{topSource?.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{totalSourceLeads.toLocaleString()} leads across {sourceData.length} sources</p>
                  </div>
                  <span className="shrink-0 text-2xl font-black tabular-nums">{topSource?.count.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Clickable source list */}
            <div className="lg:col-span-3 space-y-2 max-h-[328px] overflow-y-auto custom-scrollbar pr-2">
              {sourceMomentum.length === 0 && (
                <div className="flex h-48 items-center justify-center rounded-xl border border-dashed px-4 text-center text-sm font-medium text-muted-foreground">
                  No source activity in either comparison period.
                </div>
              )}
              {sourceMomentum.map((source, index) => {
                const canFilterSource = source.key !== '__other__' && source.key !== 'other'
                const href = canFilterSource
                  ? `/app/leads?fromDate=${currentPeriodStart}&toDate=${todayISO()}&website=${encodeURIComponent(source.key)}`
                  : `/app/leads?fromDate=${currentPeriodStart}&toDate=${todayISO()}`
                return (
                  <Link
                    key={`${source.key}-${index}`}
                    to={href}
                    className="group block rounded-xl border border-transparent bg-muted/40 p-3 hover:border-primary/20 hover:bg-primary/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 shrink-0 text-center text-xs font-black text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold group-hover:text-primary">{source.name}</span>
                      <span className="hidden sm:inline text-[10px] font-semibold tabular-nums text-muted-foreground">Prev {source.previous.toLocaleString()}</span>
                      <TrendBadge value={source.change} compact />
                      <span className="w-14 text-right text-sm font-black tabular-nums">{source.current.toLocaleString()}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
                    </div>
                    <div className="ml-9 mr-5 mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/80" style={{ width: `${source.share}%` }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Pending Follow-ups + Today's Call List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PendingFollowupsWidget />
        <TodaysCallList />
      </div>
    </div>
  )
}
