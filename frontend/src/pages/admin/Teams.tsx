import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Users, Pencil, Check, X, Search, Crown, UserMinus, Power } from 'lucide-react'
import { teamsApi, type Team, type TeamMember } from '@/lib/projects-api'
import { usersApi } from '@/lib/api'
import { Modal } from '@/components/common/Modal'
import { Avatar } from '@/components/projects/bits'
import { cn } from '@/lib/utils'

/**
 * Teams — the departments a project can be handed to, and who is in each.
 *
 * This is the list the assignment picker reads, live: put somebody in IT here
 * and every rep can hand them a brief a second later; take them out and they
 * stop being offered. Membership is the only thing that needs maintaining.
 */
export default function Teams() {
  const qc = useQueryClient()
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const [membersFor, setMembersFor] = useState<Team | null>(null)

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['teams', { showInactive }],
    queryFn: () => teamsApi.list(showInactive),
  })

  const toggle = useMutation({
    mutationFn: (t: Team) => teamsApi.update(t.id, { active: !t.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update'),
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-sm text-muted-foreground">Departments a project can be assigned to, and the people in them.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
          <button onClick={() => setEditing('new')} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New team
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !teams.length ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No teams yet. Add IT, Digital Marketing, Design — whoever projects go to.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <div key={t.id} className={cn('rounded-xl border bg-card p-4', !t.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color || '#94a3b8' }} />
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{t.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.members.filter((m) => m.active).length} member{t.members.filter((m) => m.active).length === 1 ? '' : 's'} · {t.projectCount} project{t.projectCount === 1 ? '' : 's'}
                      {!t.active && ' · inactive'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => setEditing(t)} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => toggle.mutate(t)} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent" title={t.active ? 'Deactivate' : 'Reactivate'}><Power className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {t.description && <p className="mt-2 text-xs text-muted-foreground">{t.description}</p>}

              <div className="mt-3 space-y-1.5">
                {t.members.length ? (
                  t.members.map((m) => <MemberRow key={m.id} m={m} />)
                ) : (
                  <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">Nobody in this team yet — reps cannot assign to it until someone is.</p>
                )}
              </div>

              <button onClick={() => setMembersFor(t)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                <Users className="h-3.5 w-3.5" /> Manage members
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && <TeamForm team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {membersFor && <MembersModal team={membersFor} onClose={() => setMembersFor(null)} />}
    </div>
  )
}

function MemberRow({ m }: { m: TeamMember }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5', !m.active && 'opacity-50')}>
      <Avatar user={m} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{m.name}{!m.active && <span className="ml-1 text-[10px] text-muted-foreground">(deactivated)</span>}</p>
        {m.designation && <p className="truncate text-[11px] text-muted-foreground">{m.designation}</p>}
      </div>
      {m.memberRole === 'lead' && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Team lead" />}
    </div>
  )
}

function TeamForm({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: team?.name ?? '',
    description: team?.description ?? '',
    color: team?.color ?? '#2563eb',
    priority: team?.priority ?? 0,
  })

  const save = useMutation({
    mutationFn: () => (team ? teamsApi.update(team.id, form) : teamsApi.create(form)),
    onSuccess: () => {
      toast.success(team ? 'Team updated' : 'Team created')
      qc.invalidateQueries({ queryKey: ['teams'] })
      onClose()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={team ? 'Edit team' : 'New team'}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Check className="mr-1 inline h-4 w-4" /> Save
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
          <input autoFocus className={input} placeholder="Digital Marketing" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">What they do</label>
          <input className={input} placeholder="SEO, ads, content, social" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Colour</label>
            <input type="color" className="h-9 w-full cursor-pointer rounded-lg border bg-background" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Sort order</label>
            <input type="number" className={input} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          </div>
        </div>
      </div>
    </Modal>
  )
}

interface StaffUser {
  id: number
  name: string
  email: string
  designation: string | null
  role: string
  status: number
}

function MembersModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [members, setMembers] = useState<Map<number, 'lead' | 'member'>>(
    () => new Map(team.members.map((m) => [m.id, m.memberRole])),
  )

  const { data: users = [] } = useQuery({
    queryKey: ['users', { forTeams: true }],
    queryFn: () => usersApi.list() as Promise<StaffUser[]>,
    staleTime: 60_000,
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => u.status === 1 && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.designation ?? '').toLowerCase().includes(q)))
  }, [users, search])

  const save = useMutation({
    mutationFn: () => teamsApi.setMembers(team.id, [...members.entries()].map(([userId, role]) => ({ userId, role }))),
    onSuccess: () => {
      toast.success('Members saved')
      qc.invalidateQueries({ queryKey: ['teams'] })
      onClose()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const setRole = (id: number, role: 'lead' | 'member' | null) =>
    setMembers((cur) => {
      const next = new Map(cur)
      if (role) next.set(id, role)
      else next.delete(id)
      return next
    })

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${team.name} · members`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{members.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button>
          </div>
        </div>
      }
    >
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input className="w-full rounded-lg border bg-background py-2 pl-9 pr-8 text-sm" placeholder="Search staff…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button>}
      </div>
      <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
        {filtered.map((u) => {
          const role = members.get(u.id) ?? null
          return (
            <div key={u.id} className={cn('flex items-center gap-2.5 rounded-lg border px-2.5 py-2', role && 'border-primary/40 bg-primary/5')}>
              <input type="checkbox" checked={!!role} onChange={(e) => setRole(u.id, e.target.checked ? 'member' : null)} />
              <Avatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{u.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{[u.designation, u.role].filter(Boolean).join(' · ')}</p>
              </div>
              {role && (
                <button
                  onClick={() => setRole(u.id, role === 'lead' ? 'member' : 'lead')}
                  className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', role === 'lead' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'text-muted-foreground hover:bg-accent')}
                  title="Toggle team lead"
                >
                  <Crown className="h-3 w-3" /> {role === 'lead' ? 'Team lead' : 'Make lead'}
                </button>
              )}
              {role && (
                <button onClick={() => setRole(u.id, null)} className="rounded p-1 text-muted-foreground hover:text-rose-600" title="Remove"><UserMinus className="h-3.5 w-3.5" /></button>
              )}
            </div>
          )
        })}
        {!filtered.length && <p className="py-6 text-center text-sm text-muted-foreground">Nobody matches.</p>}
      </div>
    </Modal>
  )
}
