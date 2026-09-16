import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, Inbox } from 'lucide-react'
import type { TenantStatus, ProvisioningStatus } from '@/lib/api'

/**
 * Shared building blocks for the super admin panel.
 *
 * Light surface, but deliberately NOT the customer app's look. The CRM leads on
 * blue; this console leads on near-black primaries with a violet accent, sits on
 * a slate-50 page rather than white, and uses wider radii and softer shadows.
 * You should be able to tell which panel you are in from a glance at a
 * thumbnail — that mattered when this was dark, and it still matters now.
 */

// ─── Page scaffolding ─────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumb?: ReactNode
}) {
  return (
    <div className="mb-6">
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && (
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon: Icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'warn' | 'danger' | 'good'
  icon?: React.ComponentType<{ className?: string }>
}) {
  const valueTone = {
    default: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    danger: 'text-red-600',
  }[tone]

  const iconTone = {
    default: 'bg-slate-100 text-slate-500',
    good: 'bg-emerald-50 text-emerald-600',
    warn: 'bg-amber-50 text-amber-600',
    danger: 'bg-red-50 text-red-600',
  }[tone]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight', valueTone)}>
            {value}
          </div>
        </div>
        {Icon && (
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconTone)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

// ─── Badges ───────────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: TenantStatus }) {
  const map: Record<TenantStatus, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    suspended: 'bg-red-50 text-red-700 ring-red-600/20',
    expired: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset',
        map[status],
      )}
    >
      {status}
    </span>
  )
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function ProvisioningBadge({
  status,
  step,
}: {
  status: ProvisioningStatus
  step?: string | null
}) {
  if (status === 'ready') return null

  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
        <AlertTriangle className="h-3 w-3" /> Setup failed
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
      <Loader2 className="h-3 w-3 animate-spin" />
      {step || status.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Usage ────────────────────────────────────────────────────────────────────

/** used / limit with a bar. A null limit renders as "unlimited". */
export function UsageBar({
  label,
  used,
  limit,
}: {
  label: string
  used: number
  limit: number | null
}) {
  if (limit == null) {
    return (
      <div className="flex items-baseline justify-between gap-3 py-2">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="text-sm tabular-nums text-slate-500">
          {used.toLocaleString()} <span className="text-slate-300">/</span>{' '}
          <span className="text-slate-400">unlimited</span>
        </span>
      </div>
    )
  }

  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const bar = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  const numbers = pct >= 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-slate-500'

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-700">{label}</span>
        <span className={cn('text-sm tabular-nums', numbers)}>
          {used.toLocaleString()} <span className="text-slate-300">/</span>{' '}
          <span className="text-slate-400">{limit.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Forms ────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ' +
  'placeholder:text-slate-400 transition-colors ' +
  'focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20'

// Near-black primary, not the CRM's blue — part of keeping the two panels
// visually distinct now that the background no longer does that job.
export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm ' +
  'transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm ' +
  'transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

export const btnDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm ' +
  'transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

// ─── Tables ───────────────────────────────────────────────────────────────────

/** Full-bleed scroll container for a table inside a Panel's padded body. */
export function TableWrap({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-5 -mb-5 overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export const thClass =
  'px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'

export const trClass = 'border-t border-slate-100 transition-colors hover:bg-slate-50/70'

export const tdClass = 'px-5 py-3 align-middle'

// ─── States ───────────────────────────────────────────────────────────────────

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

export function Empty({ children, icon = true }: { children: ReactNode; icon?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
          <Inbox className="h-5 w-5 text-slate-400" />
        </div>
      )}
      <p className="text-sm text-slate-500">{children}</p>
    </div>
  )
}

export function Callout({
  tone = 'warn',
  title,
  children,
}: {
  tone?: 'warn' | 'danger' | 'good' | 'info'
  title?: ReactNode
  children: ReactNode
}) {
  const map = {
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border-violet-200 bg-violet-50 text-violet-900',
  }[tone]

  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border p-3.5 text-sm', map)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        <div className={cn(title && 'mt-0.5', 'text-[13px] leading-relaxed opacity-90')}>{children}</div>
      </div>
    </div>
  )
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000)
}
