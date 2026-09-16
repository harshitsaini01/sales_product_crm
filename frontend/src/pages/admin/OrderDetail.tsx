import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Receipt, FileSignature, Handshake, FileText, User, Check, Pencil, X, Save, Truck } from 'lucide-react'
import { ordersApi, ORDER_STATUSES, type Order } from '@/lib/sales-api'
import { commerceApi } from '@/lib/commerce-api'
import { downloadBlob } from '@/lib/utils'
import { formatMoney } from '@/lib/deals-api'
import { DocumentLines, StatusPill } from '@/components/crm/DocumentLines'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { ChainBar } from '@/components/crm/ChainBar'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * One order.
 *
 * Orders used to live inside an expanding row on the list page, with no URL of
 * their own — nothing could link to one. This is the page the chain bar, the
 * deal, the quote and the invoice link to. Status is a rail (confirmed →
 * processing → delivered), lines edit in place until delivery, and the two
 * things an order leads to — a contract and an invoice — are one click each.
 */
export default function OrderDetail() {
  const { orderId } = useParams({ from: '/app/orders/$orderId' })
  const id = Number(orderId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  const { data: order, isLoading } = useQuery({ queryKey: ['orders', id], queryFn: () => ordersApi.get(id) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['sales-chain'] })
    qc.invalidateQueries({ queryKey: ['deals'] })
  }

  const setStatus = useMutation({
    mutationFn: (status: string) => ordersApi.update(id, { status }),
    onSuccess: refresh,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update'),
  })
  const addItem = useMutation({ mutationFn: (l: Record<string, unknown>) => ordersApi.addItem(id, l), onSuccess: refresh })
  const updateItem = useMutation({
    mutationFn: ({ lineId, patch }: { lineId: number; patch: Record<string, unknown> }) => ordersApi.updateItem(id, lineId, patch),
    onSuccess: refresh,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the line'),
  })
  const removeItem = useMutation({ mutationFn: (lineId: number) => ordersApi.removeItem(id, lineId), onSuccess: refresh })
  const raiseInvoice = useMutation({
    mutationFn: () => ordersApi.invoice(id),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoiceNumber} raised`)
      refresh()
      navigate({ to: '/app/invoices/$invoiceId', params: { invoiceId: String(inv.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not raise an invoice', { duration: 7000 }),
  })
  const drawContract = useMutation({
    mutationFn: () => ordersApi.contract(id),
    onSuccess: (ct) => {
      toast.success(`Contract ${ct.contractNumber} drawn up`)
      refresh()
      navigate({ to: '/app/contracts/$contractId', params: { contractId: String(ct.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not draw up a contract'),
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!order) return <p className="py-12 text-center text-sm">Not found.</p>

  const locked = order.status === 'delivered' || order.status === 'cancelled'
  const liveInvoices = (order.invoices ?? []).filter((i) => i.status !== 'cancelled')
  const rail = ORDER_STATUSES.filter((s) => s !== 'cancelled' && s !== 'draft')
  const normalized = order.status === 'processing' ? 'packed' : order.status
  const idx = rail.indexOf(normalized)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/app/orders" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All orders
      </Link>

      <ChainBar current={{ kind: 'order', id }} />

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold">{order.orderNumber}</h1>
              <StatusPill status={order.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {order.account ? (
                <Link to="/app/accounts/$accountId" params={{ accountId: String(order.account.id) }} className="inline-flex items-center gap-1 hover:text-primary"><Building2 className="h-3.5 w-3.5" /> {order.account.name}</Link>
              ) : (
                <span>No account</span>
              )}
              {order.contact && <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" /> {order.contact.name}</span>}
              {order.deal && (
                <Link to="/app/deals/$dealId" params={{ dealId: String(order.deal.id) }} className="inline-flex items-center gap-1 hover:text-primary"><Handshake className="h-3.5 w-3.5" /> {order.deal.name}</Link>
              )}
              {order.quote && (
                <Link to="/app/quotes/$quoteId" params={{ quoteId: String(order.quote.id) }} className="inline-flex items-center gap-1 hover:text-primary"><FileText className="h-3.5 w-3.5" /> from {order.quote.quoteNumber}</Link>
              )}
              {order.contract && (
                <Link to="/app/contracts/$contractId" params={{ contractId: String(order.contract.id) }} className="inline-flex items-center gap-1 hover:text-primary"><FileSignature className="h-3.5 w-3.5" /> under {order.contract.contractNumber}</Link>
              )}
              <span>ordered {new Date(order.orderDate).toLocaleDateString('en-IN')}</span>
              {order.deliveryDate && <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> delivery {new Date(order.deliveryDate).toLocaleDateString('en-IN')}</span>}
            </div>
          </div>
          <p className="text-2xl font-bold">{formatMoney(Number(order.total), order.currency)}</p>
        </div>

        {/* Status rail */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {rail.map((s, i) => (
            <button
              key={s}
              onClick={() => s !== order.status && setStatus.mutate(s)}
              disabled={setStatus.isPending || order.status === 'cancelled'}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                s === order.status ? (s === 'delivered' ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground') : i < idx ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <button onClick={() => setStatus.mutate('cancelled')} className="ml-auto rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">Cancel order</button>
          )}
          {order.status === 'cancelled' && (
            <button onClick={() => setStatus.mutate('confirmed')} className="ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent">Reinstate</button>
          )}
        </div>

        {/* What this order leads to */}
        <div className="mt-4 flex flex-wrap gap-2">
          {!liveInvoices.length && order.status !== 'cancelled' && (
            <button onClick={() => raiseInvoice.mutate()} disabled={raiseInvoice.isPending || !order.items?.length} title={!order.items?.length ? 'Add line items first' : undefined} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Receipt className="h-3.5 w-3.5" /> Raise invoice
            </button>
          )}
          {!order.contract && order.status !== 'cancelled' && (
            <button onClick={() => drawContract.mutate()} disabled={drawContract.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
              <FileSignature className="h-3.5 w-3.5" /> Draw up a contract
            </button>
          )}
          {order.status === 'delivered' && (
            <button
              onClick={() => ordersApi.returnOrder(id).then(() => { toast.success('Return / credit note raised'); refresh() }).catch((e) => toast.error(e?.response?.data?.error || 'Could not return'))}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Raise return / credit note
            </button>
          )}
          <button
            onClick={() => ordersApi.challan(id).then((b) => downloadBlob(b, `${order.orderNumber}-challan.pdf`)).catch(() => toast.error('Could not open challan'))}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Delivery challan
          </button>
          <button
            onClick={() => ordersApi.packingList(id).then((b) => downloadBlob(b, `${order.orderNumber}-packing.pdf`)).catch(() => toast.error('Could not open packing list'))}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Packing list
          </button>
          <DeleteButton
            what="order"
            label={order.orderNumber}
            showLabel
            note="Refused while an invoice exists against it."
            onDelete={() => ordersApi.remove(id)}
            onDeleted={() => navigate({ to: '/app/orders' })}
          />
        </div>

        {!!order.invoices?.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {order.invoices.map((inv) => (
              <Link key={inv.id} to="/app/invoices/$invoiceId" params={{ invoiceId: String(inv.id) }} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono">{inv.invoiceNumber}</span>
                <StatusPill status={inv.status} overdue={inv.overdue} />
                <span className="text-xs text-muted-foreground">{(inv.balance ?? 0) > 0 ? `${formatMoney(inv.balance)} due` : 'settled'}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className={cn('rounded-xl border bg-card p-5', locked && 'opacity-90')}>
          <h2 className="mb-4 font-semibold">Line items</h2>
          <DocumentLines
            lines={order.items ?? []}
            totals={order}
            readOnly={locked || liveInvoices.length > 0}
            onAdd={(l) => addItem.mutate(l)}
            onUpdate={(lineId, patch) => updateItem.mutate({ lineId, patch })}
            onRemove={(lineId) => removeItem.mutate(lineId)}
          />
          {liveInvoices.length > 0 && !locked && (
            <p className="mt-3 text-xs text-muted-foreground">Invoiced — the lines are what was billed. Cancel the invoice to change them.</p>
          )}
          {locked && <p className="mt-3 text-xs text-muted-foreground">This order is {order.status}; its lines can no longer change.</p>}
        </div>

        <aside>
          <DetailsPanel order={order} editing={editing} setEditing={setEditing} onSaved={refresh} />
          <ShipPanel order={order} onSaved={refresh} />
        </aside>
      </div>
    </div>
  )
}

function DetailsPanel({ order, editing, setEditing, onSaved }: { order: Order; editing: boolean; setEditing: (v: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    deliveryDate: order.deliveryDate ? order.deliveryDate.slice(0, 10) : '',
    notes: order.notes ?? '',
    courier: order.courier ?? '',
    trackingNumber: order.trackingNumber ?? '',
    podNotes: order.podNotes ?? '',
  })
  const save = useMutation({
    mutationFn: () =>
      ordersApi.update(order.id, {
        deliveryDate: form.deliveryDate || null,
        notes: form.notes || null,
        courier: form.courier || null,
        trackingNumber: form.trackingNumber || null,
        podNotes: form.podNotes || null,
      }),
    onSuccess: () => {
      toast.success('Saved')
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Details</h3>
        <button onClick={() => setEditing(!editing)} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent">{editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}</button>
      </div>
      {editing ? (
        <div className="space-y-2.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Delivery date</label>
            <input type="date" className={input} value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Courier</label>
            <input className={input} value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tracking number</label>
            <input className={input} value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Proof of delivery</label>
            <textarea className={cn(input, 'min-h-[60px]')} value={form.podNotes} onChange={(e) => setForm({ ...form, podNotes: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
            <textarea className={cn(input, 'min-h-[80px]')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Save</button>
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Delivery</dt><dd>{order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-IN') : <span className="text-muted-foreground">Not set</span>}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Tracking</dt><dd>{order.courier || order.trackingNumber ? `${order.courier ?? ''} ${order.trackingNumber ?? ''}`.trim() : <span className="text-muted-foreground">Not set</span>}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Contract</dt><dd>{order.contract ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-emerald-600" /> {order.contract.contractNumber} · {order.contract.status.replace(/_/g, ' ')}</span> : <span className="text-muted-foreground">None</span>}</dd></div>
          {order.notes && <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap text-xs">{order.notes}</dd></div>}
        </dl>
      )}
    </div>
  )
}

function ShipPanel({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const [qty, setQty] = useState(recordFromLines(order))
  const ship = useMutation({
    mutationFn: () => {
      const items = (order.items ?? [])
        .map((l) => ({
          productId: l.productId ?? undefined,
          name: l.name,
          sku: l.sku,
          quantity: Number(qty[l.id] || 0),
        }))
        .filter((l) => l.quantity > 0)
      if (!items.length) throw new Error('Pick at least one quantity')
      return commerceApi.createShipment(order.id, {
        courier: order.courier,
        trackingNumber: order.trackingNumber,
        items,
      })
    },
    onSuccess: () => {
      toast.success('Shipment created')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || e.message || 'Could not ship'),
  })
  if (order.status === 'cancelled') return null
  return (
    <div className="mt-4 rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Partial ship</h3>
      {(order.shipments ?? []).map((s) => (
        <p key={s.id} className="mb-2 text-xs text-muted-foreground">{s.shipmentNumber} · {s.status.replace(/_/g, ' ')} · {(s.items ?? []).map((i) => `${i.name} × ${i.quantity}`).join(', ')}</p>
      ))}
      <div className="space-y-2">
        {(order.items ?? []).map((l) => (
          <div key={l.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <input
              className="w-20 rounded-lg border bg-background px-2 py-1 text-sm"
              type="number"
              min={0}
              max={l.quantity}
              value={qty[l.id] ?? ''}
              onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <button onClick={() => ship.mutate()} disabled={ship.isPending} className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50">Create shipment</button>
    </div>
  )
}

function recordFromLines(order: Order) {
  const out: Record<number, string> = {}
  for (const l of order.items ?? []) out[l.id] = String(l.quantity)
  return out
}
