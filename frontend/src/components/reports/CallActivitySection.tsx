import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, usersApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { PhoneCall, ArrowUpRight } from 'lucide-react'

interface StatRow {
  userId: number
  status: string
  count: number
  durationSec: number
}
interface User { id: number; name: string }

export function CallActivitySection({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const { isAdmin, isSalesHead } = useAuthStore()
  const canSeeTeam = isAdmin() || isSalesHead()
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'custom'>('30d')

  const computed = useMemo(() => {
    if (range === 'custom') return { from: fromDate || undefined, to: toDate || undefined }
    const today = new Date()
    const offset = range === 'today' ? 0 : range === '7d' ? 6 : 29
    const start = new Date(today)
    start.setDate(today.getDate() - offset)
    return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
  }, [range, fromDate, toDate])

  const { data: stats = [], isLoading } = useQuery<StatRow[]>({
    queryKey: ['call-stats', computed.from, computed.to],
    queryFn: () => api.get('/calls/stats', { params: { fromDate: computed.from, toDate: computed.to } }).then((r) => r.data),
  })

  const { data: counsellors = [] } = useQuery<User[]>({
    queryKey: ['users-counsellors-only'],
    queryFn: () => usersApi.counsellors(),
    enabled: true,
  })

  const byUser = useMemo(() => {
    const map = new Map<number, { total: number; answered: number; missed: number; talkSec: number }>()
    for (const r of stats) {
      const cur = map.get(r.userId) ?? { total: 0, answered: 0, missed: 0, talkSec: 0 }
      // MISSED = incoming the counsellor didn't pick up — it goes into the
      // missed bucket only, not the total of calls they made.
      if (r.status !== 'MISSED') cur.total += r.count
      if (r.status === 'ANSWERED') { cur.answered += r.count; cur.talkSec += r.durationSec }
      if (r.status === 'MISSED' || r.status === 'NO_ANSWER') cur.missed += r.count
      map.set(r.userId, cur)
    }
    return Array.from(map.entries())
      .map(([userId, v]) => ({ userId, name: counsellors.find((u) => u.id === userId)?.name ?? `User #${userId}`, ...v }))
      .sort((a, b) => b.total - a.total)
  }, [stats, counsellors])

  const grandTotals = useMemo(() => byUser.reduce(
    (acc, r) => ({ total: acc.total + r.total, answered: acc.answered + r.answered, missed: acc.missed + r.missed, talkSec: acc.talkSec + r.talkSec }),
    { total: 0, answered: 0, missed: 0, talkSec: 0 },
  ), [byUser])

  return (
    <div className="bg-card border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-indigo-600" />
          Call activity {!canSeeTeam && <span className="text-xs font-normal text-muted-foreground">(your calls)</span>}
        </h2>
        <div className="flex items-center gap-1.5">
          {(['today', '7d', '30d', 'custom'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded ${range === r ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
            >
              {r === 'today' ? 'Today' : r === '7d' ? '7d' : r === '30d' ? '30d' : 'Custom'}
            </button>
          ))}
          <Link to="/app/calls" className="ml-2 text-xs text-primary hover:underline inline-flex items-center gap-0.5">
            See all <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Header totals */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Stat label="Total calls" value={grandTotals.total} />
        <Stat label="Answered" value={grandTotals.answered} />
        <Stat label="No answer" value={grandTotals.missed} />
        <Stat label="Talk time" value={`${Math.round(grandTotals.talkSec / 60)} min`} />
      </div>

      {/* Per-user breakdown */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : byUser.length === 0 ? (
        <div className="text-sm text-muted-foreground">No calls recorded in this range.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">{canSeeTeam ? 'Sales Rep' : 'You'}</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium text-right">Answered</th>
                <th className="px-3 py-2 font-medium text-right">No Answer</th>
                <th className="px-3 py-2 font-medium text-right">Talk time</th>
                <th className="px-3 py-2 font-medium text-right">Avg / answered</th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((r) => (
                <tr key={r.userId} className="border-b">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.total}</td>
                  <td className="px-3 py-2 text-right">{r.answered}</td>
                  <td className="px-3 py-2 text-right">{r.missed}</td>
                  <td className="px-3 py-2 text-right">{Math.round(r.talkSec / 60)} min</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {r.answered > 0 ? `${Math.round(r.talkSec / r.answered)}s` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  )
}
