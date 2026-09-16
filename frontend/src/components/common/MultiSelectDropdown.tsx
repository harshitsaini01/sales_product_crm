import { useEffect, useRef, useState } from 'react'

// Searchable multi-select dropdown. `value` is a string[] (not CSV) because
// real-world option labels can legitimately contain commas — e.g. city names
// like "ALWAR, SUBHASH NAGAR" — and CSV would split them mid-name.
export function MultiSelectDropdown({
  options, value, onChange, placeholder, searchPlaceholder,
}: {
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selectedSet = new Set(value)
  const filtered = options.filter((o) =>
    !search.trim() || o.toLowerCase().includes(search.toLowerCase()),
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function toggle(v: string) {
    const set = new Set(selectedSet)
    set.has(v) ? set.delete(v) : set.add(v)
    onChange(Array.from(set))
  }

  const label =
    value.length === 0 ? <span className="text-muted-foreground">{placeholder || 'Any'}</span>
    : value.length === 1 ? value[0]
    : `${value.length} selected`

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 text-sm border rounded-lg bg-background text-left flex items-center justify-between gap-2"
      >
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground text-xs shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-background border rounded-lg shadow-lg flex flex-col max-h-72">
          <div className="p-2 border-b">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder || 'Search...'}
              className="w-full px-2 py-1.5 text-sm border rounded bg-background"
            />
          </div>
          <div className="overflow-y-auto flex-1 divide-y">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
            ) : (
              filtered.map((opt) => {
                const checked = selectedSet.has(opt)
                return (
                  <label
                    key={opt}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/40 ${checked ? 'bg-primary/5' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="flex-1 truncate">{opt}</span>
                  </label>
                )
              })
            )}
          </div>
          {value.length > 0 && (
            <div className="border-t p-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{value.length} selected</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
