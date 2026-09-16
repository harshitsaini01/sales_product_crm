import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  total?: number
  pageSize?: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
  const canPrev = page > 1
  const canNext = page < totalPages

  const from = pageSize ? (page - 1) * pageSize + 1 : null
  const to = pageSize && total ? Math.min(page * pageSize, total) : null

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
      <div className="text-muted-foreground">
        {total !== undefined && from && to
          ? `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`
          : `Page ${page} of ${totalPages || 1}`}
      </div>
      <div className="flex items-center gap-2">
        {onPageSizeChange && pageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 py-1 text-xs border rounded bg-background"
          >
            {pageSizeOptions.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => onPageChange(1)}
          disabled={!canPrev}
          className="p-1.5 border rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          title="First"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          className="p-1.5 border rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          title="Previous"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="px-2 font-mono text-xs tabular-nums">
          {page} / {totalPages || 1}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          className="p-1.5 border rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          title="Next"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={!canNext}
          className="p-1.5 border rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          title="Last"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
