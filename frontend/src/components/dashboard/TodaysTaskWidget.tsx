import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ClipboardCheck, PhoneCall, StickyNote } from 'lucide-react'
import { leadWorkApi } from '@/lib/api'

function localISO(): string {
  const value = new Date()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

// Compact top-of-dashboard widget showing the counsellor's active daily task(s).
// The heavy per-task view is still inside <LeadWorkboard /> further down.
export function TodaysTaskWidget() {
  const { data, isLoading } = useQuery({ queryKey: ['lead-work-batches'], queryFn: leadWorkApi.batches, refetchInterval: 30_000 })

  const today = localISO()
  const todayTasks = useMemo(() => (data || []).filter((batch: any) => (batch.workDateLabel || String(batch.workDate).slice(0, 10)) === today && batch.state !== 'CANCELLED'), [data, today])

  if (isLoading) return null
  if (!todayTasks.length) return null

  const totalRequired = todayTasks.reduce((sum: number, batch: any) => sum + (batch.total || 0), 0)
  const totalCompleted = todayTasks.reduce((sum: number, batch: any) => sum + (batch.completed || 0), 0)
  const totalRemaining = totalRequired - totalCompleted
  const globalPercent = totalRequired ? Math.round((totalCompleted * 100) / totalRequired) : 0
  const activeTask = todayTasks.find((batch: any) => batch.state === 'READY' || batch.state === 'IN_PROGRESS') || todayTasks[0]

  const stateTone = (state: string) => state === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : state === 'LOCKED' ? 'bg-gray-100 text-gray-600' : state === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'

  const allDone = totalRequired > 0 && totalRemaining === 0

  return <section className={`rounded-2xl border p-5 shadow-sm ${allDone ? 'border-emerald-300 bg-emerald-50' : 'bg-card'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><ClipboardCheck className="h-5 w-5" /></div>
        <div>
          <h2 className="text-lg font-black">Today's Task</h2>
          <p className="text-xs text-muted-foreground">{todayTasks.length} task{todayTasks.length !== 1 ? 's' : ''} on your queue for {today}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-2xl font-black text-primary">{totalRemaining}</p>
        <p className="text-[10px] font-bold uppercase text-muted-foreground">calls left of {totalRequired}</p>
      </div>
    </div>

    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs font-bold"><span>{totalCompleted} completed</span><span>{globalPercent}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${globalPercent === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${globalPercent}%` }} /></div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
      <StatBox label="Tasks" value={todayTasks.length} />
      <StatBox label="Calls required" value={totalRequired} />
      <StatBox label="Completed" value={totalCompleted} tone="text-emerald-700" />
      <StatBox label="Pending" value={totalRemaining} tone="text-red-600" />
    </div>

    {activeTask && <div className={`mt-4 rounded-xl border p-3 ${activeTask.state === 'COMPLETED' ? 'border-emerald-300 bg-emerald-100/60' : 'border-primary/40 bg-primary/5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Day-wise task number, not the row id — "task 2 of 3 today". */}
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${activeTask.state === 'COMPLETED' ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground'}`}>{activeTask.daySequence || activeTask.sequence}</div>
          <div>
            <p className="text-sm font-black">{activeTask.title}</p>
            <p className="text-[10px] text-muted-foreground">Task {activeTask.daySequence || activeTask.sequence}{activeTask.dayTaskCount ? ` of ${activeTask.dayTaskCount}` : ''} today · Assigned by {activeTask.assignedBy?.name} · {activeTask.workType === 'FOLLOWUP' ? 'Follow-up task' : 'First-call task'}</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${stateTone(activeTask.state)}`}>{activeTask.state.replace('_', ' ')}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs"><PhoneCall className="h-3.5 w-3.5 text-primary" /><b>{activeTask.remaining}</b> {activeTask.workType === 'FOLLOWUP' ? 'follow-up' : 'call'}{activeTask.remaining !== 1 ? 's' : ''} remaining right now</div>
      {activeTask.notes && <div className="mt-2 rounded border-l-2 border-amber-400 bg-amber-50 p-2 text-xs"><p className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase text-amber-800"><StickyNote className="h-3 w-3" /> Note</p><p className="whitespace-pre-wrap text-amber-900">{activeTask.notes}</p></div>}
      {activeTask.remainingItems?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{activeTask.remainingItems.slice(0, 6).map((item: any) => <Link key={item.id} to="/app/leads/$leadId" params={{ leadId: String(item.lead.id) }} className="rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:border-primary hover:text-primary">{item.lead.name}</Link>)}{activeTask.remainingItems.length > 6 && <span className="rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground">+{activeTask.remainingItems.length - 6} more</span>}</div>}
    </div>}
  </section>
}

function StatBox({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-lg border p-2 text-center">
    <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
    <p className={`text-xl font-black ${tone || ''}`}>{value}</p>
  </div>
}
