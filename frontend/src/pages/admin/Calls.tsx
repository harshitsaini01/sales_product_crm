import { useState, useEffect, useRef } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { callsApi, usersApi, remarksApi, leadConfigApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { maskPhone } from '@/lib/utils'
import { PhoneCall, Loader2, ArrowUpRight, Search, X, ChevronDown, ChevronLeft, ChevronRight, MessageSquareQuote, Send, Trash2, Plus, Globe, Building2 } from 'lucide-react'

import { RecordingPlayer } from '@/components/calls/RecordingPlayer'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { toast } from 'sonner'
import type { CounsellorRemark } from '@/types'

interface CallRow {
  id: number
  phoneNumber: string
  direction: 'OUTGOING' | 'INCOMING'
  status: string
  startedAt: string
  endedAt: string | null
  durationSec: number
  recordingPath: string | null
  triggeredFrom: string | null
  simSlot: number | null
  simCarrier: string | null
  simNumber: string | null
  user: { id: number; name: string } | null
  lead: {
    id: number
    name: string
    mobile: string | null
    leadStatus?: string | null
    leadSubStatus?: string | null
    departmentId?: number | null
    departmentName?: string | null
  } | null
  remarks?: CounsellorRemark[]
}


interface CallsResponse {
  data: CallRow[]
  total: number
  page: number
  limit: number
  totalPages: number
}

interface SourceCallMetric {
  source: string
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  talkTimeSec: number
}

interface DepartmentCallMetric {
  departmentName: string
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  talkTimeSec: number
}

interface CallsSummary {
  filter: {
    total: number
    answered: number
    missed: number
    noAnswer: number
    rejected: number
    busy: number
    failed: number
    totalSec: number
    answeredSec: number
  }
  today: { count: number; answered: number; talkSec: number }
  perUser: { userId: number; name: string; count: number; answered: number; talkSec: number }[]
  hourly?: { hour: number; count: number; answered: number; talkSec: number }[]
  bySource?: SourceCallMetric[]
  byDepartment?: DepartmentCallMetric[]
}

interface User {
  id: number
  name: string
  role?: string
}

const STATUSES = ['', 'ANSWERED', 'MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY', 'FAILED', 'RINGING']
const STATUS_LABELS: Record<string, string> = {
  '': 'All',
  ANSWERED: 'Answered',
  MISSED: 'Missed',
  NO_ANSWER: 'No Answer',
  REJECTED: 'Rejected',
  BUSY: 'Busy',
  FAILED: 'Failed',
  RINGING: 'Ringing',
}
const DIRECTIONS = [
  { v: '', label: 'All' },
  { v: 'OUTGOING', label: 'Outgoing' },
  { v: 'INCOMING', label: 'Incoming' },
]
const PAGE_SIZES = [50, 100, 200, 500]

// Quick-range chips next to From/To date inputs. "All time" sends empty dates.
type QuickRange = 'today' | 'yesterday' | '7d' | '30d' | '365d' | 'all'
const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '365d', label: 'Last 365 days' },
  { key: 'all', label: 'All time' },
]
function rangeFor(r: QuickRange): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  if (r === 'all') return { from: '', to: '' }
  if (r === 'today') return { from: today, to: today }
  if (r === 'yesterday') {
    const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
    return { from: y, to: y }
  }
  const days = r === '7d' ? 7 : r === '30d' ? 30 : 365
  const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10)
  return { from, to: today }
}

export default function Calls() {
  const { isAdmin, isSalesHead } = useAuthStore()
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  // Admins, sub-admins and sales-heads all see the team's calls + recordings
  // (branch-scoped server-side for sub-admin/sales-head). Only users with full phone
  // permission see full phone numbers — everyone else gets the masked number.
  const canSeeAll = isAdmin() || isSalesHead()
  const initial = rangeFor('today')

  const [userId, setUserId] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [direction, setDirection] = useState<string>('')
  const [departmentId, setDepartmentId] = useState<string>('')
  const [leadStatus, setLeadStatus] = useState<string>('')
  const [fromDate, setFromDate] = useState(initial.from)
  const [toDate, setToDate] = useState(initial.to)
  const [activeRange, setActiveRange] = useState<QuickRange | null>('today')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(100)
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [hourlyStart, setHourlyStart] = useState(10)
  const [hourlyEnd, setHourlyEnd] = useState(19)

  const [remarkCallModal, setRemarkCallModal] = useState<CallRow | null>(null)
  const [remarkHourModal, setRemarkHourModal] = useState<{ hour: number; label: string } | null>(null)

  // Debounce the search box so we don't refetch on every keystroke
  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])


  const filters = {
    userId: userId ? Number(userId) : undefined,
    status: status || undefined,
    direction: direction || undefined,
    departmentId: departmentId ? Number(departmentId) : undefined,
    leadStatus: leadStatus || undefined,
    q: q || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  }

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users-counsellors-only'],
    queryFn: () => usersApi.counsellors(),
    enabled: canSeeAll,
  })

  const { data: departments = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['lead-config-departments'],
    queryFn: leadConfigApi.departments,
  })

  const { data: leadStatuses = [] } = useQuery<{ id: number; title: string }[]>({
    queryKey: ['lead-config-statuses'],
    queryFn: leadConfigApi.statuses,
  })

  const { data, isLoading, isFetching } = useQuery<CallsResponse>({
    queryKey: ['calls', { ...filters, page, limit }],
    queryFn: () => callsApi.list({ ...filters, page, limit }),
    placeholderData: keepPreviousData,
  })

  const { data: summary } = useQuery<CallsSummary>({
    queryKey: ['calls-summary', filters],
    queryFn: () => callsApi.summary(filters),
    placeholderData: keepPreviousData,
  })

  const { data: allRemarks = [], refetch: refetchRemarks } = useQuery<CounsellorRemark[]>({
    queryKey: ['remarks', 'calls-page', { userId }],
    queryFn: () => remarksApi.list(userId ? { counsellorId: Number(userId) } : undefined),
  })

  const calls = data?.data ?? []


  const clearFilters = () => {
    setUserId(''); setStatus(''); setDirection(''); setDepartmentId(''); setLeadStatus(''); setSearchInput(''); setQ('')
    const r = rangeFor('today')
    setFromDate(r.from); setToDate(r.to); setActiveRange('today'); setPage(1)
  }

  const applyQuickRange = (r: QuickRange) => {
    const { from, to } = rangeFor(r)
    setFromDate(from); setToDate(to); setActiveRange(r); setPage(1)
  }

  const shiftMonth = (offset: number) => {
    let current = new Date()
    if (fromDate) {
      const parsed = new Date(fromDate)
      if (!isNaN(parsed.getTime())) current = parsed
    }
    
    current.setMonth(current.getMonth() + offset)
    
    // JS dates handle year rollover automatically
    const firstDay = new Date(current.getFullYear(), current.getMonth(), 1)
    const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0)
    
    // adjust to local timezone string format for inputs
    const fmt = (d: Date) => {
      const offsetMs = d.getTimezoneOffset() * 60000
      return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10)
    }
    
    setFromDate(fmt(firstDay))
    setToDate(fmt(lastDay))
    setActiveRange(null)
    setPage(1)
  }

  const currentMonthLabel = (() => {
    if (fromDate) {
      const d = new Date(fromDate)
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      }
    }
    return new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  })()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Calls</h1>
            <p className="text-sm text-muted-foreground">
              {canSeeAll ? 'All counsellor calls captured from the mobile app.' : 'Your call activity from the mobile app.'}
            </p>
          </div>
        </div>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Search bar */}
      <div className="bg-card border rounded-lg p-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={canSeeAll ? 'Search phone, lead name, or counsellor…' : 'Search phone or lead name…'}
          className="flex-1 bg-transparent text-sm outline-none"
        />
        {searchInput && (
          <button onClick={() => setSearchInput('')} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card border rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {canSeeAll && (
          <div>
            <label className="text-xs text-muted-foreground">Sales Rep</label>
            <CounsellorCombobox
              users={users}
              value={userId}
              onChange={(v) => { setUserId(v); setPage(1) }}
            />
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground">Department</label>
          <select
            value={departmentId}
            onChange={(e) => { setDepartmentId(e.target.value); setPage(1) }}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
          >
            <option value="">All Depts</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Lead Status</label>
          <select
            value={leadStatus}
            onChange={(e) => { setLeadStatus(e.target.value); setPage(1) }}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
          >
            <option value="">All Lead Statuses</option>
            {leadStatuses.map((s) => (
              <option key={s.id} value={s.title}>{s.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Call Status</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
          >
            {STATUSES.map((s) => (<option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Direction</label>
          <select
            value={direction}
            onChange={(e) => { setDirection(e.target.value); setPage(1) }}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
          >
            {DIRECTIONS.map((d) => (<option key={d.v} value={d.v}>{d.label}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">From</label>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setActiveRange(null); setPage(1) }} className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">To</label>
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setActiveRange(null); setPage(1) }} className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background" />
        </div>
        <div className="flex items-end">
          <button onClick={clearFilters} className="w-full px-3 py-1.5 text-sm border rounded hover:bg-muted/40">Reset</button>
        </div>
      </div>

      {/* Quick range chips and month switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => applyQuickRange(r.key)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                activeRange === r.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 bg-card border rounded-md px-1 py-0.5 text-sm">
          <button 
            onClick={() => shiftMonth(-1)}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-medium min-w-[80px] text-center text-xs">
            {currentMonthLabel}
          </span>
          <button 
            onClick={() => shiftMonth(1)}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats — server-side aggregates across the WHOLE filter, not just this page.
          Each card is clickable: filters to that status (or clears it when re-clicked). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat
          label={rangeStatLabel(activeRange, canSeeAll, !!userId)}
          value={summary ? summary.filter.total.toLocaleString() : '—'}
          sub={summary ? `${summary.filter.answered} answered · ${fmtHM(summary.filter.answeredSec)} talk` : undefined}
          tone="primary"
        />
        <Stat
          label="Answered"
          value={summary ? summary.filter.answered.toLocaleString() : '—'}
          sub={summary && summary.filter.total ? `${Math.round((summary.filter.answered / summary.filter.total) * 100)}% rate` : undefined}
          onClick={() => { setStatus(status === 'ANSWERED' ? '' : 'ANSWERED'); setPage(1) }}
          active={status === 'ANSWERED'}
        />
        <Stat
          label="Missed"
          value={summary ? summary.filter.missed.toLocaleString() : '—'}
          onClick={() => { setStatus(status === 'MISSED' ? '' : 'MISSED'); setPage(1) }}
          active={status === 'MISSED'}
        />
        <Stat
          label="No Answer"
          value={summary ? summary.filter.noAnswer.toLocaleString() : '—'}
          onClick={() => { setStatus(status === 'NO_ANSWER' ? '' : 'NO_ANSWER'); setPage(1) }}
          active={status === 'NO_ANSWER'}
        />
        <Stat
          label="Rejected"
          value={summary ? summary.filter.rejected.toLocaleString() : '—'}
          onClick={() => { setStatus(status === 'REJECTED' ? '' : 'REJECTED'); setPage(1) }}
          active={status === 'REJECTED'}
        />
        <Stat label="Total talk time" value={summary ? fmtHM(summary.filter.totalSec) : '—'} sub={summary && summary.filter.answered ? `avg ${fmtHM(Math.round(summary.filter.answeredSec / summary.filter.answered))}/answered` : undefined} />
      </div>

      {/* Per-counsellor leaderboard for admins + sales-head */}
      {canSeeAll && summary && summary.perUser.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b text-sm font-medium text-muted-foreground">
            Sales rep talk time (current filter)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2 font-medium">Sales Rep</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Answered</th>
                  <th className="px-3 py-2 font-medium text-right">Connect %</th>
                  <th className="px-3 py-2 font-medium text-right">Talk time</th>
                </tr>
              </thead>
              <tbody>
                {summary.perUser.map((u) => (
                  <tr key={u.userId} className="border-b hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => { setUserId(String(u.userId)); setPage(1) }}
                        className="text-primary hover:underline"
                      >
                        {u.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">{u.count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{u.answered.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{u.count ? `${Math.round((u.answered / u.count) * 100)}%` : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtHM(u.talkSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Calls by Lead Source & Calls by Department (Filter-Aware) ─── */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CallsPageSourceSection bySource={summary.bySource} />
          <CallsPageDeptSection byDepartment={summary.byDepartment} />
        </div>
      )}

      {/* Hourly Calls Analytics */}
      {summary?.hourly && summary.hourly.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="text-sm font-medium text-muted-foreground">
              Hourly Calls Analytics
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">From</label>
                <select 
                  value={hourlyStart} 
                  onChange={(e) => setHourlyStart(Number(e.target.value))}
                  className="px-2 py-1 text-xs border rounded bg-background"
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={i}>{formatHourRange(i).split(' – ')[0]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">To</label>
                <select 
                  value={hourlyEnd} 
                  onChange={(e) => setHourlyEnd(Number(e.target.value))}
                  className="px-2 py-1 text-xs border rounded bg-background"
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={i}>{formatHourRange(i).split(' – ')[1]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-6">
            {/* Chart */}
            <div className="w-full" style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                  data={summary.hourly.filter(h => h.hour >= hourlyStart && h.hour <= hourlyEnd)} 
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="hour" 
                    tickFormatter={(h) => {
                      if (h === 0) return '12a'
                      if (h === 12) return '12p'
                      return h > 12 ? `${h - 12}p` : `${h}a`
                    }}
                    tick={{ fontSize: 12, fill: '#6b7280' }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    formatter={(val: number) => [val, 'Total Calls']}
                    labelFormatter={(label: number) => formatHourRange(label)}
                    contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            
            {/* Table */}
            <div className="overflow-x-auto border rounded-lg max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur z-10">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Hour</th>
                    <th className="px-4 py-3 font-medium text-right">Total Calls</th>
                    <th className="px-4 py-3 font-medium text-right">Answered</th>
                    <th className="px-4 py-3 font-medium text-right">Talk Time</th>
                    <th className="px-4 py-3 font-medium text-right">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.hourly.filter(h => h.hour >= hourlyStart && h.hour <= hourlyEnd).map((h) => {
                    const rangeLabel = formatHourRange(h.hour)
                    const hourlyMatchRemarks = (allRemarks || []).filter(r => r.hourContext === rangeLabel)

                    return (
                      <tr key={h.hour} className="border-b hover:bg-muted/20 last:border-0 align-top">
                        <td className="px-4 py-3 text-muted-foreground font-medium">{rangeLabel}</td>
                        <td className="px-4 py-3 text-right font-medium">{h.count.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-emerald-600 font-medium">{h.answered.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-medium">{fmtHM(h.talkSec)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {hourlyMatchRemarks.length > 0 && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold text-xs flex items-center gap-1">
                                <MessageSquareQuote className="h-3 w-3" />
                                {hourlyMatchRemarks.length}
                              </span>
                            )}
                            {canSeeAll && (
                              <button
                                onClick={() => setRemarkHourModal({ hour: h.hour, label: rangeLabel })}
                                className="px-2.5 py-1 text-xs font-semibold border rounded-lg hover:bg-accent flex items-center gap-1 transition-colors text-muted-foreground hover:text-foreground"
                                title={`Add Remark for ${rangeLabel}`}
                              >
                                <Plus className="h-3 w-3" />
                                Remark
                              </button>
                            )}
                          </div>
                          {hourlyMatchRemarks.length > 0 && (
                            <div className="mt-2 space-y-1 text-left">
                              {hourlyMatchRemarks.map(r => (
                                <div key={r.id} className="text-[11px] bg-muted/40 p-2 rounded-lg border text-foreground space-y-0.5">
                                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
                                    <span>To: {r.counsellor?.name || 'Sales Rep'}</span>
                                    <span>By: {r.createdBy?.name || 'Admin'}</span>
                                  </div>
                                  <p className="text-foreground/90 whitespace-pre-wrap">{r.remark}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>

              </table>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading calls…</div>
        ) : calls.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No calls in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2 font-medium">When</th>
                  {canSeeAll && <th className="px-3 py-2 font-medium">Sales Rep</th>}
                  <th className="px-3 py-2 font-medium">Lead / Phone</th>
                  <th className="px-3 py-2 font-medium">Dept / Lead Status</th>
                  <th className="px-3 py-2 font-medium">Direction</th>
                  <th className="px-3 py-2 font-medium">Call Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  {/* <th className="px-3 py-2 font-medium">Via SIM</th> */}
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Recording</th>
                  <th className="px-3 py-2 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const dt = splitDateTime(c.startedAt)
                  return (
                  <tr key={c.id} className="border-b hover:bg-muted/20">
                    <td className="px-3 py-2 whitespace-nowrap leading-tight">
                      <div>{dt.date}</div>
                      <div className="text-xs text-muted-foreground">{dt.time}</div>
                    </td>
                    {canSeeAll && <td className="px-3 py-2 font-medium text-foreground">{c.user?.name ?? '—'}</td>}
                    <td className="px-3 py-2 leading-tight">
                      {c.lead ? (
                        <Link to="/app/leads/$leadId" params={{ leadId: String(c.lead.id) }} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 font-medium">
                          {c.lead.name} <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      ) : <span className="text-muted-foreground">unmatched</span>}
                      <div className="text-xs text-muted-foreground">{maskPhone(c.phoneNumber, canRevealPhone)}</div>
                    </td>
                    <td className="px-3 py-2 leading-tight">
                      {c.lead ? (
                        <div className="space-y-1">
                          {c.lead.departmentName && (
                            <div className="text-xs font-semibold text-foreground">
                              {c.lead.departmentName}
                            </div>
                          )}
                          {c.lead.leadStatus && (
                            <div>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                                {c.lead.leadStatus}{c.lead.leadSubStatus ? ` (${c.lead.leadSubStatus})` : ''}
                              </span>
                            </div>
                          )}
                          {!c.lead.departmentName && !c.lead.leadStatus && <span className="text-muted-foreground">—</span>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{c.direction === 'OUTGOING' ? '→ Out' : '← In'}</td>
                    <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2">{fmtDuration(c.durationSec)}</td>
                    {/* <td className="px-3 py-2 text-xs">{fmtSim(c)}</td> */}
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.triggeredFrom ?? '—'}</td>
                    <td className="px-3 py-2">{
                      c.recordingPath
                        ? (canSeeAll
                            ? <RecordingPlayer callId={c.id} />
                            : <span className="text-muted-foreground text-xs">Admin only</span>)
                        : <span className="text-muted-foreground">—</span>
                    }</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {c.remarks && c.remarks.length > 0 ? (
                          <button
                            onClick={() => setRemarkCallModal(c)}
                            className="px-2 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-amber-500/20 transition-colors"
                            title="View Call Remarks"
                          >
                            <MessageSquareQuote className="h-3 w-3" />
                            {c.remarks.length} {c.remarks.length === 1 ? 'Remark' : 'Remarks'}
                          </button>
                        ) : null}

                        {canSeeAll && (
                          <button
                            onClick={() => setRemarkCallModal(c)}
                            className="px-2 py-1 text-xs font-medium border rounded-lg hover:bg-accent transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            title="Add Remark to this Call"
                          >
                            <Plus className="h-3 w-3" />
                            Remark
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Render Modals */}
        {remarkCallModal && (
          <CallRemarkModal
            call={remarkCallModal}
            onClose={() => setRemarkCallModal(null)}
            onSuccess={() => {
              refetchRemarks()
            }}
          />
        )}

        {remarkHourModal && (
          <HourlyRemarkModal
            hourLabel={remarkHourModal.label}
            dateContext={fromDate ? new Date(fromDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Today'}
            usersList={users}
            defaultUserId={userId}
            onClose={() => setRemarkHourModal(null)}
            onSuccess={() => {
              refetchRemarks()
            }}
          />
        )}



        {/* Pagination + page size */}
        {data && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t text-sm">
            <div className="text-muted-foreground">
              {data.total === 0
                ? 'No results'
                : `Showing ${(data.page - 1) * data.limit + 1}–${Math.min(data.page * data.limit, data.total)} of ${data.total.toLocaleString()}`}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Per page</label>
                <select
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
                  className="px-2 py-1 text-sm border rounded bg-background"
                >
                  {PAGE_SIZES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPage(1)} disabled={page <= 1} className="px-2 py-1 border rounded disabled:opacity-50">« First</button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
                <span className="px-2 py-1 text-muted-foreground">Page {data.page} of {data.totalPages || 1}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= (data.totalPages || 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
                <button onClick={() => setPage(data.totalPages || 1)} disabled={page >= (data.totalPages || 1)} className="px-2 py-1 border rounded disabled:opacity-50">Last »</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone, onClick, active }: {
  label: string; value: string; sub?: string; tone?: 'primary'
  onClick?: () => void; active?: boolean
}) {
  const baseTone = tone === 'primary' ? 'border-primary/40 bg-primary/5' : ''
  const activeTone = active ? 'border-primary ring-2 ring-primary/30' : ''
  const clickTone = onClick ? 'cursor-pointer hover:border-primary/60 transition-colors text-left' : ''
  const cls = `bg-card border rounded-lg p-3 ${baseTone} ${activeTone} ${clickTone}`
  const inner = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={cls}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

const STATUS_COLOR: Record<string, string> = {
  ANSWERED: 'bg-emerald-100 text-emerald-700',
  MISSED: 'bg-amber-100 text-amber-700',
  NO_ANSWER: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  BUSY: 'bg-orange-100 text-orange-700',
  FAILED: 'bg-rose-100 text-rose-700',
  TRIGGERED: 'bg-indigo-100 text-indigo-700',
  RINGING: 'bg-blue-100 text-blue-700',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? 'bg-gray-100 text-gray-700'
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>
}

function fmtDuration(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtHM(sec: number) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function CallsPageSourceSection({ bySource = [] }: { bySource?: SourceCallMetric[] }) {
  const sumCalls = bySource.reduce((acc, c) => acc + c.callsTotal, 0)
  if (bySource.length === 0) return null

  return (
    <div className="bg-card border rounded-lg overflow-hidden p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <Globe className="h-4 w-4 text-blue-500" /> Calls by Lead Source (Source-wise Calls)
        </div>
        <span className="text-xs font-semibold text-foreground bg-muted px-2 py-0.5 rounded">{sumCalls} calls total</span>
      </div>

      {/* Distribution bar */}
      <div className="h-3 bg-muted rounded-full overflow-hidden flex">
        {bySource.map((s, idx) => {
          const pct = sumCalls > 0 ? (s.callsTotal / sumCalls) * 100 : 0
          const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-indigo-500', 'bg-rose-500', 'bg-cyan-500', 'bg-slate-400']
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

      {/* Table */}
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
            {bySource.map((s) => {
              const pct = sumCalls > 0 ? (s.callsTotal / sumCalls) * 100 : 0
              const ansRate = s.callsTotal > 0 ? Math.round((s.callsAnswered / s.callsTotal) * 100) : 0
              return (
                <tr key={s.source} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-semibold text-foreground flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
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
                    {fmtHM(s.talkTimeSec)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
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
  )
}

function CallsPageDeptSection({ byDepartment = [] }: { byDepartment?: DepartmentCallMetric[] }) {
  const sumCalls = byDepartment.reduce((acc, c) => acc + c.callsTotal, 0)
  if (byDepartment.length === 0) return null

  return (
    <div className="bg-card border rounded-lg overflow-hidden p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <Building2 className="h-4 w-4 text-purple-500" /> Calls by Department (Department Volume Share)
        </div>
        <span className="text-xs font-semibold text-foreground bg-muted px-2 py-0.5 rounded">{sumCalls} calls total</span>
      </div>

      {/* Distribution bar */}
      <div className="h-3 bg-muted rounded-full overflow-hidden flex">
        {byDepartment.map((s, idx) => {
          const pct = sumCalls > 0 ? (s.callsTotal / sumCalls) * 100 : 0
          const colors = ['bg-purple-500', 'bg-indigo-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-slate-400']
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

      {/* Table */}
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
            {byDepartment.map((s) => {
              const pct = sumCalls > 0 ? (s.callsTotal / sumCalls) * 100 : 0
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
                    {fmtHM(s.talkTimeSec)}
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
  )
}

function CounsellorCombobox({ users, value, onChange }: { users: User[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const selected = users.find((u) => String(u.id) === value)
  const filtered = q.trim()
    ? users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()))
    : users

  return (
    <div className="relative mt-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1.5 text-sm border rounded bg-background text-left"
      >
        <span className={selected ? '' : 'text-muted-foreground'}>{selected ? selected.name : 'All'}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-card border rounded-md shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search counsellor…"
                className="w-full pl-7 pr-2 py-1 text-xs border rounded bg-background outline-none"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setQ('') }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${!value ? 'bg-primary/10 text-primary font-medium' : ''}`}
            >
              All counsellors
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">No match</div>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { onChange(String(u.id)); setOpen(false); setQ('') }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${value === String(u.id) ? 'bg-primary/10 text-primary font-medium' : ''}`}
                >
                  {u.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function splitDateTime(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: '—', time: '' }
  const d = new Date(value)
  if (isNaN(d.getTime())) return { date: '—', time: '' }
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  }
}

function rangeStatLabel(active: QuickRange | null, admin: boolean, hasUserFilter: boolean): string {
  const base = active ? (QUICK_RANGES.find((r) => r.key === active)?.label ?? 'Selected range') : 'Selected range'
  if (!admin) return base
  return hasUserFilter ? `${base} (this counsellor)` : `${base} (all)`
}

// function fmtSim(c: { simSlot: number | null; simCarrier: string | null; simNumber: string | null }) {
//   if (c.simNumber) {
//     return (
//       <span>
//         {c.simNumber}
//         {c.simCarrier ? <span className="text-muted-foreground"> · {c.simCarrier}</span> : null}
//       </span>
//     )
//   }
//   if (c.simSlot != null || c.simCarrier) {
//     const slot = c.simSlot != null ? `SIM ${c.simSlot}` : null
//     return <span>{[slot, c.simCarrier].filter(Boolean).join(' · ')}</span>
//   }
//   return <span className="text-muted-foreground">—</span>
// }

function formatHourRange(hour: number) {
  const formatHour = (h: number) => {
    if (h === 0 || h === 24) return '12:00 AM'
    if (h === 12) return '12:00 PM'
    return h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`
  }
  return `${formatHour(hour)} – ${formatHour(hour + 1)}`
}

function CallRemarkModal({
  call,
  onClose,
  onSuccess,
}: {
  call: CallRow
  onClose: () => void
  onSuccess: () => void
}) {
  const { user, isAdmin } = useAuthStore()
  const canAdd = isAdmin()
  const [remarkText, setRemarkText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: remarks = [], refetch } = useQuery<CounsellorRemark[]>({
    queryKey: ['remarks', 'call', call.id],
    queryFn: () => remarksApi.list({ callId: call.id }),
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!remarkText.trim()) return
    setSubmitting(true)
    try {
      await remarksApi.create({
        callId: call.id,
        counsellorId: call.user?.id || Number(user?.id),
        remark: remarkText.trim(),
      })
      toast.success('Remark added to call')
      setRemarkText('')
      refetch()
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add remark')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this remark?')) return
    try {
      await remarksApi.delete(id)
      toast.success('Remark deleted')
      refetch()
      onSuccess()
    } catch {
      toast.error('Failed to delete remark')
    }
  }

  const dt = splitDateTime(call.startedAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card border rounded-2xl max-w-lg w-full shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base flex items-center gap-2 text-foreground">
            <MessageSquareQuote className="h-5 w-5 text-primary" />
            Call Remarks
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Call Summary Info */}
        <div className="bg-muted/30 p-3.5 rounded-xl border text-xs space-y-1.5">
          <div className="flex justify-between font-semibold">
            <span className="text-foreground">
              {call.lead ? call.lead.name : call.phoneNumber}
            </span>
            <span className="text-muted-foreground">{dt.date} {dt.time}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Sales Rep: <strong className="text-foreground">{call.user?.name || '—'}</strong></span>
            <span>Duration: {fmtDuration(call.durationSec)}</span>
          </div>
        </div>

        {/* Admin Add Remark Form */}
        {canAdd && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="text-xs font-semibold text-muted-foreground block">
              Add Remark for Sales Rep
            </label>
            <textarea
              rows={2}
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              placeholder="Write a remark for this call..."
              className="w-full p-3 border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !remarkText.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Add Remark
              </button>
            </div>
          </form>
        )}

        {/* Remarks History */}
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Remarks ({remarks.length})
          </h4>
          {remarks.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 italic text-center">No remarks added yet.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {remarks.map((r) => (
                <div key={r.id} className="p-3 border rounded-xl bg-muted/20 space-y-1 text-xs relative">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="font-semibold text-foreground">{r.createdBy?.name || 'Admin'} ({r.createdBy?.role})</span>
                    <div className="flex items-center gap-2">
                      <span>{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                      {canAdd && (
                        <button onClick={() => handleDelete(r.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-foreground/90 whitespace-pre-wrap">{r.remark}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HourlyRemarkModal({
  hourLabel,
  dateContext,
  usersList,
  defaultUserId,
  onClose,
  onSuccess,
}: {
  hourLabel: string
  dateContext?: string
  usersList: { id: number; name: string }[]
  defaultUserId?: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>(
    defaultUserId ? [Number(defaultUserId)] : usersList.map((u) => u.id)
  )
  const [remarkText, setRemarkText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isAllSelected = selectedUserIds.length === usersList.length

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedUserIds([])
    } else {
      setSelectedUserIds(usersList.map((u) => u.id))
    }
  }

  function toggleUser(id: number) {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const fullHourContext = dateContext ? `${dateContext} | ${hourLabel}` : hourLabel

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!remarkText.trim() || selectedUserIds.length === 0) {
      toast.error('Please select at least one counsellor and enter a remark')
      return
    }
    setSubmitting(true)
    try {
      await remarksApi.create({
        counsellorIds: selectedUserIds,
        hourContext: fullHourContext,
        remark: remarkText.trim(),
      })
      toast.success(`Remark added for ${selectedUserIds.length} counsellor(s)`)
      onSuccess()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add hourly remark')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card border rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base flex items-center gap-2 text-foreground">
            <MessageSquareQuote className="h-5 w-5 text-primary" />
            Add Hourly Analytics Remark
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-primary/5 border border-primary/20 p-3 rounded-xl text-xs space-y-1">
          <div className="font-semibold text-primary">Hourly Slot: {fullHourContext}</div>
          <p className="text-muted-foreground">Select counsellors to attach feedback/inquiry for this call window.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Select Sales Reps ({selectedUserIds.length}/{usersList.length}) <span className="text-destructive">*</span>
              </label>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs text-primary hover:underline font-medium"
              >
                {isAllSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="border rounded-xl p-2.5 max-h-40 overflow-y-auto space-y-1.5 bg-muted/20">
              {usersList.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-2">No counsellors found</div>
              ) : (
                usersList.map((u) => {
                  const checked = selectedUserIds.includes(u.id)
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center gap-2.5 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                        checked ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-accent text-foreground'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUser(u.id)}
                        className="rounded border-muted-foreground/30 text-primary focus:ring-primary/20 h-4 w-4"
                      />
                      <span>{u.name}</span>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">
              Remark Detail <span className="text-destructive">*</span>
            </label>
            <textarea
              rows={3}
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              placeholder="e.g. Why were call numbers lower during this hour? Please check."
              className="w-full p-3 border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-xl text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !remarkText.trim() || selectedUserIds.length === 0}
              className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Submit ({selectedUserIds.length})
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


