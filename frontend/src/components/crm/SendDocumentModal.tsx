import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Send, X, Eye, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * Send an invoice or a contract to the customer.
 *
 * Same shape as the quote's send dialog: the preview IS the email body, the
 * PDF is attached server-side, and a failed send does not mark anything sent.
 */
export function SendDocumentModal({
  kind,
  id,
  number,
  defaultTo,
  defaultSubject,
  warning,
  onClose,
  onSent,
}: {
  kind: 'invoice' | 'contract'
  id: number
  number: string
  defaultTo?: string | null
  defaultSubject: string
  /** Shown above the form and disables Send — e.g. "no line items". */
  warning?: string | null
  onClose: () => void
  onSent: () => void
}) {
  const [to, setTo] = useState(defaultTo ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(defaultSubject)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const base = kind === 'invoice' ? `/invoices/${id}` : `/contracts/${id}`

  const loadPreview = useMutation({
    mutationFn: () => api.get(`${base}/document`).then((r) => r.data as string),
    onSuccess: (html) => setPreview(html),
    onError: () => toast.error('Could not build the preview'),
  })
  const send = useMutation({
    mutationFn: () => api.post(`${base}/send`, { to: to || undefined, cc: cc || undefined, subject, message: message || null }).then((r) => r.data as { to: string }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.to} with the PDF attached`)
      onSent()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not send', { duration: 8000 }),
  })

  if (preview) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <p className="text-sm font-medium">Preview — this is what the customer receives (plus the PDF)</p>
            <button onClick={() => setPreview(null)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">Back</button>
          </div>
          <iframe title={`${kind} preview`} srcDoc={preview} sandbox="" className="flex-1 bg-white" />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Send {number}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        {warning && (
          <div className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-900">{warning}</p>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">To *</label>
            <input type="email" className={input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@company.com" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cc</label>
            <input className={input} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Comma separated" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Subject</label>
            <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Covering note</label>
            <textarea className={input} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Leave empty for a standard note. The document follows it either way, and the PDF is attached." />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button onClick={() => loadPreview.mutate()} disabled={loadPreview.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent">
            <Eye className="h-4 w-4" /> Preview
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
            <button onClick={() => send.mutate()} disabled={!to.trim() || !!warning || send.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Send className="h-4 w-4" /> {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Open a server-rendered document in a new tab, ready to print. */
export async function openDocument(path: string) {
  const w = window.open('', '_blank')
  if (!w) {
    toast.error('Allow pop-ups to open the document')
    return
  }
  w.document.write('<p style="font-family:sans-serif;padding:24px">Loading…</p>')
  try {
    const { data } = await api.get(path)
    w.document.open()
    w.document.write(data)
    w.document.close()
  } catch {
    w.close()
    toast.error('Could not load the document')
  }
}
