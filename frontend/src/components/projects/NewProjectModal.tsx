import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal } from '@/components/common/Modal'
import { projectsApi, PROJECT_PRIORITIES, type CreateProjectBody, type ProjectDetail } from '@/lib/projects-api'
import { TeamMemberPicker } from './bits'
import { cn } from '@/lib/utils'

/**
 * Open a project.
 *
 * One form, three steps a rep reads top to bottom: what it is, who does it,
 * who it is for. Everything after the title is optional — a brief typed in a
 * hurry between calls is worth more than a complete form nobody fills in.
 *
 * `defaults` is how the lead panel and the account page pre-fill the origin
 * and the client's address, so opening a project from a lead is two clicks.
 */
export function NewProjectModal({
  open,
  onClose,
  onCreated,
  defaults,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (project: ProjectDetail) => void
  defaults?: Partial<CreateProjectBody>
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<CreateProjectBody>(() => ({
    title: '',
    summary: '',
    description: '',
    priority: 'medium',
    currency: 'INR',
    ...defaults,
  }))

  const { data: meta } = useQuery({ queryKey: ['projects', 'meta'], queryFn: projectsApi.meta, enabled: open, staleTime: 60_000 })

  const set = <K extends keyof CreateProjectBody>(k: K, v: CreateProjectBody[K]) => setForm((f) => ({ ...f, [k]: v }))

  const create = useMutation({
    mutationFn: () =>
      projectsApi.create({
        ...form,
        title: form.title.trim(),
        summary: form.summary?.trim() || null,
        description: form.description?.trim() || null,
        clientName: form.clientName?.trim() || null,
        clientEmail: form.clientEmail?.trim() || null,
        clientCc: form.clientCc?.trim() || null,
        note: form.note?.trim() || null,
        budget: form.budget ?? null,
        dueDate: form.dueDate || null,
      }),
    onSuccess: (p) => {
      toast.success(`${p.projectNumber} opened`)
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['lead-business'] })
      onCreated?.(p)
      onClose()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not open the project'),
  })

  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'
  const label = 'mb-1 block text-xs font-medium text-muted-foreground'

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="New project"
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!form.title.trim() || create.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {create.isPending ? 'Opening…' : form.assigneeId ? 'Open & assign' : 'Open project'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What is it</h4>
          <div>
            <label className={label}>Title</label>
            <input
              className={input}
              autoFocus
              placeholder="Inventory and POS rollout across 40 stores"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </div>
          <div>
            <label className={label}>One-line summary</label>
            <input
              className={input}
              placeholder="What the list should say about it"
              value={form.summary ?? ''}
              onChange={(e) => set('summary', e.target.value)}
            />
          </div>
          <div>
            <label className={label}>The brief</label>
            <textarea
              className={cn(input, 'min-h-[120px] resize-y')}
              placeholder="Scope, stack, integrations, timeline, budget — whatever the client told you."
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Priority</label>
              <select className={input} value={form.priority} onChange={(e) => set('priority', e.target.value as CreateProjectBody['priority'])}>
                {PROJECT_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Budget (indicative)</label>
              <input
                className={input}
                type="number"
                min={0}
                placeholder="0"
                value={form.budget ?? ''}
                onChange={(e) => set('budget', e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div>
              <label className={label}>Proposal due</label>
              <input className={input} type="date" value={form.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Who works on it</h4>
          <TeamMemberPicker
            compact
            teamId={form.teamId ?? null}
            assigneeId={form.assigneeId ?? null}
            onChange={({ teamId, assigneeId }) => setForm((f) => ({ ...f, teamId, assigneeId }))}
          />
          <div>
            <label className={label}>{form.assigneeId ? 'A note for them' : 'Opening note (optional)'}</label>
            <textarea
              className={cn(input, 'min-h-[70px] resize-y')}
              placeholder={form.assigneeId ? 'What you need back, and by when.' : 'Anything the thread should start with.'}
              value={form.note ?? ''}
              onChange={(e) => set('note', e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Who it is for</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Client name</label>
              <input className={input} placeholder="Filled from the lead if left blank" value={form.clientName ?? ''} onChange={(e) => set('clientName', e.target.value)} />
            </div>
            <div>
              <label className={label}>Client email</label>
              <input className={input} type="email" placeholder="Where the proposal goes" value={form.clientEmail ?? ''} onChange={(e) => set('clientEmail', e.target.value)} />
            </div>
            <div>
              <label className={label}>CC (comma separated)</label>
              <input className={input} placeholder="finance@client.com, cto@client.com" value={form.clientCc ?? ''} onChange={(e) => set('clientCc', e.target.value)} />
            </div>
            <div>
              <label className={label}>Send from</label>
              <select className={input} value={form.mailGroupId ?? ''} onChange={(e) => set('mailGroupId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Default mailbox (replies not tracked)</option>
                {(meta?.mailboxes ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.fromEmail}{m.canReceive ? '' : ' (send only)'}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pick a mailbox the inbox polls and the client's replies land on this thread by themselves.
              </p>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}
