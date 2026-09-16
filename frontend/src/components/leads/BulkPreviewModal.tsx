import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  Loader2, CheckCircle2, Eye, ChevronLeft, ChevronRight,
  CheckSquare, Square, MinusSquare, XCircle, AlertCircle, ArrowRight,
} from 'lucide-react'

/**
 * Shared bulk preview + approval modal.
 *
 * Used by:
 *  - UpdateLeads: same-field find/replace (filterField === writeField)
 *  - VerifiedData: cascade fill (filterField !== writeField, e.g. city→state)
 */
export interface BulkPreviewModalProps {
  title?: string
  subtitle?: string
  // Field used to select leads (what "old values" filter on).
  filterField: string
  filterFieldLabel: string
  // Field that will be written (may be same as filterField for find/replace).
  writeField: string
  writeFieldLabel: string
  // Selected filter values.
  filterValues: string[]
  // Target value being written.
  newValue: string
  onClose: () => void
  onApprove: (approvedIds: number[]) => void
  isApproving: boolean
}

const PAGE_SIZE = 100

export function BulkPreviewModal({
  title = 'Preview Changes',
  subtitle = 'Review leads before applying the update',
  filterField, filterFieldLabel,
  writeField, writeFieldLabel,
  filterValues, newValue,
  onClose, onApprove, isApproving,
}: BulkPreviewModalProps) {
  const [page, setPage] = useState(1)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())
  const [isAllMode, setIsAllMode] = useState(true)
  const [explicitIds, setExplicitIds] = useState<Set<number>>(new Set())

  const isCascade = filterField !== writeField

  const { data, isLoading } = useQuery({
    queryKey: ['field-preview', filterField, writeField, filterValues.join(','), newValue, page],
    queryFn: () => leadsApi.fieldPreview({
      filterField, writeField, oldValues: filterValues, newValue, page, limit: PAGE_SIZE,
    }),
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 0

  const approvedCount = isAllMode ? Math.max(0, total - excludedIds.size) : explicitIds.size
  const isRowSelected = (id: number) => isAllMode ? !excludedIds.has(id) : explicitIds.has(id)

  const toggleRow = (id: number) => {
    if (isAllMode) {
      const next = new Set(excludedIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      setExcludedIds(next)
    } else {
      const next = new Set(explicitIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      setExplicitIds(next)
    }
  }

  const selectAllTotal = () => { setIsAllMode(true); setExcludedIds(new Set()); setExplicitIds(new Set()) }
  const selectAllPage = () => {
    if (isAllMode) {
      const next = new Set(excludedIds); rows.forEach((r) => next.delete(r.id)); setExcludedIds(next)
    } else {
      const next = new Set(explicitIds); rows.forEach((r) => next.add(r.id)); setExplicitIds(next)
    }
  }
  const deselectAll = () => { setIsAllMode(false); setExplicitIds(new Set()) }
  const pageSelectedCount = rows.filter((r) => isRowSelected(r.id)).length

  const handleApprove = () => {
    if (approvedCount === 0) { toast.error('No leads selected'); return }
    if (isAllMode && excludedIds.size === 0) onApprove([])
    else if (isAllMode) onApprove(rows.filter((r) => !excludedIds.has(r.id)).map((r) => r.id))
    else onApprove(Array.from(explicitIds))
  }

  const buildPageNums = (cur: number, tot: number) => {
    let start = Math.max(1, cur - 2)
    const end = Math.min(tot, start + 4)
    start = Math.max(1, end - 4)
    return Array.from({ length: Math.min(tot, 5) }, (_, i) => start + i)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Eye className="h-5 w-5 text-orange-500" /> {title}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-3 bg-amber-50/60 border-b flex items-center gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <span className="text-sm font-semibold">
              {isCascade ? `Where ${filterFieldLabel}` : filterFieldLabel}
            </span>
            <span className="text-muted-foreground text-sm">:</span>
            {filterValues.slice(0, 4).map((v) => (
              <span key={v} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-medium">{v}</span>
            ))}
            {filterValues.length > 4 && <span className="text-xs text-muted-foreground">+{filterValues.length - 4} more</span>}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold">
              {isCascade ? `Set ${writeFieldLabel}` : writeFieldLabel}
            </span>
            <span className="text-muted-foreground text-sm">=</span>
            <span className="px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-bold">{newValue}</span>
          </div>
          {total > 0 && (
            <span className="text-sm font-semibold whitespace-nowrap">{total.toLocaleString()} lead{total !== 1 ? 's' : ''} affected</span>
          )}
        </div>

        {!isLoading && total > 0 && (
          <div className="px-6 py-2.5 border-b bg-muted/20 flex items-center gap-3 shrink-0 text-sm">
            <span className="font-semibold">
              {approvedCount === 0 ? 'None selected'
                : isAllMode && excludedIds.size === 0 ? ('All ' + total.toLocaleString() + ' leads selected')
                : (approvedCount.toLocaleString() + ' lead' + (approvedCount !== 1 ? 's' : '') + ' selected')}
            </span>
            <div className="flex items-center gap-2 ml-auto text-xs">
              <button onClick={selectAllPage} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5" /> Page ({rows.length})
              </button>
              <span className="text-muted-foreground">|</span>
              <button onClick={selectAllTotal} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5" /> All {total.toLocaleString()}
              </button>
              <span className="text-muted-foreground">|</span>
              <button onClick={deselectAll} className="text-muted-foreground hover:text-foreground font-medium flex items-center gap-1">
                <Square className="h-3.5 w-3.5" /> None
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <span className="ml-3 text-muted-foreground">Loading preview...</span>
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-3 text-muted-foreground/30" />
              <p className="font-medium">No leads found</p>
              <p className="text-sm mt-1">No active leads match the selected values</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b z-10">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <button onClick={pageSelectedCount === rows.length ? deselectAll : selectAllPage} className="text-muted-foreground hover:text-foreground">
                      {pageSelectedCount === rows.length
                        ? <CheckSquare className="h-4 w-4 text-blue-600" />
                        : pageSelectedCount > 0 ? <MinusSquare className="h-4 w-4 text-blue-400" />
                        : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Lead Name</th>
                  {isCascade && (
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">{filterFieldLabel}</th>
                  )}
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Current {writeFieldLabel}</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">New {writeFieldLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, idx) => {
                  const selected = isRowSelected(row.id)
                  return (
                    <tr key={row.id} onClick={() => toggleRow(row.id)}
                      className={'cursor-pointer transition-colors ' + (selected ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-muted/30 opacity-60')}>
                      <td className="px-4 py-2.5 text-center">
                        {selected ? <CheckSquare className="h-4 w-4 text-blue-600 mx-auto" /> : <Square className="h-4 w-4 text-muted-foreground/40 mx-auto" />}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{((page - 1) * PAGE_SIZE) + idx + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{row.name}</td>
                      {isCascade && (
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-md font-medium">
                            {row.filterValue || <em className="opacity-50">empty</em>}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-md font-medium">
                          {row.oldValue || <em className="opacity-50">empty</em>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-bold">{row.newValue}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-3 border-t bg-card flex items-center justify-between shrink-0">
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages} &bull; {total.toLocaleString()} leads</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              {buildPageNums(page, totalPages).map((p) => (
                <button key={p} onClick={() => setPage(p)}
                  className={'w-8 h-8 rounded-lg text-sm font-medium transition-colors ' + (p === page ? 'bg-orange-500 text-white' : 'hover:bg-muted text-muted-foreground')}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t bg-card flex items-center justify-between gap-3 shrink-0">
          <p className="text-sm text-muted-foreground">
            {approvedCount === 0
              ? <span className="text-amber-600 font-medium">Select at least one lead to proceed</span>
              : <><strong className="text-foreground">{approvedCount.toLocaleString()}</strong> lead{approvedCount !== 1 ? 's' : ''} will be updated</>}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-accent font-medium transition-colors">Cancel</button>
            <button onClick={handleApprove} disabled={isApproving || approvedCount === 0}
              className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {isApproving
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating...</>
                : <><CheckCircle2 className="h-4 w-4" /> Approve & Update ({approvedCount.toLocaleString()})</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
