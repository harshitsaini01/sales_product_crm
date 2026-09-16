import { useState } from 'react'
import { Check, AlertTriangle } from 'lucide-react'
import type { FeatureDef } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * One module toggle, shared by the New Customer wizard and an existing
 * customer's Modules tab.
 *
 * Two grids rendering their own copy of this is how the core-locking change
 * shipped half-done last time — the wizard got it, the customer detail page did
 * not, and the result was a checkbox that looked clickable and silently did
 * nothing. One component, used twice.
 *
 * EVERY module is switchable, including Leads and Dashboard. The `critical`
 * ones are not locked, but turning one OFF asks first and says what breaks,
 * because "Leads" and "Internal Chat" should not be one careless click apart.
 * Turning one back ON is not confirmed — that direction is always safe.
 */
export function FeatureToggle({
  feature,
  on,
  onChange,
}: {
  feature: FeatureDef
  on: boolean
  onChange: (next: boolean) => void
}) {
  const [confirming, setConfirming] = useState(false)

  const needsConfirm = feature.critical && on

  function handle(next: boolean) {
    if (needsConfirm && !next) {
      setConfirming(true)
      return
    }
    onChange(next)
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-3.5 transition-colors',
        confirming
          ? 'border-amber-300 bg-amber-50'
          : on
            ? 'border-violet-200 bg-violet-50/50'
            : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
            on ? 'border-violet-600 bg-violet-600' : 'border-slate-300 bg-white',
          )}
        >
          {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => handle(e.target.checked)}
          className="sr-only"
        />
        <div className="min-w-0">
          <div
            className={cn(
              'flex items-center gap-1.5 text-sm font-medium',
              on ? 'text-violet-900' : 'text-slate-900',
            )}
          >
            {feature.label}
            {feature.critical && (
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                title="Other modules depend on this one"
              >
                core
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{feature.description}</div>
        </div>
      </label>

      {confirming && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-900">
              {feature.criticalWarning ??
                'Other parts of the CRM depend on this module. Turning it off will affect more than its own screens.'}
            </p>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                onChange(false)
                setConfirming(false)
              }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Turn {feature.label} off
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-amber-50"
            >
              Keep it on
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
