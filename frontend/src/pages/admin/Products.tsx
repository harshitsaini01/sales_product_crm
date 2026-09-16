import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, Package, EyeOff, Eye, X, ImagePlus, Trash2, Loader2 } from 'lucide-react'
import { productsApi, formatMoney, type Product } from '@/lib/deals-api'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

export default function Products() {
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const [search, setSearch] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Product | null>(null)

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
    onSuccess: () => {
      toast.success('Catalog updated')
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => productsApi.remove(id),
    onSuccess: () => {
      toast.success('Product deleted')
      setRemoving(null)
      setEditing(null)
      setCreating(false)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not delete this product'),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-sub">Photo, price and description. Pick these when you send a catalog to a lead.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New product
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-lg border bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          Show hidden
        </label>
      </div>

      {isLoading ? (
        <div className="surface py-16 text-center text-sm text-slate-500">Loading catalog…</div>
      ) : !products.length ? (
        <div className="surface border-dashed py-16 text-center">
          <Package className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-medium text-slate-800">No products yet</p>
          <p className="mt-1 text-sm text-slate-500">Add a photo, a price and a short description.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <article
              key={p.id}
              className={cn(
                'surface overflow-hidden transition-colors hover:border-primary/30',
                !p.active && 'opacity-60',
              )}
            >
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="block w-full text-left"
                >
                  <ProductBody p={p} />
                </button>
              ) : (
                <ProductBody p={p} />
              )}
              {isAdmin && (
                <div className="flex items-center justify-end gap-1 border-t px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggle.mutate(p)}
                    title={p.active ? 'Hide from catalog' : 'Show again'}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  >
                    {p.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(p)}
                    title="Delete product"
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ProductModal
          product={editing}
          canDelete={isAdmin && !!editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            refresh()
          }}
          onDelete={() => editing && setRemoving(editing)}
        />
      )}

      {removing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-500/20 p-4">
          <div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-slate-800">Delete this product?</h2>
            <p className="mt-2 text-sm text-slate-500">
              <span className="font-medium text-slate-700">{removing.name}</span> will be removed from the catalog.
              Past catalog sends keep their snapshot.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setRemoving(null)}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => remove.mutate(removing.id)}
                disabled={remove.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProductBody({ p }: { p: Product }) {
  return (
    <>
      {p.imageUrl ? (
        <img src={p.imageUrl} alt="" className="h-44 w-full object-cover bg-slate-50" />
      ) : (
        <div className="flex h-44 w-full items-center justify-center bg-slate-50 text-slate-300">
          <Package className="h-10 w-10" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-slate-800 truncate">{p.name}</p>
          {!p.active && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Hidden
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold text-primary">{formatMoney(p.unitPrice, p.currency)}</p>
        {p.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{p.description}</p>
        )}
      </div>
    </>
  )
}

function ProductModal({
  product,
  canDelete,
  onClose,
  onSaved,
  onDelete,
}: {
  product: Product | null
  canDelete?: boolean
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/20 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{product ? 'Edit product' : 'New product'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 text-sm hover:bg-slate-50">
            {preview ? (
              <img src={preview} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-50">
                <ImagePlus className="h-5 w-5 text-slate-400" />
              </div>
            )}
            <span className="text-slate-500">Click to add a photo</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Name *</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Price (₹)</label>
            <input
              type="number"
              className={input}
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Description</label>
            <textarea className={input} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
            <button
              onClick={() => save.mutate()}
              disabled={!name.trim() || save.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {product ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
