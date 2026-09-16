import { useParams, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { autoDialerApi, usersApi, type AutoDialerStats } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { ChevronLeft, Play, Pause, CheckCircle2, PhoneCall, PhoneOff, Clock, Users } from 'lucide-react'

type RouteParams = { id: string }

export default function AutoDialerDetail() {
  const params = useParams({ strict: false }) as Partial<RouteParams>
  const id = Number(params.id)
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.isAdmin())

  const campQ = useQuery({
    queryKey: ['auto-dialer', 'campaign', id],
    queryFn: () => autoDialerApi.get(id),
    enabled: !!id,
    refetchInterval: 15_000,
  })
  const statsQ = useQuery({
    queryKey: ['auto-dialer', 'stats', id],
    queryFn: () => autoDialerApi.stats(id),
    enabled: !!id,
    refetchInterval: 10_000,
  })
  const usersQ = useQuery({ queryKey: ['users', 'counsellors'], queryFn: usersApi.counsellors })

  const pauseMut = useMutation({ mutationFn: () => autoDialerApi.pause(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['auto-dialer'] }) })
  const resumeMut = useMutation({ mutationFn: () => autoDialerApi.resume(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['auto-dialer'] }) })
  const completeMut = useMutation({ mutationFn: () => autoDialerApi.complete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['auto-dialer'] }) })

  if (!id) return <div className="p-6">Invalid campaign id</div>
  if (campQ.isLoading) return <div className="p-6">Loading…</div>
  if (!campQ.data) return <div className="p-6">Not found</div>

  const camp = campQ.data
  const stats: AutoDialerStats | undefined = statsQ.data
  const users = (usersQ.data as Array<{ id: number; name: string }> | undefined) || []
  const userMap = new Map(users.map((u) => [u.id, u.name]))

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link to="/app/auto-dialer" className="p-1 rounded hover:bg-muted"><ChevronLeft className="h-4 w-4" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{camp.name}</h1>
          <p className="text-xs text-muted-foreground">{camp.type} · Gap {camp.callGapSec}s · {camp.status}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {camp.status === 'active' && (
              <button onClick={() => pauseMut.mutate()} className="px-3 py-1.5 rounded border text-sm inline-flex items-center gap-1">
                <Pause className="h-3 w-3" /> Pause
              </button>
            )}
            {camp.status === 'paused' && (
              <button onClick={() => resumeMut.mutate()} className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm inline-flex items-center gap-1">
                <Play className="h-3 w-3" /> Resume
              </button>
            )}
            {(camp.status === 'active' || camp.status === 'paused') && (
              <button onClick={() => { if (confirm('End this campaign?')) completeMut.mutate() }} className="px-3 py-1.5 rounded border text-sm inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> End
              </button>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {stats && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>Progress</span>
            <span className="font-medium">{stats.dialed} / {stats.totalContacts} ({stats.progressPct}%)</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${stats.progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats.totalContacts} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Pending" value={stats.pending} icon={<Clock className="h-4 w-4" />} cls="text-muted-foreground" />
          <StatCard label="Connected" value={stats.connected} icon={<PhoneCall className="h-4 w-4" />} cls="text-emerald-600" />
          <StatCard label="No answer" value={stats.noAnswer + stats.busy} icon={<PhoneOff className="h-4 w-4" />} cls="text-amber-600" />
          <StatCard label="Failed" value={stats.failed + stats.declined} icon={<PhoneOff className="h-4 w-4" />} cls="text-destructive" />
          <StatCard label="Total talk" value={`${Math.round(stats.totalCallDurationSec / 60)}m`} icon={<Clock className="h-4 w-4" />} />
          <StatCard label="Avg talk" value={`${stats.avgTalkTimeSec}s`} icon={<Clock className="h-4 w-4" />} />
          <StatCard label="Skipped" value={stats.skipped} icon={<PhoneOff className="h-4 w-4" />} />
          <StatCard label="Calls logged" value={stats.callsLogged} icon={<PhoneCall className="h-4 w-4" />} />
        </div>
      )}

      {/* Per-counsellor breakdown (admin only) */}
      {isAdmin && stats?.perCounsellor && stats.perCounsellor.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2">Counsellor breakdown</h3>
          <div className="border rounded overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">Sales Rep</th>
                  <th className="px-3 py-2">Pending</th>
                  <th className="px-3 py-2">Connected</th>
                  <th className="px-3 py-2">No answer</th>
                  <th className="px-3 py-2">Failed</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.perCounsellor.map((row) => {
                  const counts = row as Record<string, number> & { counsellorId: number }
                  const total = Object.entries(counts).filter(([k]) => k !== 'counsellorId').reduce((s, [, v]) => s + (v || 0), 0)
                  return (
                    <tr key={counts.counsellorId} className="border-t">
                      <td className="px-3 py-2 font-medium">{userMap.get(counts.counsellorId) || `User #${counts.counsellorId}`}</td>
                      <td className="px-3 py-2">{counts.pending || 0}</td>
                      <td className="px-3 py-2 text-emerald-600">{counts.connected || 0}</td>
                      <td className="px-3 py-2 text-amber-600">{(counts.no_answer || 0) + (counts.busy || 0)}</td>
                      <td className="px-3 py-2 text-destructive">{(counts.failed || 0) + (counts.declined || 0)}</td>
                      <td className="px-3 py-2 font-medium">{total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, cls }: { label: string; value: number | string; icon: React.ReactNode; cls?: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className={`text-xl font-bold mt-1 ${cls || ''}`}>{value}</div>
    </div>
  )
}
