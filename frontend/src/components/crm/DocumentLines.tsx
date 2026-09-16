import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { productsApi, formatMoney } from '@/lib/deals-api'
import type { DocLine } from '@/lib/sales-api'
import { cn } from '@/lib/utils'
import { ProductStockPicker } from '@/components/crm/ProductStockPicker'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'
const cell = 'w-full rounded border bg-background px-2 py-1 text-right text-sm'

/**
 * The line-item table shared by quotes, orders and invoices.
 *
 * All three documents carry the same line shape and the same arithmetic, so
 * they share one editor. Totals are NOT computed here — they come back from the
 * server after every write, because the server is the only place the formula
 * lives and a second copy in the browser is how a screen ends up disagreeing
 * with the invoice it just printed.
 *
 * Lines edit in place when `onUpdate` is given. Fixing a quantity used to mean
 * deleting the line and typing it again, which is how a quote loses its SKU.
 */
export function DocumentLines({
  lines,
  totals,
  readOnly,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lines: DocLine[]
  totals: { subtotal: number; discount: number; tax: number; total: number; currency: string }
  readOnly?: boolean
  onAdd: (line: Record<string, unknown>) => void
  onUpdate?: (lineId: number, patch: Record<string, unknown>) => void
  onRemove: (lineId: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState<Record<string, unknown>>({})
  const [draft, setDraft] = useState<Record<string, unknown>>({
    name: '',
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
    taxPercent: 18,
  })

  const { data: catalogue = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
    enabled: adding,
  })

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }))

  const reset = () => {
    setDraft({ name: '', quantity: 1, unitPrice: 0, discountPercent: 0, taxPercent: 18 })
    setAdding(false)
  }

  const startEdit = (l: DocLine) => {
    setEditingId(l.id)
    setEdit({
      name: l.name,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPercent: Number(l.discountPercent),
      taxPercent: Number(l.taxPercent),
    })
  }

  const editable = !readOnly && !!onUpdate

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Disc</th>
              <th className="px-3 py-2 text-right font-medium">Tax</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              {!readOnly && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {!lines.length && (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="px-3 py-8 text-center text-muted-foreground">
                  No line items yet.
                </td>
              </tr>
            )}
            {lines.map((l) =>
              editingId === l.id ? (
                <tr key={l.id} className="border-t bg-primary/5">
                  <td className="px-2 py-1.5">
                    <input className={cn(cell, 'text-left')} value={String(edit.name ?? '')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
                  </td>
                  <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.quantity)} onChange={(e) => setEdit({ ...edit, quantity: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.unitPrice)} onChange={(e) => setEdit({ ...edit, unitPrice: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.discountPercent)} onChange={(e) => setEdit({ ...edit, discountPercent: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.taxPercent)} onChange={(e) => setEdit({ ...edit, taxPercent: Number(e.target.value) })} /></td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">recalculated on save</td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          onUpdate?.(l.id, edit)
                          setEditingId(null)
                        }}
                        disabled={!String(edit.name ?? '').trim()}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40"
                        title="Save"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="rounded p-1 text-muted-foreground hover:bg-accent" title="Cancel">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">
                    {l.name}
                    {l.sku && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{l.sku}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{Number(l.quantity)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(Number(l.unitPrice))}</td>
                  <td className="px-3 py-2 text-right">{Number(l.discountPercent)}%</td>
                  <td className="px-3 py-2 text-right">{Number(l.taxPercent)}%</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(Number(l.total))}</td>
                  {!readOnly && (
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        {editable && (
                          <button onClick={() => startEdit(l)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit line">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => onRemove(l.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Remove line"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* Discount and tax are shown as their own lines rather than folded into
          one number, because that is what a customer queries an invoice about. */}
      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <Row label="Subtotal" value={formatMoney(totals.subtotal, totals.currency)} />
        {totals.discount > 0 && (
          <Row label="Discount" value={`− ${formatMoney(totals.discount, totals.currency)}`} />
        )}
        <Row label="Tax" value={formatMoney(totals.tax, totals.currency)} />
        <div className="flex justify-between border-t pt-1 text-base font-bold">
          <span>Total</span>
          <span>{formatMoney(totals.total, totals.currency)}</span>
        </div>
      </div>

      {!readOnly && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Add line
        </button>
      )}

      {!readOnly && adding && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          {!!catalogue.length && (
            <ProductStockPicker
              products={catalogue}
              onPick={(p) =>
                setDraft({
                  productId: p.id,
                  name: p.name,
                  sku: p.sku,
                  hsnCode: p.hsnCode,
                  quantity: 1,
                  unitPrice: p.unitPrice ?? 0,
                  discountPercent: 0,
                  taxPercent: p.taxPercent ?? 18,
                })
              }
            />
          )}

          <input
            className={input}
            placeholder="Description *"
            value={String(draft.name ?? '')}
            onChange={(e) => set('name', e.target.value)}
          />

          <div className="grid gap-3 sm:grid-cols-4">
            <Num label="Qty" value={draft.quantity} onChange={(v) => set('quantity', v)} />
            <Num label="Unit price" value={draft.unitPrice} onChange={(v) => set('unitPrice', v)} />
            <Num label="Discount %" value={draft.discountPercent} onChange={(v) => set('discountPercent', v)} />
            <Num label="Tax %" value={draft.taxPercent} onChange={(v) => set('taxPercent', v)} />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                onAdd(draft)
                reset()
              }}
              disabled={!String(draft.name ?? '').trim()}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Add
            </button>
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        className={input}
        value={String(value ?? '')}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/** Shared status pill colouring across all four document types. */
export function StatusPill({ status, overdue }: { status: string; overdue?: boolean }) {
  const tone = overdue
    ? 'bg-red-500/10 text-red-600'
    : ['paid', 'accepted', 'signed', 'active', 'delivered'].includes(status)
      ? 'bg-emerald-500/10 text-emerald-600'
      : ['rejected', 'expired', 'cancelled', 'terminated'].includes(status)
        ? 'bg-red-500/10 text-red-600'
        : ['partial', 'processing', 'under_review', 'sent', 'viewed'].includes(status)
          ? 'bg-amber-500/10 text-amber-600'
          : 'bg-slate-500/10 text-slate-500'

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>
      {overdue ? 'overdue' : status.replace(/_/g, ' ')}
    </span>
  )
}
