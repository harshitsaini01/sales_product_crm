import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { platformApi, type FeatureDef } from '@/lib/api'
import { PageHeader, Panel, Pill, Field, Loading, Callout, inputClass, btnPrimary, btnGhost } from './ui'
import { cn } from '@/lib/utils'
import { FeatureToggle } from './FeatureToggle'
import { ArrowLeft, ArrowRight, Check, Loader2, RefreshCw, Copy } from 'lucide-react'

type Step = 'company' | 'vertical' | 'plan' | 'modules' | 'admin' | 'provisioning'

const STEPS: { key: Step; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'vertical', label: 'Vertical' },
  { key: 'plan', label: 'Plan & limits' },
  { key: 'modules', label: 'Modules' },
  { key: 'admin', label: 'First admin' },
]

const LIMIT_FIELDS = [
  { key: 'maxUsers', label: 'Max team members' },
  { key: 'maxCounsellors', label: 'Max counsellors' },
  { key: 'maxSubAdmins', label: 'Max sub-admins' },
  { key: 'maxBranches', label: 'Max branches' },
  { key: 'maxLeads', label: 'Max leads (total)' },
  { key: 'maxLeadsPerMonth', label: 'Max leads per month' },
  { key: 'maxStorageMb', label: 'Storage (MB)' },
] as const

/** Turns "Acme Overseas Pvt Ltd" into "acme_overseas_pvt_ltd". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'c$1')
    .slice(0, 31)
}

function randomPassword(): string {
  // No look-alike characters — this gets read out over the phone.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let out = ''
  const bytes = crypto.getRandomValues(new Uint32Array(14))
  for (const b of bytes) out += chars[b % chars.length]
  return out
}

export default function SuperNewCustomer() {
  const [step, setStep] = useState<Step>('company')
  const [slugTouched, setSlugTouched] = useState(false)
  const [createdId, setCreatedId] = useState<number | null>(null)

  const { data: catalogue } = useQuery({
    queryKey: ['platform', 'features'],
    queryFn: platformApi.features,
    staleTime: 60 * 60_000,
  })

  const { data: verticals } = useQuery({
    queryKey: ['platform', 'verticals'],
    queryFn: platformApi.verticals,
    staleTime: 60 * 60_000,
  })

  const [form, setForm] = useState({
    companyName: '',
    slug: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    planName: 'starter',
    planExpiresAt: '',
    limits: {
      maxUsers: '10',
      maxCounsellors: '8',
      maxSubAdmins: '2',
      maxBranches: '2',
      maxLeads: '10000',
      maxLeadsPerMonth: '',
      maxStorageMb: '2048',
    } as Record<string, string>,
    vertical: 'education',
    features: {} as Record<string, boolean>,
    admin: { name: '', email: '', loginid: '', password: randomPassword(), mobile: '' },
    sendWelcomeEmail: true,
  })

  // Default the modules to whatever the catalogue says a new customer gets.
  useEffect(() => {
    if (!catalogue) return
    setForm((f) =>
      Object.keys(f.features).length
        ? f
        : { ...f, features: Object.fromEntries(catalogue.map((x) => [x.key, x.defaultEnabled])) },
    )
  }, [catalogue])

  /**
   * Choosing a vertical re-seeds the module grid from its preset.
   *
   * Done here rather than server-side so the Modules step shows what will
   * actually be created: the wizard posts the whole grid, so a preset applied
   * only on the server would be silently overridden by whatever was on screen.
   */
  function chooseVertical(key: string) {
    const preset = verticals?.find((v) => v.key === key)
    setForm((f) => ({
      ...f,
      vertical: key,
      features: {
        ...Object.fromEntries((catalogue ?? []).map((x) => [x.key, x.defaultEnabled])),
        ...(preset?.features ?? {}),
      },
    }))
  }

  const slug = slugTouched ? form.slug : slugify(form.companyName)
  const slugValid = /^[a-z][a-z0-9_]{2,30}$/.test(slug)

  const create = useMutation({
    mutationFn: () =>
      platformApi.createTenant({
        slug,
        companyName: form.companyName,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        planName: form.planName,
        planExpiresAt: form.planExpiresAt
          ? new Date(`${form.planExpiresAt}T23:59:59`).toISOString()
          : null,
        limits: Object.fromEntries(
          LIMIT_FIELDS.map((f) => {
            const raw = form.limits[f.key]?.trim()
            return [f.key, raw === '' || raw == null ? null : Number(raw)]
          }),
        ),
        vertical: form.vertical,
        features: form.features,
        admin: {
          name: form.admin.name,
          email: form.admin.email,
          loginid: form.admin.loginid || form.admin.email,
          password: form.admin.password,
          mobile: form.admin.mobile || undefined,
        },
        sendWelcomeEmail: form.sendWelcomeEmail,
      }),
    onSuccess: (tenant) => {
      setCreatedId(tenant.id)
      setStep('provisioning')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create the customer'),
  })

  const canContinue = useMemo(() => {
    if (step === 'company') return form.companyName.trim().length >= 2 && slugValid
    if (step === 'admin') {
      return (
        form.admin.name.trim().length >= 2 &&
        /\S+@\S+\.\S+/.test(form.admin.email) &&
        form.admin.password.length >= 8
      )
    }
    return true
  }, [step, form, slugValid])

  if (step === 'provisioning' && createdId != null) {
    return <ProvisioningView tenantId={createdId} adminPassword={form.admin.password} />
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={
          <Link
            to="/super/customers"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-violet-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All customers
          </Link>
        }
        title="New customer"
        description="Creates a dedicated database schema, applies every migration, seeds a working lead pipeline and creates their first admin."
      />

      {/* Stepper */}
      <ol className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        {STEPS.map((s, i) => {
          const done = i < stepIndex
          const active = i === stepIndex
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  done
                    ? 'bg-emerald-100 text-emerald-700'
                    : active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-400',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-xs',
                  active ? 'font-medium text-slate-900' : done ? 'text-slate-600' : 'text-slate-400',
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="ml-1 h-px w-6 bg-slate-200" />}
            </li>
          )
        })}
      </ol>

      {step === 'company' && (
        <Panel title="Company">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Company name">
                <input
                  autoFocus
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="Acme Overseas Education"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field
                label="Slug"
                hint="Lowercase letters, numbers and underscores. This cannot be changed later."
              >
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))
                  }}
                  placeholder="acme_overseas"
                  className={cn(
                    inputClass,
                    'font-mono',
                    slug && !slugValid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
                  )}
                />
              </Field>
              {slug && (
                <p className={cn('mt-1.5 text-[11px]', slugValid ? 'text-slate-500' : 'text-red-600')}>
                  {slugValid ? (
                    <>
                      Their data will live in the schema{' '}
                      <code className="font-mono text-slate-700">tenant_{slug}</code>.
                    </>
                  ) : (
                    'Must be 3–31 characters, start with a letter, and use only lowercase letters, numbers and underscores.'
                  )}
                </p>
              )}
            </div>

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
          </div>
        </Panel>
      )}

      {step === 'vertical' && (
        <Panel
          title="What kind of business is this?"
          description="Picks a starting set of modules, lead fields, wording and pipeline stages. Every part of it stays editable afterwards."
        >
          {!verticals ? (
            <Loading />
          ) : (
            <div className="space-y-3">
              {verticals.map((v) => {
                const active = form.vertical === v.key
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => chooseVertical(v.key)}
                    className={cn(
                      'w-full rounded-xl border p-4 text-left transition-colors',
                      active
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{v.label}</span>
                      {active && <Pill>Selected</Pill>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{v.description}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      Switches off {v.disabledFeatureCount} module
                      {v.disabledFeatureCount === 1 ? '' : 's'} and {v.hiddenGroupCount} lead-field
                      group{v.hiddenGroupCount === 1 ? '' : 's'}.
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>
      )}

      {step === 'plan' && (
        <Panel title="Plan & limits" description="Leave a box empty for no limit. All of this is changeable later.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan name">
              <input
                value={form.planName}
                onChange={(e) => setForm((f) => ({ ...f, planName: e.target.value }))}
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

            <div className="sm:col-span-2 mt-1 border-t border-slate-100 pt-4">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Limits
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {LIMIT_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input
                      type="number"
                      min={0}
                      value={form.limits[f.key] ?? ''}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          limits: { ...prev.limits, [f.key]: e.target.value },
                        }))
                      }
                      placeholder="Unlimited"
                      className={inputClass}
                    />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {step === 'modules' && (
        <Panel title="Modules" description="What this customer's plan includes. Changeable at any time.">
          {!catalogue ? (
            <Loading />
          ) : (
            <FeatureGrid
              catalogue={catalogue}
              values={form.features}
              onChange={(features) => setForm((f) => ({ ...f, features }))}
            />
          )}
        </Panel>
      )}

      {step === 'admin' && (
        <Panel
          title="Their first admin"
          description="The account they will sign in with. They can add the rest of their team themselves."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input
                autoFocus
                value={form.admin.name}
                onChange={(e) => setForm((f) => ({ ...f, admin: { ...f.admin, name: e.target.value } }))}
                className={inputClass}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.admin.email}
                onChange={(e) => setForm((f) => ({ ...f, admin: { ...f.admin, email: e.target.value } }))}
                className={inputClass}
              />
            </Field>
            <Field label="Login ID" hint="Defaults to their email address.">
              <input
                value={form.admin.loginid}
                onChange={(e) => setForm((f) => ({ ...f, admin: { ...f.admin, loginid: e.target.value } }))}
                placeholder={form.admin.email || 'admin@company.com'}
                className={inputClass}
              />
            </Field>
            <Field label="Mobile">
              <input
                value={form.admin.mobile}
                onChange={(e) => setForm((f) => ({ ...f, admin: { ...f.admin, mobile: e.target.value } }))}
                className={inputClass}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field
                label="Password"
                hint="Generated for you. Copy it before continuing — it is only shown here and in the welcome email."
              >
                <div className="flex gap-2">
                  <input
                    value={form.admin.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, admin: { ...f.admin, password: e.target.value } }))
                    }
                    className={cn(inputClass, 'font-mono')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(form.admin.password)
                      toast.success('Copied')
                    }}
                    className={btnGhost}
                    title="Copy"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, admin: { ...f.admin, password: randomPassword() } }))
                    }
                    className={btnGhost}
                    title="Generate another"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </Field>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.sendWelcomeEmail}
                onChange={(e) => setForm((f) => ({ ...f, sendWelcomeEmail: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              />
              Email these credentials to {form.admin.email || 'the admin'}
            </label>
          </div>
        </Panel>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}
          disabled={stepIndex === 0}
          className={btnGhost}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {step === 'admin' ? (
          <button
            onClick={() => create.mutate()}
            disabled={!canContinue || create.isPending}
            className={btnPrimary}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Create customer
          </button>
        ) : (
          <button
            onClick={() => setStep(STEPS[stepIndex + 1].key)}
            disabled={!canContinue}
            className={btnPrimary}
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function FeatureGrid({
  catalogue,
  values,
  onChange,
}: {
  catalogue: FeatureDef[]
  values: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, FeatureDef[]>()
    for (const f of catalogue) {
      if (!map.has(f.group)) map.set(f.group, [])
      map.get(f.group)!.push(f)
    }
    return [...map.entries()]
  }, [catalogue])

  return (
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
                onChange={(next) => onChange({ ...values, [f.key]: next })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Live progress while the schema is created, migrated and seeded. */
function ProvisioningView({ tenantId, adminPassword }: { tenantId: number; adminPassword: string }) {
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ['platform', 'tenant', tenantId],
    queryFn: () => platformApi.getTenant(tenantId),
    refetchInterval: (q) => {
      const s = q.state.data?.provisioningStatus
      return s === 'ready' || s === 'failed' ? false : 1_500
    },
  })

  const status = data?.provisioningStatus ?? 'pending'
  const ORDER = ['pending', 'creating_schema', 'migrating', 'seeding', 'ready'] as const
  const currentIndex = ORDER.indexOf(status as (typeof ORDER)[number])

  const STAGES: [string, string][] = [
    ['creating_schema', 'Creating their database schema'],
    ['migrating', 'Applying database migrations'],
    ['seeding', 'Seeding lead pipeline and first admin'],
    ['ready', 'Ready'],
  ]

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Setting up ${data?.companyName ?? 'the new customer'}`}
        description={
          status === 'ready'
            ? 'Done — they can sign in now.'
            : status === 'failed'
              ? 'Something went wrong.'
              : 'This takes a minute. You can leave this page; it keeps running.'
        }
      />

      <Panel>
        <ol className="space-y-4">
          {STAGES.map(([key, label], i) => {
            const index = ORDER.indexOf(key as (typeof ORDER)[number])
            const done = status === 'ready' ? true : currentIndex > index
            const active = currentIndex === index && status !== 'failed'

            return (
              <li key={key} className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    done
                      ? 'bg-emerald-100 text-emerald-700'
                      : active
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {done ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    'text-sm',
                    done || active ? 'font-medium text-slate-900' : 'text-slate-400',
                  )}
                >
                  {label}
                </span>
              </li>
            )
          })}
        </ol>

        {status === 'failed' && (
          <div className="mt-5">
            <Callout tone="danger" title="Setup failed and the half-built schema was removed.">
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
                {data?.provisioningError}
              </pre>
            </Callout>
          </div>
        )}

        {status === 'ready' && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-medium text-emerald-900">
              {data?.companyName} is live. Their admin can sign in at the normal login page.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
                {adminPassword}
              </code>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(adminPassword)
                  toast.success('Copied')
                }}
                className={btnGhost}
              >
                <Copy className="h-4 w-4" /> Copy password
              </button>
            </div>
          </div>
        )}
      </Panel>

      <div className="mt-5 flex gap-2">
        <button onClick={() => navigate({ to: '/super/customers' })} className={btnGhost}>
          All customers
        </button>
        {status === 'ready' && (
          <button
            onClick={() =>
              navigate({ to: '/super/customers/$tenantId', params: { tenantId: String(tenantId) } })
            }
            className={btnPrimary}
          >
            Open {data?.companyName} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
