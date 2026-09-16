import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { leadsApi, type BulkStatusPreviewRow } from '@/lib/api'
import { toast } from 'sonner'
import {
  Loader2, Eye, ChevronLeft, ChevronRight, CheckSquare, Square, MinusSquare,
  XCircle, AlertCircle, ArrowRight, Building2, Ban, CheckCircle2,
} from 'lucide-react'

/**
 * Confirmation screen for a bulk status / department change.
 *
 * Renders the server's dry run (`POST /leads/bulk-status/preview`) — the same
 * planner the apply endpoint uses — so every lead is listed with the exact
 * department it leaves and the one it lands in before anything is written.
 * Leads the pipeline guard refuses are shown greyed out and cannot be ticked.
 */
const PAGE_SIZE = 100

export interface BulkStatusPreviewModalProps {
  /** Heading — defaults to the department-move wording. */
  title?: string
  subtitle?: string
  /** Verb on the confirm button, e.g. "Move" / "Add Follow-up". */
  confirmLabel?: string
  leadIds: number[]
  leadStatusId?: number
  leadSubStatusId?: number
  /** Explicit target department (Move Department flow). */
  departmentId?: number
  onBack: () => void
  onClose: () => void
  onConfirm: (approvedIds: number[]) => void
  isApplying: boolean
}

export function BulkStatusPreviewModal({
  title = 'Preview Move',
  subtitle = 'Review every lead before the department change is applied',
  confirmLabel = 'Confirm & Move',
  leadIds, leadStatusId, leadSubStatusId, departmentId,
  onBack, onClose, onConfirm, isApplying,
}: BulkStatusPreviewModalProps) {
  const [page, setPage] = useState(1)
  // Everything eligible starts ticked; the user unticks what they want to skip.
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bulk-status-preview', leadIds.length, leadStatusId, leadSubStatusId, departmentId, page],
    queryFn: () => leadsApi.bulkStatusPreview({
      leadIds, leadStatusId, leadSubStatusId, departmentId, page, limit: PAGE_SIZE,
    }),
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 0
  const blockedCount = data?.blockedCount ?? 0
  const movingCount = data?.movingCount ?? 0
  const eligibleTotal = Math.max(0, total - blockedCount)
  const approvedCount = Math.max(0, eligibleTotal - excludedIds.size)

  const isRowSelected = (row: BulkStatusPreviewRow) => !row.blocked && !excludedIds.has(row.id)

  const toggleRow = (row: BulkStatusPreviewRow) => {
    if (row.blocked) return
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  const eligibleRows = useMemo(() => rows.filter((r) => !r.blocked), [rows])
  const pageSelectedCount = eligibleRows.filter((r) => !excludedIds.has(r.id)).length

  const selectAllPage = () =>
    setExcludedIds((prev) => {
      const next = new Set(prev)
      eligibleRows.forEach((r) => next.delete(r.id))
      return next
    })
  const deselectAllPage = () =>
    setExcludedIds((prev) => {
      const next = new Set(prev)
      eligibleRows.forEach((r) => next.add(r.id))
      return next
    })
  const selectEverything = () => setExcludedIds(new Set())

  const handleConfirm = () => {
    if (approvedCount === 0) {
      toast.error('No leads selected')
      return
    }
    // Excluding nothing → send the whole selection and let the server re-plan
    // it (avoids shipping thousands of ids). Otherwise send the explicit list.
    if (excludedIds.size === 0) onConfirm([])
    else onConfirm(leadIds.filter((id) => !excludedIds.has(id)))
  }

  const buildPageNums = (cur: number, tot: number) => {
    let start = Math.max(1, cur - 2)
    const end = Math.min(tot, start + 4)
    start = Math.max(1, end - 4)
    return Array.from({ length: Math.min(tot, 5) }, (_, i) => start + i)
  }

  const fromLabel = data?.fromDepartments?.length
    ? data.fromDepartments.length === 1
      ? data.fromDepartments[0]
      : `${data.fromDepartments.length} departments`
    : '—'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-5xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
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

        {/* From → To summary */}
        <div className="px-6 py-3 bg-amber-50/60 dark:bg-amber-950/20 border-b flex items-center gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap flex-1 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-background border rounded-lg font-semibold">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {fromLabel}
            </span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 rounded-lg font-bold">
              <Building2 className="h-3.5 w-3.5" /> {data?.toDepartment ?? 'No department change'}
            </span>
            {data?.toStatus && (
              <span className="text-xs text-muted-foreground">
                Status → <strong className="text-foreground">{data.toStatus}</strong>
                {data.toSubStatus && <> / <strong className="text-foreground">{data.toSubStatus}</strong></>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm whitespace-nowrap">
            <span className="font-semibold">{total.toLocaleString()} lead{total !== 1 ? 's' : ''}</span>
            {movingCount > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">{movingCount.toLocaleString()} moving</span>
            )}
            {blockedCount > 0 && (
              <span className="text-red-600 font-medium flex items-center gap-1">
                <Ban className="h-3.5 w-3.5" /> {blockedCount.toLocaleString()} blocked
              </span>
            )}
          </div>
        </div>

        {/* Selection toolbar */}
        {!isLoading && total > 0 && (
          <div className="px-6 py-2.5 border-b bg-muted/20 flex items-center gap-3 shrink-0 text-sm">
            <span className="font-semibold">
              {approvedCount === 0
                ? 'None selected'
                : excludedIds.size === 0
                  ? `All ${eligibleTotal.toLocaleString()} eligible leads selected`
                  : `${approvedCount.toLocaleString()} lead${approvedCount !== 1 ? 's' : ''} selected`}
            </span>
            <div className="flex items-center gap-2 ml-auto text-xs">
              <button onClick={selectAllPage} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5" /> Page ({eligibleRows.length})
              </button>
              <span className="text-muted-foreground">|</span>
              <button onClick={selectEverything} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5" /> All {eligibleTotal.toLocaleString()}
              </button>
              <span className="text-muted-foreground">|</span>
              <button onClick={deselectAllPage} className="text-muted-foreground hover:text-foreground font-medium flex items-center gap-1">
                <Square className="h-3.5 w-3.5" /> None on page
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <span className="ml-3 text-muted-foreground">Building preview…</span>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-3 text-red-400" />
              <p className="font-medium">Could not build the preview</p>
              <p className="text-sm mt-1">Go back and try again</p>
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-3 text-muted-foreground/30" />
              <p className="font-medium">No leads to update</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b z-10">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <button
                      onClick={pageSelectedCount === eligibleRows.length ? deselectAllPage : selectAllPage}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Toggle page selection"
                    >
                      {eligibleRows.length > 0 && pageSelectedCount === eligibleRows.length
                        ? <CheckSquare className="h-4 w-4 text-blue-600" />
                        : pageSelectedCount > 0 ? <MinusSquare className="h-4 w-4 text-blue-400" />
                        : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Lead</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">From Dept</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">To Dept</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, idx) => {
                  const selected = isRowSelected(row)
                  return (
                    <tr
                      key={row.id}
                      onClick={() => toggleRow(row)}
                      title={row.blockReason ?? undefined}
                      className={
                        row.blocked
                          ? 'bg-red-50/50 dark:bg-red-950/20 opacity-70 cursor-not-allowed'
                          : 'cursor-pointer transition-colors ' +
                            (selected ? 'bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30' : 'hover:bg-muted/30 opacity-60')
                      }
                    >
                      <td className="px-4 py-2.5 text-center">
                        {row.blocked
                          ? <Ban className="h-4 w-4 text-red-500 mx-auto" />
                          : selected
                            ? <CheckSquare className="h-4 w-4 text-blue-600 mx-auto" />
                            : <Square className="h-4 w-4 text-muted-foreground/40 mx-auto" />}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{((page - 1) * PAGE_SIZE) + idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground">
                          #{row.id}{row.mobile ? ` · ${row.mobile}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground border rounded-md font-medium">
                          {row.fromDepartment ?? <em className="opacity-50">none</em>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {row.blocked ? (
                          <span className="px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-md font-semibold">
                            Blocked — backward
                          </span>
                        ) : row.moving ? (
                          <span className="px-2 py-0.5 text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 rounded-md font-bold">
                            {row.toDepartment}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">stays</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="text-muted-foreground">{row.fromStatus || '—'}</span>
                        {row.toStatus && row.toStatus !== row.fromStatus && (
                          <>
                            <ArrowRight className="h-3 w-3 inline mx-1 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{row.toStatus}</span>
                          </>
                        )}
                        {row.toSubStatus && row.toSubStatus !== row.fromSubStatus && (
                          <div className="text-[11px] text-muted-foreground">Sub: <strong className="text-foreground">{row.toSubStatus}</strong></div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
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

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-card flex items-center justify-between gap-3 shrink-0">
          <p className="text-sm text-muted-foreground">
            {approvedCount === 0
              ? <span className="text-amber-600 font-medium">Select at least one lead to proceed</span>
              : <><strong className="text-foreground">{approvedCount.toLocaleString()}</strong> lead{approvedCount !== 1 ? 's' : ''} will be updated{blockedCount > 0 && <span className="text-red-600"> · {blockedCount.toLocaleString()} skipped</span>}</>}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="px-4 py-2 text-sm border rounded-lg hover:bg-accent font-medium transition-colors">
              Back
            </button>
            <button onClick={handleConfirm} disabled={isApplying || approvedCount === 0}
              className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {isApplying
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</>
                : <><CheckCircle2 className="h-4 w-4" /> {confirmLabel} ({approvedCount.toLocaleString()})</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
