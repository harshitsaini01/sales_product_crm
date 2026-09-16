import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, AlertTriangle, X } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Delete one record, with the confirmation the record deserves.
 *
 * Shared by accounts, contacts, deals, quotes, orders, contracts and invoices,
 * because they all need the same three things and had none of them: a
 * confirmation, a place to show the server's refusal, and a way to act on it.
 *
 * THE SERVER IS THE AUTHORITY. Several of these deletes are refused with a 409
 * and a reason — an order that has been invoiced, an invoice with payments
 * against it, a quote already converted. This renders that reason rather than a
 * generic "failed", and offers the override only when the server itself said
 * one exists.
 *
 * Admin only, matching the endpoints.
 */
export function DeleteButton({
  label,
  what,
  onDelete,
  onDeleted,
  /** Renders "Delete" beside the icon rather than icon-only. */
  showLabel,
  /** Extra line shown in the dialog — e.g. "Its contacts stay attached." */
  note,
}: {
  /** The record's own name, shown so nobody deletes the wrong row. */
  label: string
  /** "account", "invoice" — used in the sentence. */
  what: string
  onDelete: (force: boolean) => Promise<unknown>
  onDeleted: () => void
  showLabel?: boolean
  note?: string
}) {
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [canForce, setCanForce] = useState(false)

  const del = useMutation({
    mutationFn: (force: boolean) => onDelete(force),
    onSuccess: () => {
      toast.success(`${what[0].toUpperCase()}${what.slice(1)} deleted`)
      setOpen(false)
      setRefusal(null)
      // Refetch everything on screen. A delete ripples further than its own
      // list — removing an order changes the account's totals, the deal's
      // documents and the lead's company panel — and callers were left to
      // remember every one of those. Blanket invalidation is a little wasteful
      // and always correct, which is the right trade for a destructive action.
      qc.invalidateQueries()
      onDeleted()
    },
    onError: (e: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = (e as any)?.response
      const msg = res?.data?.error
      if (res?.status === 409 && msg) {
        // A refusal with a reason, not a failure. Keep the dialog open and show
        // it — the person needs to read it to decide what to do next.
        setRefusal(msg)
        // Only offer the override where the server implements one.
        setCanForce(typeof res.data?.paymentCount === 'number' || typeof res.data?.valueCount === 'number')
        return
      }
      toast.error(msg || `Could not delete this ${what}`)
    },
  })

  if (!isAdmin) return null

  return (
    <>
      <button
        onClick={() => {
          setRefusal(null)
          setCanForce(false)
          setOpen(true)
        }}
        title={`Delete this ${what}`}
        className={
          showLabel
            ? 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive'
            : 'rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
        }
      >
        <Trash2 className="h-4 w-4" />
        {showLabel && 'Delete'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">Delete this {what}?</h2>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm">
              <span className="font-medium">{label}</span>
            </p>
            {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}

            {refusal && (
              <div className="mt-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed text-amber-900">{refusal}</p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>

              {refusal && canForce && (
                <button
                  onClick={() => del.mutate(true)}
                  disabled={del.isPending}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                >
                  Delete anyway
                </button>
              )}

              {!refusal && (
                <button
                  onClick={() => del.mutate(false)}
                  disabled={del.isPending}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                >
                  {del.isPending ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
