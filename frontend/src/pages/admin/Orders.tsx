import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Package2, FileSignature, Receipt, Plus, X } from 'lucide-react'
import {
  ordersApi, contractsApi, ORDER_STATUSES, CONTRACT_STATUSES,
  type Order, type Contract,
} from '@/lib/sales-api'
import { accountsApi } from '@/lib/crm-api'
import { formatMoney } from '@/lib/deals-api'
import { DocumentLines, StatusPill } from '@/components/crm/DocumentLines'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { Pager } from './Quotes'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

// ═══ ORDERS ═══════════════════════════════════════════════════════════════════

export default function Orders() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status, page }],
    queryFn: () => ordersApi.list({ status: status || undefined, page }),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['orders'] })

  const raiseInvoice = useMutation({
    mutationFn: (orderId: number) => ordersApi.invoice(orderId),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoiceNumber} raised`)
      navigate({ to: '/app/invoices/$invoiceId', params: { invoiceId: String(inv.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not raise an invoice'),
  })

  const orders = data?.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-sm text-muted-foreground">{data?.total ?? 0} total</p>
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
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !orders.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Package2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No orders</p>
          <p className="mt-1 text-sm text-muted-foreground">
            An order is created by converting an accepted quote.
          </p>
          <Link to="/app/quotes" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
            Go to quotes →
          </Link>
        </div>
      ) : (
        <div className="grid gap-2">
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl border bg-card">
              <div className="flex w-full flex-wrap items-center gap-4 p-4 text-left">
                <Link to="/app/orders/$orderId" params={{ orderId: String(o.id) }} className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent" title="Open the order page">
                  Open
                </Link>
              <button
                onClick={() => setOpen(open === o.id ? null : o.id)}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold">{o.orderNumber}</p>
                    <StatusPill status={o.status} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {o.account?.name ?? 'No account'} ·{' '}
                    {new Date(o.orderDate).toLocaleDateString('en-IN')}
                    {o._count && ` · ${o._count.items} lines, ${o._count.invoices} invoices`}
                  </p>
                </div>
                <span className="font-semibold">{formatMoney(Number(o.total), o.currency)}</span>
              </button>
              </div>

              {open === o.id && <OrderPanel orderId={o.id} onChanged={refresh} onInvoice={raiseInvoice.mutate} />}
            </div>
          ))}
        </div>
      )}

      {(data?.totalPages ?? 1) > 1 && (
        <Pager page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
      )}
    </div>
  )
}

function OrderPanel({
  orderId,
  onChanged,
  onInvoice,
}: {
  orderId: number
  onChanged: () => void
  onInvoice: (id: number) => void
}) {
  const qc = useQueryClient()
  const { data: order } = useQuery({ queryKey: ['orders', orderId], queryFn: () => ordersApi.get(orderId) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['orders'] })
    onChanged()
  }

  const setStatus = useMutation({
    mutationFn: (status: string) => ordersApi.update(orderId, { status }),
    onSuccess: refresh,
  })
  const addItem = useMutation({
    mutationFn: (l: Record<string, unknown>) => ordersApi.addItem(orderId, l),
    onSuccess: refresh,
  })
  const removeItem = useMutation({
    mutationFn: (lineId: number) => ordersApi.removeItem(orderId, lineId),
    onSuccess: refresh,
  })

  if (!order) return <p className="border-t p-4 text-sm text-muted-foreground">Loading…</p>

  const locked = order.status === 'delivered' || order.status === 'cancelled'

  return (
    <div className="space-y-4 border-t p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border bg-background px-3 py-1.5 text-sm"
          value={order.status}
          onChange={(e) => setStatus.mutate(e.target.value)}
        >
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {order.quote && (
          <Link
            to="/app/quotes/$quoteId"
            params={{ quoteId: String(order.quote.id) }}
            className="text-sm font-medium text-primary hover:underline"
          >
            From {order.quote.quoteNumber}
          </Link>
        )}

        <DeleteButton
          what="order"
          label={order.orderNumber}
          showLabel
          note="Refused while an invoice exists against it."
          onDelete={() => ordersApi.remove(orderId)}
          onDeleted={onChanged}
        />

        {!order.invoices?.length && (
          <button
            onClick={() => onInvoice(orderId)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            <Receipt className="h-3.5 w-3.5" /> Raise invoice
          </button>
        )}
      </div>

      {!!order.invoices?.length && (
        <div className="flex flex-wrap gap-2">
          {order.invoices.map((inv) => (
            <Link
              key={inv.id}
              to="/app/invoices/$invoiceId"
              params={{ invoiceId: String(inv.id) }}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <span className="font-mono">{inv.invoiceNumber}</span>
              <StatusPill status={inv.status} />
            </Link>
          ))}
        </div>
      )}

      <DocumentLines
        lines={order.items ?? []}
        totals={order}
        readOnly={locked}
        onAdd={(l) => addItem.mutate(l)}
        onRemove={(lineId) => removeItem.mutate(lineId)}
      />
    </div>
  )
}

// ═══ CONTRACTS ════════════════════════════════════════════════════════════════

export function Contracts() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [renewing, setRenewing] = useState(false)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['contracts', { status, renewing, page }],
    queryFn: () =>
      contractsApi.list({
        status: status || undefined,
        // The one query a renewals desk actually runs.
        renewingWithinDays: renewing ? 90 : undefined,
        page,
      }),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['contracts'] })
  const contracts = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Contracts</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New contract
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border bg-background px-3 py-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Any status</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={renewing}
            onChange={(e) => {
              setRenewing(e.target.checked)
              setPage(1)
            }}
          />
          Renewing in 90 days
        </label>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !contracts.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <FileSignature className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No contracts</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {contracts.map((ct) => (
            <div
              key={ct.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border bg-card pr-2 hover:border-primary/40"
            >
              <Link
                to="/app/contracts/$contractId"
                params={{ contractId: String(ct.id) }}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-4 p-4 text-left"
              >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{ct.title}</p>
                  <StatusPill status={ct.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  <span className="font-mono">{ct.contractNumber}</span>
                  {ct.account && ` · ${ct.account.name}`}
                  {ct.renewalDate && ` · renews ${new Date(ct.renewalDate).toLocaleDateString('en-IN')}`}
                </p>
              </div>
                {ct.value != null && (
                  <span className="font-semibold">{formatMoney(Number(ct.value))}</span>
                )}
              </Link>
              <button onClick={() => setEditing(ct)} className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">Edit</button>
              <DeleteButton
                what="contract"
                label={ct.title}
                onDelete={() => contractsApi.remove(ct.id)}
                onDeleted={refresh}
              />
            </div>
          ))}
        </div>
      )}

      {(data?.totalPages ?? 1) > 1 && (
        <Pager page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
      )}

      {(creating || editing) && (
        <ContractModal
          contract={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function ContractModal({
  contract,
  onClose,
  onSaved,
}: {
  contract: Contract | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Record<string, unknown>>(
    contract
      ? {
          title: contract.title,
          type: contract.type ?? '',
          status: contract.status,
          startDate: contract.startDate?.slice(0, 10) ?? '',
          endDate: contract.endDate?.slice(0, 10) ?? '',
          renewalDate: contract.renewalDate?.slice(0, 10) ?? '',
          value: contract.value,
          paymentTerms: contract.paymentTerms ?? '',
          signedBy: contract.signedBy ?? '',
          documentUrl: contract.documentUrl ?? '',
          notes: contract.notes ?? '',
        }
      : { title: '', status: 'draft' },
  )
  const [accountSearch, setAccountSearch] = useState('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'picker', accountSearch],
    queryFn: () => accountsApi.list({ search: accountSearch || undefined, limit: 10 }),
    enabled: !contract && accountSearch.length > 1,
  })

  const save = useMutation({
    mutationFn: () => (contract ? contractsApi.update(contract.id, form) : contractsApi.create(form)),
    onSuccess: () => {
      toast.success(contract ? 'Saved' : 'Contract created')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{contract ? contract.contractNumber : 'New contract'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Title *</label>
            <input
              className={input}
              value={String(form.title ?? '')}
              onChange={(e) => set('title', e.target.value)}
              autoFocus
            />
          </div>

          {!contract && (
            <div>
              <label className="mb-1 block text-sm font-medium">Account</label>
              {form.accountId ? (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <span>
                    {accounts?.data.find((a) => a.id === form.accountId)?.name ?? `#${form.accountId}`}
                  </span>
                  <button onClick={() => set('accountId', null)} className="text-xs text-muted-foreground">
                    change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={input}
                    placeholder="Search companies…"
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                  />
                  {!!accounts?.data.length && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border">
                      {accounts.data.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            set('accountId', a.id)
                            setAccountSearch('')
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Type</label>
              <input
                className={input}
                placeholder="MSA, SOW, AMC…"
                value={String(form.type ?? '')}
                onChange={(e) => set('type', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Status</label>
              <select className={input} value={String(form.status)} onChange={(e) => set('status', e.target.value)}>
                {CONTRACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Start</label>
              <input
                type="date"
                className={input}
                value={String(form.startDate ?? '')}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">End</label>
              <input
                type="date"
                className={input}
                value={String(form.endDate ?? '')}
                onChange={(e) => set('endDate', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Renewal</label>
              <input
                type="date"
                className={input}
                value={String(form.renewalDate ?? '')}
                onChange={(e) => set('renewalDate', e.target.value)}
              />
            </div>
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
              <label className="mb-1 block text-sm font-medium">Signed by</label>
              <input
                className={input}
                value={String(form.signedBy ?? '')}
                onChange={(e) => set('signedBy', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Document URL</label>
            <input
              className={input}
              value={String(form.documentUrl ?? '')}
              onChange={(e) => set('documentUrl', e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Notes</label>
            <textarea
              className={input}
              rows={2}
              value={String(form.notes ?? '')}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={!String(form.title ?? '').trim() || save.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {contract ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export type { Order }
