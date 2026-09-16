import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { dailyReportsApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import {
  ClipboardList,
  Loader2,
  Phone,
  RefreshCw,
  AlertTriangle,
  CalendarDays,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function DailyReports() {
  const { isAdmin, user } = useAuthStore()
  const navigate = useNavigate()

  // Counsellors don't get a landing page here — their own full activity IS
  // the Daily Reports page. Redirect straight to it.
  useEffect(() => {
    if (!isAdmin() && user) {
      navigate({ to: '/app/daily-reports/activity/$userId', params: { userId: String(user.id) }, replace: true })
    }
  }, [isAdmin, user, navigate])

  if (!isAdmin()) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <TeamActivityRoster />
}

// ─── Admin roster: every counsellor's real activity for the day ─────────────

function TeamActivityRoster() {
  const today = toISODate(new Date())
  const [date, setDate] = useState(today)

  const { data, isLoading } = useQuery({
    queryKey: ['daily-reports', 'team-summary', date],
    queryFn: () => dailyReportsApi.teamSummary(date),
  })

  function shiftDay(delta: number) {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() + delta)
    setDate(toISODate(d))
  }

  const rows = data?.rows ?? []
  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.callsToday,
      followups: acc.followups + r.followupsToday,
      statusChanges: acc.statusChanges + r.statusChangesToday,
      overdue: acc.overdue + r.backlog.overdue,
    }),
    { calls: 0, followups: 0, statusChanges: 0, overdue: 0 },
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            Daily Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real activity, per counsellor — calls made, follow-ups actioned, statuses changed, and their current follow-up backlog.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(today)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
              date === today ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); setDate(toISODate(d)) }}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
              date === toISODate(new Date(Date.now() - 86400000)) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'
            }`}
          >
            Yesterday
          </button>
          <button onClick={() => shiftDay(-1)} className="p-1.5 rounded-lg border hover:bg-muted" aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="px-2.5 py-1.5 border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => shiftDay(1)}
            disabled={date >= today}
            className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Team totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <TotalCard icon={<Phone className="h-4 w-4" />} label="Calls Made" value={totals.calls} color="text-blue-600" />
        <TotalCard icon={<RefreshCw className="h-4 w-4" />} label="Follow-ups Done" value={totals.followups} color="text-purple-600" />
        <TotalCard icon={<CalendarDays className="h-4 w-4" />} label="Status Changes" value={totals.statusChanges} color="text-emerald-600" />
        <TotalCard icon={<AlertTriangle className="h-4 w-4" />} label="Total Overdue" value={totals.overdue} color="text-red-600" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center py-16 text-sm text-muted-foreground">No counsellors found.</p>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[1000px]">
              <thead>
                {/* Grouped section titles */}
                <tr className="border-b bg-muted/60 text-muted-foreground font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-4 font-bold text-foreground">Counsellor Daily Report</th>
                  <th colSpan={4} className="py-2.5 px-3 text-center border-l bg-blue-500/5 text-blue-700 dark:text-blue-400">
                    Pipeline (Live)
                  </th>
                  <th colSpan={3} className="py-2.5 px-3 text-center border-l bg-purple-500/5 text-purple-700 dark:text-purple-400">
                    Follow-ups
                  </th>
                  <th colSpan={3} className="py-2.5 px-3 text-center border-l bg-emerald-500/5 text-emerald-700 dark:text-emerald-400">
                    Activity · {date === today ? 'Today' : date}
                  </th>
                  <th colSpan={3} className="py-2.5 px-3 text-center border-l bg-amber-500/5 text-amber-700 dark:text-amber-400">
                    Calls · {date === today ? 'Today' : date}
                  </th>
                  <th className="py-2.5 px-3 border-l"></th>
                </tr>
                {/* Sub-column headers */}
                <tr className="border-b bg-muted/30 text-muted-foreground font-medium text-[11px]">
                  <th className="py-2 px-4">Sales Rep</th>
                  {/* Pipeline */}
                  <th className="py-2 px-3 text-right border-l">Active</th>
                  <th className="py-2 px-3 text-right">Enrolled</th>
                  <th className="py-2 px-3 text-right">Conv %</th>
                  <th className="py-2 px-3 text-right">Stale</th>
                  {/* Follow-ups */}
                  <th className="py-2 px-3 text-right border-l">Overdue</th>
                  <th className="py-2 px-3 text-right">Today</th>
                  <th className="py-2 px-3 text-right">Next 7d</th>
                  {/* Activity */}
                  <th className="py-2 px-3 text-right border-l">New</th>
                  <th className="py-2 px-3 text-right">F/U</th>
                  <th className="py-2 px-3 text-right">Status Δ</th>
                  {/* Calls */}
                  <th className="py-2 px-3 text-right border-l">Total</th>
                  <th className="py-2 px-3 text-right">Ans</th>
                  <th className="py-2 px-3 text-right">Talk</th>
                  <th className="py-2 px-3 text-center border-l">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.userId} className="hover:bg-muted/30 transition-colors group">
                    {/* Counsellor */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        to="/app/daily-reports/activity/$userId"
                        params={{ userId: String(r.userId) }}
                        className="flex items-center gap-2.5 group-hover:text-primary transition-colors"
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                          {r.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground text-xs group-hover:underline">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground capitalize">{r.designation || r.role}</div>
                        </div>
                      </Link>
                    </td>

                    {/* Pipeline (Live) */}
                    <td className="py-3 px-3 text-right border-l font-medium text-foreground">{r.pipeline?.active ?? 0}</td>
                    <td className="py-3 px-3 text-right font-medium text-foreground">{r.pipeline?.enrolled ?? 0}</td>
                    <td className="py-3 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{r.pipeline?.convRate ?? '0.0%'}</td>
                    <td className="py-3 px-3 text-right font-medium text-amber-600 dark:text-amber-400">{r.pipeline?.stale ?? 0}</td>

                    {/* Follow-ups */}
                    <td className="py-3 px-3 text-right border-l font-semibold text-red-600 dark:text-red-400">{r.backlog.overdue}</td>
                    <td className="py-3 px-3 text-right font-medium text-blue-600 dark:text-blue-400">{r.backlog.dueToday}</td>
                    <td className="py-3 px-3 text-right font-medium text-purple-600 dark:text-purple-400">{r.backlog.upcoming}</td>

                    {/* Activity */}
                    <td className="py-3 px-3 text-right border-l font-medium text-foreground">{r.activity?.newLeads ?? 0}</td>
                    <td className="py-3 px-3 text-right font-medium text-foreground">{r.activity?.followupsDone ?? r.followupsToday}</td>
                    <td className="py-3 px-3 text-right font-medium text-foreground">{r.activity?.statusChanges ?? r.statusChangesToday}</td>

                    {/* Calls */}
                    <td className="py-3 px-3 text-right border-l font-medium text-foreground">{r.calls?.total ?? r.callsToday}</td>
                    <td className="py-3 px-3 text-right font-medium text-foreground">
                      {r.calls?.answered ?? 0}
                      <span className="text-[10px] text-muted-foreground ml-0.5">·{r.calls?.unanswered ?? 0}</span>
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-foreground">{r.calls?.talkTimeFormatted ?? '0m'}</td>

                    {/* Action link */}
                    <td className="py-3 px-3 text-center border-l whitespace-nowrap">
                      <Link
                        to="/app/daily-reports/activity/$userId"
                        params={{ userId: String(r.userId) }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded transition-colors"
                      >
                        Log <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TotalCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-card border rounded-xl p-4">
      <div className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase mb-2 ${color}`}>
        {icon} {label}
      </div>
      <p className="text-2xl font-black">{value}</p>
    </div>
  )
}
