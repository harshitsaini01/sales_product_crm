import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table2 } from 'lucide-react'
import { leadWorkApi } from '@/lib/api'

/**
 * Day-by-day calling load, one row per task date: how many leads each counsellor
 * was given that day and how many of those calls are still pending, with the
 * follow-up (lead cohort) dates the work came from. Reads the same
 * /lead-work/batches payload the task board uses — no extra endpoint.
 */
function dayOf(batch: any): string {
  return batch.workDateLabel || String(batch.workDate).slice(0, 10)
}
// 'picked' for a hand-picked task, which has no created-date cohort. Only ever
// used as a set key for the per-day cohort count, so the label is enough.
function cohortOf(batch: any): string {
  if (!batch.leadDate) return 'picked'
  return batch.leadDateLabel || String(batch.leadDate).slice(0, 10)
}
function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

/** Column headings use the first name only — 11 counsellors x 2 groups means
 *  full names never fit. A last initial is added back only when two of the
 *  counsellors on screen share a first name, so columns stay distinguishable. */
function shortNames(names: { id: number; name: string }[]): Map<number, string> {
  const first = (value: string) => value.trim().split(/\s+/)[0] || value
  const counts = new Map<string, number>()
  for (const row of names) {
    const key = first(row.name).toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const out = new Map<number, string>()
  for (const row of names) {
    const parts = row.name.trim().split(/\s+/)
    const key = parts[0].toLowerCase()
    out.set(row.id, (counts.get(key) || 0) > 1 && parts[1] ? `${parts[0]} ${parts[1][0].toUpperCase()}.` : parts[0])
  }
  return out
}

type Cell = { assigned: number; pending: number; done: number }
type Row = { date: string; cohorts: Set<string>; cells: Map<number, Cell>; total: Cell }

export function CallingLoadTable({ selectedDate }: { selectedDate?: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['lead-work-batches'],
    queryFn: leadWorkApi.batches,
    refetchInterval: 30_000,
  })

  const { rows, counsellors, grand } = useMemo(() => {
    const live = (data as any[]).filter((batch) => batch.state !== 'CANCELLED')
    const staff = new Map<number, string>()
    const byDay = new Map<string, Row>()
    for (const batch of live) {
      const counsellorId = Number(batch.assignedTo?.id ?? 0)
      staff.set(counsellorId, batch.assignedTo?.name || `#${counsellorId}`)
      const day = dayOf(batch)
      if (!byDay.has(day)) byDay.set(day, { date: day, cohorts: new Set(), cells: new Map(), total: { assigned: 0, pending: 0, done: 0 } })
      const row = byDay.get(day)!
      row.cohorts.add(cohortOf(batch))
      const cell = row.cells.get(counsellorId) || { assigned: 0, pending: 0, done: 0 }
      cell.assigned += batch.total || 0
      cell.pending += batch.remaining || 0
      cell.done += batch.completed || 0
      row.cells.set(counsellorId, cell)
      row.total.assigned += batch.total || 0
      row.total.pending += batch.remaining || 0
      row.total.done += batch.completed || 0
    }
    const counsellorList = [...staff.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    const dayRows = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date))
    const totals = dayRows.reduce((sum, row) => ({
      assigned: sum.assigned + row.total.assigned,
      pending: sum.pending + row.total.pending,
      done: sum.done + row.total.done,
    }), { assigned: 0, pending: 0, done: 0 })
    return { rows: dayRows, counsellors: counsellorList, grand: totals }
  }, [data])

  if (isLoading || !rows.length) return null

  const cellOf = (row: Row, id: number): Cell => row.cells.get(id) || { assigned: 0, pending: 0, done: 0 }
  const labels = shortNames(counsellors)
  const num = (value: number) => value.toLocaleString()

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-primary/15 p-2 text-primary"><Table2 className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-black">Calling load by day</h3>
            <p className="text-[11px] text-muted-foreground">Leads given to each counsellor on a task date, and how many of those calls are still pending.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-800">{num(grand.assigned)} leads assigned</span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">{num(grand.done)} called</span>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">{num(grand.pending)} pending</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th rowSpan={2} className="sticky left-0 z-10 border-r bg-muted/60 p-2 text-left">Task date</th>
              <th rowSpan={2} className="border-r p-2 text-left">Follow-up date</th>
              <th colSpan={counsellors.length} className="border-r p-2 text-center">Leads assigned</th>
              <th rowSpan={2} className="border-r p-2 text-right">Total</th>
              <th colSpan={counsellors.length} className="border-r p-2 text-center">Pending calls</th>
              <th rowSpan={2} className="p-2 text-right">Total pending</th>
            </tr>
            <tr className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              {counsellors.map((counsellor) => (
                <th key={`a-${counsellor.id}`} className="p-2 text-right font-bold" title={counsellor.name}>{labels.get(counsellor.id)}</th>
              ))}
              {counsellors.map((counsellor) => (
                <th key={`p-${counsellor.id}`} className="p-2 text-right font-bold" title={counsellor.name}>{labels.get(counsellor.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date} className={`border-t tabular-nums ${row.date === selectedDate ? 'bg-primary/5' : 'hover:bg-muted/30'}`}>
                <th scope="row" className={`sticky left-0 z-10 border-r p-2 text-left font-bold ${row.date === selectedDate ? 'bg-primary/5' : 'bg-card'}`}>
                  {shortDate(row.date)}
                </th>
                <td className="border-r p-2 text-muted-foreground">{[...row.cohorts].sort((a, b) => b.localeCompare(a)).map(shortDate).join(', ')}</td>
                {counsellors.map((counsellor) => {
                  const cell = cellOf(row, counsellor.id)
                  return <td key={`a-${counsellor.id}`} className={`p-2 text-right ${cell.assigned ? '' : 'text-muted-foreground/40'}`} title={`${cell.done} called · ${cell.pending} pending`}>{cell.assigned || '—'}</td>
                })}
                <td className="border-r p-2 text-right font-black">{num(row.total.assigned)}</td>
                {counsellors.map((counsellor) => {
                  const cell = cellOf(row, counsellor.id)
                  return <td key={`p-${counsellor.id}`} className={`p-2 text-right ${cell.pending ? 'font-bold text-red-600' : 'text-muted-foreground/40'}`}>{cell.pending || '—'}</td>
                })}
                <td className={`p-2 text-right font-black ${row.total.pending ? 'text-red-600' : 'text-emerald-600'}`}>{num(row.total.pending)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/40 tabular-nums">
              <th scope="row" className="sticky left-0 z-10 border-r bg-muted/40 p-2 text-left font-black">All days</th>
              <td className="border-r p-2 text-muted-foreground">{rows.length} task date{rows.length === 1 ? '' : 's'}</td>
              {counsellors.map((counsellor) => (
                <td key={`fa-${counsellor.id}`} className="p-2 text-right font-bold">
                  {num(rows.reduce((sum, row) => sum + cellOf(row, counsellor.id).assigned, 0))}
                </td>
              ))}
              <td className="border-r p-2 text-right font-black">{num(grand.assigned)}</td>
              {counsellors.map((counsellor) => (
                <td key={`fp-${counsellor.id}`} className="p-2 text-right font-bold text-red-600">
                  {num(rows.reduce((sum, row) => sum + cellOf(row, counsellor.id).pending, 0))}
                </td>
              ))}
              <td className="p-2 text-right font-black text-red-600">{num(grand.pending)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
