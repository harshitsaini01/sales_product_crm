import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { platformApi, type Tenant } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import {
  PageHeader, Panel, StatusBadge, ProvisioningBadge, Pill, Loading, Empty,
  TableWrap, thClass, trClass, tdClass,
  formatDate, daysUntil, inputClass, btnPrimary, btnGhost,
} from './ui'
import { Plus, Search, LogIn, Pause, Play, CalendarPlus } from 'lucide-react'

/** used / limit as a compact inline meter, so a row shows headroom at a glance. */
function Meter({ used, limit }: { used: number | null; limit: number | null }) {
  if (used == null) return <span className="text-slate-400">—</span>

  if (limit == null) {
    return <span className="tabular-nums text-slate-700">{used.toLocaleString()}</span>
  }

  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const bar = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="w-28">
      <div className="tabular-nums text-slate-700">
        {used.toLocaleString()}
        <span className="text-slate-300"> / </span>
        <span className="text-slate-400">{limit.toLocaleString()}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function SuperCustomers() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const impersonateTenant = useAuthStore((s) => s.impersonateTenant)
  const platformUser = useAuthStore((s) => s.platformUser)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'expired'>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: platformApi.listTenants,
    refetchInterval: (q) =>
      q.state.data?.some((t) => t.provisioningStatus !== 'ready' && t.provisioningStatus !== 'failed')
        ? 3_000
        : false,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform'] })

  const suspend = useMutation({
    mutationFn: (t: Tenant) => platformApi.suspend(t.id),
    onSuccess: () => { toast.success('Customer suspended'); refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not suspend'),
  })

  const resume = useMutation({
    mutationFn: (t: Tenant) => platformApi.resume(t.id),
    onSuccess: () => { toast.success('Customer reactivated'); refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not reactivate'),
  })

  const extend = useMutation({
    mutationFn: ({ id, months }: { id: number; months: number }) => platformApi.extend(id, months),
    onSuccess: (r: any) => { toast.success(r?.message || 'Plan extended'); refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not extend'),
  })

  // "Log in as" hands us a short-lived token for that customer's admin. The
  // platform session is stashed rather than replaced, so "Exit" on the banner
  // drops us straight back into this panel.
  const impersonate = useMutation({
    mutationFn: (t: Tenant) => platformApi.impersonate(t.id),
    onSuccess: (res) => {
      impersonateTenant(
        res.token,
        res.user,
        { ...res.tenant, planName: '', planExpiresAt: null },
        { id: platformUser?.id ?? 0, name: platformUser?.name ?? 'Super Admin' },
      )
      toast.success(`Signed in as ${res.tenant.name} — expires in ${res.expiresInMinutes} minutes`)
      navigate({ to: '/app' })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not sign in as this customer'),
  })

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data ?? []).filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (!term) return true
      return (
        t.companyName.toLowerCase().includes(term) ||
        t.slug.toLowerCase().includes(term) ||
        (t.contactEmail ?? '').toLowerCase().includes(term)
      )
    })
  }, [data, search, statusFilter])

  if (isLoading) return <Loading label="Loading customers…" />

  const total = data?.length ?? 0

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${total} account${total === 1 ? '' : 's'}, each in its own database schema.`}
        actions={
          <Link to="/super/customers/new" className={btnPrimary}>
            <Plus className="h-4 w-4" /> New customer
          </Link>
        }
      />

      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by company, slug or email"
              className={`${inputClass} pl-9`}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className={`${inputClass} w-auto`}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <Empty>
            {total === 0 ? 'No customers yet — create your first one.' : 'No customers match that.'}
          </Empty>
        ) : (
          <TableWrap minWidth={900}>
            <thead className="bg-slate-50/80">
              <tr>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Plan</th>
                <th className={thClass}>Users</th>
                <th className={thClass}>Leads</th>
                <th className={thClass}>Expires</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const days = daysUntil(t.planExpiresAt)
                return (
                  <tr key={t.id} className={trClass}>
                    <td className={tdClass}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/super/customers/$tenantId"
                          params={{ tenantId: String(t.id) }}
                          className="font-medium text-slate-900 hover:text-violet-700"
                        >
                          {t.companyName}
                        </Link>
                        <StatusBadge status={t.status} />
                        {t.isPrimary && <Pill>original install</Pill>}
                        <ProvisioningBadge status={t.provisioningStatus} step={t.provisioningStep} />
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">{t.slug}</div>
                    </td>

                    <td className={`${tdClass} capitalize text-slate-700`}>{t.planName}</td>

                    <td className={tdClass}>
                      <Meter used={t.usage?.users ?? null} limit={t.maxUsers} />
                    </td>

                    <td className={tdClass}>
                      <Meter used={t.usage?.leads ?? null} limit={t.maxLeads} />
                    </td>

                    <td className={tdClass}>
                      <div className="text-slate-700">{formatDate(t.planExpiresAt)}</div>
                      {days != null && days <= 30 && (
                        <div
                          className={
                            days <= 7
                              ? 'mt-0.5 text-[11px] font-medium text-red-600'
                              : 'mt-0.5 text-[11px] font-medium text-amber-600'
                          }
                        >
                          {days < 0 ? 'expired' : `in ${days} day${days === 1 ? '' : 's'}`}
                        </div>
                      )}
                    </td>

                    <td className={tdClass}>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          onClick={() => extend.mutate({ id: t.id, months: 12 })}
                          disabled={extend.isPending}
                          className={`${btnGhost} px-2 py-1 text-xs`}
                          title="Extend the subscription by 12 months"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" /> +1y
                        </button>

                        {!t.isPrimary &&
                          (t.status === 'suspended' ? (
                            <button
                              onClick={() => resume.mutate(t)}
                              disabled={resume.isPending}
                              className={`${btnGhost} px-2 py-1 text-xs`}
                            >
                              <Play className="h-3.5 w-3.5" /> Resume
                            </button>
                          ) : (
                            <button
                              onClick={() => suspend.mutate(t)}
                              disabled={suspend.isPending}
                              className={`${btnGhost} px-2 py-1 text-xs`}
                            >
                              <Pause className="h-3.5 w-3.5" /> Suspend
                            </button>
                          ))}

                        <button
                          onClick={() => impersonate.mutate(t)}
                          disabled={impersonate.isPending || t.provisioningStatus !== 'ready'}
                          className={`${btnGhost} px-2 py-1 text-xs`}
                          title="Open their panel as their admin, for 15 minutes"
                        >
                          <LogIn className="h-3.5 w-3.5" /> Log in as
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  )
}
