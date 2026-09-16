import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Searchable multi-select dropdown used by the Lead Bucket filter bar and the
 * calling-task builder. The value is a comma-separated string so it drops
 * straight into a query param.
 *
 * Extracted verbatim from `pages/admin/Bucket.tsx` so both pages share one
 * implementation — behaviour is unchanged for the Bucket.
 */
export function MultiSelectFilter({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; count: number }[]
  placeholder: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedList = useMemo(
    () => (value ? value.split(',').filter(Boolean) : []),
    [value],
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = useMemo(() => {
    let list = options
    if (search.trim()) {
      const q = search.toLowerCase()
      list = options.filter((opt) => opt.value.toLowerCase().includes(q))
    }
    // Limit to max 35 items to prevent DOM lag
    return list.slice(0, 35)
  }, [options, search])

  function toggleOption(val: string) {
    let next: string[]
    if (selectedList.includes(val)) {
      next = selectedList.filter((v) => v !== val)
    } else {
      next = [...selectedList, val]
    }
    onChange(next.join(','))
  }

  function clearAll() {
    onChange('')
    setSearch('')
  }

  const displayLabel = useMemo(() => {
    if (selectedList.length === 0) return placeholder
    if (selectedList.length === 1) return selectedList[0]
    return `${selectedList.length} ${label.toLowerCase()}s selected`
  }, [selectedList, placeholder, label])

  return (
    <div className="relative z-30" ref={containerRef}>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>

      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={cn(
            'w-full flex items-center justify-between pl-3 pr-8 py-1.5 text-xs bg-background border rounded-lg hover:border-primary/50 transition-colors text-left font-medium shadow-2xs',
            selectedList.length > 0
              ? 'border-primary/50 text-primary font-semibold bg-primary/5 ring-1 ring-primary/20'
              : 'text-foreground',
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown
            className={cn('absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', isOpen && 'rotate-180')}
          />
        </button>

        {selectedList.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              clearAll()
            }}
            title={`Clear ${label} filter`}
            className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-destructive rounded-full"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 min-w-[240px] w-full max-w-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 p-2.5 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground border-b border-border/40 pb-1.5">
            <span>Top {filteredOptions.length} items</span>
            {selectedList.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="text-primary hover:underline font-semibold"
              >
                Clear all ({selectedList.length})
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground">Select multiple</span>
            )}
          </div>

          <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-xs text-center text-muted-foreground">No matching {label.toLowerCase()}s</div>
            ) : (
              filteredOptions.map((opt) => {
                const isChecked = selectedList.includes(opt.value)
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg cursor-pointer transition-colors select-none my-0.5',
                      isChecked
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOption(opt.value)}
                        className="rounded border-slate-300 text-primary focus:ring-primary/40 h-3.5 w-3.5"
                      />
                      <span className="truncate font-medium">{opt.value}</span>
                    </div>
                    {opt.count > 0 && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full ml-1 shrink-0 font-medium">
                        {opt.count}
                      </span>
                    )}
                  </label>
                )
              })
            )}
          </div>

          <div className="pt-1 border-t border-border/40 flex justify-end">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
