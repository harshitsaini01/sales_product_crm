import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Receipt, Plus, Send, IndianRupee, Trash2, X, Download, Printer } from 'lucide-react'
import {
  invoicesApi, INVOICE_STATUSES, PAYMENT_MODES, type Invoice,
} from '@/lib/sales-api'
import { accountsApi } from '@/lib/crm-api'
import { formatMoney, compactMoney } from '@/lib/deals-api'
import { DocumentLines, StatusPill } from '@/components/crm/DocumentLines'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { ChainBar } from '@/components/crm/ChainBar'
import { SendDocumentModal, openDocument } from '@/components/crm/SendDocumentModal'
import { downloadBlob } from '@/lib/utils'
import { Pager } from './Quotes'
import { useAuthStore } from '@/stores/auth.store'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

// ─── LIST + AGEING ────────────────────────────────────────────────────────────

export default function Invoices() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', { status, page }],
    queryFn: () => invoicesApi.list({ status: status || undefined, page }),
  })
  const { data: ageing } = useQuery({ queryKey: ['invoices', 'ageing'], queryFn: invoicesApi.ageing })

  const invoices = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New invoice
        </button>
      </div>

      {/* Ageing. The buckets are the whole reason a finance person opens this
          screen — how much is owed, and how late it is. */}
      {ageing && ageing.outstanding > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Outstanding</h2>
            <p className="text-xl font-bold">{formatMoney(ageing.outstanding)}</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            {(
              [
                ['Not yet due', ageing.buckets.current, 'text-muted-foreground'],
                ['1–30 days', ageing.buckets.days30, 'text-amber-600'],
                ['31–60 days', ageing.buckets.days60, 'text-orange-600'],
                ['61–90 days', ageing.buckets.days90, 'text-red-600'],
                ['90+ days', ageing.buckets.older, 'text-red-700'],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label} className="rounded-lg border p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={`mt-0.5 font-semibold ${tone}`}>{compactMoney(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <option value="overdue">Overdue</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !invoices.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No invoices</p>
          <p className="mt-1 text-sm text-muted-foreground">
            One can also be raised straight from an order, copying its lines.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              to="/app/invoices/$invoiceId"
              params={{ invoiceId: String(inv.id) }}
              className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 hover:border-primary/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-semibold">{inv.invoiceNumber}</p>
                  <StatusPill status={inv.status} overdue={inv.overdue} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {inv.account?.name ?? 'No account'}
                  {inv.dueDate && ` · due ${new Date(inv.dueDate).toLocaleDateString('en-IN')}`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{formatMoney(Number(inv.total), inv.currency)}</p>
                {inv.balance > 0 && inv.balance !== Number(inv.total) && (
                  <p className="text-xs text-amber-600">{formatMoney(inv.balance)} due</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {(data?.totalPages ?? 1) > 1 && (
        <Pager page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
      )}

      {creating && (
        <NewInvoiceModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            qc.invalidateQueries({ queryKey: ['invoices'] })
          }}
        />
      )}
    </div>
  )
}

function NewInvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [accountId, setAccountId] = useState<number | null>(null)
  const [accountSearch, setAccountSearch] = useState('')
  const [dueDate, setDueDate] = useState('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'picker', accountSearch],
    queryFn: () => accountsApi.list({ search: accountSearch || undefined, limit: 10 }),
    enabled: accountSearch.length > 1,
  })

  const create = useMutation({
    mutationFn: () => invoicesApi.create({ accountId, dueDate: dueDate || null }),
    onSuccess: () => {
      toast.success('Invoice created')
      onCreated()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <h2 className="text-lg font-bold">New invoice</h2>
        <p className="mt-1 text-sm text-muted-foreground">Defaults to 30 days if no due date is set.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Account</label>
            {accountId ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span>{accounts?.data.find((a) => a.id === accountId)?.name ?? `#${accountId}`}</span>
                <button onClick={() => setAccountId(null)} className="text-xs text-muted-foreground">
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
                  autoFocus
                />
                {!!accounts?.data.length && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border">
                    {accounts.data.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setAccountId(a.id)
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

          <div>
            <label className="mb-1 block text-sm font-medium">Due date</label>
            <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────

export function InvoiceDetail() {
  const { invoiceId } = useParams({ from: '/app/invoices/$invoiceId' })
  const id = Number(invoiceId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const [paying, setPaying] = useState(false)
  const [sending, setSending] = useState(false)

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoices', id],
    queryFn: () => invoicesApi.get(id),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['invoices'] })

  const setStatus = useMutation({
    mutationFn: (status: string) => invoicesApi.update(id, { status }),
    onSuccess: refresh,
  })
  const addItem = useMutation({
    mutationFn: (l: Record<string, unknown>) => invoicesApi.addItem(id, l),
    onSuccess: refresh,
  })
  const removeItem = useMutation({
    mutationFn: (lineId: number) => invoicesApi.removeItem(id, lineId),
    onSuccess: refresh,
  })
  const pdf = useMutation({
    mutationFn: () => invoicesApi.pdf(id),
    onSuccess: (blob) => downloadBlob(blob, `${invoice?.invoiceNumber ?? 'invoice'}.pdf`),
    onError: () => toast.error('Could not build the PDF'),
  })
  const removePayment = useMutation({
    mutationFn: (paymentId: number) => invoicesApi.removePayment(id, paymentId),
    onSuccess: () => {
      toast.success('Payment removed')
      refresh()
    },
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!invoice) return <p className="py-12 text-center text-sm">Not found.</p>

  // Once money has moved against it, the lines are the record of what was
  // billed. Editing them then would make the payments reconcile against
  // something that no longer exists.
  const linesLocked = invoice.status !== 'draft' || Number(invoice.amountPaid) > 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/app/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All invoices
      </Link>

      <ChainBar current={{ kind: 'invoice', id }} />

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-2xl font-bold">{invoice.invoiceNumber}</h1>
              <StatusPill status={invoice.status} overdue={invoice.overdue} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.account?.name ?? 'No account'}
              {invoice.account?.gstin && ` · GSTIN ${invoice.account.gstin}`}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              <span>Issued {new Date(invoice.issueDate).toLocaleDateString('en-IN')}</span>
              {invoice.sentAt && <span>sent {new Date(invoice.sentAt).toLocaleDateString('en-IN')}</span>}
              {invoice.dueDate && <span>due {new Date(invoice.dueDate).toLocaleDateString('en-IN')}</span>}
              {invoice.order && (
                <Link to="/app/orders/$orderId" params={{ orderId: String(invoice.order.id) }} className="hover:text-primary">order {invoice.order.orderNumber}</Link>
              )}
              {invoice.contract && (
                <Link to="/app/contracts/$contractId" params={{ contractId: String(invoice.contract.id) }} className="hover:text-primary">contract {invoice.contract.contractNumber}</Link>
              )}
              {invoice.quote && (
                <Link to="/app/quotes/$quoteId" params={{ quoteId: String(invoice.quote.id) }} className="hover:text-primary">quote {invoice.quote.quoteNumber}</Link>
              )}
              {invoice.deal && (
                <Link to="/app/deals/$dealId" params={{ dealId: String(invoice.deal.id) }} className="hover:text-primary">deal {invoice.deal.name}</Link>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{formatMoney(Number(invoice.total), invoice.currency)}</p>
            {Number(invoice.amountPaid) > 0 && (
              <p className="text-sm text-emerald-600">
                {formatMoney(Number(invoice.amountPaid))} received
              </p>
            )}
            {invoice.balance > 0 && (
              <p className="text-sm font-medium text-amber-600">{formatMoney(invoice.balance)} due</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
            <button
              onClick={() => setSending(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Send className="h-3.5 w-3.5" /> {invoice.status === 'draft' ? 'Send to customer' : 'Send again'}
            </button>
          )}
          {invoice.status === 'draft' && (
            <button onClick={() => setStatus.mutate('sent')} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent" title="Sent by other means — just record it">
              Mark sent
            </button>
          )}
          <button onClick={() => openDocument(`/invoices/${id}/document`)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            <Printer className="h-3.5 w-3.5" /> View / print
          </button>
          <button onClick={() => pdf.mutate()} disabled={pdf.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
          {invoice.balance > 0 && invoice.status !== 'draft' && invoice.status !== 'cancelled' && (
            <button
              onClick={() => setPaying(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              <IndianRupee className="h-3.5 w-3.5" /> Record payment
            </button>
          )}
          {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
            <button
              onClick={() => setStatus.mutate('cancelled')}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Cancel invoice
            </button>
          )}

          <DeleteButton
            what="invoice"
            label={invoice.invoiceNumber}
            showLabel
            note="Refused if payments were recorded — cancel it instead, which keeps the number and the record of what was received."
            onDelete={(force) => invoicesApi.remove(invoice.id, force)}
            onDeleted={() => navigate({ to: '/app/invoices' })}
          />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Line items</h2>
        <DocumentLines
          lines={invoice.items ?? []}
          totals={invoice}
          readOnly={linesLocked}
          onAdd={(l) => addItem.mutate(l)}
          onRemove={(lineId) => removeItem.mutate(lineId)}
        />
        {linesLocked && (
          <p className="mt-3 text-xs text-muted-foreground">
            This invoice has been issued, so its lines are the record of what was billed.
          </p>
        )}
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Payments</h2>
        {!invoice.payments?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <div className="space-y-2">
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{formatMoney(Number(p.amount))}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(p.paymentDate).toLocaleDateString('en-IN')} · {p.mode.replace(/_/g, ' ')}
                    {p.transactionId && ` · ${p.transactionId}`}
                    {p.bank && ` · ${p.bank}`}
                  </p>
                  {p.reference && <p className="mt-0.5 text-xs text-muted-foreground">{p.reference}</p>}
                </div>
                {p.recordedBy && (
                  <span className="text-xs text-muted-foreground">by {p.recordedBy.name}</span>
                )}
                {isAdmin && (
                  <button
                    onClick={() => removePayment.mutate(p.id)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {sending && (
        <SendDocumentModal
          kind="invoice"
          id={id}
          number={invoice.invoiceNumber}
          defaultTo={invoice.account?.email}
          defaultSubject={`Invoice ${invoice.invoiceNumber}`}
          warning={!invoice.items?.length ? 'This invoice has no line items — there is nothing to bill.' : null}
          onClose={() => setSending(false)}
          onSent={() => {
            setSending(false)
            refresh()
          }}
        />
      )}

      {paying && (
        <PaymentModal
          invoice={invoice}
          onClose={() => setPaying(false)}
          onSaved={() => {
            setPaying(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function PaymentModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: Invoice
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Record<string, unknown>>({
    // Pre-filled with the whole balance, which is what it is most of the time.
    amount: invoice.balance,
    paymentDate: new Date().toISOString().slice(0, 10),
    mode: 'bank_transfer',
  })

  const save = useMutation({
    mutationFn: () => invoicesApi.addPayment(invoice.id, form),
    onSuccess: () => {
      toast.success('Payment recorded')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not record', { duration: 7000 }),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Record payment</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {formatMoney(invoice.balance)} outstanding on {invoice.invoiceNumber}.
        </p>

        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Amount *</label>
              <input
                type="number"
                className={input}
                value={String(form.amount ?? '')}
                onChange={(e) => set('amount', Number(e.target.value))}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Date *</label>
              <input
                type="date"
                className={input}
                value={String(form.paymentDate ?? '')}
                onChange={(e) => set('paymentDate', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Mode</label>
            <select className={input} value={String(form.mode)} onChange={(e) => set('mode', e.target.value)}>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Transaction ID</label>
              <input
                className={input}
                value={String(form.transactionId ?? '')}
                onChange={(e) => set('transactionId', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Bank</label>
              <input
                className={input}
                value={String(form.bank ?? '')}
                onChange={(e) => set('bank', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Reference</label>
            <input
              className={input}
              value={String(form.reference ?? '')}
              onChange={(e) => set('reference', e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={!Number(form.amount) || save.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Record
          </button>
        </div>
      </div>
    </div>
  )
}
