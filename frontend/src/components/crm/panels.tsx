import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The small pieces every CRM summary panel is built from.
 *
 * These were written three times — once in the lead's company panel, once in
 * the lead overview, once in the account summary — and had already begun to
 * drift: the same "Mini" stat had different padding and a different warning
 * colour in two of them. One definition, used everywhere.
 */

export function Block({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('rounded-lg border bg-card p-4', className)}>{children}</div>
}

/** A section heading with a count and an optional "See all". */
export function SectionHead({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h4 className="text-sm font-semibold">{title}</h4>
      {!!count && (
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          {count}
        </span>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="ml-auto text-xs font-medium text-primary hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * One number with a label.
 *
 * `tone` is deliberately not a colour name — the caller says what the number
 * *means* and this decides how to show it, so an overdue figure looks the same
 * everywhere it appears.
 */
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'warn' | 'good' | 'accent'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2.5',
        tone === 'warn' && 'border-amber-300 bg-amber-50/60',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/40',
        tone === 'accent' && 'border-primary/30 bg-primary/5',
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-sm font-bold',
          tone === 'warn' && 'text-amber-700',
          tone === 'good' && 'text-emerald-700',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

/** A linked row in a list of records. */
export function RecordRow({
  to,
  params,
  title,
  sub,
  right,
  mono,
}: {
  to: string
  params: Record<string, string>
  title: string
  sub?: React.ReactNode
  right?: React.ReactNode
  mono?: boolean
}) {
  return (
    <Link
      // TanStack Router types every path as a literal union; these components
      // are generic over the record type, so the route is passed as a string.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params={params as any}
      className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5 text-sm transition-colors hover:border-primary/40"
    >
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', mono && 'font-mono text-xs')}>{title}</p>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {right}
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** A whole section that disappears when it has nothing to show. */
export function RecordList<T>({
  icon,
  title,
  items,
  render,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  items: T[] | undefined
  render: (item: T) => React.ReactNode
  action?: { label: string; onClick: () => void }
}) {
  if (!items?.length) return null
  return (
    <Block>
      <SectionHead icon={icon} title={title} count={items.length} action={action} />
      <div className="mt-2 space-y-1.5">{items.map(render)}</div>
    </Block>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-muted-foreground">{children}</p>
}
