import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { platformApi, type TenantLimits, type FeatureDef } from '@/lib/api'
import {
  PageHeader, Panel, StatusBadge, ProvisioningBadge, Pill, UsageBar,
  Loading, Empty, Field, Callout, TableWrap, thClass, trClass, tdClass,
  formatDate, inputClass, btnPrimary, btnGhost, btnDanger,
} from './ui'
import { cn } from '@/lib/utils'
import { SetupTab } from './SetupTab'
import { FeatureToggle } from './FeatureToggle'
import { ArrowLeft, KeyRound, RefreshCw, Save, Trash2, Copy, Check } from 'lucide-react'

type TenantDetail = Awaited<ReturnType<typeof platformApi.getTenant>>
type Tab = 'overview' | 'limits' | 'features' | 'leadFields' | 'setup' | 'users' | 'plan' | 'danger'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'limits', label: 'Limits' },
  { key: 'features', label: 'Modules' },
  { key: 'leadFields', label: 'Lead Fields' },
  { key: 'setup', label: 'Vertical & Wording' },
  { key: 'users', label: 'Users' },
  { key: 'plan', label: 'Plan' },
  { key: 'danger', label: 'Danger' },
]

const LIMIT_FIELDS: { key: keyof TenantLimits; label: string; hint: string }[] = [
  { key: 'maxUsers', label: 'Max team members', hint: 'Everyone with a login, any role.' },
  { key: 'maxCounsellors', label: 'Max counsellors', hint: 'Counts against max team members too.' },
  { key: 'maxSubAdmins', label: 'Max sub-admins', hint: 'Branch-scoped managers.' },
  { key: 'maxBranches', label: 'Max branches', hint: 'Office locations.' },
  { key: 'maxLeads', label: 'Max leads (total)', hint: 'Excludes leads in the trash.' },
  { key: 'maxLeadsPerMonth', label: 'Max leads per month', hint: 'Resets on the 1st.' },
  { key: 'maxStorageMb', label: 'Storage (MB)', hint: 'Uploaded files. Reported, not yet blocked.' },
]

export default function SuperCustomerDetail() {
  const { tenantId } = useParams({ from: '/super/customers/$tenantId' })
  const id = Number(tenantId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['platform', 'tenant', id],
    queryFn: () => platformApi.getTenant(id),
    refetchInterval: (q) =>
      q.state.data &&
      q.state.data.provisioningStatus !== 'ready' &&
      q.state.data.provisioningStatus !== 'failed'
        ? 3_000
        : false,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform'] })

  if (isLoading) return <Loading label="Loading customer…" />
  if (!tenant) return <Empty>Customer not found.</Empty>

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to="/super/customers"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-violet-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All customers
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {tenant.companyName}
            <StatusBadge status={tenant.status} />
            {tenant.isPrimary && <Pill>original install</Pill>}
            <ProvisioningBadge status={tenant.provisioningStatus} step={tenant.provisioningStep} />
          </span>
        }
        description={
          <span className="font-mono text-xs">
            {tenant.slug} · schema <span className="text-slate-700">{tenant.schemaName}</span>
          </span>
        }
      />

      {tenant.provisioningStatus === 'failed' && (
        <div className="mb-5">
          <Callout tone="danger" title="Setup failed — this customer has no database schema.">
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
              {tenant.provisioningError}
            </pre>
            <p className="mt-2">Delete this record from the Danger tab, then create the customer again.</p>
          </Callout>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const active = tab === t.key
          const danger = t.key === 'danger'
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors',
                active
                  ? danger
                    ? 'border-red-500 font-medium text-red-600'
                    : 'border-violet-600 font-medium text-violet-700'
                  : cn(
                      'border-transparent text-slate-500 hover:text-slate-900',
                      danger && 'hover:text-red-600',
                    ),
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewTab tenant={tenant} />}
      {tab === 'limits' && <LimitsTab tenant={tenant} onSaved={refresh} />}
      {tab === 'features' && <FeaturesTab tenant={tenant} onSaved={refresh} />}
      {tab === 'leadFields' && <LeadFieldsTab tenant={tenant} onSaved={refresh} />}
      {tab === 'setup' && <SetupTab tenant={tenant} onSaved={refresh} />}
      {tab === 'users' && <UsersTab tenantId={id} />}
      {tab === 'plan' && <PlanTab tenant={tenant} onSaved={refresh} />}
      {tab === 'danger' && (
        <DangerTab
          tenant={tenant}
          onDeleted={() => {
            refresh()
            navigate({ to: '/super/customers' })
          }}
        />
      )}
    </>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900">{value || '—'}</dd>
    </div>
  )
}

function OverviewTab({ tenant }: { tenant: TenantDetail }) {
  const usage = tenant.usage

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Account">
        <dl>
          <DetailRow label="Contact name" value={tenant.contactName} />
          <DetailRow label="Email" value={tenant.contactEmail} />
          <DetailRow label="Phone" value={tenant.contactPhone} />
          <DetailRow label="Created" value={formatDate(tenant.createdAt)} />
          <DetailRow label="Plan" value={<span className="capitalize">{tenant.planName}</span>} />
          <DetailRow label="Expires" value={formatDate(tenant.planExpiresAt)} />
        </dl>
        {tenant.notes && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Internal notes
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{tenant.notes}</p>
          </div>
        )}
      </Panel>

      <Panel title="Usage right now" description="Counted live from their schema.">
        {!usage ? (
          <Empty>No usage available — the schema is not ready.</Empty>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              <UsageBar label="Team members" used={usage.usage.users} limit={usage.limits.maxUsers} />
              <UsageBar label="Counsellors" used={usage.usage.counsellors} limit={usage.limits.maxCounsellors} />
              <UsageBar label="Branches" used={usage.usage.branches} limit={usage.limits.maxBranches} />
              <UsageBar label="Leads" used={usage.usage.leads} limit={usage.limits.maxLeads} />
              <UsageBar
                label="Leads this month"
                used={usage.usage.leadsThisMonth}
                limit={usage.limits.maxLeadsPerMonth}
              />
              <UsageBar label="Storage (MB)" used={usage.usage.storageMb} limit={usage.limits.maxStorageMb} />
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-semibold tabular-nums text-slate-900">
                {usage.usage.students.toLocaleString()}
              </span>{' '}
              enrolled students
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

// ─── Limits ───────────────────────────────────────────────────────────────────

function LimitsTab({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      LIMIT_FIELDS.map((f) => [f.key, tenant[f.key] == null ? '' : String(tenant[f.key])]),
    ),
  )

  const save = useMutation({
    mutationFn: () => {
      // An empty box means "no limit", which the API stores as null.
      const body: Partial<TenantLimits> = {}
      for (const f of LIMIT_FIELDS) {
        const raw = values[f.key]?.trim()
        body[f.key] = raw === '' || raw == null ? null : Number(raw)
      }
      return platformApi.updateLimits(tenant.id, body)
    },
    onSuccess: () => { toast.success('Limits updated'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save limits'),
  })

  const usage = tenant.usage?.usage
  const usedFor = (key: keyof TenantLimits): number | undefined =>
    usage &&
    (
      {
        maxUsers: usage.users,
        maxCounsellors: usage.counsellors,
        maxSubAdmins: usage.subAdmins,
        maxBranches: usage.branches,
        maxLeads: usage.leads,
        maxLeadsPerMonth: usage.leadsThisMonth,
        maxStorageMb: usage.storageMb,
      } as Record<string, number>
    )[key]

  return (
    <Panel
      title="Plan limits"
      description="Leave a box empty for no limit. Going over is blocked at the moment of creation, with a message naming the limit and what they are using."
      actions={
        <button onClick={() => save.mutate()} disabled={save.isPending} className={btnPrimary}>
          <Save className="h-4 w-4" /> Save limits
        </button>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {LIMIT_FIELDS.map((f) => {
          const used = usedFor(f.key)
          const limit = values[f.key]?.trim() ? Number(values[f.key]) : null
          const over = used != null && limit != null && used > limit

          return (
            <div key={f.key}>
              <Field label={f.label} hint={f.hint}>
                <input
                  type="number"
                  min={0}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder="Unlimited"
                  className={cn(inputClass, over && 'border-amber-400 focus:border-amber-500 focus:ring-amber-500/20')}
                />
              </Field>
              {used != null && (
                <p className={cn('mt-1.5 text-[11px]', over ? 'font-medium text-amber-700' : 'text-slate-500')}>
                  {over
                    ? `Already using ${used.toLocaleString()} — this limit is below their current usage. Nothing is deleted; they simply cannot add more.`
                    : `Currently using ${used.toLocaleString()}.`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ─── Modules ──────────────────────────────────────────────────────────────────

function FeaturesTab({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const { data: catalogue } = useQuery({
    queryKey: ['platform', 'features'],
    queryFn: platformApi.features,
    staleTime: 60 * 60_000,
  })

  const [values, setValues] = useState<Record<string, boolean>>(tenant.features ?? {})
  useEffect(() => setValues(tenant.features ?? {}), [tenant.features])

  const grouped = useMemo(() => {
    const map = new Map<string, FeatureDef[]>()
    for (const f of catalogue ?? []) {
      if (!map.has(f.group)) map.set(f.group, [])
      map.get(f.group)!.push(f)
    }
    return [...map.entries()]
  }, [catalogue])

  const save = useMutation({
    mutationFn: () => platformApi.updateFeatures(tenant.id, values),
    onSuccess: () => { toast.success('Modules updated'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save modules'),
  })

  if (!catalogue) return <Loading />

  const onCount = catalogue.filter((f) => values[f.key] ?? f.defaultEnabled).length

  return (
    <Panel
      title="Modules"
      description="Switching a module off hides it from their sidebar and makes its API return 403. Takes effect on their very next request."
      actions={
        <>
          <Pill>
            {onCount} of {catalogue.length} on
          </Pill>
          <button onClick={() => save.mutate()} disabled={save.isPending} className={btnPrimary}>
            <Save className="h-4 w-4" /> Save modules
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {grouped.map(([group, features]) => (
          <div key={group}>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {group}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {features.map((f) => (
                <FeatureToggle
                  key={f.key}
                  feature={f}
                  on={values[f.key] ?? f.defaultEnabled}
                  onChange={(next) => setValues((v) => ({ ...v, [f.key]: next }))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── Users ────────────────────────────────────────────────────────────────────

function UsersTab({ tenantId }: { tenantId: number }) {
  const queryClient = useQueryClient()
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'tenant', tenantId, 'users'],
    queryFn: () => platformApi.tenantUsers(tenantId),
  })

  const reset = useMutation({
    mutationFn: (userId: number) => platformApi.resetUserPassword(tenantId, userId),
    onSuccess: (res) => {
      setIssued({ name: res.user.name, password: res.password })
      toast.success('Password reset — copy it before closing.')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not reset password'),
  })

  const rebuild = useMutation({
    mutationFn: () => platformApi.rebuildDirectory(tenantId),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Directory rebuilt')
      queryClient.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId, 'users'] })
    },
  })

  if (isLoading) return <Loading />

  return (
    <Panel
      title="Their staff"
      description="Read from the shared-login directory. Editing users happens inside their own panel — use “Log in as” for that."
      actions={
        <button onClick={() => rebuild.mutate()} disabled={rebuild.isPending} className={btnGhost}>
          <RefreshCw className={cn('h-4 w-4', rebuild.isPending && 'animate-spin')} /> Rebuild directory
        </button>
      }
    >
      {issued && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
          <div className="min-w-0">
            <div className="text-sm font-medium text-emerald-900">New password for {issued.name}</div>
            <code className="font-mono text-lg tracking-wide text-emerald-800">{issued.password}</code>
            <div className="mt-0.5 text-[11px] text-emerald-700">
              Shown once. Their existing sessions have been signed out.
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(issued.password)
                toast.success('Copied')
              }}
              className={btnGhost}
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
            <button onClick={() => setIssued(null)} className={btnGhost}>
              Done
            </button>
          </div>
        </div>
      )}

      {!data?.length ? (
        <Empty>No users in the directory for this customer.</Empty>
      ) : (
        <TableWrap minWidth={660}>
          <thead className="bg-slate-50/80">
            <tr>
              <th className={thClass}>Name</th>
              <th className={thClass}>Login ID</th>
              <th className={thClass}>Role</th>
              <th className={thClass}>Status</th>
              <th className={`${thClass} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className={trClass}>
                <td className={tdClass}>
                  <div className="font-medium text-slate-900">{u.name}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </td>
                <td className={`${tdClass} font-mono text-xs text-slate-600`}>{u.loginid}</td>
                <td className={`${tdClass} capitalize text-slate-700`}>{u.role}</td>
                <td className={tdClass}>
                  {u.status === 1 ? (
                    <span className="text-xs font-medium text-emerald-600">Active</span>
                  ) : (
                    <span className="text-xs text-slate-400">Disabled</span>
                  )}
                </td>
                <td className={`${tdClass} text-right`}>
                  <button
                    onClick={() => reset.mutate(u.userId)}
                    disabled={reset.isPending}
                    className={`${btnGhost} px-2 py-1 text-xs`}
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  )
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

function PlanTab({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const [form, setForm] = useState({
    companyName: tenant.companyName,
    contactName: tenant.contactName ?? '',
    contactEmail: tenant.contactEmail ?? '',
    contactPhone: tenant.contactPhone ?? '',
    planName: tenant.planName,
    planExpiresAt: tenant.planExpiresAt ? tenant.planExpiresAt.slice(0, 10) : '',
    notes: tenant.notes ?? '',
  })

  const save = useMutation({
    mutationFn: () =>
      platformApi.updateTenant(tenant.id, {
        companyName: form.companyName,
        contactName: form.contactName || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        planName: form.planName,
        // A date input gives a bare date; the API wants an ISO instant.
        planExpiresAt: form.planExpiresAt
          ? new Date(`${form.planExpiresAt}T23:59:59`).toISOString()
          : null,
        notes: form.notes || null,
      }),
    onSuccess: () => { toast.success('Saved'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const extend = useMutation({
    mutationFn: (months: number) => platformApi.extend(tenant.id, months),
    onSuccess: (r: any) => { toast.success(r?.message || 'Extended'); onSaved() },
  })

  const suspend = useMutation({
    mutationFn: () => platformApi.suspend(tenant.id, 'Suspended from the super admin panel'),
    onSuccess: () => { toast.success('Suspended'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not suspend'),
  })

  const resume = useMutation({
    mutationFn: () => platformApi.resume(tenant.id),
    onSuccess: () => { toast.success('Reactivated'); onSaved() },
  })

  return (
    <div className="space-y-5">
      <Panel
        title="Account details"
        actions={
          <button onClick={() => save.mutate()} disabled={save.isPending} className={btnPrimary}>
            <Save className="h-4 w-4" /> Save
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <input
              value={form.companyName}
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Plan name">
            <input
              value={form.planName}
              onChange={(e) => setForm((f) => ({ ...f, planName: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Contact name">
            <input
              value={form.contactName}
              onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Contact email">
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Contact phone">
            <input
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Subscription expires" hint="Leave empty for no expiry.">
            <input
              type="date"
              value={form.planExpiresAt}
              onChange={(e) => setForm((f) => ({ ...f, planExpiresAt: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Internal notes" hint="Only visible in this panel.">
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel
        title="Subscription"
        description="Extending from an expiry still in the future adds to it, rather than restarting from today — renewing late does not lose paid months."
      >
        <div className="flex flex-wrap items-center gap-2">
          {[1, 3, 6, 12].map((months) => (
            <button
              key={months}
              onClick={() => extend.mutate(months)}
              disabled={extend.isPending}
              className={btnGhost}
            >
              + {months} month{months > 1 ? 's' : ''}
            </button>
          ))}

          {!tenant.isPrimary && (
            <div className="ml-auto">
              {tenant.status === 'suspended' ? (
                <button onClick={() => resume.mutate()} disabled={resume.isPending} className={btnPrimary}>
                  <Check className="h-4 w-4" /> Reactivate account
                </button>
              ) : (
                <button onClick={() => suspend.mutate()} disabled={suspend.isPending} className={btnDanger}>
                  Suspend account
                </button>
              )}
            </div>
          )}
        </div>

        {tenant.suspendedReason && (
          <div className="mt-4">
            <Callout tone="danger" title="Currently suspended">
              {tenant.suspendedReason}
            </Callout>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ─── Danger ───────────────────────────────────────────────────────────────────

function SchemaDriftPanel({ tenantId }: { tenantId: number }) {
  const [checked, setChecked] = useState(false)

  const drift = useQuery({
    queryKey: ['platform', 'tenant', tenantId, 'drift'],
    queryFn: () => platformApi.drift(tenantId),
    enabled: checked,
    staleTime: 0,
  })

  const reconcile = useMutation({
    mutationFn: () => platformApi.reconcile(tenantId),
    onSuccess: (r) => {
      toast.success(r.message)
      drift.refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not reconcile'),
  })

  return (
    <Panel
      title="Schema drift"
      description="Whether this customer's tables still match prisma/schema.prisma. Worth checking after a migration fails, or if a page errors on a missing column."
      actions={
        <button
          onClick={() => {
            setChecked(true)
            drift.refetch()
          }}
          disabled={drift.isFetching}
          className={btnGhost}
        >
          <RefreshCw className={cn('h-4 w-4', drift.isFetching && 'animate-spin')} /> Check now
        </button>
      }
    >
      {!checked ? (
        <p className="text-sm text-slate-500">Not checked yet.</p>
      ) : drift.isFetching ? (
        <Loading label="Comparing against prisma/schema.prisma…" />
      ) : drift.isError ? (
        <Callout tone="danger" title="Could not check">
          {(drift.error as any)?.response?.data?.error ?? 'The drift check failed.'}
        </Callout>
      ) : !drift.data?.hasDrift ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <Check className="h-4 w-4" strokeWidth={3} />
          Schema matches prisma/schema.prisma exactly.
        </div>
      ) : (
        <div className="space-y-3">
          <Callout tone={drift.data.destructive ? 'danger' : 'warn'} title="This schema is out of date">
            {drift.data.destructive
              ? 'Closing this drift would DROP a table or column, so it cannot be applied automatically. Review the SQL below and apply it by hand.'
              : 'The statements below exist in prisma/schema.prisma but not in this schema.'}
          </Callout>

          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
            {drift.data.sql}
          </pre>

          <button
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending || drift.data.destructive}
            className={btnPrimary}
          >
            <RefreshCw className={cn('h-4 w-4', reconcile.isPending && 'animate-spin')} />
            Apply the difference
          </button>
        </div>
      )}
    </Panel>
  )
}

function LeadFieldsTab({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const { data: catalogue } = useQuery({
    queryKey: ['platform', 'lead-fields'],
    queryFn: platformApi.leadFieldCatalogue,
    staleTime: 60 * 60_000,
  })

  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(
    () => new Set(tenant.leadFields?.hiddenGroups ?? []),
  )
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(
    () => new Set(tenant.leadFields?.hiddenFields ?? []),
  )

  useEffect(() => {
    setHiddenGroups(new Set(tenant.leadFields?.hiddenGroups ?? []))
    setHiddenFields(new Set(tenant.leadFields?.hiddenFields ?? []))
  }, [tenant.leadFields])

  const save = useMutation({
    mutationFn: () =>
      platformApi.updateLeadFields(tenant.id, {
        hiddenGroups: [...hiddenGroups],
        hiddenFields: [...hiddenFields],
      }),
    onSuccess: () => { toast.success('Lead fields updated'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  if (!catalogue) return <Loading />

  const toggleGroup = (id: string, on: boolean) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleField = (key: string, on: boolean) =>
    setHiddenFields((prev) => {
      const next = new Set(prev)
      if (on) next.delete(key)
      else next.add(key)
      return next
    })

  const totalFields = catalogue.reduce((n, g) => n + g.fields.length, 0)
  const shownFields = catalogue.reduce(
    (n, g) => n + (hiddenGroups.has(g.id) ? 0 : g.fields.filter((f) => !hiddenFields.has(f.key)).length),
    0,
  )

  return (
    <Panel
      title="Lead Information fields"
      description="What this customer sees on a lead. Switching a field off only hides it — the data stays in the database, and turning it back on shows it again."
      actions={
        <>
          <Pill>
            {shownFields} of {totalFields} shown
          </Pill>
          <button onClick={() => save.mutate()} disabled={save.isPending} className={btnPrimary}>
            <Save className="h-4 w-4" /> Save fields
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {catalogue.map((group) => {
          const groupOn = !hiddenGroups.has(group.id)
          return (
            <div
              key={group.id}
              className={cn(
                'rounded-xl border transition-colors',
                groupOn ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50',
              )}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      group.locked
                        ? 'border-slate-200 bg-slate-200'
                        : groupOn
                          ? 'border-violet-600 bg-violet-600'
                          : 'border-slate-300 bg-white',
                    )}
                  >
                    {(groupOn || group.locked) && (
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={groupOn}
                    disabled={group.locked}
                    onChange={(e) => toggleGroup(group.id, e.target.checked)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      groupOn ? 'text-slate-900' : 'text-slate-400',
                    )}
                  >
                    {group.title}
                  </span>
                  {group.locked && <Pill>always on</Pill>}
                </label>
                <span className="text-xs text-slate-400">{group.fields.length} fields</span>
              </div>

              {groupOn && (
                <div className="grid gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.fields.map((f) => {
                    const on = !hiddenFields.has(f.key)
                    return (
                      <label
                        key={f.key}
                        className={cn(
                          'flex items-center gap-2 text-sm',
                          f.locked ? 'cursor-default' : 'cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on || f.locked}
                          disabled={f.locked}
                          onChange={(e) => toggleField(f.key, e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-violet-600 disabled:opacity-50"
                        />
                        <span className={on || f.locked ? 'text-slate-700' : 'text-slate-400 line-through'}>
                          {f.label}
                        </span>
                        {f.locked && <span className="text-[10px] text-slate-400">(required)</span>}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function DangerTab({ tenant, onDeleted }: { tenant: TenantDetail; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('')

  const remove = useMutation({
    mutationFn: () => platformApi.deleteTenant(tenant.id, confirm),
    onSuccess: () => { toast.success('Customer deleted'); onDeleted() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not delete'),
  })

  const migrate = useMutation({
    mutationFn: () => platformApi.migrateTenant(tenant.id),
    onSuccess: () => toast.success('Migrations applied'),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Migration failed'),
  })

  const maintenance = (
    <Panel
      title="Maintenance"
      description="Apply any migrations this customer's schema is missing. Safe to run at any time."
    >
      <button onClick={() => migrate.mutate()} disabled={migrate.isPending} className={btnGhost}>
        <RefreshCw className={cn('h-4 w-4', migrate.isPending && 'animate-spin')} /> Re-run migrations
      </button>
    </Panel>
  )

  if (tenant.isPrimary) {
    return (
      <div className="space-y-5">
        <Callout tone="info" title="This is the original installation">
          It cannot be suspended or deleted from here.
        </Callout>
        {maintenance}
        <SchemaDriftPanel tenantId={tenant.id} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {maintenance}
      <SchemaDriftPanel tenantId={tenant.id} />

      <Panel title="Delete this customer" className="border-red-200">
        <Callout tone="danger" title="This cannot be undone.">
          Deleting drops the Postgres schema <code className="font-mono">{tenant.schemaName}</code>{' '}
          and everything in it — every lead, student, user, invoice and file record this customer
          has. Take a database dump first.
        </Callout>

        <div className="mt-4 max-w-sm">
          <Field label={`Type "${tenant.slug}" to confirm`}>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={tenant.slug}
              className={cn(inputClass, 'font-mono')}
            />
          </Field>
        </div>

        <button
          onClick={() => remove.mutate()}
          disabled={remove.isPending || confirm !== tenant.slug}
          className={`${btnDanger} mt-4`}
        >
          <Trash2 className="h-4 w-4" /> Permanently delete {tenant.companyName}
        </button>
      </Panel>
    </div>
  )
}
