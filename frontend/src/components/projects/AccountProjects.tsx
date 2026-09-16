import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Plus, ArrowRight } from 'lucide-react'
import type { Account } from '@/lib/crm-api'
import { projectsApi, OPEN_STATUSES } from '@/lib/projects-api'
import { NewProjectModal } from './NewProjectModal'
import { StatusBadge, PriorityMark, Avatar, when } from './bits'
import { cn } from '@/lib/utils'

/** The Projects tab on the Account 360. */
export function AccountProjects({ account }: { account: Account }) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['projects', { accountId: account.id }],
    queryFn: () => projectsApi.list({ accountId: account.id, status: undefined, limit: 50 }),
  })

  const rows = data?.data ?? []
  const open = rows.filter((p) => OPEN_STATUSES.includes(p.status))
  const done = rows.filter((p) => !OPEN_STATUSES.includes(p.status))

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>

  const newButton = (
    <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
      <Plus className="h-4 w-4" /> New project
    </button>
  )

  const primary = account.keyContacts?.[0]
  const modal = creating && (
    <NewProjectModal
      open
      onClose={() => setCreating(false)}
      defaults={{
        accountId: account.id,
        contactId: primary?.id ?? null,
        clientName: primary?.fullName ?? account.name,
        clientEmail: primary?.email ?? account.email ?? '',
      }}
      onCreated={() => qc.invalidateQueries({ queryKey: ['projects'] })}
    />
  )

  if (!rows.length) {
    return (
      <>
        <div className="rounded-xl border border-dashed py-12 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No projects for {account.name} yet.</p>
          <div className="mt-4">{newButton}</div>
        </div>
        {modal}
      </>
    )
  }

  const list = (items: typeof rows) => (
    <div className="space-y-1.5">
      {items.map((p) => (
        <Link
          key={p.id}
          to="/app/projects/$projectId"
          params={{ projectId: String(p.id) }}
          className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5 text-sm transition-colors hover:border-primary/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-semibold text-muted-foreground">{p.projectNumber}</span>
              <StatusBadge status={p.status} />
              <PriorityMark priority={p.priority} />
            </div>
            <p className="truncate font-medium">{p.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[p.team?.name, p.assignee ? `with ${p.assignee.name}` : null, `${p.messageCount} messages`, when(p.updatedAt)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex -space-x-2">
            {p.owner && <Avatar user={p.owner} size="sm" />}
            {p.assignee && <Avatar user={p.assignee} size="sm" />}
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Open · {open.length}</h3>
        {newButton}
      </div>
      {open.length ? list(open) : <p className="text-sm text-muted-foreground">Nothing open.</p>}
      {!!done.length && (
        <div className={cn('space-y-2 border-t pt-4')}>
          <h3 className="text-sm font-semibold text-muted-foreground">Finished · {done.length}</h3>
          {list(done)}
        </div>
      )}
      {modal}
    </div>
  )
}
