import { useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, Building2, Users, Target, Pencil, Check, X, Mail, Phone, CalendarDays,
  IndianRupee, Files, Trash2, UserPlus, Loader2, ExternalLink, Clock, Handshake,
} from 'lucide-react'
import { projectsApi, PROJECT_STATUSES, PROJECT_PRIORITIES, OPEN_STATUSES, type ProjectDetail as ProjectDetailT, type ProjectStatus } from '@/lib/projects-api'
import { useAuthStore } from '@/stores/auth.store'
import { formatMoney } from '@/lib/deals-api'
import { ProjectThread } from '@/components/projects/ProjectThread'
import { StatusBadge, PriorityMark, Person, TeamMemberPicker, AttachmentGrid, FilePicker, PendingFiles, Menu, when } from '@/components/projects/bits'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'

/**
 * One project.
 *
 * The thread is the page — it takes the wide column and stays put. Everything
 * else (the brief, who has it, the client, the files) sits in the side column
 * and is editable in place, because sending somebody to a separate settings
 * screen to fix a client's email address is how the wrong address gets used.
 */
export default function ProjectDetail() {
  const { projectId } = useParams({ from: '/app/projects/$projectId' })
  const id = Number(projectId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const hasDeals = useAuthStore((s) => s.hasFeature)('deals')

  const { data: project, isLoading } = useQuery({
    queryKey: ['projects', id],
    queryFn: () => projectsApi.get(id),
    refetchInterval: 45_000,
  })

  const [statusNote, setStatusNote] = useState<{ status: ProjectStatus; note: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['projects', id] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const setStatus = useMutation({
    mutationFn: ({ status, note }: { status: ProjectStatus; note: string }) => projectsApi.setStatus(id, status, note || null),
    onSuccess: () => {
      toast.success('Status updated')
      setStatusNote(null)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update'),
  })

  const toDeal = useMutation({
    mutationFn: () => projectsApi.toDeal(id),
    onSuccess: (r) => {
      toast.success(`Opened as deal ${r.dealNumber ?? ''} — raise the quote from there`)
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['deals'] })
      navigate({ to: '/app/deals/$dealId', params: { dealId: String(r.dealId) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not open a deal'),
  })

  const remove = useMutation({
    mutationFn: () => projectsApi.remove(id),
    onSuccess: () => {
      toast.success('Project deleted')
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate({ to: '/app/projects' })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not delete'),
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!project) return <div className="py-12 text-center text-muted-foreground">Project not found</div>

  const canDelete = isAdmin() || project.ownerId === me?.id || project.createdById === me?.id
  const overdue = project.dueDate && OPEN_STATUSES.includes(project.status) && new Date(project.dueDate) < new Date()

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link to="/app/projects" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> All projects
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted-foreground">{project.projectNumber}</span>
              <StatusBadge status={project.status} />
              <PriorityMark priority={project.priority} />
              {overdue && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                  <Clock className="h-3 w-3" /> overdue
                </span>
              )}
            </div>
            <h1 className="mt-1 text-xl font-bold leading-tight">{project.title}</h1>
            {project.summary && <p className="mt-1 text-sm text-muted-foreground">{project.summary}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {project.account && (
                <Link to="/app/accounts/$accountId" params={{ accountId: String(project.account.id) }} className="inline-flex items-center gap-1 hover:text-primary">
                  <Building2 className="h-3.5 w-3.5" /> {project.account.name}
                </Link>
              )}
              {project.lead && (
                <Link to="/app/leads/$leadId" params={{ leadId: String(project.lead.id) }} className="inline-flex items-center gap-1 hover:text-primary">
                  <ExternalLink className="h-3.5 w-3.5" /> Lead: {project.lead.name}
                </Link>
              )}
              {project.deal && (
                <Link to="/app/deals/$dealId" params={{ dealId: String(project.deal.id) }} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <Handshake className="h-3.5 w-3.5" /> Deal {project.deal.dealNumber ?? project.deal.name}
                </Link>
              )}
              {project.dueDate && (
                <span className={cn('inline-flex items-center gap-1', overdue && 'text-rose-600')}>
                  <CalendarDays className="h-3.5 w-3.5" /> due {new Date(project.dueDate).toLocaleDateString('en-IN')}
                </span>
              )}
              {project.budget != null && project.budget > 0 && (
                <span className="inline-flex items-center gap-1">
                  <IndianRupee className="h-3.5 w-3.5" /> {formatMoney(project.budget, project.currency)}
                </span>
              )}
              <span>opened {when(project.createdAt)}{project.createdBy ? ` by ${project.createdBy.name}` : ''}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasDeals && !project.dealId && (
              <button
                onClick={() => toDeal.mutate()}
                disabled={toDeal.isPending}
                title={project.status === 'approved' ? 'The client approved it — open the deal and quote it' : 'Open a deal for this project now'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50',
                  project.status === 'approved' ? 'bg-emerald-600 text-white' : 'border hover:bg-accent',
                )}
              >
                <Handshake className="h-3.5 w-3.5" /> {project.status === 'approved' ? 'Open the deal' : 'Open a deal'}
              </button>
            )}
            <Menu
              label="Set status"
              items={PROJECT_STATUSES.filter((s) => s.value !== project.status).map((s) => ({
                label: s.label,
                onClick: () => setStatusNote({ status: s.value, note: '' }),
              }))}
            />
            {canDelete && (
              <button onClick={() => setConfirmDelete(true)} className="rounded-lg border p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600" title="Delete project">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {statusNote && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="min-w-[220px] flex-1">
              <p className="mb-1 text-xs text-muted-foreground">
                Mark as <span className="font-semibold text-foreground">{PROJECT_STATUSES.find((s) => s.value === statusNote.status)?.label}</span>
                {' '}— add a note for the thread (optional)
              </p>
              <input
                autoFocus
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                placeholder="Why, or what happens next"
                value={statusNote.note}
                onChange={(e) => setStatusNote({ ...statusNote, note: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && setStatus.mutate(statusNote)}
              />
            </div>
            <button onClick={() => setStatus.mutate(statusNote)} disabled={setStatus.isPending} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Confirm
            </button>
            <button onClick={() => setStatusNote(null)} className="rounded-lg border px-3 py-2 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <ProjectThread project={project} />
        </div>

        <aside className="space-y-4">
          <BriefPanel project={project} onSaved={refresh} />
          <AssignmentPanel project={project} onSaved={refresh} />
          <ClientPanel project={project} onSaved={refresh} />
          <FilesPanel project={project} onSaved={refresh} />
        </aside>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title="Delete this project?"
        message={`${project.projectNumber} and its whole thread will be hidden. This does not delete any email that was already sent.`}
        confirmText="Delete"
      />
    </div>
  )
}

// ─── Side panels ──────────────────────────────────────────────────────────────

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'
const label = 'mb-1 block text-xs font-medium text-muted-foreground'

function Panel({ icon: Icon, title, action, children }: { icon: React.ComponentType<{ className?: string }>; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </div>
  )
}

function EditButton({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent" title={editing ? 'Cancel' : 'Edit'}>
      {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
    </button>
  )
}

function BriefPanel({ project, onSaved }: { project: ProjectDetailT; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    title: project.title,
    summary: project.summary ?? '',
    description: project.description ?? '',
    priority: project.priority,
    budget: project.budget ?? ('' as number | ''),
    dueDate: project.dueDate ? project.dueDate.slice(0, 10) : '',
  })

  const save = useMutation({
    mutationFn: () =>
      projectsApi.update(project.id, {
        title: form.title,
        summary: form.summary || null,
        description: form.description || null,
        priority: form.priority,
        budget: form.budget === '' ? null : Number(form.budget),
        dueDate: form.dueDate || null,
      }),
    onSuccess: () => {
      toast.success('Saved')
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  return (
    <Panel icon={Target} title="The brief" action={<EditButton editing={editing} onClick={() => setEditing((v) => !v)} />}>
      {editing ? (
        <div className="space-y-2.5">
          <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className={input} placeholder="One-line summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          <textarea className={cn(input, 'min-h-[140px] resize-y')} placeholder="Scope, stack, timeline, budget…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as ProjectDetailT['priority'] })}>
              {PROJECT_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input className={input} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            <input className={cn(input, 'col-span-2')} type="number" min={0} placeholder="Budget" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value === '' ? '' : Number(e.target.value) })} />
          </div>
          <button onClick={() => save.mutate()} disabled={!form.title.trim() || save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Save
          </button>
        </div>
      ) : project.description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{project.description}</p>
      ) : (
        <button onClick={() => setEditing(true)} className="w-full rounded-lg border border-dashed px-3 py-3 text-left text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
          No brief written yet. Add the scope so whoever picks this up knows what they are quoting for.
        </button>
      )}
    </Panel>
  )
}

function AssignmentPanel({ project, onSaved }: { project: ProjectDetailT; onSaved: () => void }) {
  const [editing, setEditing] = useState(!project.assigneeId)
  const [pick, setPick] = useState<{ teamId: number | null; assigneeId: number | null }>({ teamId: project.teamId, assigneeId: project.assigneeId })
  const [note, setNote] = useState('')

  const assign = useMutation({
    mutationFn: () => projectsApi.assign(project.id, { teamId: pick.teamId, assigneeId: pick.assigneeId!, note: note || null }),
    onSuccess: () => {
      toast.success('Assigned')
      setEditing(false)
      setNote('')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not assign'),
  })

  return (
    <Panel
      icon={Users}
      title="Who has it"
      action={project.assigneeId ? <EditButton editing={editing} onClick={() => setEditing((v) => !v)} /> : null}
    >
      <div className="space-y-3">
        <Person user={project.owner} label="Owner (talks to the client)" />
        {!editing ? (
          <Person
            user={project.assignee}
            label={project.team ? `Assigned · ${project.team.name}` : 'Assigned to'}
            sub={project.assignee ? (project.lastInternalAt ? `last activity ${when(project.lastInternalAt)}` : undefined) : undefined}
          />
        ) : (
          <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {project.assigneeId ? 'Hand it to somebody else' : 'Pick a department and one of its active members.'}
            </p>
            <TeamMemberPicker teamId={pick.teamId} assigneeId={pick.assigneeId} onChange={setPick} />
            <textarea className={cn(input, 'min-h-[60px] resize-y')} placeholder="A note for them (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              onClick={() => assign.mutate()}
              disabled={!pick.assigneeId || assign.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" /> {project.assigneeId ? 'Reassign' : 'Assign'}
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}

function ClientPanel({ project, onSaved }: { project: ProjectDetailT; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    clientName: project.clientName ?? '',
    clientEmail: project.clientEmail ?? '',
    clientCc: project.clientCc ?? '',
    mailGroupId: project.mailGroupId,
  })
  const { data: meta } = useQuery({ queryKey: ['projects', 'meta'], queryFn: projectsApi.meta, staleTime: 60_000 })

  const save = useMutation({
    mutationFn: () => projectsApi.update(project.id, { ...form, clientName: form.clientName || null, clientEmail: form.clientEmail || null, clientCc: form.clientCc || null }),
    onSuccess: () => {
      toast.success('Saved')
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  return (
    <Panel icon={Mail} title="The client" action={<EditButton editing={editing} onClick={() => setEditing((v) => !v)} />}>
      {editing ? (
        <div className="space-y-2.5">
          <div>
            <label className={label}>Name</label>
            <input className={input} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          </div>
          <div>
            <label className={label}>Email</label>
            <input className={input} type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
          </div>
          <div>
            <label className={label}>CC</label>
            <input className={input} value={form.clientCc} onChange={(e) => setForm({ ...form, clientCc: e.target.value })} />
          </div>
          <div>
            <label className={label}>Send from</label>
            <select className={input} value={form.mailGroupId ?? ''} onChange={(e) => setForm({ ...form, mailGroupId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Default mailbox (replies not tracked)</option>
              {(meta?.mailboxes ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name} · {m.fromEmail}{m.canReceive ? '' : ' (send only)'}</option>
              ))}
            </select>
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Save
          </button>
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</dt>
            <dd className="font-medium">{project.clientName || project.contact?.fullName || project.account?.name || <span className="text-muted-foreground">—</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Email</dt>
            <dd className="truncate">
              {project.clientEmail ? (
                <a href={`mailto:${project.clientEmail}`} className="hover:text-primary">{project.clientEmail}</a>
              ) : (
                <span className="text-amber-700">No email yet — add one before sending.</span>
              )}
            </dd>
          </div>
          {project.clientCc && (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">CC</dt>
              <dd className="truncate text-xs">{project.clientCc}</dd>
            </div>
          )}
          {(project.contact?.mobile || project.lead?.mobile || project.account?.phone) && (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Phone</dt>
              <dd className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {project.contact?.mobile || project.lead?.mobile || project.account?.phone}</dd>
            </div>
          )}
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Mailbox</dt>
            <dd className="text-xs">
              {project.mailbox ? (
                <>
                  {project.mailbox.name} · {project.mailbox.fromEmail}
                  {project.mailbox.canReceive ? <span className="ml-1 text-emerald-600">replies tracked</span> : <span className="ml-1 text-amber-700">send only</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Default — replies are not tracked</span>
              )}
            </dd>
          </div>
          {project.sentToClientAt && (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Timeline</dt>
              <dd className="text-xs text-muted-foreground">
                first sent {when(project.sentToClientAt)}
                {project.lastClientReplyAt && ` · last reply ${when(project.lastClientReplyAt)}`}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Panel>
  )
}

function FilesPanel({ project, onSaved }: { project: ProjectDetailT; onSaved: () => void }) {
  const [pending, setPending] = useState<File[]>([])
  const { data: meta } = useQuery({ queryKey: ['projects', 'meta'], queryFn: projectsApi.meta, staleTime: 60_000 })

  const upload = useMutation({
    mutationFn: () => projectsApi.uploadFiles(project.id, pending),
    onSuccess: () => {
      toast.success('Uploaded')
      setPending([])
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Upload failed'),
  })
  const remove = useMutation({
    mutationFn: (fileId: number) => projectsApi.removeFile(project.id, fileId),
    onSuccess: onSaved,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not remove'),
  })

  return (
    <Panel icon={Files} title={`Files${project.files.length ? ` · ${project.files.length}` : ''}`}>
      <AttachmentGrid files={project.files} dense onRemove={(f) => remove.mutate(f.id)} />
      {!project.files.length && <p className="text-xs text-muted-foreground">Nothing attached yet. Everything sent or received on the thread lands here too.</p>}
      <FilePicker onPick={(f) => setPending((cur) => [...cur, ...f])} maxBytes={meta?.maxUploadBytes} className="mt-2">
        <PendingFiles files={pending} onRemove={(i) => setPending((cur) => cur.filter((_, idx) => idx !== i))} />
      </FilePicker>
      {!!pending.length && (
        <button onClick={() => upload.mutate()} disabled={upload.isPending} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Upload {pending.length}
        </button>
      )}
    </Panel>
  )
}
