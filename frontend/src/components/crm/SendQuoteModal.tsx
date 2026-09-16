import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Send, X, Eye, AlertTriangle } from 'lucide-react'
import { quotesApi, type Quote } from '@/lib/sales-api'
import { api } from '@/lib/api'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * Send a quote to the customer.
 *
 * The document is rendered server-side and is the SAME markup the customer
 * receives — the preview here is not a mock-up of the email, it is the email.
 *
 * A failed send does not mark the quote sent. That rule lives in the API, and
 * it matters: a rep who believes a customer has a quote they never received
 * will chase a decision that was never asked for.
 */
export function SendQuoteModal({
  quote,
  defaultTo,
  onClose,
  onSent,
}: {
  quote: Quote
  defaultTo?: string | null
  onClose: () => void
  onSent: () => void
}) {
  const [to, setTo] = useState(defaultTo ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`Quotation ${quote.quoteNumber}`)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  const noItems = !quote.items?.length

  const loadPreview = useMutation({
    mutationFn: () => quotesApi.document(quote.id),
    onSuccess: (html) => setPreview(html),
    onError: () => toast.error('Could not build the preview'),
  })

  const send = useMutation({
    mutationFn: () =>
      quotesApi.send(quote.id, { to: to || undefined, cc: cc || undefined, subject, message: message || null }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.to}`)
      onSent()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || 'Could not send the quote', { duration: 8000 }),
  })

  if (preview) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <p className="text-sm font-medium">
              Preview — this is exactly what the customer receives
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Print from a clean window rather than the app shell, so the
                  // browser's Save-as-PDF gets the document and nothing else.
                  const w = window.open('', '_blank')
                  if (!w) return toast.error('Allow pop-ups to print')
                  w.document.write(preview)
                  w.document.close()
                  w.focus()
                  setTimeout(() => w.print(), 300)
                }}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Print / Save as PDF
              </button>
              <button onClick={() => setPreview(null)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
                Back
              </button>
            </div>
          </div>
          <iframe
            title="Quote preview"
            srcDoc={preview}
            // Sandboxed: the document is generated from customer-entered text
            // (notes, terms), so it is rendered without script access.
            sandbox=""
            className="flex-1 bg-white"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Send {quote.quoteNumber}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {noItems && (
          <div className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-900">
              This quote has no line items. Add some before sending — there is nothing
              for the customer to price.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">To *</label>
            <input
              type="email"
              className={input}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={defaultTo ? undefined : 'customer@company.com'}
              autoFocus
            />
            {defaultTo && (
              <p className="mt-1 text-xs text-muted-foreground">
                Defaults to the contact on this quote.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Cc</label>
            <input
              className={input}
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="Comma separated"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Subject</label>
            <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Covering note</label>
            <textarea
              className={input}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Leave empty for a standard note. The quote itself is attached below it either way."
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button
            onClick={() => loadPreview.mutate()}
            disabled={loadPreview.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Eye className="h-4 w-4" /> Preview
          </button>

          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <button
              onClick={() => send.mutate()}
              disabled={!to.trim() || noItems || send.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Open the server-rendered document in a new tab, ready to print. */
export async function openQuoteDocument(quoteId: number) {
  const w = window.open('', '_blank')
  if (!w) {
    toast.error('Allow pop-ups to open the document')
    return
  }
  w.document.write('<p style="font-family:sans-serif;padding:24px">Loading…</p>')
  try {
    const { data } = await api.get(`/quotes/${quoteId}/document`)
    w.document.open()
    w.document.write(data)
    w.document.close()
  } catch {
    w.close()
    toast.error('Could not load the document')
  }
}
