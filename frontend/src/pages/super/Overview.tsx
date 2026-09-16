import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { platformApi } from '@/lib/api'
import {
  PageHeader, Panel, StatTile, Loading, Empty, Callout,
  formatDate, daysUntil, btnPrimary,
} from './ui'
import {
  AlertTriangle, ArrowRight, Loader2, Plus,
  Building2, Users, Database, CalendarClock, PauseCircle,
} from 'lucide-react'

export default function SuperOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: platformApi.overview,
    // Provisioning finishes in the background — poll fast enough to watch one
    // complete, then fall back to a lazy refresh.
    refetchInterval: (q) => (q.state.data?.metrics.provisioning ? 3_000 : 60_000),
  })

  if (isLoading) return <Loading label="Loading platform overview…" />
  if (!data) return <Empty>Could not load the overview.</Empty>

  const m = data.metrics
  const needsAttention = m.failedProvisioning > 0 || m.suspendedCustomers > 0

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every customer running on this installation."
        actions={
          <Link to="/super/customers/new" className={btnPrimary}>
            <Plus className="h-4 w-4" /> New customer
          </Link>
        }
      />

      {m.failedProvisioning > 0 && (
        <div className="mb-5">
          <Callout tone="danger" title={`${m.failedProvisioning} customer setup failed`}>
            Their schema was rolled back, so nothing is half-built. Open the customer to see why,
            then delete the record and create it again.
          </Callout>
        </div>
      )}

      {/* Headline numbers. Two rows of three on desktop rather than a single
          run of six, so the platform-wide totals read as their own group. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Customers"
          value={m.totalCustomers}
          hint={`${m.activeCustomers} active`}
          icon={Building2}
        />
        <StatTile
          label="Suspended"
          value={m.suspendedCustomers}
          tone={m.suspendedCustomers ? 'danger' : 'default'}
          hint={m.suspendedCustomers ? 'not able to sign in' : 'none'}
          icon={PauseCircle}
        />
        <StatTile
          label="Expiring in 30 days"
          value={m.expiringSoon}
          tone={m.expiringSoon ? 'warn' : 'default'}
          hint={m.expiringSoon ? 'renewals due' : 'nothing due'}
          icon={CalendarClock}
        />
        <StatTile
          label="Total users"
          value={m.totalUsers.toLocaleString()}
          hint="across all customers"
          icon={Users}
        />
        <StatTile
          label="Total leads"
          value={m.totalLeads.toLocaleString()}
          hint="across all customers"
          icon={Database}
        />
        <StatTile
          label="Setting up"
          value={m.provisioning}
          tone={needsAttention && m.failedProvisioning ? 'danger' : 'default'}
          hint={m.failedProvisioning ? `${m.failedProvisioning} failed` : 'none in progress'}
          icon={Loader2}
        />
      </div>

      {data.provisioningJobs.length > 0 && (
        <div className="mt-5">
          <Panel title="Setting up now" description="New customers being provisioned." bodyClassName="p-0">
            <ul className="divide-y divide-slate-100">
              {data.provisioningJobs.map((job) => (
                <li key={job.id} className="flex items-center gap-3 px-5 py-3">
                  {job.status === 'failed' ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                  ) : (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/super/customers/$tenantId"
                      params={{ tenantId: String(job.id) }}
                      className="text-sm font-medium text-slate-900 hover:text-violet-700"
                    >
                      {job.companyName}
                    </Link>
                    <div className="truncate text-xs text-slate-500">
                      {job.status === 'failed' ? job.error : job.step || job.status}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel
          title="Nearing their limits"
          description="At 80% or more of a plan cap, from last night's usage counts."
          bodyClassName="p-0"
        >
          {data.nearingLimits.length === 0 ? (
            <Empty>Nobody is close to a limit.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.nearingLimits.map((row, i) => (
                <li
                  key={`${row.slug}-${row.label}-${i}`}
                  className="flex items-center gap-4 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {row.companyName}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {row.label} · {row.used.toLocaleString()} of {row.limit.toLocaleString()}
                    </div>
                  </div>
                  <div className="w-24 shrink-0">
                    <div className="mb-1 text-right text-sm font-semibold tabular-nums">
                      <span className={row.pct >= 100 ? 'text-red-600' : 'text-amber-600'}>
                        {row.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={row.pct >= 100 ? 'h-full bg-red-500' : 'h-full bg-amber-500'}
                        style={{ width: `${Math.min(100, row.pct)}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Expiring soon"
          description="Subscriptions ending within 30 days."
          bodyClassName="p-0"
        >
          {data.expiringSoon.length === 0 ? (
            <Empty>No renewals due.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.expiringSoon.map((t) => {
                const days = daysUntil(t.planExpiresAt)
                const urgent = days != null && days <= 7
                return (
                  <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/super/customers/$tenantId"
                        params={{ tenantId: String(t.id) }}
                        className="block truncate text-sm font-medium text-slate-900 hover:text-violet-700"
                      >
                        {t.companyName}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {formatDate(t.planExpiresAt)}
                      </div>
                    </div>
                    <span
                      className={
                        urgent
                          ? 'shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20'
                          : 'shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20'
                      }
                    >
                      {days != null ? `${days} day${days === 1 ? '' : 's'}` : '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="Recent activity"
          actions={
            <Link
              to="/super/audit"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-violet-700"
            >
              Full audit log <ArrowRight className="h-3 w-3" />
            </Link>
          }
          bodyClassName="p-0"
        >
          {data.recentActivity.length === 0 ? (
            <Empty>Nothing has happened yet.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentActivity.map((row) => (
                <li key={row.id} className="px-5 py-2.5">
                  <div className="text-sm text-slate-800">{row.summary}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {row.actorName} · {new Date(row.at).toLocaleString('en-IN')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
