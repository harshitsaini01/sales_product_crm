import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PhoneCall, Loader2 } from 'lucide-react'
import { leadsApi } from '@/lib/api'

type Outcome = 'answered' | 'not_answered' | 'declined' | 'busy' | 'wrong_number' | 'switched_off'

const OUTCOMES: { value: Outcome; label: string; tone: string }[] = [
  { value: 'answered',     label: '✓ Answered',    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  { value: 'not_answered', label: '✗ Not Answered', tone: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
  { value: 'busy',         label: '📵 Busy',        tone: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
  { value: 'switched_off', label: '⚡ Switched Off', tone: 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100' },
  { value: 'declined',     label: '🚫 Declined',    tone: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' },
  { value: 'wrong_number', label: '☎ Wrong No.',    tone: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100' },
]

/**
 * Header button that:
 *   1. Opens the dialer via `tel:` (browser/OS handles it)
 *   2. Pops a small sheet to log the call outcome
 *   3. Hits POST /leads/:id/call (which auto-advances status + creates reminder)
 */
export function QuickCallButton({
  leadId,
  mobile,
}: {
  leadId: number
  mobile?: string | null
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')

  const log = useMutation({
    mutationFn: (outcome: Outcome) => leadsApi.logCall(leadId, { outcome, notes: notes || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      qc.invalidateQueries({ queryKey: ['lead-timeline', leadId] })
      qc.invalidateQueries({ queryKey: ['lead-calls', leadId] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['followups'] })
      toast.success('Call logged')
      setOpen(false)
      setNotes('')
    },
    onError: () => toast.error('Failed to log call'),
  })

  const openDialer = () => {
    if (mobile) window.open(`tel:${mobile}`, '_self')
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={openDialer}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
      >
        <PhoneCall className="h-3.5 w-3.5" /> Call
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background border rounded-lg shadow-lg w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-base">Log call outcome</h3>
              <p className="text-xs text-muted-foreground">
                Status will be updated automatically based on your selection.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  disabled={log.isPending}
                  onClick={() => log.mutate(o.value)}
                  className={`px-3 py-2 text-sm border rounded-md transition-colors disabled:opacity-50 ${o.tone}`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes (e.g. 'Asked to call back after 5pm')..."
              rows={2}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />

            <div className="flex items-center justify-between">
              {log.isPending && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                className="ml-auto px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
