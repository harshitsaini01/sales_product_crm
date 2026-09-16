import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { dashboardApi, reportsApi } from '@/lib/api'
import {
  Globe, Loader2, Users, Award, Calendar, Building2,
  CheckCircle2, AlertTriangle, Clock, ArrowUpRight, Layers,
} from 'lucide-react'

interface WebsiteRow {
  website: string | null
  count: number
}

interface SourceDetail {
  website: string | null
  event: string | null
  total: number
  enrolled: number
  unassigned: number
  todayNew: number
  weekNew: number
  byStatus: { status: string | null; count: number }[]
  bySubSource: { label: string | null; count: number }[]
  byEvent: { label: string | null; count: number }[]
  eventOptions: { label: string | null; count: number }[]
  byDepartment: {
    departmentId: number | null
    departmentName: string
    total: number
    enrolled: number
    todayNew: number
  }[]
  byCounsellor: {
    id: number
    name: string
    role: string | null
    designation: string | null
    assigned: number
    enrolled: number
    followupsDueToday: number
    followupsDoneToday: number
    followupsPendingToday: number
  }[]
}

export function SourceBreakdownSection({ fromDate, toDate, intrestedCourse }: { fromDate: string; toDate: string; intrestedCourse?: string }) {
  const [website, setWebsite] = useState<string>('')
  const [event, setEvent] = useState<string>('')

  const { data: websites, isLoading: loadingWebsites } = useQuery<WebsiteRow[]>({
    queryKey: ['dashboard', 'website-breakdown'],
    queryFn: () => dashboardApi.websiteBreakdown(),
  })

  const { data, isLoading, isFetching } = useQuery<SourceDetail>({
    queryKey: ['reports', 'source-detail', website, event, fromDate, toDate, intrestedCourse],
    queryFn: () => reportsApi.sourceDetail({
      website: website || undefined,
      event: event || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      intrestedCourse,
    }),
  })

  const sortedWebsites = useMemo(() => {
    return [...(websites || [])].sort((a, b) => b.count - a.count)
  }, [websites])

  const conversionRate = data && data.total > 0
    ? Math.round((data.enrolled / data.total) * 1000) / 10
    : 0

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          Source Breakdown
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </h2>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground">Source</label>
          <select
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value)
              setEvent('')
            }}
            className="border rounded px-2 py-1 text-sm bg-background min-w-[160px]"
            disabled={loadingWebsites}
          >
            <option value="">All sources</option>
            {sortedWebsites.map((w) => (
              <option key={w.website || '__none__'} value={w.website || ''}>
                {(w.website || 'Other')} ({w.count.toLocaleString()})
              </option>
            ))}
          </select>

          <label className="text-xs text-muted-foreground ml-2">Event</label>
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-background min-w-[160px]"
            disabled={isLoading || (data?.eventOptions.length ?? 0) === 0}
          >
            <option value="">All events</option>
            {(data?.eventOptions || []).map((ev) => {
              const v = ev.label || ''
              return (
                <option key={v || '__none__'} value={v}>
                  {(ev.label || 'Unknown')} ({ev.count.toLocaleString()})
                </option>
              )
            })}
          </select>
        </div>
      </div>

      {/* ─── Pills: quick-select top sources ──────────────────────────────── */}
      {sortedWebsites.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => {
              setWebsite('')
              setEvent('')
            }}
            className={`px-2.5 py-1 text-xs rounded font-medium ${
              website === '' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
            }`}
          >
            All
          </button>
          {sortedWebsites.slice(0, 8).map((w) => {
            const v = w.website || ''
            return (
              <button
                key={v || '__none__'}
                onClick={() => {
                  setWebsite(v)
                  setEvent('')
                }}
                className={`px-2.5 py-1 text-xs rounded font-medium ${
                  website === v ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
                }`}
              >
                {w.website || 'Other'}
                <span className="ml-1 opacity-70 tabular-nums">{w.count.toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ─── Summary tiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Tile icon={<Users className="h-3.5 w-3.5 text-blue-500" />} label="Total Leads" value={data?.total ?? 0} />
        <Tile icon={<Award className="h-3.5 w-3.5 text-emerald-500" />} label="Enrolled" value={data?.enrolled ?? 0} hint={`${conversionRate.toFixed(1)}% conv`} />
        <Tile icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />} label="Unassigned" value={data?.unassigned ?? 0} />
        <Tile icon={<Calendar className="h-3.5 w-3.5 text-purple-500" />} label="New Today" value={data?.todayNew ?? 0} />
        <Tile icon={<Calendar className="h-3.5 w-3.5 text-indigo-500" />} label="New This Week" value={data?.weekNew ?? 0} />
        <Tile icon={<Building2 className="h-3.5 w-3.5 text-slate-500" />} label="Departments" value={data?.byDepartment.length ?? 0} hint={`${data?.byCounsellor.length ?? 0} sales reps`} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !data ? null : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ─── Departments ──────────────────────────────────────────────── */}
          <Card title="By Department" icon={<Building2 className="h-4 w-4 text-primary" />}>
            {data.byDepartment.length === 0 ? (
              <Empty />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                    <th className="px-3 py-1.5 text-left font-semibold">Department</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Leads</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Today</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDepartment.map((d) => (
                    <tr key={d.departmentId ?? '-'} className="border-t hover:bg-accent/30">
                      <td className="px-3 py-1.5 font-medium">{d.departmentName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{d.total.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-purple-600">{d.todayNew}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600">{d.enrolled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* ─── Status breakdown ─────────────────────────────────────────── */}
          <Card title="By Status" icon={<Layers className="h-4 w-4 text-primary" />}>
            {data.byStatus.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-2 p-3">
                {(() => {
                  const max = Math.max(1, ...data.byStatus.map((s) => s.count))
                  return data.byStatus.slice(0, 10).map((s) => (
                    <div key={s.status || '-'} className="space-y-0.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate max-w-[60%]">{s.status || 'No Status'}</span>
                        <span className="font-semibold tabular-nums">{s.count.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(s.count / max) * 100}%` }} />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </Card>

          {/* ─── Counsellor table ─────────────────────────────────────────── */}
          <Card
            title={`By Sales Rep (${data.byCounsellor.length})`}
            icon={<Users className="h-4 w-4 text-primary" />}
            className="lg:col-span-2"
          >
            {data.byCounsellor.length === 0 ? (
              <Empty />
            ) : (
              <div>
                <div className="overflow-x-auto overflow-y-auto max-h-[275px] scrollbar-thin">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-card z-10 shadow-sm border-b">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                        <th className="px-3 py-2 text-left font-semibold">Sales Rep</th>
                        <th className="px-3 py-2 text-right font-semibold">Assigned</th>
                        <th className="px-3 py-2 text-right font-semibold">Converted</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          <span className="inline-flex items-center gap-1 justify-end">
                            <Clock className="h-3 w-3 text-blue-500" /> Due Today
                          </span>
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          <span className="inline-flex items-center gap-1 justify-end">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Done Today
                          </span>
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          <span className="inline-flex items-center gap-1 justify-end">
                            <AlertTriangle className="h-3 w-3 text-red-500" /> Pending Today
                          </span>
                        </th>
                        <th className="px-2 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byCounsellor.map((r) => (
                        <tr key={r.id} className="border-t hover:bg-accent/30 group">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                {r.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold flex items-center gap-1.5">
                                  {r.name}
                                  <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                                    r.role === 'admin' || r.role === 'sub-admin'
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}>
                                    {r.role === 'sub-admin' ? 'sub' : (r.role?.slice(0, 4) || '—')}
                                  </span>
                                </div>
                                {r.designation && (
                                  <div className="text-[10px] text-muted-foreground">{r.designation}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.assigned.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.enrolled}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-blue-600">{r.followupsDueToday}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{r.followupsDoneToday}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.followupsPendingToday > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {r.followupsPendingToday}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <Link
                              to="/app/profiles/counsellor/$id"
                              params={{ id: String(r.id) }}
                              className="inline-flex items-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Open profile"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.byCounsellor.length > 5 && (
                  <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/20 border-t flex items-center justify-between font-medium">
                    <span>Showing {Math.min(5, data.byCounsellor.length)} of {data.byCounsellor.length} sales reps</span>
                    <span className="text-[10px] text-primary/80 font-semibold">Scroll down inside table to view all ↓</span>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* ─── Sub-source / Event ─────────────────────────────────────────── */}
          {(data.bySubSource.length > 0 || data.byEvent.length > 0) && (
            <Card title="Sub-source / Event" icon={<Globe className="h-4 w-4 text-primary" />} className="lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Sub-source</div>
                  {data.bySubSource.length === 0 ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {data.bySubSource.slice(0, 10).map((s) => (
                        <li key={s.label || '-'} className="flex items-center justify-between">
                          <span className="truncate max-w-[70%]">{s.label || 'Unknown'}</span>
                          <span className="font-semibold tabular-nums">{s.count.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Event</div>
                  {data.byEvent.length === 0 ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {data.byEvent.slice(0, 10).map((s) => (
                        <li key={s.label || '-'} className="flex items-center justify-between">
                          <span className="truncate max-w-[70%]">{s.label || 'Unknown'}</span>
                          <span className="font-semibold tabular-nums">{s.count.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Tile({
  icon, label, value, hint,
}: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon} {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-0.5">{value.toLocaleString()}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  )
}

function Card({
  title, icon, children, className = '',
}: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border rounded-lg overflow-hidden ${className}`}>
      <div className="px-3 py-2 bg-muted/20 border-b flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-muted-foreground text-center py-6">No data</p>
}
