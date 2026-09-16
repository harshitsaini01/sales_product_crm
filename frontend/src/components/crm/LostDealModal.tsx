import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pipelinesApi } from '@/lib/deals-api'

/**
 * "Why did we lose?" — asked at the moment of losing, because a month later
 * the answer is gone. The API refuses a loss without a reason; this asks
 * before sending. Shared by the board (drag into Lost) and the deal page
 * (Mark lost).
 */
export function LostDealModal({
  dealName,
  onCancel,
  onConfirm,
  pending,
}: {
  dealName: string
  onCancel: () => void
  onConfirm: (lostReasonId: number, lostNotes?: string) => void
  pending?: boolean
}) {
  const [reasonId, setReasonId] = useState('')
  const [notes, setNotes] = useState('')
  const { data: reasons = [] } = useQuery({ queryKey: ['lost-reasons'], queryFn: pipelinesApi.lostReasons })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Mark &ldquo;{dealName}&rdquo; lost</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A reason is required — it is what makes &ldquo;why do we lose?&rdquo; answerable later.
        </p>

        <div className="mt-4 space-y-3">
          <select
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
            autoFocus
          >
            <option value="">Pick a reason…</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <textarea
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            rows={3}
            placeholder="Anything worth remembering (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(Number(reasonId), notes || undefined)}
            disabled={!reasonId || pending}
            className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
          >
            Mark lost
          </button>
        </div>
      </div>
    </div>
  )
}
