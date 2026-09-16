import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, Building2, Globe, Mail, Phone, MapPin, Users, Save,
  Plus, Trash2, Star, StickyNote, Tag as TagIcon, X,
} from 'lucide-react'
import {
  accountsApi, contactsApi, crmApi,
  ACCOUNT_STATUSES, BUSINESS_MODELS, LEGAL_STRUCTURES, LOCATION_TYPES,
  CONTACT_ROLES, RELATIONSHIP_STRENGTHS, NOTE_KINDS,
  type Account, type Contact, type CrmLocation, type CrmEntityType,
} from '@/lib/crm-api'
import { commerceApi } from '@/lib/commerce-api'
import { dealsApi, compactMoney } from '@/lib/deals-api'
import { useAuthStore } from '@/stores/auth.store'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { ActivityTimeline } from '@/components/crm/ActivityTimeline'
import { AccountSummary } from '@/components/crm/AccountSummary'
import { formatCustomValue } from '@/components/crm/CustomFieldRenderer'
import { CustomFieldsPanel } from '@/components/crm/CustomFieldsPanel'
import { useLabels } from '@/hooks/useLabels'
import { AccountProjects } from '@/components/projects/AccountProjects'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'contacts' | 'deals' | 'projects' | 'locations' | 'notes' | 'fields'

// `feature` hides a tab when the customer's plan does not include it, the same
// way the sidebar does — an account with a Deals tab that 403s is worse than
// one without the tab.
const TABS: { key: Tab; label: string; feature?: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'deals', label: 'Deals', feature: 'deals' },
  { key: 'projects', label: 'Projects', feature: 'projects' },
  { key: 'locations', label: 'Locations' },
  { key: 'notes', label: 'Notes' },
  { key: 'fields', label: 'Custom Fields' },
]

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * The Account 360.
 *
 * Header and tabs on the left, the activity timeline pinned on the right — so
 * whatever a sales rep is doing, the history of the relationship stays visible.
 * That layout is the whole point of the page: the timeline is not a tab you
 * have to remember to open.
 */
export default function AccountDetail() {
  const { accountId } = useParams({ from: '/app/accounts/$accountId' })
  const id = Number(accountId)
  const qc = useQueryClient()
  const t = useLabels()
  const hasFeature = useAuthStore((s) => s.hasFeature)
  const [tab, setTab] = useState<Tab>('overview')

  const { data: account, isLoading } = useQuery({
    queryKey: ['accounts', id],
    queryFn: () => accountsApi.get(id),
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!account) return <p className="py-12 text-center text-sm">Not found.</p>

  const refresh = () => qc.invalidateQueries({ queryKey: ['accounts', id] })

  return (
    <div className="space-y-6">
      <Link
        to="/app/accounts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All {t.plural('account').toLowerCase()}
      </Link>

      <AccountHeader account={account} />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-1 border-b">
            {TABS.filter((x) => !x.feature || hasFeature(x.feature)).map((x) => (
              <button
                key={x.key}
                onClick={() => setTab(x.key)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === x.key
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {x.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab account={account} onSaved={refresh} />}
          {tab === 'contacts' && <ContactsTab account={account} />}
          {tab === 'deals' && <DealsTab account={account} />}
          {tab === 'projects' && <AccountProjects account={account} />}
          {tab === 'locations' && <LocationsTab account={account} onSaved={refresh} />}
          {tab === 'notes' && <NotesTab entityId={id} />}
          {tab === 'fields' && <CustomFieldsPanel entityType="account" entityId={id} noun="accounts" onSaved={refresh} />}
        </div>

        <aside className="min-w-0">
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold">Activity</h3>
            <ActivityTimeline entityType="account" entityId={id} />
          </div>
        </aside>
      </div>
    </div>
  )
}

function AccountHeader({ account }: { account: Account }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tagging, setTagging] = useState(false)

  const { data: tags = [] } = useQuery({
    queryKey: ['crm', 'tags', 'account', account.id],
    queryFn: () => crmApi.tagsFor('account', account.id),
  })
  const { data: allTags = [] } = useQuery({
    queryKey: ['crm', 'tags'],
    queryFn: crmApi.tags,
    enabled: tagging,
  })

  const setTags = useMutation({
    mutationFn: (ids: number[]) => crmApi.setTags('account', account.id, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'tags', 'account', account.id] }),
  })

  const selected = new Set(tags.map((x) => x.id))

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
          {account.name.slice(0, 2).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{account.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[account.accountType?.name, account.industry?.name, account.accountNumber]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {account.website && (
              <a
                href={account.website}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Globe className="h-3.5 w-3.5" /> {account.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {account.email && (
              <a href={`mailto:${account.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Mail className="h-3.5 w-3.5" /> {account.email}
              </a>
            )}
            {account.phone && (
              <a href={`tel:${account.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Phone className="h-3.5 w-3.5" /> {account.phone}
              </a>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tags.map((tg) => (
              <span
                key={tg.id}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {tg.name}
              </span>
            ))}
            <button
              onClick={() => setTagging((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <TagIcon className="h-3 w-3" /> Tags
            </button>
          </div>

          {tagging && (
            <div className="mt-3 flex flex-wrap gap-1.5 rounded-lg border bg-muted/30 p-3">
              {!allTags.length && (
                <p className="text-xs text-muted-foreground">
                  No tags yet. Create them from any record and reuse them everywhere.
                </p>
              )}
              {allTags.map((tg) => (
                <button
                  key={tg.id}
                  onClick={() =>
                    setTags.mutate(
                      selected.has(tg.id)
                        ? [...selected].filter((x) => x !== tg.id)
                        : [...selected, tg.id],
                    )
                  }
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    selected.has(tg.id)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input text-muted-foreground hover:border-primary/40',
                  )}
                >
                  {tg.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 text-right text-xs text-muted-foreground">
          <p className="font-medium uppercase tracking-wide">{account.status}</p>
          {account.owner && <p>Owner: {account.owner.name}</p>}
          <DeleteButton
            what="account"
            label={account.name}
            showLabel
            note="It moves to the trash — its contacts, deals and invoices stay attached, so it can be restored."
            onDelete={() => accountsApi.remove(account.id)}
            onDeleted={() => navigate({ to: '/app/accounts' })}
          />
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const checkIn = useMutation({
    mutationFn: () =>
      new Promise<{ accountId: number; lat?: number; lng?: number }>((resolve) => {
        const done = (lat?: number, lng?: number) => resolve({ accountId: account.id, lat, lng })
        if (!navigator.geolocation) return done()
        navigator.geolocation.getCurrentPosition(
          (pos) => done(pos.coords.latitude, pos.coords.longitude),
          () => done(),
        )
      }).then((body) => commerceApi.checkIn(body)),
    onSuccess: () => {
      toast.success('Checked in')
      onSaved()
    },
  })

  return (
    <div className="space-y-5">
      <AccountSummary account={account} />
      <button onClick={() => checkIn.mutate()} disabled={checkIn.isPending} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
        Beat check-in
      </button>

      <div className="rounded-xl border bg-card">
        <button
          onClick={() => setEditing((v) => !v)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div>
            <h3 className="text-sm font-semibold">Company details</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Name, registration, contact routes and everything else on the record.
            </p>
          </div>
          <span className="text-sm font-medium text-primary">{editing ? 'Done' : 'Edit'}</span>
        </button>
        {editing && (
          <div className="border-t p-5 pt-5">
            <AccountForm account={account} onSaved={onSaved} />
          </div>
        )}
      </div>
    </div>
  )
}

function AccountForm({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, unknown>>({})
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const val = (k: keyof Account) => (k in form ? form[k as string] : account[k]) ?? ''

  const save = useMutation({
    mutationFn: () => accountsApi.update(account.id, form),
    onSuccess: () => {
      toast.success('Saved')
      setForm({})
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const { data: types = [] } = useQuery({ queryKey: ['crm', 'account-types'], queryFn: crmApi.accountTypes })
  const { data: industries = [] } = useQuery({ queryKey: ['crm', 'industries'], queryFn: crmApi.industries })

  const dirty = Object.keys(form).length > 0

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name">
          <input className={input} value={String(val('name'))} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Legal name">
          <input
            className={input}
            value={String(val('legalName'))}
            onChange={(e) => set('legalName', e.target.value)}
          />
        </Field>
        <Field label="Type">
          <select
            className={input}
            value={String(val('accountTypeId'))}
            onChange={(e) => set('accountTypeId', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Industry">
          <select
            className={input}
            value={String(val('industryId'))}
            onChange={(e) => set('industryId', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {industries.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={input} value={String(val('status'))} onChange={(e) => set('status', e.target.value)}>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Business model">
          <select
            className={input}
            value={String(val('businessModel'))}
            onChange={(e) => set('businessModel', e.target.value || null)}
          >
            <option value="">—</option>
            {BUSINESS_MODELS.map((m) => (
              <option key={m} value={m}>
                {m.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employees">
          <input
            type="number"
            className={input}
            value={String(val('employeeCount'))}
            onChange={(e) => set('employeeCount', e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
        <Field label="Annual revenue (₹)">
          <input
            type="number"
            className={input}
            value={String(val('annualRevenue'))}
            onChange={(e) => set('annualRevenue', e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
        <Field label="Website">
          <input className={input} value={String(val('website'))} onChange={(e) => set('website', e.target.value)} />
        </Field>
        <Field label="LinkedIn">
          <input className={input} value={String(val('linkedin'))} onChange={(e) => set('linkedin', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={input} value={String(val('email'))} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className={input} value={String(val('phone'))} onChange={(e) => set('phone', e.target.value)} />
        </Field>
      </div>

      <div>
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Registration
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GSTIN">
            <input className={input} value={String(val('gstin'))} onChange={(e) => set('gstin', e.target.value)} />
          </Field>
          <Field label="PAN">
            <input className={input} value={String(val('pan'))} onChange={(e) => set('pan', e.target.value)} />
          </Field>
          <Field label="CIN">
            <input className={input} value={String(val('cin'))} onChange={(e) => set('cin', e.target.value)} />
          </Field>
          <Field label="Legal structure">
            <select
              className={input}
              value={String(val('legalStructure'))}
              onChange={(e) => set('legalStructure', e.target.value || null)}
            >
              <option value="">—</option>
              {LEGAL_STRUCTURES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Billing state">
            <input className={input} value={String(val('billingState'))} onChange={(e) => set('billingState', e.target.value)} />
          </Field>
          <Field label="Credit limit (₹)">
            <input type="number" className={input} value={String(val('creditLimit') ?? '')} onChange={(e) => set('creditLimit', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Credit days">
            <input type="number" className={input} value={String(val('creditDays') ?? '')} onChange={(e) => set('creditDays', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Replenish every (days)">
            <input type="number" className={input} value={String(val('replenishDays') ?? '')} onChange={(e) => set('replenishDays', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <PriceListField account={account} form={form} set={set} val={val} />
        </div>
      </div>

      <Field label="Notes">
        <textarea
          className={input}
          rows={3}
          value={String(val('notes'))}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>

      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {dirty ? 'Save changes' : 'No changes'}
      </button>
    </div>
  )
}

function ContactsTab({ account }: { account: Account }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>({ firstName: '', role: 'unknown' })

  const { data: contacts = [] } = useQuery({
    queryKey: ['accounts', account.id, 'contacts'],
    queryFn: () => accountsApi.contacts(account.id),
  })

  const create = useMutation({
    mutationFn: () => contactsApi.create({ ...form, accountId: account.id }),
    onSuccess: () => {
      toast.success('Contact added')
      setForm({ firstName: '', role: 'unknown' })
      setAdding(false)
      qc.invalidateQueries({ queryKey: ['accounts', account.id, 'contacts'] })
      qc.invalidateQueries({ queryKey: ['crm', 'timeline', 'account', account.id] })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not add'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Add contact
        </button>
      </div>

      {adding && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={input}
              placeholder="First name *"
              value={String(form.firstName ?? '')}
              onChange={(e) => set('firstName', e.target.value)}
            />
            <input
              className={input}
              placeholder="Last name"
              value={String(form.lastName ?? '')}
              onChange={(e) => set('lastName', e.target.value)}
            />
            <input
              className={input}
              placeholder="Job title"
              value={String(form.jobTitle ?? '')}
              onChange={(e) => set('jobTitle', e.target.value)}
            />
            <select className={input} value={String(form.role)} onChange={(e) => set('role', e.target.value)}>
              {CONTACT_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              className={input}
              placeholder="Email"
              value={String(form.email ?? '')}
              onChange={(e) => set('email', e.target.value)}
            />
            <input
              className={input}
              placeholder="Mobile"
              value={String(form.mobile ?? '')}
              onChange={(e) => set('mobile', e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => create.mutate()}
              disabled={!String(form.firstName ?? '').trim() || create.isPending}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Add
            </button>
            <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!contacts.length ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">Nobody here yet.</p>
        </div>
      ) : (
        contacts.map((ct) => <ContactCard key={ct.id} contact={ct} />)
      )}
    </div>
  )
}

function ContactCard({ contact }: { contact: Contact }) {
  const role = CONTACT_ROLES.find((r) => r.value === contact.role)?.label ?? contact.role
  const strength = RELATIONSHIP_STRENGTHS.find((r) => r.value === contact.relationshipStrength)

  return (
    <Link
      to="/app/contacts/$contactId"
      params={{ contactId: String(contact.id) }}
      className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 hover:border-primary/40"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{contact.fullName}</p>
          {contact.role !== 'unknown' && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              {role}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[contact.jobTitle, contact.department].filter(Boolean).join(' · ') || 'No title'}
        </p>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {contact.email && <p>{contact.email}</p>}
        {contact.mobile && <p>{contact.mobile}</p>}
        {strength && strength.value !== 'unknown' && <p className="mt-1">{strength.label}</p>}
      </div>
    </Link>
  )
}

/** Every opportunity against this account — the other half of a real 360. */
function DealsTab({ account }: { account: Account }) {
  const t = useLabels()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['deals', 'byAccount', account.id],
    queryFn: () => dealsApi.list({ accountId: account.id, limit: 50 }),
  })

  const deals = data?.data ?? []
  const open = deals.filter((d) => !d.stage?.isWon && !d.stage?.isLost)
  const won = deals.filter((d) => d.stage?.isWon)

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>

  const newDealButton = (
    <button
      onClick={() => setCreating(true)}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
    >
      <Plus className="h-4 w-4" /> New {t('deal').toLowerCase()}
    </button>
  )

  const modal = creating && (
    <NewDealForAccount
      account={account}
      onClose={() => setCreating(false)}
      onCreated={() => {
        setCreating(false)
        qc.invalidateQueries({ queryKey: ['deals'] })
        qc.invalidateQueries({ queryKey: ['accounts', account.id] })
      }}
    />
  )

  if (!deals.length) {
    return (
      <>
        <div className="rounded-xl border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No {t.plural('deal').toLowerCase()} against this {t('account').toLowerCase()} yet.
          </p>
          <div className="mt-3">{newDealButton}</div>
        </div>
        {modal}
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{newDealButton}</div>
      {modal}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
          <p className="mt-1 text-lg font-bold">
            {compactMoney(open.reduce((s, d) => s + (d.value ?? 0), 0))}
          </p>
          <p className="text-xs text-muted-foreground">{open.length} live</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Won</p>
          <p className="mt-1 text-lg font-bold">
            {compactMoney(won.reduce((s, d) => s + (d.value ?? 0), 0))}
          </p>
          <p className="text-xs text-muted-foreground">{won.length} closed</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="mt-1 text-lg font-bold">{deals.length}</p>
          <p className="text-xs text-muted-foreground">all time</p>
        </div>
      </div>

      {deals.map((d) => (
        <Link
          key={d.id}
          to="/app/deals/$dealId"
          params={{ dealId: String(d.id) }}
          className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 hover:border-primary/40"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{d.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {d.dealNumber}
              {d.expectedCloseDate && ` · closes ${new Date(d.expectedCloseDate).toLocaleDateString('en-IN')}`}
            </p>
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
              d.stage?.isWon
                ? 'bg-emerald-500/10 text-emerald-600'
                : d.stage?.isLost
                  ? 'bg-red-500/10 text-red-600'
                  : 'bg-blue-500/10 text-blue-600',
            )}
          >
            {d.stage?.name}
          </span>
          <span className="font-semibold">{compactMoney(d.value, d.currency)}</span>
        </Link>
      ))}
    </div>
  )
}

/**
 * Start a deal without leaving the account.
 *
 * The account, its primary contact and its owner are already known here, so the
 * form asks only for what is genuinely new. Previously this meant going to the
 * board and searching for the company you were already looking at.
 */
function NewDealForAccount({
  account,
  onClose,
  onCreated,
}: {
  account: Account
  onClose: () => void
  onCreated: () => void
}) {
  const t = useLabels()
  const [form, setForm] = useState<Record<string, unknown>>({
    name: '',
    // Pre-pick the decision maker when there is one — that is who a deal is with.
    primaryContactId:
      account.keyContacts?.find((c) => c.role === 'decision_maker')?.id ??
      account.keyContacts?.[0]?.id ??
      null,
  })

  const { data: contacts = [] } = useQuery({
    queryKey: ['accounts', account.id, 'contacts'],
    queryFn: () => accountsApi.contacts(account.id),
  })

  const create = useMutation({
    mutationFn: () => dealsApi.create({ ...form, accountId: account.id, ownerId: account.ownerId }),
    onSuccess: () => {
      toast.success(`${t('deal')} created`)
      onCreated()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">New {t('deal').toLowerCase()}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">For {account.name}</p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">What is the opportunity? *</label>
            <input
              className={input}
              placeholder="Inventory platform — 40 stores"
              value={String(form.name ?? '')}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Main contact</label>
            <select
              className={input}
              value={String(form.primaryContactId ?? '')}
              onChange={(e) => set('primaryContactId', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">—</option>
              {contacts.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.fullName}
                  {ct.jobTitle ? ` · ${ct.jobTitle}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Value (₹)</label>
              <input
                type="number"
                className={input}
                value={String(form.value ?? '')}
                onChange={(e) => set('value', e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Expected close</label>
              <input
                type="date"
                className={input}
                value={String(form.expectedCloseDate ?? '')}
                onChange={(e) => set('expectedCloseDate', e.target.value || null)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Next step</label>
            <input
              className={input}
              placeholder="Book the discovery call"
              value={String(form.nextStep ?? '')}
              onChange={(e) => set('nextStep', e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!String(form.name ?? '').trim() || create.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

function LocationsTab({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>({ name: '', type: 'branch' })

  const { data: locations = [] } = useQuery({
    queryKey: ['accounts', account.id, 'locations'],
    queryFn: () => accountsApi.locations(account.id),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['accounts', account.id, 'locations'] })
    onSaved()
  }

  const create = useMutation({
    mutationFn: () => accountsApi.addLocation(account.id, form),
    onSuccess: () => {
      toast.success('Location added')
      setForm({ name: '', type: 'branch' })
      setAdding(false)
      refresh()
    },
  })

  const makePrimary = useMutation({
    mutationFn: (l: CrmLocation) => accountsApi.updateLocation(account.id, l.id, { isPrimary: true }),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (l: CrmLocation) => accountsApi.removeLocation(account.id, l.id),
    onSuccess: () => {
      toast.success('Location removed')
      refresh()
    },
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Add location
        </button>
      </div>

      {adding && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={input}
              placeholder="Name, e.g. Head Office *"
              value={String(form.name ?? '')}
              onChange={(e) => set('name', e.target.value)}
            />
            <select className={input} value={String(form.type)} onChange={(e) => set('type', e.target.value)}>
              {LOCATION_TYPES.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className={input}
            rows={2}
            placeholder="Address"
            value={String(form.address ?? '')}
            onChange={(e) => set('address', e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-4">
            <input className={input} placeholder="City" value={String(form.city ?? '')} onChange={(e) => set('city', e.target.value)} />
            <input className={input} placeholder="State" value={String(form.state ?? '')} onChange={(e) => set('state', e.target.value)} />
            <input className={input} placeholder="Pincode" value={String(form.pincode ?? '')} onChange={(e) => set('pincode', e.target.value)} />
            <input className={input} placeholder="Phone" value={String(form.phone ?? '')} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => create.mutate()}
              disabled={!String(form.name ?? '').trim() || create.isPending}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Add
            </button>
            <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!locations.length ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">No addresses on file.</p>
        </div>
      ) : (
        locations.map((l) => (
          <div key={l.id} className="flex items-start gap-4 rounded-xl border bg-card p-4">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{l.name}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  {LOCATION_TYPES.find((x) => x.value === l.type)?.label ?? l.type}
                </span>
                {l.isPrimary && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                    <Star className="h-2.5 w-2.5" /> Primary
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[l.address, l.city, l.state, l.pincode].filter(Boolean).join(', ') || 'No address'}
              </p>
              {l.phone && <p className="text-xs text-muted-foreground">{l.phone}</p>}
            </div>
            <div className="flex gap-1">
              {!l.isPrimary && (
                <button
                  onClick={() => makePrimary.mutate(l)}
                  title="Make primary"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                >
                  <Star className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => remove.mutate(l)}
                title="Remove"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

/** Notes for any entity. Used by the account page and the contact page alike. */
export function NotesTab({
  entityId,
  entityType = 'account',
}: {
  entityId: number
  entityType?: CrmEntityType
}) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('general')

  const { data: notes = [] } = useQuery({
    queryKey: ['crm', 'notes', entityType, entityId],
    queryFn: () => crmApi.notes(entityType, entityId),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm', 'notes', entityType, entityId] })
    qc.invalidateQueries({ queryKey: ['crm', 'timeline', entityType, entityId] })
  }

  const add = useMutation({
    mutationFn: () => crmApi.addNote(entityType, entityId, { body, kind }),
    onSuccess: () => {
      setBody('')
      refresh()
    },
  })

  const pin = useMutation({
    mutationFn: (n: { id: number; pinned: boolean }) => crmApi.updateNote(n.id, { pinned: !n.pinned }),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (id: number) => crmApi.removeNote(id),
    onSuccess: () => {
      toast.success('Note deleted')
      refresh()
    },
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <textarea
          className={input}
          rows={3}
          placeholder="Write a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <select className="rounded-lg border bg-background px-3 py-1.5 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
            {NOTE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => add.mutate()}
            disabled={!body.trim() || add.isPending}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Add note
          </button>
        </div>
      </div>

      {!notes.length ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <StickyNote className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">No notes yet.</p>
        </div>
      ) : (
        notes.map((n) => (
          <div key={n.id} className={cn('rounded-xl border bg-card p-4', n.pinned && 'border-amber-500/40 bg-amber-500/5')}>
            <div className="flex items-start justify-between gap-3">
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => pin.mutate(n)}
                  title={n.pinned ? 'Unpin' : 'Pin'}
                  className={cn('rounded-lg p-1.5 hover:bg-accent', n.pinned ? 'text-amber-600' : 'text-muted-foreground')}
                >
                  <Star className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => remove.mutate(n.id)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {n.user?.name ?? 'Someone'} · {new Date(n.createdAt).toLocaleString('en-IN')}
              {n.kind !== 'general' && ` · ${n.kind}`}
            </p>
          </div>
        ))
      )}
    </div>
  )
}

function PriceListField({
  account,
  form,
  set,
  val,
}: {
  account: Account
  form: Record<string, unknown>
  set: (k: string, v: unknown) => void
  val: (k: keyof Account) => unknown
}) {
  const { data: lists = [] } = useQuery({ queryKey: ['price-lists'], queryFn: commerceApi.priceLists })
  void form
  void account
  return (
    <Field label="Price list">
      <select
        className={input}
        value={String(val('priceListId') ?? '')}
        onChange={(e) => set('priceListId', e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Catalog price</option>
        {lists.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </Field>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}

export { formatCustomValue }
