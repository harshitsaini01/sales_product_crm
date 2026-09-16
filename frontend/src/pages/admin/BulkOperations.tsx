import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  History, ArrowLeft, Loader2, Undo2, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, XCircle, Clock,
} from 'lucide-react'
import { bulkApi, type BulkOperationSummary, type BulkStep } from '@/lib/api'

// Full audit-log view. Each row is a single past bulk operation; admins can
// expand to inspect the filter+recipe and (when reversible) undo or re-run.

export default function BulkOperations() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [kindFilter, setKindFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['bulk-operations', { page, kindFilter, statusFilter }],
    queryFn: () => bulkApi.operations({
      page, limit: 25,
      kind: kindFilter || undefined,
      status: statusFilter || undefined,
    }),
    refetchInterval: 5000,
  })

  const undoMut = useMutation({
    mutationFn: (id: number) => bulkApi.undo(id),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ['bulk-operations'] }) },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? 'Undo failed'),
  })
  const rerunMut = useMutation({
    mutationFn: (id: number) => bulkApi.rerun(id),
    onSuccess: (r) => { toast.success(r.message ?? `Re-ran — ${r.succeeded}/${r.total}`); qc.invalidateQueries({ queryKey: ['bulk-operations'] }) },
    onError: () => toast.error('Re-run failed'),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/app/bulk-management" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6 text-emerald-600" /> Bulk Operations
        </h1>
      </div>

      <div className="flex gap-2 flex-wrap">
        <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setPage(1) }} className="px-3 py-1.5 border rounded-md text-sm bg-card">
          <option value="">All kinds</option>
          {['apply', 'assign', 'unassign', 'move', 'status', 'trash', 'restore', 'permanent-delete', 'note', 'comment', 'reminder', 'followup', 'tag', 'field-update', 'merge'].map((k) =>
            <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} className="px-3 py-1.5 border rounded-md text-sm bg-card">
          <option value="">All statuses</option>
          {['running', 'completed', 'partial', 'failed', 'undone', 'cancelled'].map((s) =>
            <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></div>
        ) : !data || data.data.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <History className="h-10 w-10 mx-auto opacity-30 mb-2" />
            <p>No operations match these filters.</p>
          </div>
        ) : (
          <div className="divide-y">
            {data.data.map((op) => {
              const isOpen = expanded.has(op.id)
              return (
                <OperationRow
                  key={op.id}
                  op={op}
                  open={isOpen}
                  onToggle={() => {
                    const next = new Set(expanded)
                    if (next.has(op.id)) next.delete(op.id); else next.add(op.id)
                    setExpanded(next)
                  }}
                  onUndo={() => undoMut.mutate(op.id)}
                  onRerun={() => rerunMut.mutate(op.id)}
                />
              )
            })}
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="px-4 py-2.5 border-t flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Page {data.page} of {data.totalPages} — {data.total} total</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-30">Prev</button>
              <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OperationRow({ op, open, onToggle, onUndo, onRerun }: {
  op: BulkOperationSummary
  open: boolean
  onToggle: () => void
  onUndo: () => void
  onRerun: () => void
}) {
  const isReversible = isReversibleRecipe(op.recipe) && op.status !== 'undone' && !op.dryRun && op.status !== 'failed'
  const Status = STATUS_ICON[op.status] ?? Clock
  return (
    <div className="px-4 py-3 hover:bg-muted/30">
      <button onClick={onToggle} className="w-full text-left flex items-center gap-3">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Status className={`h-4 w-4 ${STATUS_COLOR[op.status] ?? 'text-muted-foreground'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{op.kind}</span>
            {op.dryRun && <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-semibold">DRY RUN</span>}
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: STATUS_RGB[op.status] }}>{op.status}</span>
            <span className="text-xs text-muted-foreground">· {op.actor.name}</span>
            <span className="text-xs text-muted-foreground">· {new Date(op.createdAt).toLocaleString()}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {op.recipe.map((s) => s.type).join(' → ')} · {op.succeeded}/{op.total} succeeded{op.failed > 0 && ` · ${op.failed} failed`}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isReversible && (
            <button onClick={(e) => { e.stopPropagation(); onUndo() }}
              className="text-xs px-2 py-1 rounded border bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 flex items-center gap-1">
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onRerun() }}
            className="text-xs px-2 py-1 rounded border hover:bg-accent flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Re-run
          </button>
        </div>
      </button>
      {open && (
        <div className="pl-9 mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wide text-muted-foreground mb-1">Recipe</p>
            <pre className="text-[11px] bg-muted/40 p-2 rounded overflow-x-auto">{JSON.stringify(op.recipe, null, 2)}</pre>
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wide text-muted-foreground mb-1">Filter</p>
            <pre className="text-[11px] bg-muted/40 p-2 rounded overflow-x-auto">{op.filter ? JSON.stringify(op.filter, null, 2) : '— (id list)'}</pre>
          </div>
          {op.message && <div className="md:col-span-2 text-xs text-muted-foreground">Message: {op.message}</div>}
        </div>
      )}
    </div>
  )
}

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircle2,
  partial: AlertTriangle,
  failed: XCircle,
  running: Loader2,
  undone: Undo2,
}
const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-500',
  partial: 'text-amber-500',
  failed: 'text-red-500',
  running: 'text-blue-500 animate-spin',
  undone: 'text-slate-500',
}
const STATUS_RGB: Record<string, string> = {
  completed: '#059669',
  partial: '#d97706',
  failed: '#dc2626',
  running: '#2563eb',
  undone: '#475569',
}

// Reversible if the recipe contains at least one undo-able step type. Keep in
// sync with SNAPSHOT_KINDS in backend bulk-engine.ts. Permanent-delete /
// note / comment / reminder writes stay non-reversible. 'followup' IS
// reversible because it now mutates lead status when a status is bundled in.
function isReversibleRecipe(recipe: BulkStep[]): boolean {
  const reversibleTypes = new Set(['assign', 'unassign', 'move', 'status', 'reset-status', 'trash', 'restore', 'tag', 'call-status', 'followup'])
  return recipe.some((s) => reversibleTypes.has(s.type))
}
