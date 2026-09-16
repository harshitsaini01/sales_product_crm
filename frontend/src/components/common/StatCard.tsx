import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Small icon + label + value tile used along the top of the Lead Bucket and the
 * calling-task builder. Extracted from `pages/admin/Bucket.tsx` so both pages
 * render the identical card instead of drifting apart.
 */
export function StatCard({
  icon, label, value, sub, tint,
}: {
  icon: ReactNode
  label: string
  value: number | string
  sub?: string
  tint: 'amber' | 'emerald' | 'blue' | 'violet' | 'red'
}) {
  const tints: Record<string, string> = {
    amber: 'bg-amber-500/10 text-amber-600',
    emerald: 'bg-emerald-500/10 text-emerald-600',
    blue: 'bg-blue-500/10 text-blue-600',
    violet: 'bg-violet-500/10 text-violet-600',
    red: 'bg-red-500/10 text-red-600',
  }
  return (
    <div className="bg-card border rounded-xl p-3 flex items-center gap-3">
      <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center shrink-0', tints[tint])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{label}</div>
        <div className="text-xl font-bold leading-tight">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  )
}
