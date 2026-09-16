import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CalendarDays, Check, ClipboardCheck, Clock3, PhoneCall, Plus, StickyNote, Users, X } from 'lucide-react'
import { leadWorkApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { LeadCallingTasks } from '@/components/tasks/LeadCallingTasks'

type LeadRow = { id: number; name: string; mobile?: string | null; email?: string | null; city?: string | null; state?: string | null; interest?: string | null; source?: string | null; sourceUrl?: string | null; website?: string | null; note?: string | null; attempted: boolean; answered: boolean; pendingFollowup: boolean; assignedTo: { id: number; name: string }[] }
type DrillFilter = { kind: 'total' | 'assigned' | 'called' | 'connected' | 'followups' | 'pending' | 'counsellor-pending' | 'counsellor-called' | 'counsellor-assigned' | 'counsellor-connected'; counsellorId?: number; title: string }

type DateView = 'today' | 'yesterday' | 'last7' | 'custom'
type DayRow = { date: string; total: number; assigned: number; attempted: number; answered: number; followups: number; pending: number }

function localISO(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })
}

export default function LeadWorkboard({ hideTaskBoard = false }: { hideTaskBoard?: boolean } = {}) {
  const { user } = useAuthStore()
  const admin = !!user?.roles?.some((role) => role === 'admin' || role === 'sub-admin')
  const [date, setDate] = useState(localISO())
  const [dateView, setDateView] = useState<DateView>('today')
  const [drill, setDrill] = useState<DrillFilter | null>(null)

  const board = useQuery({ queryKey: ['lead-workboard', date], queryFn: () => leadWorkApi.workboard(date), enabled: admin, refetchInterval: 30_000 })
  const history = useQuery<DayRow[]>({ queryKey: ['lead-work-history', date], queryFn: () => leadWorkApi.history(date, 7), enabled: admin })
  const batches = useQuery({ queryKey: ['lead-work-batches'], queryFn: leadWorkApi.batches, refetchInterval: 30_000 })
  const visibleDays = useMemo(() => dateView === 'last7' ? (history.data || []).slice(0, 7) : (history.data || []).filter((row) => row.date === date).slice(0, 1), [dateView, history.data, date])

  const chooseView = (view: DateView, nextDate: string) => {
    setDateView(view)
    setDate(nextDate)
  }

  const drillLeads = useMemo<LeadRow[]>(() => {
    const leads: LeadRow[] = board.data?.leads || []
    if (!drill) return []
    switch (drill.kind) {
      case 'total': return leads
      case 'assigned': return leads.filter((lead) => lead.assignedTo.length > 0)
      case 'called': return leads.filter((lead) => lead.attempted)
      case 'connected': return leads.filter((lead) => lead.answered)
      case 'followups': return leads.filter((lead) => lead.pendingFollowup)
      case 'pending': return leads.filter((lead) => !lead.attempted)
      case 'counsellor-assigned': return leads.filter((lead) => lead.assignedTo.some((a) => a.id === drill.counsellorId))
      case 'counsellor-called': return leads.filter((lead) => lead.attempted && lead.assignedTo.some((a) => a.id === drill.counsellorId))
      case 'counsellor-connected': return leads.filter((lead) => lead.answered && lead.assignedTo.some((a) => a.id === drill.counsellorId))
      case 'counsellor-pending': return leads.filter((lead) => !lead.attempted && lead.assignedTo.some((a) => a.id === drill.counsellorId))
    }
  }, [drill, board.data])

  if (!admin) return <CounsellorTasks batches={batches.data || []} loading={batches.isLoading} />

  const metrics: { label: string; value: any; Icon: any; tone: string; drill: DrillFilter }[] = [
    { label: 'Received', value: board.data?.total, Icon: Users, tone: 'text-blue-600', drill: { kind: 'total', title: `All leads created ${date}` } },
    { label: 'Assigned', value: board.data?.assigned, Icon: ClipboardCheck, tone: 'text-violet-600', drill: { kind: 'assigned', title: `Assigned leads · ${date}` } },
    { label: 'Calls done', value: board.data?.attempted, Icon: PhoneCall, tone: 'text-emerald-600', drill: { kind: 'called', title: `Leads called · ${date}` } },
    { label: 'Connected', value: board.data?.answered, Icon: PhoneCall, tone: 'text-teal-600', drill: { kind: 'connected', title: `Connected leads · ${date}` } },
    { label: 'Follow-ups', value: board.data?.followups, Icon: ClipboardCheck, tone: 'text-orange-600', drill: { kind: 'followups', title: `Follow-ups due/overdue · ${date}` } },
    { label: 'Pending', value: board.data?.pending, Icon: AlertTriangle, tone: 'text-red-600', drill: { kind: 'pending', title: `Pending leads (never called) · ${date}` } },
  ]
  const filterClass = (active: boolean) => `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'border bg-background hover:bg-muted'}`

  return <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-black"><ClipboardCheck className="h-5 w-5 text-primary" /> Daily calling overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">Click any number below to see the exact leads behind it.</p>
      </div>
      <button type="button" onClick={() => window.open(`/app/task-builder?date=${date}`, '_blank', 'noopener')} title="Opens the assignment builder in a new tab" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"><Plus className="h-4 w-4" /> Assign Task</button>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {metrics.map(({ label, value, Icon, tone, drill: filter }) => <button key={label} type="button" onClick={() => setDrill(filter)} disabled={!value} className="group relative overflow-hidden rounded-xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md disabled:cursor-default disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-border">
        <div className="flex items-center justify-between">
          <Icon className={`h-4 w-4 ${tone}`} />
          {!!value && <span className="text-[9px] font-black uppercase text-muted-foreground opacity-0 transition group-hover:opacity-100">view →</span>}
        </div>
        <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-black">{value ?? '—'}</p>
      </button>)}
    </div>

    <div className="overflow-hidden rounded-2xl border bg-background">
      <div className="border-b p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-black">Date-wise calls and backlog</h3><p className="text-xs text-muted-foreground">Choose a quick filter or calendar date. Select a row to manage that day.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={filterClass(dateView === 'today')} onClick={() => chooseView('today', localISO())}><Clock3 className="h-4 w-4" /> Today</button>
            <button type="button" className={filterClass(dateView === 'yesterday')} onClick={() => chooseView('yesterday', localISO(-1))}>Yesterday</button>
            <button type="button" className={filterClass(dateView === 'last7')} onClick={() => chooseView('last7', localISO())}><CalendarDays className="h-4 w-4" /> Last 7 Days</button>
            <label className={filterClass(dateView === 'custom')}><CalendarDays className="h-4 w-4" /><span>Calendar</span><input aria-label="Choose custom date" type="date" value={date} className="w-[18px] cursor-pointer opacity-0" onChange={(event) => event.target.value && chooseView('custom', event.target.value)} /></label>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span className="rounded-full bg-primary/10 px-2.5 py-1 font-bold text-primary">{dateView === 'last7' ? '7 separate days' : shortDate(date)}</span><span>{dateView === 'last7' ? 'Each date remains individually clickable.' : 'Showing one selected calendar day.'}</span></div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="p-3 text-left">Lead date</th><th>Received</th><th>Assigned</th><th>Called</th><th>Connected</th><th>Follow-up</th><th>Pending</th><th className="min-w-[150px]">Completion</th></tr></thead>
          <tbody>
            {visibleDays.map((row) => {
              const percent = row.total ? Math.round((row.attempted * 100) / row.total) : 0
              return <tr key={row.date} onClick={() => chooseView(row.date === localISO() ? 'today' : row.date === localISO(-1) ? 'yesterday' : 'custom', row.date)} className={`cursor-pointer border-t transition hover:bg-muted/50 ${row.date === date && dateView !== 'last7' ? 'bg-primary/5' : ''}`}>
                <td className="p-3"><div className="font-black">{shortDate(row.date)}</div><div className="text-[11px] text-muted-foreground">{row.date}{row.date === localISO() && <span className="ml-2 font-bold text-primary">TODAY</span>}</div></td>
                <td className="text-center font-semibold">{row.total}</td><td className="text-center">{row.assigned}</td><td className="text-center font-semibold text-emerald-700">{row.attempted}</td><td className="text-center">{row.answered}</td><td className="text-center">{row.followups}</td><td className="text-center"><span className={`rounded-full px-2.5 py-1 font-black ${row.pending ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{row.pending}</span></td>
                <td className="px-4"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${percent === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${percent}%` }} /></div><span className="w-10 text-right font-black">{percent}%</span>{percent === 100 && <Check className="h-4 w-4 text-emerald-600" />}</div></td>
              </tr>
            })}
            {!history.isLoading && visibleDays.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No lead activity found for this date.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {/* Unified live-task board (per-task delete, View leads, day-wise carry-over,
        expandable lead lists). /app/tasks already renders this panel itself, so
        it passes hideTaskBoard to avoid showing the same tasks twice. */}
    {!hideTaskBoard && <LeadCallingTasks />}

    {drill && <DrillLeadsModal title={drill.title} leads={drillLeads} onClose={() => setDrill(null)} />}
  </section>
}

function DrillLeadsModal({ title, leads, onClose }: { title: string; leads: LeadRow[]; onClose: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b p-4">
        <div><h3 className="font-black">{title}</h3><p className="text-xs text-muted-foreground">{leads.length} lead{leads.length !== 1 ? 's' : ''}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg border p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {leads.length ? <ul className="divide-y">{leads.map((lead) => <li key={lead.id} className="flex items-center justify-between gap-2 p-3">
          <div className="min-w-0 flex-1">
            <Link to="/app/leads/$leadId" params={{ leadId: String(lead.id) }} className="block truncate text-sm font-bold text-primary hover:underline" onClick={onClose}>{lead.name || `Lead #${lead.id}`}</Link>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Counsellor: {lead.assignedTo.length ? lead.assignedTo.map((assignment) => assignment.name).join(', ') : 'Not assigned'}</p>
          </div>
          <div className="flex flex-wrap gap-1 text-[10px] font-bold uppercase">
            {lead.attempted && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">Called</span>}
            {lead.answered && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-teal-700">Connected</span>}
            {lead.pendingFollowup && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">Followup due</span>}
            {!lead.attempted && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">Pending</span>}
          </div>
        </li>)}</ul> : <p className="p-8 text-center text-sm text-muted-foreground">No leads match this filter.</p>}
      </div>
    </div>
  </div>
}

function CounsellorTasks({ batches, loading }: { batches: any[]; loading: boolean }) {
  const todayTasks = batches.filter((batch) => (batch.workDateLabel || String(batch.workDate).slice(0, 10)) === localISO() && batch.state !== 'CANCELLED')
  const completedToday = todayTasks.filter((batch) => batch.state === 'COMPLETED').length
  const totalRequired = todayTasks.reduce((sum, batch) => sum + batch.total, 0)
  const totalCompleted = todayTasks.reduce((sum, batch) => sum + batch.completed, 0)
  // Tasks are not queued behind one another — every one of the day's tasks is
  // workable, so the badge only reports progress.
  const taskTone = (state: string) => state === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : state === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'
  const taskStateLabel = (state: string) => state === 'COMPLETED' ? 'COMPLETED' : state === 'IN_PROGRESS' ? 'IN PROGRESS' : 'ACTIVE'

  return <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
    <div><h2 className="text-xl font-black">My daily lead tasks</h2><p className="mt-1 text-sm text-muted-foreground">All of today's tasks are open — call them in whichever order you like.</p></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><TaskMetric label="Tasks today" value={todayTasks.length} /><TaskMetric label="Work required" value={totalRequired} /><TaskMetric label="Work completed" value={totalCompleted} /><TaskMetric label="Tasks finished" value={`${completedToday}/${todayTasks.length}`} /></div>
    {loading ? <p className="rounded-xl border p-5 text-sm">Loading today&apos;s work…</p> : batches.length ? <div className="space-y-3">{batches.map((batch) => {
      const active = batch.state !== 'COMPLETED'
      const taskLabel = batch.workType === 'FOLLOWUP' ? 'Follow-up task' : 'First-call task'
      return <article key={batch.id} className={`rounded-xl border p-4 transition ${active ? 'border-primary bg-primary/5 shadow-sm' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-black ${active ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{batch.sequence}</div><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{batch.title}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${taskTone(batch.state)}`}>{taskStateLabel(batch.state)}</span></div><p className="mt-1 text-xs text-muted-foreground">{taskLabel} · {batch.leadDate ? `Leads created ${batch.leadDateLabel || String(batch.leadDate).slice(0, 10)}` : 'Hand-picked leads'} · Assigned by {batch.assignedBy.name}</p></div></div><div className="text-right"><p className="text-2xl font-black text-primary">{batch.remaining}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">left of {batch.total}</p></div></div>
        {active && !!batch.remaining && <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm font-black text-primary">{batch.remaining} {batch.workType === 'FOLLOWUP' ? 'follow-ups' : 'calls'} remaining</div>}
        {batch.notes && <div className="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 text-sm"><p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase text-amber-800"><StickyNote className="h-3 w-3" /> Note from {batch.assignedBy.name}</p><p className="whitespace-pre-wrap text-amber-900">{batch.notes}</p></div>}
        <div className="mt-4"><div className="mb-1 flex justify-between text-xs font-bold"><span>{batch.completed} completed</span><span>{batch.progress}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${batch.progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${batch.progress}%` }} /></div></div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4"><div className="rounded-lg border p-2"><b className="block text-base">{batch.total}</b>Required</div><div className="rounded-lg border p-2"><b className="block text-base text-emerald-700">{batch.completed}</b>Done</div><div className="rounded-lg border p-2"><b className="block text-base text-red-600">{batch.remaining}</b>Left</div><div className="rounded-lg border p-2"><b className="block text-base">{batch.workType === 'FOLLOWUP' ? batch.completed : batch.summary.followupsCreated}</b>{batch.workType === 'FOLLOWUP' ? 'Outcomes recorded' : 'Follow-ups set'}</div></div>
        {batch.workType === 'INITIAL_CALL' && <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700">{batch.summary.connected} connected</span><span className="rounded-full bg-amber-50 px-2.5 py-1 font-bold text-amber-700">{batch.summary.noAnswer} no answer</span><span className="rounded-full bg-gray-100 px-2.5 py-1 font-bold text-gray-700">{batch.summary.busyRejected} busy/rejected</span></div>}
        {active && batch.remainingItems?.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Next remaining leads</p><div className="flex flex-wrap gap-2">{batch.remainingItems.slice(0, 10).map((item: any) => <Link key={item.id} to="/app/leads/$leadId" params={{ leadId: String(item.lead.id) }} className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary">{item.lead.name}</Link>)}</div>{batch.remainingItems.length > 10 && <p className="mt-2 text-xs text-muted-foreground">+ {batch.remainingItems.length - 10} more remaining</p>}</div>}
      </article>
    })}</div> : <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No daily lead task has been assigned yet.</p>}
  </section>
}

function TaskMetric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl border p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>
}

