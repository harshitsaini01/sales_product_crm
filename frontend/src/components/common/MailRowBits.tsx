import { Link } from '@tanstack/react-router'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// Small button that copies a string to the clipboard and briefly swaps its
// icon to a check. Used next to email addresses in Send History, Inbox, and
// the Reports drilldown so admins can grab a recipient address without
// opening the mail first. Failure (older browsers, non-HTTPS) toasts instead
// of silently doing nothing.
export function CopyButton({ text, title = 'Copy' }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!navigator.clipboard) {
          toast.error('Clipboard not available (needs HTTPS)')
          return
        }
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          },
          () => toast.error('Copy failed'),
        )
      }}
      className="inline-flex items-center justify-center p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
      title={title}
      aria-label={title}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// Renders "Lead #123" as a jump-off link to /app/leads/:leadId. Opens in a
// new tab (Ctrl-click behaviour is the default expectation for admins
// bouncing between mail history and a lead). Falls back to plain text when
// there's no id so callers can pass a nullable value without guarding.
export function LeadLinkChip({ id, className = '' }: { id: number | null | undefined; className?: string }) {
  if (id == null) return null
  return (
    <Link
      to="/app/leads/$leadId"
      params={{ leadId: String(id) }}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`text-[10px] font-mono text-primary hover:underline ${className}`}
      title={`Open lead #${id} in a new tab`}
    >
      Lead #{id}
    </Link>
  )
}
