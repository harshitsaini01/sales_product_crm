import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Lock, Mail, Send, ArrowDownLeft, ArrowUpRight, UserPlus, ArrowRightLeft,
  Sparkles, AlertTriangle, Loader2, CornerDownRight, Paperclip,
} from 'lucide-react'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { useAuthStore } from '@/stores/auth.store'
import {
  projectsApi, safeHtml, isHtml,
  type ProjectDetail, type ProjectMessage, type ProjectFile,
} from '@/lib/projects-api'
import { Avatar, AttachmentGrid, PendingFiles, FilePicker, when } from './bits'
import { cn } from '@/lib/utils'

type Channel = 'internal' | 'external'

/**
 * The thread — both channels, one story.
 *
 * Internal messages and client emails are told apart by colour and a lock or
 * a mail icon, not by living on separate tabs: a rep reading a client's reply
 * needs the team's last note right above it. The filter chips narrow the view
 * when the thread gets long.
 *
 * The composer is one box with a switch. Internal posts to the team; Email
 * sends a real mail to the client, threaded under the previous one, with the
 * attachments attached.
 */
export function ProjectThread({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.user)
  const [view, setView] = useState<'all' | Channel>('all')
  const [channel, setChannel] = useState<Channel>(() => (project.status === 'proposal_ready' || project.status === 'client_replied' ? 'external' : 'internal'))
  const endRef = useRef<HTMLDivElement>(null)

  const messages = useMemo(
    () => project.messages.filter((m) => view === 'all' || m.channel === view),
    [project.messages, view],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [project.messages.length])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['projects', project.id] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const internalCount = project.messages.filter((m) => m.channel === 'internal' && m.kind !== 'system').length
  const externalCount = project.messages.filter((m) => m.channel === 'external').length

  return (
    <div className="flex flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
        {(
          [
            ['all', 'Everything', project.messages.length],
            ['internal', 'Team', internalCount],
            ['external', 'Client', externalCount],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              view === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            {label} {!!n && <span className="opacity-70">· {n}</span>}
          </button>
        ))}
        {project.ballWith && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
            <CornerDownRight className="h-3 w-3" />
            {project.ballWith.id === me?.id ? 'Your move' : `Waiting on ${project.ballWith.name}`}
          </span>
        )}
        {!project.ballWith && project.status === 'sent_to_client' && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            <Mail className="h-3 w-3" /> Waiting on the client
          </span>
        )}
      </div>

      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {view === 'external' ? 'Nothing has gone to the client yet.' : 'Nothing here yet — start the thread below.'}
          </p>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} mine={m.authorId != null && m.authorId === me?.id} />
        ))}
        <div ref={endRef} />
      </div>

      <Composer project={project} channel={channel} onChannel={setChannel} onDone={refresh} />
    </div>
  )
}

// ─── One message ──────────────────────────────────────────────────────────────

function Message({ m, mine }: { m: ProjectMessage; mine: boolean }) {
  const external = m.channel === 'external'
  const inbound = external && m.direction === 'in'

  if (m.kind === 'system' || m.kind === 'status' || m.kind === 'assignment') {
    const Icon = m.kind === 'assignment' ? UserPlus : m.kind === 'status' ? ArrowRightLeft : Sparkles
    return (
      <div className="flex items-start gap-2.5 px-1 py-1 text-xs text-muted-foreground">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="whitespace-pre-wrap">
            {m.author?.name && <span className="font-medium text-foreground">{m.author.name} · </span>}
            {m.body}
          </span>
          <span className="ml-2 opacity-70">{when(m.createdAt)}</span>
        </div>
      </div>
    )
  }

  const who = inbound ? (m.fromName || m.fromEmail || 'Client') : (m.author?.name ?? m.fromName ?? 'Someone')

  return (
    <div className={cn('flex gap-2.5', mine && !inbound && 'flex-row-reverse')}>
      {inbound ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-600">
          <ArrowDownLeft className="h-4 w-4" />
        </div>
      ) : (
        <Avatar user={m.author} />
      )}
      <div className={cn('min-w-0 max-w-[85%] flex-1', mine && !inbound && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-xl border px-3.5 py-2.5 text-sm',
            external
              ? inbound
                ? 'border-orange-200 bg-orange-50/60 dark:border-orange-900/50 dark:bg-orange-950/20'
                : 'border-violet-200 bg-violet-50/60 dark:border-violet-900/50 dark:bg-violet-950/20'
              : mine
                ? 'border-primary/20 bg-primary/5'
                : 'bg-muted/40',
          )}
        >
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{who}</span>
            {external ? (
              <span className="inline-flex items-center gap-1">
                {inbound ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                {inbound ? `replied${m.fromEmail ? ` from ${m.fromEmail}` : ''}` : `emailed ${m.toEmail ?? 'the client'}`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" /> internal
              </span>
            )}
            {m.kind === 'proposal' && !external && (
              <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 font-medium text-violet-700 dark:text-violet-300">proposal</span>
            )}
            <span>· {when(m.createdAt)}</span>
            {m.deliveryStatus === 'failed' && (
              <span className="inline-flex items-center gap-1 text-rose-600" title={m.errorMessage ?? ''}>
                <AlertTriangle className="h-3 w-3" /> not delivered
              </span>
            )}
            {m.deliveryStatus === 'pending' && (
              <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> sending</span>
            )}
          </div>
          {external && m.subject && <p className="mb-1 text-xs font-semibold">{m.subject}</p>}
          {isHtml(m.body) ? (
            <div
              className="max-w-none break-words leading-relaxed [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: safeHtml(m.body) }}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          )}
          {!!m.files?.length && (
            <div className="mt-2.5 border-t pt-2.5">
              <AttachmentGrid files={m.files} dense />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  project,
  channel,
  onChannel,
  onDone,
}: {
  project: ProjectDetail
  channel: Channel
  onChannel: (c: Channel) => void
  onDone: () => void
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [asProposal, setAsProposal] = useState(false)
  const [subject, setSubject] = useState('')
  const [to, setTo] = useState(project.clientEmail ?? '')
  const [cc, setCc] = useState(project.clientCc ?? '')
  const [mailGroupId, setMailGroupId] = useState<number | null>(project.mailGroupId)
  const [attachIds, setAttachIds] = useState<number[]>([])
  const [showAttach, setShowAttach] = useState(false)

  const { data: meta } = useQuery({ queryKey: ['projects', 'meta'], queryFn: projectsApi.meta, staleTime: 60_000 })

  useEffect(() => {
    setTo(project.clientEmail ?? '')
    setCc(project.clientCc ?? '')
    setMailGroupId(project.mailGroupId)
  }, [project.clientEmail, project.clientCc, project.mailGroupId])

  const lastExternal = [...project.messages].reverse().find((m) => m.channel === 'external')
  // A follow-up keeps the client's subject line, minus the token the server
  // re-appends and any "Re:" stacking; the first mail names the proposal.
  const priorSubject = lastExternal?.subject?.replace(/\s*\[PRJ-\d+\]\s*$/, '').replace(/^(re:\s*)+/i, '').trim()
  const defaultSubject = priorSubject ? `Re: ${priorSubject}` : `Proposal: ${project.title}`

  const plain = body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  const canSend = (plain.length > 0 || files.length > 0 || attachIds.length > 0) && (channel === 'internal' || /\S+@\S+/.test(to))

  const send = useMutation({
    mutationFn: async () => {
      if (channel === 'internal') {
        return projectsApi.postInternal(project.id, { body: body.trim(), kind: asProposal ? 'proposal' : 'message', files })
      }
      return projectsApi.sendExternal(project.id, {
        subject: subject.trim() || defaultSubject,
        body: body.trim(),
        to: to.trim(),
        cc: cc.trim() || undefined,
        files,
        attachFileIds: attachIds,
        mailGroupId,
      })
    },
    onSuccess: () => {
      toast.success(channel === 'internal' ? 'Posted to the team' : 'Sent to the client')
      setBody('')
      setFiles([])
      setAttachIds([])
      setAsProposal(false)
      setSubject('')
      onDone()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not send'),
  })

  const projectFiles: ProjectFile[] = project.files
  const input = 'w-full rounded-lg border bg-background px-3 py-1.5 text-sm'

  return (
    <div className="border-t p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => onChannel('internal')}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium', channel === 'internal' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
          >
            <Lock className="h-3 w-3" /> Internal
          </button>
          <button
            type="button"
            onClick={() => onChannel('external')}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium', channel === 'external' ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:bg-accent')}
          >
            <Mail className="h-3 w-3" /> Email the client
          </button>
        </div>
        {channel === 'internal' ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={asProposal} onChange={(e) => setAsProposal(e.target.checked)} />
            This is the proposal (marks it ready to send)
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">
            {lastExternal ? 'Threads under the previous email.' : 'Starts the client thread.'}
            {project.mailbox && !project.mailbox.canReceive && ' This mailbox is send-only: replies will not appear here.'}
            {!project.mailbox && ' Default mailbox: replies are not tracked — pick a polled mailbox below to get them on the thread.'}
          </span>
        )}
      </div>

      {channel === 'external' && (
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
          <input className={input} placeholder="CC (comma separated)" value={cc} onChange={(e) => setCc(e.target.value)} />
          <input className={cn(input, 'sm:col-span-2')} placeholder={defaultSubject} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <select className={cn(input, 'sm:col-span-2')} value={mailGroupId ?? ''} onChange={(e) => setMailGroupId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Send from the default mailbox (replies not tracked)</option>
            {(meta?.mailboxes ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                From {m.name} · {m.fromEmail}{m.canReceive ? ' · replies tracked' : ' · send only'}
              </option>
            ))}
          </select>
        </div>
      )}

      <FilePicker onPick={(f) => setFiles((cur) => [...cur, ...f])} maxBytes={meta?.maxUploadBytes}>
        <RichTextEditor
          value={body}
          onChange={setBody}
          minHeight={channel === 'external' ? '160px' : '90px'}
          placeholder={channel === 'internal' ? 'Write to the team… drop files anywhere here' : 'Write to the client… drop files anywhere here'}
        />
      </FilePicker>

      <div className="mt-2 space-y-2">
        <PendingFiles files={files} onRemove={(i) => setFiles((cur) => cur.filter((_, idx) => idx !== i))} />

        {channel === 'external' && !!projectFiles.length && (
          <div>
            <button type="button" onClick={() => setShowAttach((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <Paperclip className="h-3 w-3" />
              {attachIds.length ? `${attachIds.length} project file${attachIds.length === 1 ? '' : 's'} attached` : 'Attach files already on the project'}
            </button>
            {showAttach && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {projectFiles.map((f) => {
                  const on = attachIds.includes(f.id)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setAttachIds((cur) => (on ? cur.filter((x) => x !== f.id) : [...cur, f.id]))}
                      className={cn('rounded-full border px-2.5 py-1 text-[11px]', on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
                      title={f.fileName}
                    >
                      {f.fileName.length > 34 ? `${f.fileName.slice(0, 32)}…` : f.fileName}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={!canSend || send.isPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
            channel === 'internal' ? 'bg-primary' : 'bg-violet-600 hover:bg-violet-700',
          )}
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {channel === 'internal' ? 'Post to team' : 'Send email'}
        </button>
      </div>
    </div>
  )
}
