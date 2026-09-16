import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, FolderKanban, Inbox, Mail, Clock, X, MessageSquare, Paperclip, ChevronLeft, ChevronRight } from 'lucide-react'
import { projectsApi, teamsApi, PROJECT_STATUSES, OPEN_STATUSES, type Project } from '@/lib/projects-api'
import { useAuthStore } from '@/stores/auth.store'
import { NewProjectModal } from '@/components/projects/NewProjectModal'
import { StatusBadge, PriorityMark, Avatar, when } from '@/components/projects/bits'
import { cn } from '@/lib/utils'

/**
 * Projects — the list.
 *
 * Opens on the four numbers that decide what a person does next: how many
 * are waiting on them, how many are out with clients, how many are late, how
 * many are open at all. "Waiting on me" is a filter as well as a number,
 * because it is the view a team member wants nine times out of ten.
 */
export default function Projects() {
  const me = useAuthStore((s) => s.user)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('open')
  const [teamId, setTeamId] = useState('')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const { data: summary } = useQuery({ queryKey: ['projects', 'summary'], queryFn: projectsApi.summary, refetchInterval: 60_000 })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list(), staleTime: 60_000 })

  const statusParam = status === 'open' ? OPEN_STATUSES.join(',') : status === 'all' ? undefined : status

  const { data, isLoading } = useQuery({
    queryKey: ['projects', { search, status, teamId, mine, page }],
    queryFn: () =>
      projectsApi.list({
        search: search || undefined,
        status: statusParam,
        teamId: teamId || undefined,
        mine: mine ? 1 : 0,
        page,
        limit: 25,
      }),
  })

  const rows = data?.data ?? []
  const s = summary

  const tile = (label: string, value: number | undefined, icon: React.ReactNode, onClick: () => void, active: boolean, tone?: string) => (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-primary/40',
        active && 'border-primary bg-primary/5',
      )}
    >
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone ?? 'bg-primary/10 text-primary')}>{icon}</div>
      <div>
        <p className="text-xl font-bold leading-none">{value ?? '–'}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </button>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">Briefs, the team's proposal, and the client thread — in one place.</p>
        </div>
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New project
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile('Waiting on me', s?.waitingOnMe, <Inbox className="h-4 w-4" />, () => { setMine((v) => !v); setStatus('open'); setPage(1) }, mine, 'bg-blue-500/10 text-blue-600')}
        {tile('With clients', s?.awaitingClient, <Mail className="h-4 w-4" />, () => { setStatus(status === 'sent_to_client' ? 'open' : 'sent_to_client'); setMine(false); setPage(1) }, status === 'sent_to_client', 'bg-amber-500/10 text-amber-600')}
        {tile('Overdue', s?.overdue, <Clock className="h-4 w-4" />, () => { setStatus('open'); setMine(false); setPage(1) }, false, 'bg-rose-500/10 text-rose-600')}
        {tile('Open', s?.open, <FolderKanban className="h-4 w-4" />, () => { setStatus('open'); setMine(false); setPage(1) }, status === 'open' && !mine)}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-8 text-sm"
              placeholder="Search title, number, client…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button>
            )}
          </div>
          <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="open">All open</option>
            <option value="all">Everything</option>
            {PROJECT_STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
          <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={teamId} onChange={(e) => { setTeamId(e.target.value); setPage(1) }}>
            <option value="">Every department</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1) }} /> Waiting on me
          </label>
        </div>

        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <div className="py-14 text-center">
            <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {mine ? 'Nothing is waiting on you.' : search || teamId || status !== 'open' ? 'Nothing matches.' : 'No projects yet. Open one from a lead, or here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((p) => <Row key={p.id} p={p} meId={me?.id} />)}
          </ul>
        )}

        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{data?.total} projects · page {page} of {data?.totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((x) => x - 1)} className="rounded-lg border p-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <button disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage((x) => x + 1)} className="rounded-lg border p-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>

      <NewProjectModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function Row({ p, meId }: { p: Project; meId: number | undefined }) {
  const mine = p.ballWithUserId != null && p.ballWithUserId === meId
  const overdue = p.dueDate && OPEN_STATUSES.includes(p.status) && new Date(p.dueDate) < new Date()
  return (
    <li>
      <Link
        to="/app/projects/$projectId"
        params={{ projectId: String(p.id) }}
        className={cn('flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40', mine && 'border-l-2 border-l-primary')}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-muted-foreground">{p.projectNumber}</span>
            <StatusBadge status={p.status} />
            <PriorityMark priority={p.priority} />
            {mine && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">your move</span>}
            {overdue && <span className="text-[10px] font-semibold text-rose-600">overdue</span>}
          </div>
          <p className="mt-0.5 truncate font-medium">{p.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[p.clientName, p.team?.name, p.summary].filter(Boolean).join(' · ') || 'No summary'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" title="Messages"><MessageSquare className="h-3.5 w-3.5" /> {p.messageCount}</span>
          {p.fileCount > 0 && <span className="inline-flex items-center gap-1" title="Files"><Paperclip className="h-3.5 w-3.5" /> {p.fileCount}</span>}
          <span className="hidden sm:inline">{when(p.updatedAt)}</span>
          <div className="flex -space-x-2" title={[p.owner?.name, p.assignee?.name].filter(Boolean).join(' → ')}>
            {p.owner && <Avatar user={p.owner} size="sm" />}
            {p.assignee && <Avatar user={p.assignee} size="sm" />}
          </div>
        </div>
      </Link>
    </li>
  )
}
