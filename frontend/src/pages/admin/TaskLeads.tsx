import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ClipboardCheck, ExternalLink, PhoneCall, StickyNote } from 'lucide-react'
import { leadWorkApi } from '@/lib/api'

// Absolute date + time — "22 Aug, 4:07 pm". A counsellor deciding whether to
// ring a lead again needs the clock time, not "3 hours ago".
function callStamp(value?: string | null): string {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export function TaskLeads() {
  const { batchId } = useParams({ strict: false }) as { batchId: string }
  const id = Number(batchId)
  const { data, isLoading } = useQuery({ queryKey: ['lead-work-batches'], queryFn: leadWorkApi.batches, refetchInterval: 30_000 })

  const task = useMemo(() => (data || []).find((batch: any) => Number(batch.id) === id), [data, id])

  if (isLoading) return <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Loading task…</div>
  if (!task) return <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Task not found or you don't have access to it. <Link to="/app/tasks" className="text-primary underline">Back to tasks</Link></div>

  const items: any[] = task.items || []
  const pending = items.filter((item: any) => !item.completedAt)
  const done = items.filter((item: any) => !!item.completedAt)
  // Still-to-call first, already-called underneath — a lead that drops off the
  // list the moment its call lands reads as data loss, not as progress.
  const ordered = [...pending, ...done]
  const isComplete = task.state === 'COMPLETED'
  const dayNo = task.daySequence || task.sequence
  const dayCount = task.dayTaskCount || 0
  const workDate = task.workDateLabel || String(task.workDate).slice(0, 10)
  const leadIds = items.map((item: any) => String(item.lead?.id ?? '')).filter(Boolean)

  // Opens in a new tab so this task page stays put behind the leads view.
  const openAllLeads = () => {
    if (!leadIds.length) return
    const search = new URLSearchParams({ ids: leadIds.join(','), batchLabel: task.title })
    window.open(`/app/leads?${search.toString()}`, '_blank', 'noopener')
  }

  return <div className="space-y-4">
    <Link to="/app/tasks" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Back to Tasks</Link>

    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className={`border-b p-5 ${isComplete ? 'bg-gradient-to-r from-emerald-100 via-emerald-50 to-transparent' : 'bg-gradient-to-r from-primary/10 via-primary/5 to-transparent'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`rounded-xl p-2.5 ${isComplete ? 'bg-emerald-600 text-white' : 'bg-primary/15 text-primary'}`}><ClipboardCheck className="h-5 w-5" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Day-wise task number — how the day is actually tracked. */}
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary">
                  Task {dayNo}{dayCount ? ` of ${dayCount}` : ''}
                </span>
                <h1 className="text-lg font-black">{task.title}</h1>
                {isComplete && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase text-white"><CheckCircle2 className="h-3 w-3" /> Completed</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">These are your leads to call · Assigned by {task.assignedBy?.name} · Work date {workDate}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Stat label="Required" value={items.length} />
            <Stat label="Done" value={done.length} tone="text-emerald-700" />
            <Stat label="Pending" value={pending.length} tone="text-red-600" />
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all ${task.progress === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-primary/70 to-primary'}`} style={{ width: `${task.progress}%` }} /></div>
        {task.notes && <div className="mt-4 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 text-sm"><p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase text-amber-800"><StickyNote className="h-3 w-3" /> Note from {task.assignedBy?.name}</p><p className="whitespace-pre-wrap text-amber-900">{task.notes}</p></div>}
      </div>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-black uppercase tracking-wide text-muted-foreground">Leads to {task.workType === 'FOLLOWUP' ? 'follow up on' : 'call'} · make a call first</h2>
          {!!leadIds.length && <button type="button" onClick={openAllLeads}
            className="ml-auto inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-bold hover:bg-muted">
            Open all {leadIds.length} on the Leads page <ExternalLink className="h-3 w-3 opacity-70" />
          </button>}
        </div>
        {ordered.length ? <ul className="divide-y rounded-lg border">
          {ordered.map((item: any) => {
            const isDone = !!item.completedAt
            return <li key={item.id} className={`flex items-center justify-between gap-3 p-3 ${isDone ? 'bg-emerald-50/60' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/app/leads/$leadId" params={{ leadId: String(item.lead.id) }} className={`truncate text-sm font-bold ${isDone ? 'text-emerald-900' : 'text-primary hover:underline'}`}>{item.lead.name || `Lead #${item.lead.id}`}</Link>
                  {/* Done marker sits right behind the name. */}
                  {isDone && <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white"><CheckCircle2 className="h-2.5 w-2.5" /> Done</span>}
                </div>
                {item.lead.mobile && <p className="mt-0.5 text-xs text-muted-foreground">{item.lead.mobile}</p>}
                {item.lastCallAt && <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground"><PhoneCall className="h-3 w-3" /> Last call {callStamp(item.lastCallAt)}{item.callAttempts > 1 ? ` · ${item.callAttempts} attempts` : ''}</p>}
                {item.lead.followupDate && task.workType === 'FOLLOWUP' && <p className="text-[11px] text-orange-600">Follow-up due {String(item.lead.followupDate).slice(0, 10)}</p>}
              </div>
              {!isDone && <Link to="/app/leads/$leadId" params={{ leadId: String(item.lead.id) }} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"><PhoneCall className="h-3.5 w-3.5" /> Open</Link>}
            </li>
          })}
        </ul> : <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No leads in this task.</p>}
      </div>
    </section>
  </div>
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="text-right">
    <p className={`text-xl font-black ${tone || ''}`}>{value}</p>
    <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
  </div>
}
