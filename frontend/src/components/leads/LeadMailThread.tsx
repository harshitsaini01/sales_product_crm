import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Mail, Send } from 'lucide-react'
import { communicationApi, inboxApi, leadsApi } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

export type MailThreadItem = {
  id: number
  direction: 'out' | 'in'
  source?: 'mail' | 'catalog' | 'inbound'
  subject: string
  body: string
  createdAt: string
  inboundId?: number | null
}

function conversationKey(subject: string) {
  return subject.replace(/^(re|fwd|fw):\s*/gi, '').replace(/\s+/g, ' ').trim().toLowerCase() || '(no subject)'
}

function groupConversations(mails: MailThreadItem[]) {
  const groups: MailThreadItem[][] = []
  const index = new Map<string, number>()
  for (const m of mails) {
    const key = conversationKey(m.subject)
    const i = index.get(key)
    if (i == null) {
      index.set(key, groups.length)
      groups.push([m])
    } else {
      groups[i].push(m)
    }
  }
  return groups
}

export function LeadMailThread({
  leadId,
  leadEmail,
}: {
  leadId: number
  leadEmail?: string | null
}) {
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState<MailThreadItem | null>(null)
  const [replyBody, setReplyBody] = useState('')

  const { data: mails = [], isLoading } = useQuery<MailThreadItem[]>({
    queryKey: ['lead-mails', leadId],
    queryFn: () => leadsApi.mails(leadId),
  })
  const conversations = useMemo(() => groupConversations(mails), [mails])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lead-mails', leadId] })
    qc.invalidateQueries({ queryKey: ['lead-timeline', leadId] })
  }

  const sendNew = async () => {
    if (!leadEmail) return toast.error('This customer has no email')
    if (!subject.trim() || !body.trim()) return toast.error('Subject and body are required')
    setSending(true)
    try {
      await communicationApi.send({ toEmail: leadEmail, subject, body, leadId })
      toast.success('Email sent')
      setSubject('')
      setBody('')
      refresh()
    } catch {
      toast.error('Could not send')
    } finally {
      setSending(false)
    }
  }

  const sendReply = async () => {
    if (!leadEmail) return toast.error('This customer has no email')
    if (!replyingTo || !replyBody.trim()) return toast.error('Write a reply first')
    const re = replyingTo.subject.toLowerCase().startsWith('re:') ? replyingTo.subject : `Re: ${replyingTo.subject}`
    setSending(true)
    try {
      if (replyingTo.inboundId) {
        try {
          await inboxApi.reply(replyingTo.inboundId, { subject: re, body: replyBody })
        } catch {
          await communicationApi.send({ toEmail: leadEmail, subject: re, body: replyBody, leadId })
        }
      } else {
        await communicationApi.send({ toEmail: leadEmail, subject: re, body: replyBody, leadId })
      }
      toast.success('Reply sent')
      setReplyingTo(null)
      setReplyBody('')
      refresh()
    } catch {
      toast.error('Could not send the reply')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {!leadEmail && (
        <p className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          This customer has no email on file, so the thread cannot send.
        </p>
      )}

      <div className="max-h-[480px] space-y-4 overflow-y-auto rounded-xl border bg-muted/20 p-3">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : !mails.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No mail yet. Catalog sends, new mails and replies land here.</p>
        ) : (
          conversations.map((items) => (
            <div key={conversationKey(items[0].subject)} className="overflow-hidden rounded-lg border bg-card">
              {items.map((m, i) => (
                <div
                  key={`${m.direction}-${m.source ?? 'mail'}-${m.id}`}
                  className={cn(
                    'p-3 text-sm',
                    i > 0 && 'border-t bg-muted/10 pl-8',
                    m.direction === 'in' && 'bg-primary/5',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {i > 0 ? 'Reply · ' : ''}
                      {m.direction === 'in' ? 'Customer' : m.source === 'catalog' ? 'Catalog sent' : 'You'}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">{m.subject}</p>
                  <div className="prose prose-sm mt-2 max-w-none" dangerouslySetInnerHTML={{ __html: m.body || '<p></p>' }} />
                  <button
                    type="button"
                    onClick={() => { setReplyingTo(m); setReplyBody('') }}
                    className="mt-2 text-xs font-medium text-primary hover:underline"
                  >
                    Reply
                  </button>
                  {replyingTo && replyingTo.direction === m.direction && replyingTo.id === m.id && (
                    <div className="mt-2 space-y-2 border-t pt-2">
                      <textarea
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        rows={4}
                        placeholder={`Reply under “${m.subject}”…`}
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button onClick={() => void sendReply()} disabled={sending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send reply
                        </button>
                        <button onClick={() => setReplyingTo(null)} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 rounded-xl border p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="h-4 w-4" /> New mail</p>
        <input
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          rows={5}
          placeholder="Write a separate mail. It stays in this thread."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          onClick={() => void sendNew()}
          disabled={sending || !leadEmail}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </button>
      </div>
    </div>
  )
}
