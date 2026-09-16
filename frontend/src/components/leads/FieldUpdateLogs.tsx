import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { bulkApi, type BulkOperationSummary } from '@/lib/api'
import { toast } from 'sonner'
import {
  Loader2, CheckCircle2, Eye, ChevronLeft, ChevronRight,
  RotateCcw, Clock, XCircle, History,
} from 'lucide-react'

const LOG_PAGE_SIZE = 10

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(s))
}

function StatusBadge({ row }: { row: BulkOperationSummary }) {
  if (row.undoneAt) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
      <RotateCcw className="h-3 w-3" /> Undone
    </span>
  )
  if (row.dryRun) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-600">
      <Eye className="h-3 w-3" /> Preview
    </span>
  )
  switch (row.status) {
    case 'completed': return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    )
    case 'running': return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">
        <Loader2 className="h-3 w-3 animate-spin" /> Running
      </span>
    )
    case 'failed': return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600">
        <XCircle className="h-3 w-3" /> Failed
      </span>
    )
    default: return <span className="text-xs text-muted-foreground">{row.status}</span>
  }
}

export function FieldUpdateLogs() {
  const queryClient = useQueryClient()
  const [logPage, setLogPage] = useState(1)
  const [undoingId, setUndoingId] = useState<number | null>(null)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bulk-ops-field-update', logPage],
    queryFn: () => bulkApi.operations({ kind: 'field-update', page: logPage, limit: LOG_PAGE_SIZE }),
    refetchInterval: 10_000,
  })

  const undoMutation = useMutation({
    mutationFn: (id: number) => { setUndoingId(id); return bulkApi.undo(id) },
    onSuccess: () => {
      toast.success('Operation undone successfully')
      setUndoingId(null)
      queryClient.invalidateQueries({ queryKey: ['bulk-ops-field-update'] })
    },
    onError: (err: any) => { setUndoingId(null); toast.error(err?.response?.data?.error ?? 'Undo failed') },
  })

  const rows: BulkOperationSummary[] = (data as any)?.data ?? []
  const total: number = (data as any)?.total ?? 0
  const totalPages: number = (data as any)?.totalPages ?? 0

  const buildPageNums = (cur: number, tot: number) => {
    let start = Math.max(1, cur - 2)
    const end = Math.min(tot, start + 4)
    start = Math.max(1, end - 4)
    return Array.from({ length: Math.min(tot, 5) }, (_, i) => start + i)
  }

  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b bg-gradient-to-r from-slate-50/80 to-transparent flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          Operation Logs
          {total > 0 && <span className="px-2 py-0.5 text-xs font-bold bg-slate-100 text-slate-600 rounded-full">{total}</span>}
        </h3>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <History className="h-8 w-8 mb-2 text-muted-foreground/20" />
          <p className="text-sm">No operations yet</p>
          <p className="text-xs mt-1">Field updates will appear here once approved</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">Operation</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground text-xs uppercase tracking-wider">Total</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">By</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground text-xs uppercase tracking-wider">Undo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const recipe = row.recipe as any
                  const step = Array.isArray(recipe) ? recipe[0] : null
                  const canUndo = (row.status === 'completed' || row.status === 'partial') && !row.undoneAt && !row.dryRun
                  const isCascade = step?.filterField && step?.filterField !== step?.field
                  return (
                    <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(row.createdAt)}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-xs font-medium leading-relaxed">
                          {row.message ?? (step
                            ? isCascade
                              ? <><span className="font-semibold capitalize">{step.filterField}</span> {'→'} set <span className="font-semibold capitalize">{step.field}</span> = <span className="text-emerald-700 font-bold">"{step.value}"</span></>
                              : <><span className="font-semibold capitalize">{step.field}</span> {'→'} <span className="text-emerald-700 font-bold">"{step.value}"</span></>
                            : '—')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-bold">{row.total ?? '—'}</span>
                        {row.succeeded != null && row.succeeded !== row.total && (
                          <span className="block text-xs text-emerald-600">{row.succeeded} ok</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center"><StatusBadge row={row} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.actor?.name ?? ('#' + row.actorId)}</td>
                      <td className="px-4 py-3 text-center">
                        {canUndo ? (
                          <button onClick={() => undoMutation.mutate(row.id)} disabled={undoMutation.isPending}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50">
                            {undoingId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            Undo
                          </button>
                        ) : row.undoneAt ? (
                          <span className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                            <Clock className="h-3 w-3" />{fmtDate(row.undoneAt).split(',')[0]}
                          </span>
                        ) : <span className="text-xs text-muted-foreground/40">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t flex items-center justify-between bg-muted/10">
              <span className="text-xs text-muted-foreground">{total} operations &bull; page {logPage}/{totalPages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setLogPage((p) => Math.max(1, p - 1))} disabled={logPage === 1}
                  className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {buildPageNums(logPage, totalPages).map((p) => (
                  <button key={p} onClick={() => setLogPage(p)}
                    className={'w-7 h-7 rounded text-xs font-medium transition-colors ' + (p === logPage ? 'bg-slate-600 text-white' : 'hover:bg-muted text-muted-foreground')}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setLogPage((p) => Math.min(totalPages, p + 1))} disabled={logPage === totalPages}
                  className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
