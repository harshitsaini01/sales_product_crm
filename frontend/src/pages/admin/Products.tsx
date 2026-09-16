import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, Package, EyeOff, Eye, X, ImagePlus, History } from 'lucide-react'
import { productsApi, formatMoney, type Product } from '@/lib/deals-api'
import { commerceApi } from '@/lib/commerce-api'
import { StockBadge } from '@/components/crm/ProductStockPicker'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * The sellable catalogue: photos, HSN, ATP, and a stock ledger.
 *
 * Products are RETIRED, never deleted. Deal lines copy the name and price at
 * the time they were added, so an old deal reads correctly either way.
 */
export default function Products() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [stockFilter, setStockFilter] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [historyFor, setHistoryFor] = useState<Product | null>(null)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', { search, showRetired, stockFilter }],
    queryFn: () =>
          productsApi.list({
            search: search || undefined,
            all: showRetired ? 1 : undefined,
            stockStatus: stockFilter || undefined,
          }),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['products'] })

  const toggle = useMutation({
    mutationFn: (p: Product) =>
      p.active ? productsApi.retire(p.id) : productsApi.update(p.id, { active: true }),
    onSuccess: refresh,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">Catalogue, HSN, photos and live stock.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New product
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Name, SKU or HSN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
          <option value="">All stock</option>
          <option value="in_stock">In stock</option>
          <option value="low_stock">Low stock</option>
          <option value="out_of_stock">Out of stock</option>
        </select>
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          Show retired
        </label>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !products.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Package className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No products yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add SKUs with photos so quotes and emails can pull them in live.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {products.map((p) => (
            <div
              key={p.id}
              className={cn('flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4', !p.active && 'opacity-60')}
            >
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover border" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <Package className="h-5 w-5" />
                </div>
              )}
              <button onClick={() => setEditing(p)} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{p.name}</p>
                  {p.sku && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {p.sku}
                    </span>
                  )}
                  {p.hsnCode && <span className="text-[10px] text-muted-foreground">HSN {p.hsnCode}</span>}
                  {!p.active && (
                    <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                      Retired
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {p.category && <span>{p.category}</span>}
                  {p.collection && <span>· {p.collection}</span>}
                  <StockBadge product={p} />
                </div>
              </button>

              <div className="text-right">
                <p className="font-semibold">{formatMoney(p.unitPrice, p.currency)}</p>
                {p.taxPercent != null && (
                  <p className="text-xs text-muted-foreground">+{Number(p.taxPercent)}% GST</p>
                )}
              </div>

              <button
                onClick={() => setHistoryFor(p)}
                title="Stock history"
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              >
                <History className="h-4 w-4" />
              </button>
              <button
                onClick={() => toggle.mutate(p)}
                title={p.active ? 'Retire (keeps every deal line intact)' : 'Bring back'}
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              >
                {p.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ProductModal
          product={editing}
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

      {historyFor && (
        <StockHistoryModal product={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  )
}

function ProductModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Record<string, unknown>>(
    product
      ? {
          name: product.name,
          sku: product.sku ?? '',
          category: product.category ?? '',
          collection: product.collection ?? '',
          brand: product.brand ?? '',
          description: product.description ?? '',
          shortDescription: product.shortDescription ?? '',
          hsnCode: product.hsnCode ?? '',
          unit: product.unit ?? 'pcs',
          unitPrice: product.unitPrice,
          costPrice: product.costPrice,
          minSellingPrice: product.minSellingPrice,
          taxPercent: product.taxPercent,
          minStockLevel: product.minStockLevel,
          allowBackorder: product.allowBackorder ?? false,
          isKit: product.isKit ?? false,
        }
      : { name: '', taxPercent: 18, unit: 'pcs', minStockLevel: 0 },
  )
  const [qty, setQty] = useState('')
  const [openingQty, setOpeningQty] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const saved = product
        ? await productsApi.update(product.id, form)
        : await productsApi.create({ ...form, sku: form.sku || null })
      const id = product?.id ?? saved.id
      if (!product && openingQty) {
        const n = Number(openingQty)
        if (n > 0) await productsApi.adjustStock(id, { quantity: n, movementType: 'RESTOCK', notes: 'Opening stock' })
      }
      if (product && qty) {
        const n = Number(qty)
        if (n) await productsApi.adjustStock(id, { quantity: n, movementType: n > 0 ? 'RESTOCK' : 'ADJUSTMENT', notes: 'Manual adjust' })
      }
      return saved
    },
    onSuccess: () => {
      toast.success(product ? 'Saved' : 'Product created')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const upload = useMutation({
    mutationFn: (file: File) => {
      if (!product) throw new Error('Save the product first')
      return productsApi.uploadImage(product.id, file)
    },
    onSuccess: () => {
      toast.success('Photo uploaded')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not upload'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{product ? 'Edit product' : 'New product'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {product && (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm hover:bg-accent">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <span className="text-muted-foreground">Click to upload a catalogue photo</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload.mutate(f)
                }}
              />
            </label>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <input className={input} value={String(form.name ?? '')} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">SKU</label>
              <input className={input} value={String(form.sku ?? '')} onChange={(e) => set('sku', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">HSN</label>
              <input className={input} value={String(form.hsnCode ?? '')} onChange={(e) => set('hsnCode', e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Category</label>
              <input className={input} value={String(form.category ?? '')} onChange={(e) => set('category', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Collection</label>
              <input className={input} value={String(form.collection ?? '')} onChange={(e) => set('collection', e.target.value)} placeholder="best-sellers" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Short description</label>
            <input className={input} value={String(form.shortDescription ?? '')} onChange={(e) => set('shortDescription', e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Selling price (₹)</label>
              <input type="number" className={input} value={String(form.unitPrice ?? '')} onChange={(e) => set('unitPrice', e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Cost</label>
              <input type="number" className={input} value={String(form.costPrice ?? '')} onChange={(e) => set('costPrice', e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Floor price</label>
              <input type="number" className={input} value={String(form.minSellingPrice ?? '')} onChange={(e) => set('minSellingPrice', e.target.value ? Number(e.target.value) : null)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">GST %</label>
              <input type="number" className={input} value={String(form.taxPercent ?? '')} onChange={(e) => set('taxPercent', e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Min stock</label>
              <input type="number" className={input} value={String(form.minStockLevel ?? '')} onChange={(e) => set('minStockLevel', e.target.value ? Number(e.target.value) : 0)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Unit</label>
              <input className={input} value={String(form.unit ?? 'pcs')} onChange={(e) => set('unit', e.target.value)} />
            </div>
          </div>

          {product ? (
            <div>
              <label className="mb-1 block text-sm font-medium">Adjust stock (+ restock / − write-off)</label>
              <input type="number" className={input} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`On hand ${product.stockQuantity ?? 0} · reserved ${product.reservedQuantity ?? 0}`} />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium">Opening stock</label>
              <input type="number" className={input} value={openingQty} onChange={(e) => setOpeningQty(e.target.value)} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded" checked={Boolean(form.allowBackorder)} onChange={(e) => set('allowBackorder', e.target.checked)} />
            Allow backorder
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded" checked={Boolean(form.isKit)} onChange={(e) => set('isKit', e.target.checked)} />
            This is a kit (stock comes from components)
          </label>
          {product && Boolean(form.isKit) && <KitEditor productId={product.id} />}

          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea className={input} rows={2} value={String(form.description ?? '')} onChange={(e) => set('description', e.target.value)} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button
            onClick={() => save.mutate()}
            disabled={!String(form.name ?? '').trim() || save.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {product ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KitEditor({ productId }: { productId: number }) {
  const qc = useQueryClient()
  const { data: items = [] } = useQuery({
    queryKey: ['products', productId, 'kit'],
    queryFn: () => commerceApi.kitItems(productId),
  })
  const { data: products = [] } = useQuery({ queryKey: ['products', 'picker'], queryFn: () => productsApi.list() })
  const [row, setRow] = useState({ componentId: 0, quantity: '1' })
  const save = useMutation({
    mutationFn: (next: { componentId: number; quantity: number }[]) => commerceApi.saveKit(productId, next),
    onSuccess: () => {
      toast.success('Kit saved')
      qc.invalidateQueries({ queryKey: ['products', productId, 'kit'] })
    },
  })
  const current = items.map((i) => ({ componentId: Number(i.componentId), quantity: Number(i.quantity) }))
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">Kit components</p>
      {items.map((i) => (
        <div key={i.id} className="flex items-center justify-between text-sm">
          <span>{i.component?.name ?? i.componentId} × {Number(i.quantity)}</span>
          <button
            className="text-xs text-rose-600"
            onClick={() => save.mutate(current.filter((c) => c.componentId !== Number(i.componentId)))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <select className={input} value={row.componentId} onChange={(e) => setRow({ ...row, componentId: Number(e.target.value) })}>
          <option value={0}>Component SKU</option>
          {products.filter((p) => p.id !== productId).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input className={`${input} w-20`} type="number" value={row.quantity} onChange={(e) => setRow({ ...row, quantity: e.target.value })} />
        <button
          className="rounded-lg border px-2 text-sm"
          disabled={!row.componentId}
          onClick={() => save.mutate([...current.filter((c) => c.componentId !== row.componentId), { componentId: row.componentId, quantity: Number(row.quantity) || 1 }])}
        >
          Add
        </button>
      </div>
    </div>
  )
}

function StockHistoryModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['products', product.id, 'stock-history'],
    queryFn: () => productsApi.stockHistory(product.id),
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Stock · {product.name}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">No movements yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {(rows as Array<{ id: number; movementType: string; quantity: number; previousStock: number; newStock: number; createdAt: string; notes?: string | null }>).map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="font-medium">{m.movementType}</p>
                  <p className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString('en-IN')}{m.notes ? ` · ${m.notes}` : ''}</p>
                </div>
                <p className="font-mono text-xs">{Number(m.previousStock)} → {Number(m.newStock)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
