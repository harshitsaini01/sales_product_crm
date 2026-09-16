import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, Package, EyeOff, Eye, X, ImagePlus } from 'lucide-react'
import { productsApi, formatMoney, type Product } from '@/lib/deals-api'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

export default function Products() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', { search, showRetired }],
    queryFn: () =>
      productsApi.list({
        search: search || undefined,
        all: showRetired ? 1 : undefined,
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
          <p className="text-sm text-muted-foreground">Photo, price and description. Pick these when you mail a lead.</p>
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
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
          <p className="mt-1 text-sm text-muted-foreground">Add a photo, a price and a short description.</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditing(p)}
              className={cn(
                'flex gap-3 rounded-xl border bg-card p-3 text-left hover:border-primary/40',
                !p.active && 'opacity-60',
              )}
            >
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover border" />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <Package className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{p.name}</p>
                <p className="mt-0.5 font-semibold">{formatMoney(p.unitPrice, p.currency)}</p>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                )}
              </div>
              <span
                role="presentation"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle.mutate(p)
                }}
                title={p.active ? 'Hide' : 'Show again'}
                className="self-start rounded-lg p-2 text-muted-foreground hover:bg-accent"
              >
                {p.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </span>
            </button>
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
  const [name, setName] = useState(product?.name ?? '')
  const [unitPrice, setUnitPrice] = useState(product?.unitPrice != null ? String(product.unitPrice) : '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [file, setFile] = useState<File | null>(null)
  const preview = file ? URL.createObjectURL(file) : product?.imageUrl ?? null

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        unitPrice: unitPrice ? Number(unitPrice) : null,
        description: description.trim() || null,
      }
      const saved = product
        ? await productsApi.update(product.id, body)
        : await productsApi.create(body)
      const id = product?.id ?? saved.id
      if (file) await productsApi.uploadImage(id, file)
      return saved
    },
    onSuccess: () => {
      toast.success(product ? 'Saved' : 'Product added')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{product ? 'Edit product' : 'New product'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm hover:bg-accent">
            {preview ? (
              <img src={preview} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <span className="text-muted-foreground">Click to add a photo</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Price (₹)</label>
            <input
              type="number"
              className={input}
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea className={input} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button
            onClick={() => save.mutate()}
            disabled={!name.trim() || save.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {product ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
