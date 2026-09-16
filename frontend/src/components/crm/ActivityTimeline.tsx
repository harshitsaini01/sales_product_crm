import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Phone, Mail, MessageSquare, MessageSquareQuote, Users, StickyNote, CheckSquare,
  ArrowRightLeft, FileText, IndianRupee, Settings, Plus, Loader2, FolderKanban,
} from 'lucide-react'
import { crmApi, type ActivityItem, type CrmEntityType } from '@/lib/crm-api'
import { cn } from '@/lib/utils'

/**
 * The activity timeline.
 *
 * One ordered feed of everything that has happened to a record — calls, emails,
 * WhatsApp, meetings, notes, status changes — so a sales rep opening an account
 * sees its whole history without clicking through five tabs to assemble it.
 *
 * Reads from `crm_activities`, which is written by the routes that perform each
 * action. If something a user did is missing from here, the fix is a
 * `recordSafe()` call at that action, not a merge in this component.
 */

const ICONS: Record<string, typeof Phone> = {
  call: Phone,
  comment: MessageSquareQuote,
  email: Mail,
  whatsapp: MessageSquare,
  meeting: Users,
  note: StickyNote,
  task: CheckSquare,
  followup: CheckSquare,
  stage_change: ArrowRightLeft,
  quote: FileText,
  payment: IndianRupee,
  project: FolderKanban,
  system: Settings,
}

const TONES: Record<string, string> = {
  call: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  email: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  whatsapp: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  meeting: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  note: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  comment: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  stage_change: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  payment: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  project: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400',
  system: 'bg-slate-500/10 text-slate-500',
}

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'call', label: 'Calls' },
  { value: 'email', label: 'Emails' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Meetings' },
  // Comments are what people write on a lead; notes are the second, quieter
  // channel. One chip covers both rather than making somebody guess which of
  // two near-identical filters holds the thing they are looking for.
  { value: 'comment,note', label: 'Comments' },
]

function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ActivityTimeline({
  entityType,
  entityId,
}: {
  entityType: CrmEntityType
  entityId: number
}) {
  const qc = useQueryClient()
  const [kind, setKind] = useState('')
  const [logging, setLogging] = useState(false)
  const [draft, setDraft] = useState({ kind: 'call', subject: '', body: '' })

  const queryKey = ['crm', 'timeline', entityType, entityId, kind]

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    // Keyset, not offset: the feed is appended to while somebody reads it, and
    // OFFSET would skip or repeat rows on every scroll.
    queryFn: ({ pageParam }) =>
      crmApi.timeline(entityType, entityId, {
        kinds: kind || undefined,
        before: pageParam ?? undefined,
        limit: 25,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  const log = useMutation({
    mutationFn: () =>
      crmApi.logActivity(entityType, entityId, {
        kind: draft.kind,
        subject: draft.subject || null,
        body: draft.body || null,
      }),
    onSuccess: () => {
      toast.success('Logged')
      setDraft({ kind: 'call', subject: '', body: '' })
      setLogging(false)
      qc.invalidateQueries({ queryKey: ['crm', 'timeline', entityType, entityId] })
    },
    onError: () => toast.error('Could not log that'),
  })

  const items: ActivityItem[] = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setKind(f.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                kind === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setLogging((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Log activity
        </button>
      </div>

      {logging && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            For something that happened outside the CRM — a call from a personal
            phone, a meeting, a WhatsApp exchange.
          </p>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <select
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              {['call', 'email', 'whatsapp', 'meeting', 'comment'].map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="Summary"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </div>
          <textarea
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            rows={2}
            placeholder="What happened? (optional)"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              onClick={() => log.mutate()}
              disabled={log.isPending || (!draft.subject && !draft.body)}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setLogging(false)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : !items.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {kind ? 'Nothing of that kind yet.' : 'Nothing has happened here yet.'}
        </p>
      ) : (
        <ol className="relative space-y-4 border-l pl-6">
          {items.map((a) => {
            const Icon = ICONS[a.kind] ?? Settings
            return (
              <li key={a.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-background',
                    TONES[a.kind] ?? TONES.system,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{a.subject || a.kind}</p>
                    <time
                      className="text-xs text-muted-foreground"
                      title={new Date(a.occurredAt).toLocaleString('en-IN')}
                    >
                      {when(a.occurredAt)}
                    </time>
                  </div>
                  {a.body && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                  )}
                  {a.actor && (
                    <p className="mt-1.5 text-xs text-muted-foreground">by {a.actor.name}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full rounded-lg border py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load older'}
        </button>
      )}
    </div>
  )
}
