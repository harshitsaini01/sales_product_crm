import { Sparkles, Phone, Clock, XCircle, CheckCircle2, Archive } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Maps a lead status title (canonical or legacy) to a color scheme + icon.
 * Add new entries here as new lifecycle stages are seeded into lead_statuses.
 */
const STAGE_META: Record<string, { cls: string; Icon: typeof Sparkles }> = {
  'Fresh':          { cls: 'bg-blue-100 text-blue-700 border-blue-300',       Icon: Sparkles },
  'New':            { cls: 'bg-blue-100 text-blue-700 border-blue-300',       Icon: Sparkles },
  'Contacted':      { cls: 'bg-violet-100 text-violet-700 border-violet-300', Icon: Phone },
  'Follow-up':      { cls: 'bg-amber-100 text-amber-700 border-amber-300',    Icon: Clock },
  'Not Interested': { cls: 'bg-rose-100 text-rose-700 border-rose-300',       Icon: XCircle },
  'Converted':      { cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', Icon: CheckCircle2 },
  'Closed':         { cls: 'bg-slate-100 text-slate-600 border-slate-300',    Icon: Archive },
}

const FALLBACK = { cls: 'bg-gray-100 text-gray-700 border-gray-300', Icon: Sparkles }

export function StatusBadge({
  status,
  subStatus,
  className,
}: {
  status: string | null | undefined
  subStatus?: string | null
  className?: string
}) {
  const key = status ?? 'Fresh'
  const meta = STAGE_META[key] ?? FALLBACK
  const { Icon } = meta
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap',
        meta.cls,
        className,
      )}
      title={subStatus ? `${key} — ${subStatus}` : key}
    >
      <Icon className="h-3 w-3" />
      {key}
      {subStatus ? <span className="opacity-70">· {subStatus}</span> : null}
    </span>
  )
}
