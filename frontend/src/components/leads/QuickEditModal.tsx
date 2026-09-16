import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { useLeadFields } from '@/hooks/useLeadFields'
import { normalizePhone } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { X, Loader2, Pencil, Flag } from 'lucide-react'
// Flag auto-engages when a flag comment is typed — no button, no toggle.
import type { Lead } from '@/types'

interface QuickEditModalProps {
  lead: Lead
  onClose: () => void
}

// Admin/sub-admin push flags downward (`send`); everyone else flags upward (`rcv`).
function flagWhich(role: string | undefined): 'send' | 'rcv' {
  return role === 'admin' || role === 'sub-admin' ? 'send' : 'rcv'
}

export function QuickEditModal({ lead, onClose }: QuickEditModalProps) {
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const which = flagWhich(role)
  const initiallyFlagged = (lead.flagSend === 1) || (lead.flagRcv === 1)

  const [name, setName] = useState(lead.name ?? '')
  const [email, setEmail] = useState(lead.email ?? '')
  const [mobile, setMobile] = useState(lead.mobile ?? '')
  const [intrestedCourse, setIntrestedCourse] = useState(lead.intrestedCourse ?? '')
  const [city, setCity] = useState(lead.city ?? '')
  const [state, setState] = useState(lead.state ?? '')
  const [nationality, setNationality] = useState(lead.nationality ?? '')

  // Typing in this textarea auto-flags the lead. Empty + previously unflagged = no-op.
  const [flagComment, setFlagComment] = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const save = useMutation({
    mutationFn: async () => {
      await leadsApi.update(lead.id, {
        name: name.trim(),
        email: email.trim() || null,
        mobile: normalizePhone(mobile) || null,
        intrestedCourse: intrestedCourse.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        nationality: nationality.trim() || null,
      })
      // Typing a comment auto-flags. Backend appends the comment without
      // flipping the flag state when the lead is already flagged.
      const trimmed = flagComment.trim()
      if (trimmed) {
        await leadsApi.toggleFlag(lead.id, which, trimmed)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      qc.invalidateQueries({ queryKey: ['flag-messages', lead.id] })
      qc.invalidateQueries({ queryKey: ['lead-tab-counts'] })
      qc.invalidateQueries({ queryKey: ['lead-department-counts'] })
      toast.success('Lead updated')
      onClose()
    },
    onError: () => toast.error('Failed to update lead'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    save.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl mx-4 bg-card border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b bg-card/95 backdrop-blur-sm rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            <div>
              <h2 className="text-lg font-bold">Quick Edit</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lead.name} <span className="text-muted-foreground/50">#{lead.id}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field name="name" label="Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <Field name="email" label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field name="mobile" label="Mobile">
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={inputCls} />
            </Field>
            <Field name="intrestedCourse" label="Product interest">
              <input value={intrestedCourse} onChange={(e) => setIntrestedCourse(e.target.value)} className={inputCls} placeholder="e.g. SKU or product line" />
            </Field>
            <Field name="city" label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
            </Field>
            <Field name="state" label="State">
              <input value={state} onChange={(e) => setState(e.target.value)} className={inputCls} />
            </Field>
            <Field name="nationality" label="Nationality">
              <input value={nationality} onChange={(e) => setNationality(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* ── Flag section — typing a comment auto-flags the lead ───── */}
          <fieldset className="border-t pt-4">
            <legend className="text-sm font-bold flex items-center gap-2 mb-2">
              <Flag className={`h-4 w-4 ${initiallyFlagged ? 'text-amber-500 fill-amber-400' : 'text-muted-foreground'}`} />
              Flag Comment
              {initiallyFlagged && (
                <span className="ml-1 text-xs font-medium text-amber-700">(already flagged)</span>
              )}
            </legend>
            <textarea
              value={flagComment}
              onChange={(e) => setFlagComment(e.target.value)}
              rows={3}
              placeholder={initiallyFlagged
                ? 'Add another note to the flag history...'
                : 'Type a comment to flag this lead...'}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {initiallyFlagged
                ? 'Comment will be appended to the flag history. Flag stays on.'
                : 'Writing a comment here will mark this lead as flagged.'}
            </p>
          </fieldset>

          <div className="flex items-center gap-3 pt-2 border-t">
            <button
              type="submit"
              disabled={save.isPending}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium border rounded-lg hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputCls =
  'w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring'

function Field({
  name,
  label,
  required,
  children,
}: {
  /** Lead field key — the Field hides itself when the customer has it off. */
  name?: string
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  const { visible, label: renamed } = useLeadFields()
  if (name && !visible(name)) return null

  // Same rule as the Add form: the customer's own wording, with `label` as the
  // fallback for anyone who has renamed nothing.
  const heading = name ? renamed(name, label) : label

  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">
        {heading}{required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  )
}
