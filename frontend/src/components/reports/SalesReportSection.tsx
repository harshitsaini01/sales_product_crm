import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Handshake, TrendingUp, FileText, IndianRupee, Trophy } from 'lucide-react'
import { reportsApi } from '@/lib/api'
import { formatMoney, compactMoney } from '@/lib/deals-api'
import { CockpitStrip } from '@/pages/admin/SalesOps'
import { cn } from '@/lib/utils'

export interface B2bReport {
  months: string[]
  summary: {
    openDeals: number
    openValue: number
    weightedValue: number
    winRate: number | null
    averageDealSize: number | null
    quotesAwaiting: number
    quotesAwaitingValue: number
    quoteAcceptRate: number | null
    outstanding: number
    overdue: number
    collectedPeriod: number
  }
  byStage: { id: number; name: string; sortOrder: number; probability: number; isWon: boolean; isLost: boolean; count: number; value: number; weighted: number }[]
  byRep: { id: number | null; name: string; open: number; openValue: number; won: number; wonValue: number; lost: number; winRate: number | null; avgCycleDays: number | null }[]
  monthly: { month: string; won: number; wonValue: number; lost: number; quotesSent: number; quotesSentValue: number; quotesAccepted: number; quotesAcceptedValue: number; invoiced: number; collected: number }[]
  salesDocs: boolean
}

function monthLabel(k: string) {
  const [y, m] = k.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

/**
 * The sales report — pipeline by stage and by rep, quotes sent vs accepted,
 * money invoiced vs collected, over the last N months. Only for customers with
 * the deals module; the section is not rendered otherwise.
 */
export function SalesReportSection() {
  const [months, setMonths] = useState(6)
  const { data, isLoading } = useQuery({ queryKey: ['reports', 'b2b', months], queryFn: () => reportsApi.b2b(months) as Promise<B2bReport> })

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading sales report…</p>
  if (!data) return null
  const s = data.summary
  const maxStage = Math.max(1, ...data.byStage.filter((x) => !x.isWon && !x.isLost).map((x) => x.value))

  const Tile = ({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone?: 'warn' | 'good' }) => (
    <div className={cn('rounded-xl border bg-card p-4', tone === 'warn' && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20', tone === 'good' && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20')}>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={cn('mt-1 text-xl font-bold', tone === 'warn' && 'text-amber-700')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Handshake className="h-5 w-5 text-primary" /> Sales</h2>
        <select className="rounded-lg border bg-background px-3 py-1.5 text-sm" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[3, 6, 12].map((m) => <option key={m} value={m}>Last {m} months</option>)}
        </select>
      </div>

      <CockpitStrip />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon={Handshake} label="Open pipeline" value={compactMoney(s.openValue)} sub={`${s.openDeals} deals · ${compactMoney(s.weightedValue)} weighted`} />
        <Tile icon={Trophy} label="Win rate" value={s.winRate == null ? '—' : `${s.winRate}%`} sub={s.averageDealSize ? `avg won deal ${compactMoney(s.averageDealSize)}` : 'no won deals yet'} />
        {data.salesDocs && <Tile icon={FileText} label="Quotes awaiting" value={compactMoney(s.quotesAwaitingValue)} sub={`${s.quotesAwaiting} out · ${s.quoteAcceptRate == null ? '—' : `${s.quoteAcceptRate}%`} accepted`} />}
        {data.salesDocs && <Tile icon={IndianRupee} label={`Collected (${months}m)`} value={compactMoney(s.collectedPeriod)} tone="good" />}
        {data.salesDocs && <Tile icon={TrendingUp} label="Outstanding" value={compactMoney(s.outstanding)} sub={s.overdue > 0 ? `${compactMoney(s.overdue)} overdue` : 'nothing overdue'} tone={s.overdue > 0 ? 'warn' : undefined} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pipeline by stage */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">Pipeline by stage</h3>
          <div className="mt-3 space-y-2">
            {data.byStage.filter((x) => !x.isWon && !x.isLost).map((st) => (
              <div key={st.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{st.name} <span className="text-muted-foreground">· {st.count} · {st.probability}%</span></span>
                  <span className="font-semibold">{compactMoney(st.value)} <span className="font-normal text-muted-foreground">({compactMoney(st.weighted)} weighted)</span></span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (st.value / maxStage) * 100)}%` }} /></div>
              </div>
            ))}
            {data.byStage.filter((x) => x.isWon || x.isLost).map((st) => (
              <div key={st.id} className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{st.name} · {st.count}</span><span>{compactMoney(st.value)}</span>
              </div>
            ))}
            {!data.byStage.length && <p className="text-sm text-muted-foreground">No deals yet.</p>}
          </div>
        </div>

        {/* By rep */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">By rep</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-1.5 text-left font-medium">Rep</th>
                  <th className="pb-1.5 text-right font-medium">Open</th>
                  <th className="pb-1.5 text-right font-medium">Won</th>
                  <th className="pb-1.5 text-right font-medium">Win %</th>
                  <th className="pb-1.5 text-right font-medium">Cycle</th>
                </tr>
              </thead>
              <tbody>
                {data.byRep.map((r) => (
                  <tr key={r.id ?? 'none'} className="border-t">
                    <td className="py-1.5">
                      {r.id ? <Link to="/app/deals" className="hover:text-primary">{r.name}</Link> : r.name}
                    </td>
                    <td className="py-1.5 text-right">{r.open} <span className="text-muted-foreground">· {compactMoney(r.openValue)}</span></td>
                    <td className="py-1.5 text-right">{r.won} <span className="text-muted-foreground">· {compactMoney(r.wonValue)}</span></td>
                    <td className="py-1.5 text-right">{r.winRate == null ? '—' : `${r.winRate}%`}</td>
                    <td className="py-1.5 text-right">{r.avgCycleDays == null ? '—' : `${r.avgCycleDays}d`}</td>
                  </tr>
                ))}
                {!data.byRep.length && <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">No deals yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">Deals won per month</h3>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => compactMoney(Number(v))} width={60} />
                <Tooltip formatter={(v: number, name: string) => (name === 'wonValue' ? [formatMoney(v), 'Won value'] : [v, name])} />
                <Bar dataKey="wonValue" name="wonValue" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{data.monthly.reduce((t, m) => t + m.won, 0)} won · {data.monthly.reduce((t, m) => t + m.lost, 0)} lost in the period</p>
        </div>
        {data.salesDocs && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">Quoted vs accepted, invoiced vs collected</h3>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => compactMoney(Number(v))} width={60} />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="quotesSentValue" name="Quoted" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="quotesAcceptedValue" name="Accepted" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="invoiced" name="Invoiced" fill="#fcd34d" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="collected" name="Collected" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
