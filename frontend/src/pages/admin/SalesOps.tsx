import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, X, Check, Ban } from 'lucide-react'
import { commerceApi, type Cadence, type SalesApprovalRow, type PriceList } from '@/lib/commerce-api'
import { productsApi, type Product } from '@/lib/deals-api'
import { branchesApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { compactMoney } from '@/lib/deals-api'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

type Tab = 'cadences' | 'approvals' | 'prices' | 'stock' | 'sla' | 'field'

export default function SalesOps() {
  const [tab, setTab] = useState<Tab>('cadences')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'cadences', label: 'Cadences' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'prices', label: 'Price lists' },
    { key: 'stock', label: 'Warehouse' },
    { key: 'sla', label: 'SLA' },
    { key: 'field', label: 'Field' },
  ]
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sales operations</h1>
        <p className="text-sm text-muted-foreground">Playbooks, discount approvals and dealer price lists.</p>
      </div>
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'cadences' && <CadencesTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'prices' && <PriceListsTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'sla' && <SlaTab />}
      {tab === 'field' && <FieldTab />}
    </div>
  )
}

function CadencesTab() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['cadences'], queryFn: commerceApi.cadences })
  const create = useMutation({
    mutationFn: () =>
      commerceApi.createCadence({
        name,
        steps: [
          { dayOffset: 0, channel: 'email', subject: 'Catalog', body: 'Here is our catalogue {{product_grid}}' },
          { dayOffset: 2, channel: 'call', subject: 'Follow-up call' },
          { dayOffset: 5, channel: 'whatsapp', subject: 'Quote nudge' },
        ],
      }),
    onSuccess: () => {
      toast.success('Cadence created')
      setCreating(false)
      setName('')
      qc.invalidateQueries({ queryKey: ['cadences'] })
    },
  })
  return (
    <div className="space-y-4">
      <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
        <Plus className="h-4 w-4" /> New cadence
      </button>
      {creating && (
        <div className="flex gap-2">
          <input className={input} placeholder="Name, e.g. New enquiry" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Save</button>
          <button onClick={() => setCreating(false)} className="rounded-lg border px-3 py-2 text-sm"><X className="h-4 w-4" /></button>
        </div>
      )}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.map((c: Cadence) => (
        <div key={c.id} className="rounded-xl border bg-card p-4">
          <p className="font-medium">{c.name}</p>
          <p className="text-xs text-muted-foreground">{c.steps?.length ?? 0} steps · {c._count?.enrollments ?? 0} enrolled</p>
        </div>
      ))}
    </div>
  )
}

function ApprovalsTab() {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['approvals'], queryFn: () => commerceApi.approvals('pending') })
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'rejected' }) => commerceApi.decide(id, status),
    onSuccess: () => {
      toast.success('Decision recorded')
      qc.invalidateQueries({ queryKey: ['approvals'] })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not decide'),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing waiting.</p>
  return (
    <div className="space-y-2">
      {rows.map((r: SalesApprovalRow) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{r.kind.replace(/_/g, ' ')} · {r.quote?.quoteNumber ?? r.entityType}</p>
            <p className="text-xs text-muted-foreground">{r.account?.name ?? '—'}{r.requestedPct != null ? ` · ${r.requestedPct}%` : ''}</p>
          </div>
          <button onClick={() => decide.mutate({ id: r.id, status: 'approved' })} className="rounded-lg border border-emerald-300 p-2 text-emerald-700 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
          <button onClick={() => decide.mutate({ id: r.id, status: 'rejected' })} className="rounded-lg border border-rose-300 p-2 text-rose-700 hover:bg-rose-50"><Ban className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  )
}

function PriceListsTab() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [sku, setSku] = useState({ listId: 0, productId: 0, unitPrice: '', minQty: '1' })
  const { data: rows = [] } = useQuery({ queryKey: ['price-lists'], queryFn: commerceApi.priceLists })
  const { data: products = [] } = useQuery({ queryKey: ['products', 'picker'], queryFn: () => productsApi.list() })
  const create = useMutation({
    mutationFn: () => commerceApi.createPriceList({ name, kind: 'dealer' }),
    onSuccess: () => {
      toast.success('Price list created')
      setName('')
      qc.invalidateQueries({ queryKey: ['price-lists'] })
    },
  })
  const addItem = useMutation({
    mutationFn: () =>
      commerceApi.addPriceItem(sku.listId, {
        productId: sku.productId,
        unitPrice: Number(sku.unitPrice),
        minQty: Number(sku.minQty) || 1,
      }),
    onSuccess: () => {
      toast.success('Qty break saved')
      setSku({ listId: 0, productId: 0, unitPrice: '', minQty: '1' })
      qc.invalidateQueries({ queryKey: ['price-lists'] })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not add'),
  })
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className={input} placeholder="Dealer / key-account list name" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Create</button>
      </div>
      {rows.map((p: PriceList) => (
        <div key={p.id} className="rounded-xl border bg-card p-4 space-y-3">
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-muted-foreground">{p.kind} · {p.items?.length ?? 0} SKUs · {p._count?.accounts ?? 0} accounts</p>
          <div className="flex flex-wrap gap-2">
            <select className={input} value={sku.listId === p.id ? sku.productId : 0} onChange={(e) => setSku({ ...sku, listId: p.id, productId: Number(e.target.value) })}>
              <option value={0}>Add SKU…</option>
              {products.map((prod: Product) => (
                <option key={prod.id} value={prod.id}>{prod.name}{prod.sku ? ` (${prod.sku})` : ''}</option>
              ))}
            </select>
            <input className={`${input} w-28`} type="number" placeholder="Price" value={sku.listId === p.id ? sku.unitPrice : ''} onChange={(e) => setSku({ ...sku, listId: p.id, unitPrice: e.target.value })} />
            <input className={`${input} w-24`} type="number" placeholder="Min qty" value={sku.listId === p.id ? sku.minQty : '1'} onChange={(e) => setSku({ ...sku, listId: p.id, minQty: e.target.value })} />
            <button
              onClick={() => addItem.mutate()}
              disabled={sku.listId !== p.id || !sku.productId || !sku.unitPrice || addItem.isPending}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            >
              Add break
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function StockTab() {
  const [form, setForm] = useState({ productId: 0, fromBranchId: 0, toBranchId: 0, quantity: '' })
  const { data: products = [] } = useQuery({ queryKey: ['products', 'picker'], queryFn: () => productsApi.list() })
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list })
  const transfer = useMutation({
    mutationFn: () =>
      commerceApi.transferStock({
        productId: form.productId,
        fromBranchId: form.fromBranchId,
        toBranchId: form.toBranchId,
        quantity: Number(form.quantity),
      }),
    onSuccess: () => {
      toast.success('Transferred')
      setForm({ ...form, quantity: '' })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Transfer failed'),
  })
  return (
    <div className="max-w-xl space-y-3 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">Move stock between branch warehouses. Global ATP stays the same; each warehouse ledger updates.</p>
      <select className={input} value={form.productId} onChange={(e) => setForm({ ...form, productId: Number(e.target.value) })}>
        <option value={0}>Product</option>
        {products.map((p: Product) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <select className={input} value={form.fromBranchId} onChange={(e) => setForm({ ...form, fromBranchId: Number(e.target.value) })}>
          <option value={0}>From warehouse</option>
          {(branches as { id: number; name: string }[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={input} value={form.toBranchId} onChange={(e) => setForm({ ...form, toBranchId: Number(e.target.value) })}>
          <option value={0}>To warehouse</option>
          {(branches as { id: number; name: string }[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <input className={input} type="number" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      <button
        onClick={() => transfer.mutate()}
        disabled={!form.productId || !form.fromBranchId || !form.toBranchId || !Number(form.quantity) || transfer.isPending}
        className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        Transfer
      </button>
    </div>
  )
}

function SlaTab() {
  const { data, isLoading } = useQuery({ queryKey: ['commerce', 'sla'], queryFn: commerceApi.sla })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!data?.breached.length) return <p className="text-sm text-muted-foreground">No first-response breaches (window {data?.hours ?? 4}h).</p>
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Leads with no call or WhatsApp within {data.hours} hours.</p>
      {data.breached.map((l) => (
        <div key={l.id} className="rounded-xl border bg-card p-4">
          <p className="font-medium">{l.name}</p>
          <p className="text-xs text-muted-foreground">{l.mobile || '—'} · {l.hoursLate}h late</p>
        </div>
      ))}
    </div>
  )
}

function FieldTab() {
  const [form, setForm] = useState({ productId: 0, quantity: '1', notes: '' })
  const { data: products = [] } = useQuery({ queryKey: ['products', 'picker'], queryFn: () => productsApi.list() })
  const sample = useMutation({
    mutationFn: () => commerceApi.issueSample({ productId: form.productId, quantity: Number(form.quantity) || 1, notes: form.notes || 'Sample bag' }),
    onSuccess: () => toast.success('Sample issued from stock'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not issue sample'),
  })
  return (
    <div className="max-w-xl space-y-3 rounded-xl border bg-card p-4">
      <p className="font-medium">Sample bag</p>
      <p className="text-sm text-muted-foreground">Writes a SAMPLE stock movement so giveaways do not silently drain ATP.</p>
      <select className={input} value={form.productId} onChange={(e) => setForm({ ...form, productId: Number(e.target.value) })}>
        <option value={0}>Product</option>
        {products.map((p: Product) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className={input} type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      <input className={input} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <button onClick={() => sample.mutate()} disabled={!form.productId || sample.isPending} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Issue sample</button>
    </div>
  )
}

export function CockpitStrip() {
  const { data } = useQuery({ queryKey: ['commerce', 'cockpit'], queryFn: commerceApi.cockpit })
  if (!data) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding</p>
        <p className="mt-1 text-xl font-bold">{compactMoney(data.outstanding)}</p>
        <p className="text-xs text-muted-foreground">{compactMoney(data.overdue)} overdue</p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Stock at risk</p>
        <p className="mt-1 text-xl font-bold">{data.lowStock} SKUs</p>
        <p className="text-xs text-muted-foreground">{compactMoney(data.stockValue)} on hand</p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Approvals</p>
        <p className="mt-1 text-xl font-bold">{data.pendingApprovals}</p>
        <p className="text-xs text-muted-foreground">{data.returns} returns</p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Collected</p>
        <p className="mt-1 text-xl font-bold">{compactMoney(data.collected)}</p>
      </div>
    </div>
  )
}
