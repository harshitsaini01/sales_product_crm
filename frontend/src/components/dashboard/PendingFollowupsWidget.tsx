import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { followupsApi } from '@/lib/api'
import { formatDate, maskPhone } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { AlertTriangle, Calendar, CalendarClock, ChevronRight, Loader2, Phone } from 'lucide-react'
import { StatusBadge } from '@/components/leads/StatusBadge'

type PendingLead = {
  id: number
  name: string
  mobile: string | null
  email: string | null
  leadStatus: string
  leadSubStatus: string | null
  followupDate: string | null
}

type BucketKey = 'overdue' | 'today' | 'upcoming'

const BUCKETS: { key: BucketKey; label: string; icon: typeof Calendar; tone: string }[] = [
  { key: 'overdue',  label: 'Overdue',     icon: AlertTriangle, tone: 'text-rose-600' },
  { key: 'today',    label: 'Today',       icon: Calendar,      tone: 'text-primary' },
  { key: 'upcoming', label: 'Next 7 days', icon: CalendarClock, tone: 'text-amber-600' },
]

export function PendingFollowupsWidget() {
  const [active, setActive] = useState<BucketKey>('today')

  const { data: counts } = useQuery({
    queryKey: ['followups-pending-counts'],
    queryFn: () => followupsApi.pendingCounts(),
    refetchInterval: 60_000, // refresh every minute
  })

  const { data: leadsRes, isLoading } = useQuery({
    queryKey: ['followups-pending', active],
    queryFn: () =>
      active === 'overdue' ? followupsApi.overdue({ limit: 50 })
      : active === 'today'  ? followupsApi.today({ limit: 50 })
      :                       followupsApi.upcoming({ limit: 50 }),
  })
  const leads: PendingLead[] = (leadsRes?.data ?? []) as PendingLead[]

  return (
    <div className="bg-card border rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
        <h2 className="text-lg font-bold">Pending Follow-ups</h2>
        <Link
          to="/app/leads"
          search={{ followupDate: new Date().toISOString().slice(0, 10) } as Record<string, string>}
          className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
        >
          View all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex border-b">
        {BUCKETS.map((b) => {
          const count = counts?.[b.key] ?? 0
          const isActive = active === b.key
          const Icon = b.icon
          return (
            <button
              key={b.key}
              onClick={() => setActive(b.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${isActive ? b.tone : ''}`} />
              {b.label}
              <span
                className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
                  b.key === 'overdue' && count > 0
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="max-h-[360px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            {active === 'overdue'
              ? 'No overdue follow-ups. Nice work.'
              : active === 'today'
              ? 'No follow-ups scheduled for today.'
              : 'Nothing in the next 7 days.'}
          </p>
        ) : (
          <ul className="divide-y">
            {leads.map((l) => (
              <li key={l.id} className="group">
                <Link
                  to="/app/leads/$leadId"
                  params={{ leadId: String(l.id) }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-6 py-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{l.name}</span>
                      <StatusBadge status={l.leadStatus} subStatus={l.leadSubStatus} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {l.mobile && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {maskPhone(l.mobile, useAuthStore.getState().canRevealPhone())}
                        </span>
                      )}
                      {l.followupDate && (
                        <span
                          className={
                            active === 'overdue'
                              ? 'font-semibold text-rose-600'
                              : 'font-medium text-foreground'
                          }
                        >
                          {formatDate(l.followupDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
