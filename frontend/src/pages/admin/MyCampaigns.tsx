import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { autoDialerApi } from '@/lib/api'
import { PhoneOutgoing, Smartphone, Clock } from 'lucide-react'

export default function MyCampaigns() {
  const listQ = useQuery({
    queryKey: ['auto-dialer', 'campaigns', 'mine'],
    queryFn: () => autoDialerApi.list(),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">My Campaigns</h1>
        <p className="text-sm text-muted-foreground">Auto-dialer campaigns assigned to you</p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-primary" />
        Start dialing from the mobile app — calls will play the campaign recording to the caller automatically.
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {listQ.isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : (listQ.data?.data || []).length === 0 ? (
          <div className="text-muted-foreground">No active campaigns assigned to you yet.</div>
        ) : (listQ.data?.data || []).map((c) => (
          <Link
            key={c.id}
            to="/app/auto-dialer/$id"
            params={{ id: String(c.id) }}
            className="border rounded-lg p-4 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-semibold truncate">{c.name}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {c.status}
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2"><PhoneOutgoing className="h-3 w-3" /> {c.totalContacts} contacts</div>
              <div className="flex items-center gap-2"><Clock className="h-3 w-3" /> Gap {c.callGapSec}s</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
