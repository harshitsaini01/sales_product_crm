import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { dashboardApi } from '@/lib/api'
import { maskPhone } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { StatusBadge } from '@/components/leads/StatusBadge'
import { ChevronRight, Loader2, MapPin, Phone, UserPlus } from 'lucide-react'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function AssignedTodayWidget() {
  const reveal = useAuthStore((s) => s.canRevealPhone())
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'assigned-today'],
    queryFn: () => dashboardApi.assignedToday({ limit: 50 }),
    refetchInterval: 60_000,
  })

  const total = data?.total ?? 0
  const leads = data?.data ?? []

  return (
    <div className="bg-card border rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-indigo-600" />
            Assigned to Me Today
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fresh leads handed to you today — start with these.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700">
            {total}
          </span>
          <Link
            to="/app/leads"
            search={{ assignedFrom: todayISO(), assignedTo: todayISO() } as Record<string, string>}
            className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
          >
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No new leads assigned to you today.
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{l.name}</span>
                      <StatusBadge status={l.leadStatus} subStatus={l.leadSubStatus} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                      {l.mobile && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {maskPhone(l.mobile, reveal)}
                        </span>
                      )}
                      {l.city && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {l.city}
                        </span>
                      )}
                      <span className="font-medium">{formatTime(l.assignedAt)}</span>
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
