import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, Plus, Search, Users, MapPin, X } from 'lucide-react'
import {
  accountsApi, crmApi, ACCOUNT_STATUSES, type Account,
} from '@/lib/crm-api'
import { useLabels } from '@/hooks/useLabels'
import { cn } from '@/lib/utils'

/**
 * Accounts — the B2B list view.
 *
 * Reached only when the `accounts` module is on; the router redirects and the
 * API 403s otherwise, so an education customer never lands here.
 */
export default function Accounts() {
  const qc = useQueryClient()
  const t = useLabels()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [accountTypeId, setAccountTypeId] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['accounts', { search, status, accountTypeId, page }],
    queryFn: () =>
      accountsApi.list({
        search: search || undefined,
        status: status || undefined,
        accountTypeId: accountTypeId || undefined,
        page,
        limit: 25,
      }),
  })

  const { data: types = [] } = useQuery({
    queryKey: ['crm', 'account-types'],
    queryFn: crmApi.accountTypes,
    staleTime: 60 * 60_000,
  })

  const accounts = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.plural('account')}</h1>
          <p className="text-sm text-muted-foreground">
            {data?.total ?? 0} {(data?.total ?? 0) === 1 ? t('account') : t.plural('account')}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New {t('account')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Company, website, phone or GST…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <select
          className="rounded-lg border bg-background px-3 py-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Any status</option>
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border bg-background px-3 py-2 text-sm"
          value={accountTypeId}
          onChange={(e) => {
            setAccountTypeId(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Any type</option>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {ty.name}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !accounts.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No {t.plural('account').toLowerCase()} yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one, or convert a {t('lead').toLowerCase()} from the {t.plural('lead')} screen.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </div>
      )}

      {(data?.totalPages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            {page} of {data?.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= (data?.totalPages ?? 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {creating && (
        <NewAccountModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            qc.invalidateQueries({ queryKey: ['accounts'] })
          }}
        />
      )}
    </div>
  )
}

function AccountRow({ account }: { account: Account }) {
  const tone =
    account.status === 'active'
      ? 'bg-emerald-500/10 text-emerald-600'
      : account.status === 'churned'
        ? 'bg-red-500/10 text-red-600'
        : account.status === 'inactive'
          ? 'bg-slate-500/10 text-slate-500'
          : 'bg-blue-500/10 text-blue-600'

  return (
    <Link
      to="/app/accounts/$accountId"
      params={{ accountId: String(account.id) }}
      className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
        {account.name.slice(0, 2).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold">{account.name}</p>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', tone)}>
            {account.status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[account.accountType?.name, account.industry?.name, account.accountNumber]
            .filter(Boolean)
            .join(' · ') || 'No type set'}
        </p>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {account.contactCount != null && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {account.contactCount}
          </span>
        )}
        {account.locationCount != null && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {account.locationCount}
          </span>
        )}
        {account.owner && <span className="hidden sm:inline">{account.owner.name}</span>}
      </div>
    </Link>
  )
}

function NewAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useLabels()
  const [form, setForm] = useState<Record<string, unknown>>({ name: '', status: 'prospect' })

  const { data: types = [] } = useQuery({ queryKey: ['crm', 'account-types'], queryFn: crmApi.accountTypes })
  const { data: industries = [] } = useQuery({ queryKey: ['crm', 'industries'], queryFn: crmApi.industries })

  const create = useMutation({
    mutationFn: () => accountsApi.create(form),
    onSuccess: () => {
      toast.success(`${t('account')} created`)
      onCreated()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">New {t('account')}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Company name *</label>
            <input
              className={input}
              value={String(form.name ?? '')}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Type</label>
              <select
                className={input}
                value={String(form.accountTypeId ?? '')}
                onChange={(e) => set('accountTypeId', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">—</option>
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Industry</label>
              <select
                className={input}
                value={String(form.industryId ?? '')}
                onChange={(e) => set('industryId', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">—</option>
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                className={input}
                value={String(form.email ?? '')}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Phone</label>
              <input
                className={input}
                value={String(form.phone ?? '')}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Website</label>
            <input
              className={input}
              placeholder="https://"
              value={String(form.website ?? '')}
              onChange={(e) => set('website', e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Everything else — addresses, registration, custom fields — is on the
            {' '}{t('account').toLowerCase()} page once it exists.
          </p>
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
