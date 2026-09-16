import { formatMoney, type Product } from '@/lib/deals-api'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

function stockTone(p: Product) {
  if (p.stockStatus === 'out_of_stock') return 'text-rose-600'
  if (p.stockStatus === 'low_stock') return 'text-amber-600'
  return 'text-emerald-700'
}

/**
 * Catalogue picker with photo, ATP and floor warning.
 *
 * Used on quote/order/deal lines so a rep cannot quote a SKU they cannot ship.
 */
export function ProductStockPicker({
  products,
  onPick,
}: {
  products: Product[]
  onPick: (p: Product) => void
}) {
  return (
    <select
      className={input}
      defaultValue=""
      onChange={(e) => {
        const p = products.find((x) => String(x.id) === e.target.value)
        if (p) onPick(p)
      }}
    >
      <option value="">Pick from the catalogue, or type below…</option>
      {products.map((p) => (
        <option key={p.id} value={p.id} disabled={p.stockStatus === 'out_of_stock' && !p.allowBackorder}>
          {p.name}
          {p.sku ? ` · ${p.sku}` : ''}
          {p.unitPrice != null ? ` — ${formatMoney(p.unitPrice)}` : ''}
          {` · ATP ${p.available ?? 0}`}
          {p.stockStatus === 'out_of_stock' ? ' (out)' : p.stockStatus === 'low_stock' ? ' (low)' : ''}
        </option>
      ))}
    </select>
  )
}

export function StockBadge({ product }: { product: Product }) {
  const label =
    product.stockStatus === 'out_of_stock'
      ? 'Out of stock'
      : product.stockStatus === 'low_stock'
        ? `Low · ${product.available ?? 0}`
        : `ATP ${product.available ?? 0}`
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-wide', stockTone(product))}>
      {label}
    </span>
  )
}
