import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { followupsApi, leadsApi } from '@/lib/api'
import { PhoneCall, MessageSquare, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { maskPhone } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

interface TodayLead {
  id: number
  name: string
  mobile: string | null
  email: string | null
  leadStatus: string
  followupDate: string | null
  called?: number
  wapp?: number
  lastComment?: string | null
  lastNote?: string | null
}

export function TodaysCallList() {
  const qc = useQueryClient()
  const reveal = useAuthStore((s) => s.canRevealPhone())
  const { data: leadsRes, isLoading } = useQuery({
    queryKey: ['followups', 'today'],
    queryFn: () => followupsApi.today({ limit: 200 }),
    refetchInterval: 60_000,
  })
  const leads: TodayLead[] = (leadsRes?.data ?? []) as TodayLead[]
  const totalToday = leadsRes?.total ?? 0

  const toggleCalled = useMutation({
    mutationFn: (id: number) => leadsApi.toggleCalled(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['followups', 'today'] }),
    onError: () => toast.error('Failed'),
  })

  return (
    <div className="bg-card border rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-emerald-600" />
            Today's Call List
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Leads due for follow-up today — tap the phone to mark called.
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
          {totalToday}
        </span>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No calls scheduled for today.
          </p>
        ) : (
          <ul className="divide-y">
            {leads.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-3 px-6 py-3 hover:bg-accent/30"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to="/app/leads/$leadId"
                    params={{ leadId: String(l.id) }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sm hover:text-primary"
                  >
                    {l.name}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {l.mobile ? maskPhone(l.mobile, reveal) : 'No phone'} · {l.leadStatus || 'Fresh'}
                  </div>
                  {(l.lastNote || l.lastComment) && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {l.lastNote ? `Note: ${l.lastNote}` : `Last: ${l.lastComment}`}
                    </div>
                  )}
                </div>

                {l.mobile && (
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`tel:${l.mobile}`}
                      onClick={() => toggleCalled.mutate(l.id)}
                      title={l.called === 1 ? 'Already called' : 'Call & mark'}
                      className={`p-2 rounded-lg transition-colors ${
                        l.called === 1
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-muted text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600'
                      }`}
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`https://api.whatsapp.com/send?phone=${l.mobile}&text=Hello%20${encodeURIComponent(l.name)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="WhatsApp"
                      className={`p-2 rounded-lg transition-colors ${
                        l.wapp === 1
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-muted text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600'
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}

                <Link
                  to="/app/leads/$leadId"
                  params={{ leadId: String(l.id) }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-muted-foreground hover:text-primary"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
