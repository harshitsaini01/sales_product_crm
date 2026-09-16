import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { PhoneCall, PhoneIncoming, PhoneMissed, Clock, ArrowUpRight } from 'lucide-react'

interface StatRow {
  userId: number
  status: string
  count: number
  durationSec: number
}

/**
 * Today's call activity. Uses /api/calls/stats which auto-scopes to the current
 * user when the role is counsellor and gives the full org breakdown for admins.
 */
export function CallStatsWidget() {
  const { isAdmin } = useAuthStore()
  const today = new Date().toISOString().slice(0, 10)

  const { data = [], isLoading } = useQuery<StatRow[]>({
    queryKey: ['call-stats-today', today],
    queryFn: () => api.get('/calls/stats', { params: { fromDate: today, toDate: today } }).then((r) => r.data),
  })

  const totals = {
    // MISSED = incoming the counsellor didn't pick up — surfaces only in the
    // dedicated Missed tile, not in the "calls he made" total.
    total: data.filter((r) => r.status !== 'MISSED').reduce((s, r) => s + r.count, 0),
    answered: data.filter((r) => r.status === 'ANSWERED').reduce((s, r) => s + r.count, 0),
    missed: data.filter((r) => r.status === 'MISSED' || r.status === 'NO_ANSWER').reduce((s, r) => s + r.count, 0),
    durationSec: data.filter((r) => r.status === 'ANSWERED').reduce((s, r) => s + r.durationSec, 0),
  }

  return (
    <div className="bg-card border rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-indigo-600" />
          {isAdmin() ? 'Team calls today' : 'My calls today'}
        </h2>
        <Link to="/app/calls" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
          View all <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          <Card icon={PhoneCall} label="Total" value={totals.total} color="text-indigo-600" />
          <Card icon={PhoneIncoming} label="Answered" value={totals.answered} color="text-emerald-600" />
          <Card icon={PhoneMissed} label="No Answer" value={totals.missed} color="text-amber-600" />
          <Card icon={Clock} label="Talk time" value={`${Math.round(totals.durationSec / 60)}m`} color="text-violet-600" />
        </div>
      )}
    </div>
  )
}

function Card({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string; color: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
