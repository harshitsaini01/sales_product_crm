import { CheckCircle2, Ban } from 'lucide-react'

interface Props {
  excludeMode: boolean
  onChange: (next: boolean) => void
  className?: string
  label?: string
}

/**
 * Pill toggle that flips a filter panel between "Include" and "Exclude" mode.
 *
 * Include mode (default): results MATCH every selected filter value.
 * Exclude mode: results match NONE of the selected filter values — each
 * selection is negated independently. Useful for "show everything except…"
 * queries.
 *
 * The actual NOT-wrapping happens server-side (or in the filtering predicate
 * for client-side filters). This component is just the UI control.
 */
export function FilterModeToggle({ excludeMode, onChange, className = '', label = 'Match Mode' }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && (
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      )}
      <div
        role="radiogroup"
        aria-label="Filter match mode"
        className="inline-flex p-0.5 bg-muted rounded-lg border"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!excludeMode}
          onClick={() => onChange(false)}
          title="Show items matching the selected filters"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
            !excludeMode
              ? 'bg-emerald-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <CheckCircle2 className="h-3 w-3" /> Include
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={excludeMode}
          onClick={() => onChange(true)}
          title="Show items NOT matching any of the selected filters"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
            excludeMode
              ? 'bg-rose-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Ban className="h-3 w-3" /> Exclude
        </button>
      </div>
    </div>
  )
}
