import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
  ClipboardCheck, ExternalLink, HelpCircle, History, ListFilter, Loader2, PhoneCall, PhoneMissed,
  PhoneOff, RotateCcw, Search, StickyNote, Trash2, Users, X,
} from 'lucide-react'
import { leadWorkApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

function localISO(): string {
  const value = new Date()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function dateOf(batch: any): string {
  return batch.workDateLabel || String(batch.workDate).slice(0, 10)
}

// Empty for a hand-picked task (assigned straight off the leads list), which
// has no single created-date cohort. Callers must handle '' — see HAND_PICKED.
function cohortOf(batch: any): string {
  if (!batch.leadDate) return ''
  return batch.leadDateLabel || String(batch.leadDate).slice(0, 10)
}

const HAND_PICKED = 'Hand-picked leads'

type ScopeFilter = 'today' | 'open' | 'all'
type StatusFilter = 'all' | 'active' | 'overdue' | 'completed'
type SortBy = 'urgency' | 'progress' | 'size' | 'newest'

// A day-wise timeline chip. Empty date = "all open" (no date filter).
function shiftISO(offsetDays: number): string {
  const base = new Date()
  base.setDate(base.getDate() + offsetDays)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}
function shortDayLabel(iso: string): { top: string; bottom: string } {
  const d = new Date(iso + 'T00:00:00')
  return {
    top: d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    bottom: String(d.getDate()),
  }
}

// Whole-day distance between two YYYY-MM-DD strings (to - from).
function daysBetweenISO(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

// "12m ago" / "3h ago" / "2d ago" — used for last-activity and age read-outs so
// a glance tells you whether a task is actually moving or sitting untouched.
function relTime(value?: string | Date | null): string {
  if (!value) return ''
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(value).toLocaleDateString()
}

// Absolute date + time, e.g. "22 Aug, 4:07 pm". relTime() answers "how long
// ago", which is the wrong question for a call log — a counsellor checking
// whether a lead has already been rung today needs the clock time.
function callStamp(value?: string | Date | null): string {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

// hydrateBatch() on the backend stamps each completed item with how it was
// completed (CALL_ANSWERED, FOLLOWUP_RECORDED, …). Surfacing that per lead is
// what turns "10 completed" into an auditable list of what actually happened.
const OUTCOME_META: Record<string, { label: string; tone: string }> = {
  CALL_ANSWERED: { label: 'Answered', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  CALL_NO_ANSWER: { label: 'No answer', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  CALL_MISSED: { label: 'Missed', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  CALL_FAILED: { label: 'Call failed', tone: 'border-red-200 bg-red-50 text-red-700' },
  CALL_BUSY: { label: 'Busy', tone: 'border-slate-200 bg-slate-100 text-slate-700' },
  CALL_REJECTED: { label: 'Rejected', tone: 'border-slate-200 bg-slate-100 text-slate-700' },
  CALL_DECLINED: { label: 'Declined', tone: 'border-slate-200 bg-slate-100 text-slate-700' },
  FOLLOWUP_RECORDED: { label: 'Follow-up recorded', tone: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  STATUS_UPDATED: { label: 'Status updated', tone: 'border-violet-200 bg-violet-50 text-violet-700' },
  // Manual marks — surface a tiny "(manual)" hint so admin can spot them and,
  // if needed, undo the mark. Colours mirror the equivalent auto outcome.
  MANUAL_ANSWERED: { label: 'Answered (manual)', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  MANUAL_NO_ANSWER: { label: 'No answer (manual)', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  MANUAL_BUSY: { label: 'Busy (manual)', tone: 'border-slate-200 bg-slate-100 text-slate-800' },
  MANUAL_WRONG_NUMBER: { label: 'Wrong number (manual)', tone: 'border-red-200 bg-red-50 text-red-800' },
  MANUAL_DND: { label: 'DND (manual)', tone: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800' },
  MANUAL_SWITCHED_OFF: { label: 'Switched off (manual)', tone: 'border-slate-200 bg-slate-100 text-slate-800' },
  MANUAL_OTHER: { label: 'Marked done', tone: 'border-sky-200 bg-sky-50 text-sky-800' },
}

const MANUAL_REASONS: Array<{ key: 'answered' | 'no_answer' | 'busy' | 'wrong_number' | 'dnd' | 'switched_off' | 'other'; label: string }> = [
  { key: 'answered',     label: 'Answered — talked' },
  { key: 'no_answer',    label: 'No answer' },
  { key: 'busy',         label: 'Busy' },
  { key: 'switched_off', label: 'Switched off' },
  { key: 'wrong_number', label: 'Wrong number' },
  { key: 'dnd',          label: 'DND / do not disturb' },
  { key: 'other',        label: 'Other reason' },
]
function outcomeOf(item: any) {
  return OUTCOME_META[item?.completionType as string] || { label: 'Done', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
}

// Per-task derived tracking numbers. Everything here comes from data the
// /lead-work/batches payload already carries — no extra requests.
function taskMetrics(task: any, today: string) {
  const items: any[] = task.items || []
  const doneItems = items.filter((item) => !!item.completedAt)
  const pendingItems = items.filter((item) => !item.completedAt)
  const lastActivity = doneItems.reduce((latest: number, item: any) => {
    const at = new Date(item.completedAt).getTime()
    return Number.isNaN(at) ? latest : Math.max(latest, at)
  }, 0)
  const workDate = dateOf(task)
  const overdueDays = task.state === 'COMPLETED' ? 0 : Math.max(0, daysBetweenISO(workDate, today))
  return { items, doneItems, pendingItems, lastActivity, workDate, overdueDays }
}

// 8 stable color themes; picked by hashing the counsellor / cohort id so the
// same counsellor always renders in the same colour across page refreshes.
type Palette = { gradient: string; borderLeft: string; chip: string; dot: string; text: string }
// Muted, professional palette — desaturated -600/-700 accents on -50/8% tints.
// Inspired by Linear / Notion / Attio: readable in dense tables, no highlighter feel.
const PALETTES: Palette[] = [
  { gradient: 'bg-slate-50', borderLeft: 'border-l-slate-500', chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-600', text: 'text-slate-700' },
  { gradient: 'bg-teal-50/60', borderLeft: 'border-l-teal-600', chip: 'bg-teal-100/70 text-teal-800', dot: 'bg-teal-700', text: 'text-teal-800' },
  { gradient: 'bg-indigo-50/60', borderLeft: 'border-l-indigo-600', chip: 'bg-indigo-100/70 text-indigo-800', dot: 'bg-indigo-700', text: 'text-indigo-800' },
  { gradient: 'bg-stone-50', borderLeft: 'border-l-stone-500', chip: 'bg-stone-100 text-stone-700', dot: 'bg-stone-600', text: 'text-stone-700' },
  { gradient: 'bg-emerald-50/60', borderLeft: 'border-l-emerald-700', chip: 'bg-emerald-100/70 text-emerald-800', dot: 'bg-emerald-700', text: 'text-emerald-800' },
  { gradient: 'bg-blue-50/60', borderLeft: 'border-l-blue-600', chip: 'bg-blue-100/70 text-blue-800', dot: 'bg-blue-700', text: 'text-blue-800' },
  { gradient: 'bg-rose-50/60', borderLeft: 'border-l-rose-600', chip: 'bg-rose-100/70 text-rose-800', dot: 'bg-rose-700', text: 'text-rose-800' },
  { gradient: 'bg-amber-50/70', borderLeft: 'border-l-amber-600', chip: 'bg-amber-100/70 text-amber-800', dot: 'bg-amber-700', text: 'text-amber-800' },
]

function paletteFor(key: string | number): Palette {
  const s = String(key)
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return PALETTES[hash % PALETTES.length]
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('')
}

// The single calling-task panel — lives on /app/tasks only (it used to be
// mirrored on the Dashboard, which showed the same tasks twice). Admins see tasks
// grouped by counsellor (each counsellor has a stable colour) with per-day
// sub-groups. Counsellors see their own tasks grouped by lead cohort date, with
// the next actionable task highlighted and locked ones explained.
export function LeadCallingTasks({
  defaultScope = 'today',
  compact = false,
  selectedDate: selectedDateProp,
  onDateChange,
  hideDateStrip = false,
}: {
  defaultScope?: ScopeFilter
  compact?: boolean
  /** Controlled date filter (YYYY-MM-DD). Empty string = "all open". */
  selectedDate?: string
  onDateChange?: (iso: string) => void
  /** When rendered under a parent that owns the date strip, hide the local one. */
  hideDateStrip?: boolean
}) {
  const { isAdmin, user } = useAuthStore()
  const admin = isAdmin()
  const meId = Number(user?.id) || 0
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['lead-work-batches'], queryFn: leadWorkApi.batches, refetchInterval: 30_000 })
  // Admin-only delete for entire batches. Leads are kept — only the task /
  // assignment row is removed. Called from the per-task trash button below.
  const deleteBatch = useMutation({
    mutationFn: (id: number) => leadWorkApi.deleteBatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-work-batches'] }),
  })
  // Manual completion for a single lead in a task. The reason is written as a
  // CallLog row on the backend, so this isn't a hidden flag — it also shows on
  // the lead and in performance reports. Undo only works for MANUAL_* items.
  const markDone = useMutation({
    mutationFn: (input: { itemId: number; reason: typeof MANUAL_REASONS[number]['key']; notes?: string }) =>
      leadWorkApi.markItemDone(input.itemId, { reason: input.reason, notes: input.notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-work-batches'] }),
  })
  const undoDone = useMutation({
    mutationFn: (itemId: number) => leadWorkApi.undoItemDone(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-work-batches'] }),
  })
  const [diagnoseItemId, setDiagnoseItemId] = useState<number | null>(null)
  const [openReasonFor, setOpenReasonFor] = useState<number | null>(null)
  const today = localISO()
  const [internalDate, setInternalDate] = useState<string>(defaultScope === 'today' ? today : '')
  const selectedDate = selectedDateProp !== undefined ? selectedDateProp : internalDate
  const setSelectedDate = (iso: string) => {
    if (onDateChange) onDateChange(iso)
    else setInternalDate(iso)
  }
  // Per-task and per-group open/closed OVERRIDES, not an opt-in set: a task
  // that still has calls left opens by default (see `defaultOpen` below), so
  // "1 call left" can never hide behind a collapsed row. An entry here only
  // records that the user disagreed with that default.
  const [openTask, setOpenTask] = useState<Record<number, boolean>>({})
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({})
  const [allOpen, setAllOpen] = useState(false)
  // Tracking controls — with dozens of live tasks a flat list is unusable.
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('urgency')
  const [showAllLeads, setShowAllLeads] = useState<Set<number>>(new Set())

  // Step 1 — date scope. A task belongs to the day it was assigned for and
  // stays there: yesterday's unfinished follow-ups are yesterday's record, not
  // extra work stapled onto today. (They used to be dragged forward, which made
  // "today" a pile of every open day at once and lost which day work came from.
  // Pick the date on the strip to go back and finish them.)
  const dateScoped = useMemo(() => {
    const all = (data || []).filter((batch: any) => batch.state !== 'CANCELLED')
    if (!selectedDate) return all.filter((batch: any) => batch.state !== 'COMPLETED')
    return all.filter((batch: any) => dateOf(batch) === selectedDate)
  }, [data, selectedDate])

  // Step 2 — status filter + free-text search. The search also looks inside a
  // task's leads, so typing a lead name or number tells you which task owns it.
  const tasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dateScoped.filter((batch: any) => {
      const overdue = batch.state !== 'COMPLETED' && dateOf(batch) < today
      if (statusFilter === 'active' && batch.state === 'COMPLETED') return false
      if (statusFilter === 'completed' && batch.state !== 'COMPLETED') return false
      if (statusFilter === 'overdue' && !overdue) return false
      if (!q) return true
      const haystack = [batch.title, batch.assignedTo?.name, batch.assignedBy?.name, batch.notes]
        .filter(Boolean).join(' ').toLowerCase()
      if (haystack.includes(q)) return true
      return (batch.items || []).some((item: any) =>
        String(item.lead?.name || '').toLowerCase().includes(q) || String(item.lead?.mobile || '').includes(q))
    })
  }, [dateScoped, statusFilter, query, today])

  const totals = useMemo(() => {
    const required = tasks.reduce((sum: number, batch: any) => sum + (batch.total || 0), 0)
    const completed = tasks.reduce((sum: number, batch: any) => sum + (batch.completed || 0), 0)
    const overdue = tasks.filter((batch: any) => batch.state !== 'COMPLETED' && dateOf(batch) < today).length
    const connected = tasks.reduce((sum: number, batch: any) => sum + (batch.summary?.connected || 0), 0)
    return {
      required,
      completed,
      pending: required - completed,
      done: tasks.filter((batch: any) => batch.state === 'COMPLETED').length,
      overdue,
      connected,
      progress: required ? Math.round((completed / required) * 100) : 0,
    }
  }, [tasks, today])

  const toggle = (id: number, isOpen: boolean) => setOpenTask((prev) => ({ ...prev, [id]: !isOpen }))
  const toggleGroup = (key: string, isOpen: boolean) => setOpenGroup((prev) => ({ ...prev, [key]: !isOpen }))

  // Ranks a task for the "urgency" sort: overdue work first, then whatever is
  // actionable right now, then locked, then finished.
  const urgencyRank = (task: any) => {
    if (task.state === 'COMPLETED') return 3
    if (dateOf(task) < today) return 0
    if (task.state === 'IN_PROGRESS') return 1
    return 2
  }
  const sortTasks = (list: any[]) => [...list].sort((a, b) => {
    if (sortBy === 'progress') return (a.progress || 0) - (b.progress || 0)
    if (sortBy === 'size') return (b.total || 0) - (a.total || 0)
    if (sortBy === 'newest') return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    const rank = urgencyRank(a) - urgencyRank(b)
    if (rank !== 0) return rank
    if ((b.remaining || 0) !== (a.remaining || 0)) return (b.remaining || 0) - (a.remaining || 0)
    return (a.sequence || 0) - (b.sequence || 0)
  })

  // Primary grouping: counsellor for admins, cohort date for counsellors.
  // Secondary grouping within: work date for admin, work date for counsellor.
  const groups = useMemo(() => {
    const primary = new Map<string, { key: string; label: string; sub: string; palette: Palette; batches: any[] }>()
    for (const batch of tasks) {
      const cohort = cohortOf(batch)
      const pKey = admin ? `c:${batch.assignedTo?.id ?? '0'}` : `d:${cohort || 'picked'}`
      const pLabel = admin ? batch.assignedTo?.name || 'Unassigned' : cohort ? `Lead cohort ${cohort}` : HAND_PICKED
      const pSub = admin
        ? `Counsellor #${batch.assignedTo?.id ?? '-'}`
        : cohort ? (cohort === today ? 'Today cohort' : cohort) : 'Picked from the leads list'
      const palette = paletteFor(admin ? batch.assignedTo?.id ?? 0 : cohort || 'picked')
      if (!primary.has(pKey)) primary.set(pKey, { key: pKey, label: pLabel, sub: pSub, palette, batches: [] })
      primary.get(pKey)!.batches.push(batch)
    }
    // Sort primary groups: for admin, most pending first; for counsellor, newest date first.
    return [...primary.values()].sort((a, b) => {
      if (admin) {
        const pa = a.batches.reduce((s, x) => s + (x.remaining || 0), 0)
        const pb = b.batches.reduce((s, x) => s + (x.remaining || 0), 0)
        return pb - pa
      }
      return b.key.localeCompare(a.key)
    })
  }, [tasks, admin, today])

  // Tasks are never gated behind one another — a counsellor works whichever of
  // the day's tasks they like, so the pill only reports progress.
  const stateTone = (state: string) =>
    state === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700'
      : state === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700'
      : 'bg-amber-100 text-amber-800'
  const stateLabel = (state: string) =>
    state === 'COMPLETED' ? 'COMPLETED' : state === 'IN_PROGRESS' ? 'IN PROGRESS' : 'ACTIVE'

  // Opens in a NEW TAB. A counsellor working through the day's tasks should
  // not lose the task board itself the moment they open a lead list from it —
  // they come straight back to it to pick up the next task.
  const openLeads = (ids: string[], label: string) => {
    if (!ids.length) return
    const search = new URLSearchParams({ ids: ids.join(','), batchLabel: label })
    window.open(`/app/leads?${search.toString()}`, '_blank', 'noopener')
  }

  if (isLoading) return null
  // When the parent owns the date strip and the currently-selected day is empty,
  // we still want to render the empty-state message so it stays in sync with the
  // personal-tasks list. Only auto-hide when the LOCAL default filter kicks in.
  if (!dateScoped.length && !hideDateStrip && selectedDate === today && !onDateChange) return null

  const filterChips: { key: StatusFilter; label: string; tone: string }[] = [
    { key: 'all', label: 'All', tone: 'text-foreground' },
    { key: 'active', label: 'Active', tone: 'text-blue-700' },
    { key: 'overdue', label: totals.overdue ? `Overdue (${totals.overdue})` : 'Overdue', tone: 'text-red-600' },
    { key: 'completed', label: 'Completed', tone: 'text-emerald-700' },
  ]

  return <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-primary/15 p-2 text-primary"><ClipboardCheck className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-black">Calling Tasks — {admin ? 'grouped by counsellor' : 'your leads to call'}</h3>
            <p className="text-[11px] text-muted-foreground">
              {admin
                ? 'Colour-coded per counsellor. Every task stays on the day it was assigned for.'
                : 'Every task for the day is workable — no order to follow. Refreshes every 30 s.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {/* Overall completion read-out — the one number that answers "are we done?" */}
        {!!tasks.length && <div className="flex items-center gap-2">
          <div className="text-right leading-tight">
            <p className="text-sm font-black tabular-nums">{totals.completed}<span className="font-normal text-muted-foreground">/{totals.required}</span></p>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">leads worked</p>
          </div>
          <div className="w-28">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full transition-all ${totals.progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${totals.progress}%` }} />
            </div>
            <p className="mt-0.5 text-right text-[9px] font-bold tabular-nums text-muted-foreground">{totals.progress}% complete</p>
          </div>
        </div>}
        </div>
      </div>
      {!hideDateStrip && <DayStrip today={today} selectedDate={selectedDate} onChange={setSelectedDate} />}

      {/* Tracking toolbar: search across tasks AND their leads, status filter,
          sort order, and a bulk expand/collapse for long lists. */}
      {!!dateScoped.length && <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={admin ? 'Search task, counsellor, lead name or number...' : 'Search task or lead name / number...'}
            className="h-8 w-full rounded-lg border bg-background pl-8 pr-7 text-xs outline-none focus:border-primary"
          />
          {!!query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
          {filterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => setStatusFilter(chip.key)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${statusFilter === chip.key ? 'bg-primary text-primary-foreground' : `${chip.tone} hover:bg-muted`}`}>
              {chip.label}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="h-8 rounded-lg border bg-background px-2 text-[11px] font-bold outline-none focus:border-primary">
          <option value="urgency">Sort: most urgent</option>
          <option value="progress">Sort: least progress</option>
          <option value="size">Sort: most leads</option>
          <option value="newest">Sort: newest first</option>
        </select>
        <button type="button"
          onClick={() => { const next = !allOpen; setAllOpen(next); setOpenGroup(Object.fromEntries(groups.map((g) => [g.key, next]))) }}
          className="inline-flex h-8 items-center gap-1 rounded-lg border bg-background px-2.5 text-[11px] font-bold hover:bg-muted">
          {allOpen ? <><ChevronsDownUp className="h-3.5 w-3.5" /> Collapse all</> : <><ChevronsUpDown className="h-3.5 w-3.5" /> Expand all</>}
        </button>
      </div>}

      {!!tasks.length && <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
        {admin && <MiniStat label="Counsellors" value={groups.length} tone="text-primary" />}
        <MiniStat label="Tasks" value={tasks.length} />
        <MiniStat label="Leads" value={totals.required} />
        <MiniStat label="Done" value={totals.completed} tone="text-emerald-700" />
        <MiniStat label="Pending" value={totals.pending} tone="text-red-600" />
        <MiniStat label="Overdue tasks" value={totals.overdue} tone={totals.overdue ? 'text-red-600' : 'text-muted-foreground'} />
        {!admin && <MiniStat label="Answered" value={totals.connected} tone="text-emerald-700" />}
      </div>}
    </div>

    <div className="divide-y">
      {tasks.length ? groups.map((group) => {
        const groupRequired = group.batches.reduce((s, x) => s + (x.total || 0), 0)
        const groupCompleted = group.batches.reduce((s, x) => s + (x.completed || 0), 0)
        const groupPending = groupRequired - groupCompleted
        const groupProgress = groupRequired ? Math.round((groupCompleted / groupRequired) * 100) : 0
        const groupTasksDone = group.batches.filter((x) => x.state === 'COMPLETED').length
        const groupOverdue = group.batches.filter((x) => x.state !== 'COMPLETED' && dateOf(x) < today).length
        // Aggregate call-outcome tracking pulled from the batch.summary that the
        // backend hydrates from MobileCall / CallLog / LeadFollowup rows. We also
        // collect the underlying lead ids per bucket so each chip can deep-link
        // to a Leads view filtered to exactly those leads.
        const collectIds = (key: 'answeredLeadIds' | 'noAnswerLeadIds' | 'followupLeadIds') => {
          const ids = new Set<string>()
          for (const b of group.batches) for (const id of (b.summary?.[key] || [])) if (id) ids.add(String(id))
          return [...ids]
        }
        const answeredIds = collectIds('answeredLeadIds')
        const noAnswerIds = collectIds('noAnswerLeadIds')
        const followupIds = collectIds('followupLeadIds')
        const groupConnected = answeredIds.length || group.batches.reduce((s, x) => s + (x.summary?.connected || 0), 0)
        const groupNoAnswer = noAnswerIds.length || group.batches.reduce((s, x) => s + (x.summary?.noAnswer || 0), 0)
        const groupFollowups = followupIds.length || group.batches.reduce((s, x) => s + (x.summary?.followupsCreated || 0), 0)
        // A search query implies intent to see the matches — auto-open then.
        // Counsellors default to OPEN: the group is their own work, and there is
        // nothing to protect them from. Admins default to closed because a busy
        // board has a group per counsellor.
        const groupOpen = openGroup[group.key] ?? (!admin || !!query.trim() || groups.length === 1)

        // Sub-group batches by work date so each list stays chronological.
        const byDate = new Map<string, any[]>()
        for (const batch of group.batches) {
          const key = dateOf(batch)
          if (!byDate.has(key)) byDate.set(key, [])
          byDate.get(key)!.push(batch)
        }
        const orderedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))

        return <div key={group.key} className={`border-l-2 ${group.palette.borderLeft}`}>
          {/* Group header — counsellor name (admin) or cohort date (counsellor). */}
          <button type="button" onClick={() => toggleGroup(group.key, groupOpen)}
            className={`flex w-full items-center justify-between gap-3 ${group.palette.gradient} border-b border-border/50 px-4 py-3 text-left transition hover:bg-muted/40`}>
            <div className="flex items-center gap-3 min-w-0">
              {admin ? (
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${group.palette.dot}`}>
                  {initialsOf(group.label)}
                </div>
              ) : (
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${group.palette.dot}`}>
                  <Users className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`truncate text-sm font-semibold ${group.palette.text}`}>{group.label}</p>
                  {!!groupOverdue && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase text-red-600"><AlertTriangle className="h-2.5 w-2.5" />{groupOverdue} overdue</span>}
                </div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group.batches.length} task{group.batches.length > 1 ? 's' : ''} · {groupTasksDone}/{group.batches.length} complete · {group.sub}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Call-outcome chips — each one deep-links to exactly those leads. */}
              <div className="hidden lg:flex items-center gap-1">
                <StatChip icon={<CheckCircle2 className="h-3 w-3" />} tone="text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100" value={groupConnected} label="answered" onClick={(e) => { e.stopPropagation(); openLeads(answeredIds, `${group.label} · answered`) }} />
                <StatChip icon={<PhoneMissed className="h-3 w-3" />} tone="text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100" value={groupNoAnswer} label="no answer" onClick={(e) => { e.stopPropagation(); openLeads(noAnswerIds, `${group.label} · no answer`) }} />
                <StatChip icon={<StickyNote className="h-3 w-3" />} tone="text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100" value={groupFollowups} label="follow-ups" onClick={(e) => { e.stopPropagation(); openLeads(followupIds, `${group.label} · follow-ups changed`) }} />
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <div className="text-right leading-tight">
                  <p className={`text-sm font-bold tabular-nums ${group.palette.text}`}>{groupCompleted}<span className="text-muted-foreground font-normal">/{groupRequired}</span></p>
                  <p className="text-[9px] font-medium uppercase text-muted-foreground">{groupPending} pending</p>
                </div>
                <div className="w-24">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full transition-all ${group.palette.dot}`} style={{ width: `${groupProgress}%` }} />
                  </div>
                  <p className="mt-0.5 text-right text-[9px] font-semibold text-muted-foreground tabular-nums">{groupProgress}%</p>
                </div>
              </div>
              {/* Group-level shortcut — union of ALL lead ids across this group. */}
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  const idSet = new Set<string>()
                  for (const b of group.batches) for (const it of (b.items || [])) {
                    const id = String(it.lead?.id ?? '')
                    if (id) idSet.add(id)
                  }
                  openLeads([...idSet], `${admin ? 'All tasks' : 'All my tasks'} · ${group.label}`)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    ;(event.currentTarget as HTMLSpanElement).click()
                  }
                }}
                className="hidden md:inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[10px] font-bold text-foreground hover:bg-muted"
                title="Open the Leads page filtered to every lead across this group's tasks"
              >
                <ListFilter className="h-3 w-3" /> View leads
              </span>
              <div className="rounded-md border border-border/60 bg-background p-1 text-muted-foreground">
                {groupOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </div>
            </div>
          </button>

          {groupOpen && <div className="divide-y">
            {orderedDates.map((groupDate) => {
              const dateTag = groupDate === today ? 'TODAY' : groupDate
              const dayTasks = sortTasks(byDate.get(groupDate)!)
              const dayBehind = groupDate < today && dayTasks.some((t) => t.state !== 'COMPLETED')
              return <div key={`${group.key}-${groupDate}`}>
                <div className="flex items-center gap-2 bg-muted/40 px-4 py-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                  <span>{dateTag}</span><span className="text-muted-foreground/60">·</span>
                  <span>{dayTasks.length} task{dayTasks.length > 1 ? 's' : ''}</span>
                  {dayBehind && <span className="inline-flex items-center gap-1 text-red-600"><History className="h-3 w-3" /> still unfinished</span>}
                </div>
                {dayTasks.map((task: any) => {
                  const id = Number(task.id)
                  const m = taskMetrics(task, today)
                  const isComplete = task.state === 'COMPLETED'
                  // Anything with calls left opens itself — see `openTask`.
                  const isOpen = openTask[id] ?? (!isComplete && m.pendingItems.length > 0)
                  // ONE list, never two tabs: leads still to call on top, the
                  // ones already done underneath with a Done marker. A lead
                  // vanishing the instant a call lands reads as data loss.
                  const listItems = [...m.pendingItems, ...m.doneItems]
                  const cap = compact ? 6 : 25
                  const shown = showAllLeads.has(id) ? listItems : listItems.slice(0, cap)
                  const leadIdsOf = (rows: any[]) => rows.map((it: any) => String(it.lead?.id ?? '')).filter(Boolean)
                  // Dense per-day position — "Task 2 of 3" for this counsellor
                  // on this work date. Falls back to the stored sequence on an
                  // older backend that doesn't send the day numbers.
                  const dayNo = task.daySequence || task.sequence
                  const dayCount = task.dayTaskCount || 0

                  return <div key={task.id} className={`p-4 transition ${isComplete ? 'border-l-2 border-l-emerald-500 bg-emerald-50/50 hover:bg-emerald-50' : m.overdueDays ? 'border-l-2 border-l-red-400 hover:bg-muted/20' : 'hover:bg-muted/20'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => toggle(id, isOpen)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${isComplete ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground'}`}>
                          {dayNo}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Day-wise task number — what a counsellor tracks
                                their day by ("2 of 3 done"), not the row id. */}
                            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary">
                              Task {dayNo}{dayCount ? ` of ${dayCount}` : ''}
                            </span>
                            <b className="text-sm">{task.title}</b>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${stateTone(task.state)}`}>{stateLabel(task.state)}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{task.workType === 'FOLLOWUP' ? 'Follow-up' : 'Call'}</span>
                            {admin && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${group.palette.chip}`}>{task.assignedTo?.name}</span>}
                            {!!m.overdueDays && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-black text-red-600"><AlertTriangle className="h-3 w-3" />{m.overdueDays}d overdue</span>}
                            {!m.overdueDays && m.workDate === today && task.state !== 'COMPLETED' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">DUE TODAY</span>}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Assigned by {task.assignedBy?.name} · Work date {m.workDate} · {cohortOf(task) ? `Lead cohort ${cohortOf(task)}` : HAND_PICKED}
                            {task.createdAt ? ` · created ${relTime(task.createdAt)}` : ''}
                          </p>
                          {/* Movement tracking — is this task actually being worked? */}
                          <p className="mt-0.5 text-[11px] font-semibold">
                            {m.lastActivity
                              ? <span className="text-emerald-700">Last activity {relTime(new Date(m.lastActivity))}</span>
                              : task.state === 'COMPLETED'
                                ? <span className="text-emerald-700">Finished</span>
                                : <span className="text-amber-700">No activity logged yet</span>}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className={`text-lg font-black ${task.remaining ? 'text-primary' : 'text-emerald-600'}`}>{task.remaining}</p>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">left of {task.total}</p>
                        </div>
                        {/* View leads → Leads page filtered to this batch's lead ids. */}
                        <button
                          type="button"
                          onClick={() => openLeads(leadIdsOf(task.items || []), `${task.title} · ${m.workDate}${admin && task.assignedTo?.name ? ` · ${task.assignedTo.name}` : ''}`)}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
                          title="Open these leads on the Leads page in a new tab"
                        >
                          <ListFilter className="h-3.5 w-3.5" /> View leads <ExternalLink className="h-3 w-3 opacity-70" />
                        </button>
                        {admin && (
                          <button
                            type="button"
                            onClick={() => {
                              const summary = `Delete task #${task.sequence} for ${task.assignedTo?.name || 'this counsellor'}?\n"${task.title}"\n${task.total} lead${task.total !== 1 ? 's' : ''} will be removed from this task (leads themselves are kept).`
                              if (window.confirm(summary)) deleteBatch.mutate(id)
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-border/60 bg-background p-1.5 text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                            title="Delete this task (admin)"
                          >
                            {deleteBatch.isPending && deleteBatch.variables === id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button type="button" onClick={() => toggle(id, isOpen)} className="text-muted-foreground hover:text-foreground">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full transition-all ${task.progress === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-primary/70 to-primary'}`} style={{ width: `${task.progress}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] font-bold text-muted-foreground"><span>{task.completed} completed</span><span>{task.progress}%</span></div>
                    </div>

                    {/* Per-task outcome rail — what the calls actually produced.
                        Each chip deep-links to exactly those leads. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatChip icon={<CheckCircle2 className="h-3 w-3" />} tone="text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                        value={task.summary?.connected || 0} label="answered"
                        onClick={() => openLeads(task.summary?.answeredLeadIds || [], `${task.title} · answered`)} />
                      <StatChip icon={<PhoneOff className="h-3 w-3" />} tone="text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100"
                        value={task.summary?.noAnswer || 0} label="no answer"
                        onClick={() => openLeads(task.summary?.noAnswerLeadIds || [], `${task.title} · no answer`)} />
                      <StatChip icon={<StickyNote className="h-3 w-3" />} tone="text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100"
                        value={task.summary?.followupsCreated || 0} label="follow-ups set"
                        onClick={() => openLeads(task.summary?.followupLeadIds || [], `${task.title} · follow-ups`)} />
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                        <PhoneCall className="h-3 w-3" />{m.pendingItems.length} still to {task.workType === 'FOLLOWUP' ? 'follow up' : 'call'}
                      </span>
                    </div>

                    {task.notes && <div className="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-2.5 text-xs">
                      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase text-amber-800"><StickyNote className="h-3 w-3" /> Note from {task.assignedBy?.name}</p>
                      <p className="whitespace-pre-wrap text-amber-900">{task.notes}</p>
                    </div>}

                    {isOpen && <div className="mt-3">
                      {/* One list: still to call on top, already called below —
                          nothing disappears when a call lands. */}
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                          {m.pendingItems.length} to {task.workType === 'FOLLOWUP' ? 'follow up' : 'call'}
                        </span>
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                          {m.doneItems.length} done
                        </span>
                        {!!listItems.length && <button type="button"
                          onClick={() => openLeads(leadIdsOf(listItems), task.title)}
                          className="ml-auto inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[10px] font-bold hover:bg-muted">
                          <ListFilter className="h-3 w-3" /> Open these {listItems.length} <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                        </button>}
                      </div>

                      {shown.length ? <div className="grid gap-1.5">
                        {shown.map((item: any) => {
                          const done = !!item.completedAt
                          const outcome = outcomeOf(item)
                          const itemIdNum = Number(item.id)
                          const isMineOrAdmin = admin || Number(task.assignedTo?.id) === meId
                          const isManual = typeof item.completionType === 'string' && item.completionType.startsWith('MANUAL_')
                          const reasonOpen = openReasonFor === itemIdNum
                          return <div key={item.id} className={`group relative rounded-lg border px-3 py-2 text-xs transition hover:border-primary ${done ? 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50' : 'bg-background hover:bg-primary/5'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <Link to="/app/leads/$leadId" params={{ leadId: String(item.lead.id) }}
                                className="min-w-0 flex-1"
                                onClick={() => setOpenReasonFor(null)}>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`font-bold ${done ? 'text-emerald-900' : 'group-hover:text-primary'}`}>{item.lead.name || `Lead #${item.lead.id}`}</span>
                                  {/* Done marker, right behind the name. */}
                                  {done && <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white"><CheckCircle2 className="h-2.5 w-2.5" /> Done</span>}
                                  {item.lead.mobile && <span className="text-muted-foreground">{item.lead.mobile}</span>}
                                  {item.lead.leadStatus && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-600">{item.lead.leadStatus}</span>}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px]">
                                  {done
                                    ? <>
                                        <span className={`rounded-full border px-1.5 py-0.5 font-bold ${outcome.tone}`}>{outcome.label}</span>
                                        <span className="text-muted-foreground">{relTime(item.completedAt)}</span>
                                      </>
                                    : <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">Pending</span>}
                                  {/* When the number was actually last rung — date AND
                                      time, so "already tried today" is answerable. */}
                                  {item.lastCallAt && <span className="inline-flex items-center gap-1 text-muted-foreground"><PhoneCall className="h-2.5 w-2.5" /> Last call {callStamp(item.lastCallAt)}{item.callAttempts > 1 ? ` · ${item.callAttempts} attempts` : ''}</span>}
                                  {item.lead.followupDate && task.workType === 'FOLLOWUP' && <span className="text-orange-600">Follow-up due {String(item.lead.followupDate).slice(0, 10)}</span>}
                                </div>
                              </Link>
                              <div className="flex shrink-0 items-center gap-1">
                                {!done && isMineOrAdmin && (
                                  <>
                                    <button type="button"
                                      onClick={() => setOpenReasonFor((prev) => prev === itemIdNum ? null : itemIdNum)}
                                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                                      title="Mark this lead done with a reason (writes a CallLog row)">
                                      <CheckCircle2 className="h-3 w-3" /> Mark done
                                    </button>
                                    <button type="button"
                                      onClick={() => setDiagnoseItemId(itemIdNum)}
                                      className="inline-flex items-center justify-center rounded-md border border-border/60 bg-background p-1 text-muted-foreground hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                                      title="Why isn't this marked done? Shows every call & activity considered.">
                                      <HelpCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                                {done && isManual && isMineOrAdmin && (
                                  <button type="button"
                                    onClick={() => { if (window.confirm('Undo this manual mark? This item will go back to pending.')) undoDone.mutate(itemIdNum) }}
                                    className="inline-flex items-center justify-center rounded-md border border-border/60 bg-background p-1 text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                                    title="Undo the manual mark (only works for manually-marked items)">
                                    {undoDone.isPending && undoDone.variables === itemIdNum ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                                <PhoneCall className="h-3.5 w-3.5 text-primary opacity-0 transition group-hover:opacity-100" />
                              </div>
                            </div>
                            {reasonOpen && !done && (
                              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-2">
                                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">Mark as…</p>
                                <div className="grid grid-cols-2 gap-1">
                                  {MANUAL_REASONS.map((r) => (
                                    <button key={r.key} type="button"
                                      disabled={markDone.isPending}
                                      onClick={() => markDone.mutate({ itemId: itemIdNum, reason: r.key }, { onSuccess: () => setOpenReasonFor(null) })}
                                      className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-left text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                                      {r.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="mt-1.5 flex items-center justify-between">
                                  <p className="text-[10px] text-emerald-800/80">This writes a call log for the lead — visible on the lead page and in reports.</p>
                                  <button type="button" onClick={() => setOpenReasonFor(null)} className="text-[10px] font-bold text-emerald-700 hover:underline">Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        })}
                        {listItems.length > shown.length && <button type="button"
                          onClick={() => setShowAllLeads((prev) => { const next = new Set(prev); next.add(id); return next })}
                          className="rounded-lg border border-dashed py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-muted">
                          Show all {listItems.length} leads
                        </button>}
                      </div> : <p className="rounded-lg border p-3 text-center text-xs font-bold text-muted-foreground">
                        No leads in this task.
                      </p>}
                    </div>}
                  </div>
                })}
              </div>
            })}
          </div>}
        </div>
      }) : <div className="p-6 text-center text-sm text-muted-foreground">
        {query || statusFilter !== 'all'
          ? <>No task matches this filter. <button type="button" onClick={() => { setQuery(''); setStatusFilter('all') }} className="font-bold text-primary hover:underline">Clear filters</button></>
          : <>No {selectedDate === today ? 'calling work for today' : selectedDate ? 'calling work on this date' : 'open calling work'} yet.</>}
      </div>}
    </div>
    {diagnoseItemId !== null && (
      <DiagnoseModal itemId={diagnoseItemId} onClose={() => setDiagnoseItemId(null)} />
    )}
  </section>
}

// "Why isn't this marked done?" — opens against one task item. Shows the
// window the backend uses to credit activity, every recent call/follow-up on
// the phone (across duplicate lead rows), and a short list of plain-English
// reasons the backend produced. The counsellor still has to hit "Mark done"
// afterwards — this panel is purely diagnostic.
function DiagnoseModal({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['lead-work-diagnose', itemId],
    queryFn: () => leadWorkApi.diagnoseItem(itemId),
    staleTime: 0,
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Why isn't this marked done?</p>
            {data?.lead && <p className="text-sm font-bold">{data.lead.name || `Lead #${data.lead.id}`} · {data.lead.mobile || '—'}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[calc(85vh-56px)] overflow-y-auto p-4">
          {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {!!error && <p className="text-sm text-red-600">Failed to load diagnostics.</p>}
          {data && <div className="space-y-4 text-sm">
            <section>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reasons</p>
              <ul className="list-disc space-y-1 pl-5">
                {data.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
              </ul>
            </section>
            <section className="rounded-lg border bg-muted/30 p-2 text-[11px]">
              <p><span className="font-bold">Credit window starts:</span> {new Date(data.task.windowStart).toLocaleString()}</p>
              <p><span className="font-bold">Task type:</span> {data.task.workType} — {data.task.workType === 'INITIAL_CALL' ? 'only calls count' : 'follow-ups + status changes count'}</p>
              <p><span className="font-bold">Assigned to:</span> {data.task.assignedToName}</p>
              <p><span className="font-bold">Phones checked:</span> {(data.phoneKeys || []).join(', ') || '—'} · duplicates: {(data.siblingLeadIds || []).length}</p>
            </section>
            <section>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent mobile-app calls ({data.recent.mobileCalls.length})</p>
              {data.recent.mobileCalls.length ? <div className="overflow-hidden rounded-md border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th className="px-2 py-1">When</th><th>Phone</th><th>Status</th><th>By</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.recent.mobileCalls.map((call: any) => (
                      <tr key={call.id}><td className="px-2 py-1">{new Date(call.startedAt).toLocaleString()}</td><td>{call.phoneNumber}</td><td className={call.status === 'ANSWERED' ? 'text-emerald-700 font-bold' : call.status === 'TRIGGERED' ? 'text-red-700 font-bold' : 'text-amber-700'}>{call.status}</td><td>{call.user?.name}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div> : <p className="text-xs text-muted-foreground">No mobile-app calls for this number.</p>}
            </section>
            <section>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent manual call logs ({data.recent.callLogs.length})</p>
              {data.recent.callLogs.length ? <div className="overflow-hidden rounded-md border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th className="px-2 py-1">When</th><th>Outcome</th><th>By</th><th>Notes</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.recent.callLogs.map((call: any) => (
                      <tr key={call.id}><td className="px-2 py-1">{new Date(call.createdAt).toLocaleString()}</td><td>{call.outcome}</td><td>{call.user?.name}</td><td className="max-w-[240px] truncate" title={call.notes}>{call.notes || ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div> : <p className="text-xs text-muted-foreground">No manual call logs.</p>}
            </section>
            {!!data.recent.followups.length && <section>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent follow-ups ({data.recent.followups.length})</p>
              <ul className="space-y-0.5 text-[11px]">
                {data.recent.followups.map((row: any) => <li key={row.id}>{new Date(row.createdAt).toLocaleString()} · {row.user?.name} · {row.comment?.slice(0, 80)}</li>)}
              </ul>
            </section>}
            {!!data.recent.statusChanges.length && <section>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent status changes ({data.recent.statusChanges.length})</p>
              <ul className="space-y-0.5 text-[11px]">
                {data.recent.statusChanges.map((row: any) => <li key={row.id}>{new Date(row.createdAt).toLocaleString()} · {row.changedBy?.name} → {row.toStatus}</li>)}
              </ul>
            </section>}
          </div>}
        </div>
      </div>
    </div>
  )
}

// Day-wise timeline chip strip. 7 days back → today (highlighted) → 7 days
// forward. Empty selectedDate = "All open" (ignores date). Exported so a parent
// wrapper (e.g. Tasks.tsx) can share the same widget above the personal tasks.
export function DayStrip({ today, selectedDate, onChange }: { today: string; selectedDate: string; onChange: (iso: string) => void }) {
  const days: string[] = []
  for (let i = -7; i <= 7; i++) days.push(shiftISO(i))
  // Unfinished work no longer promotes itself onto today, so a day left
  // half-done has to be findable from right here. Reads the SAME cached query
  // the task list uses, so this costs no extra request.
  const { data } = useQuery({ queryKey: ['lead-work-batches'], queryFn: leadWorkApi.batches, refetchInterval: 30_000 })
  const openByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const batch of (data || [])) {
      if (batch.state === 'COMPLETED' || batch.state === 'CANCELLED') continue
      const iso = dateOf(batch)
      map.set(iso, (map.get(iso) || 0) + 1)
    }
    return map
  }, [data])
  const totalOpen = [...openByDay.values()].reduce((sum, n) => sum + n, 0)
  // Anything outside the ±7-day window would otherwise be unreachable from the
  // strip; "All open" is where it lives, so say how much is hiding there.
  const olderOpen = [...openByDay.entries()]
    .filter(([iso]) => iso < days[0] || iso > days[days.length - 1])
    .reduce((sum, [, n]) => sum + n, 0)
  return (
    <div className="mt-3 -mx-1 flex items-stretch gap-1 overflow-x-auto px-1 pb-1">
      <button
        type="button"
        onClick={() => onChange('')}
        className={`shrink-0 rounded-md border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition ${
          selectedDate === '' ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted'
        }`}
        title="Show every open task regardless of date"
      >
        All open{totalOpen ? ` · ${totalOpen}` : ''}
      </button>
      {olderOpen > 0 && selectedDate !== '' && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-800 transition hover:bg-amber-100"
          title="Open tasks dated outside the last / next 7 days"
        >
          +{olderOpen} outside this range
        </button>
      )}
      {days.map((iso) => {
        const isToday = iso === today
        const isSelected = iso === selectedDate
        const open = openByDay.get(iso) || 0
        const { top, bottom } = shortDayLabel(iso)
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onChange(iso)}
            className={`relative shrink-0 min-w-[52px] rounded-md border px-2.5 py-1.5 text-center transition ${
              isSelected
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : isToday
                ? 'border-primary/60 bg-primary/10 text-primary hover:bg-primary/20'
                : open
                ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                : 'border-border/60 bg-background text-muted-foreground hover:bg-muted'
            }`}
            title={open ? `${iso} — ${open} open task${open > 1 ? 's' : ''}` : iso}
          >
            <p className="text-[9px] font-bold uppercase tracking-wider leading-tight">{isToday ? 'Today' : top}</p>
            <p className="text-sm font-bold tabular-nums leading-tight">{bottom}</p>
            {/* Amber dot = this day still has unfinished tasks. */}
            {!!open && <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-primary-foreground' : 'bg-amber-500'}`} />}
          </button>
        )
      })}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-lg border bg-background p-2 text-center">
    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`text-base font-bold tabular-nums ${tone || 'text-foreground'}`}>{value}</p>
  </div>
}

function StatChip({ icon, tone, value, label, onClick }: { icon: ReactNode; tone: string; value: number; label: string; onClick?: (e: React.MouseEvent) => void }) {
  const interactive = !!onClick && value > 0
  const base = `inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition ${tone}`
  if (!interactive) {
    return <span className={`${base} ${value === 0 ? 'opacity-60' : ''}`} title={`${value} ${label}`}>{icon}{value} {label}</span>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} cursor-pointer`}
      title={`Open the ${value} lead${value === 1 ? '' : 's'} with ${label}`}
    >
      {icon}{value} {label}
    </button>
  )
}
