import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Star, X, GitBranch, EyeOff, Eye } from 'lucide-react'
import { pipelinesApi, type Pipeline, type PipelineStage } from '@/lib/deals-api'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * Pipelines, stages and lost reasons.
 *
 * All of it is rows rather than enums, which is the point: renaming a stage is
 * the first thing a new sales manager does, and it should never be a migration.
 */
export default function Pipelines() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)

  const { data: pipelines = [], isLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: pipelinesApi.list,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['pipelines'] })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pipelines</h1>
          <p className="text-sm text-muted-foreground">
            The stages a deal moves through. A customer can run several.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New pipeline
        </button>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !pipelines.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No pipelines yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Deals need somewhere to live. Create one to open the board.
          </p>
        </div>
      ) : (
        pipelines.map((p) => <PipelineCard key={p.id} pipeline={p} onChanged={refresh} />)
      )}

      <LostReasons />

      {creating && (
        <NewPipelineModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function PipelineCard({ pipeline, onChanged }: { pipeline: Pipeline; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [stage, setStage] = useState<Record<string, unknown>>({ name: '', probability: 0 })

  const makeDefault = useMutation({
    mutationFn: () => pipelinesApi.update(pipeline.id, { isDefault: true }),
    onSuccess: () => {
      toast.success(`New deals now land in ${pipeline.name}`)
      onChanged()
    },
  })

  const addStage = useMutation({
    mutationFn: () => pipelinesApi.addStage(pipeline.id, stage),
    onSuccess: () => {
      setStage({ name: '', probability: 0 })
      setAdding(false)
      onChanged()
    },
  })

  const updateStage = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      pipelinesApi.updateStage(pipeline.id, id, body),
    onSuccess: onChanged,
  })

  const removeStage = useMutation({
    mutationFn: (s: PipelineStage) => pipelinesApi.removeStage(pipeline.id, s.id),
    onSuccess: () => {
      toast.success('Stage removed')
      onChanged()
    },
    onError: (e: unknown) => {
      // The API refuses while deals sit in the stage and returns the count, so
      // the person can move them rather than guess why nothing happened.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (e as any)?.response?.data
      toast.error(data?.error || 'Could not remove that stage', { duration: 8000 })
    },
  })

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{pipeline.name}</h2>
            {pipeline.isDefault && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                <Star className="h-2.5 w-2.5" /> Default
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pipeline.stages.length} stages · {pipeline.dealCount ?? 0} deals
          </p>
        </div>
        <div className="flex gap-2">
          {!pipeline.isDefault && (
            <button
              onClick={() => makeDefault.mutate()}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Make default
            </button>
          )}
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Stage
          </button>
        </div>
      </div>

      {adding && (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              className={input}
              value={String(stage.name ?? '')}
              onChange={(e) => setStage({ ...stage, name: e.target.value })}
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Probability %</label>
            <input
              type="number"
              min={0}
              max={100}
              className={input}
              value={String(stage.probability ?? 0)}
              onChange={(e) => setStage({ ...stage, probability: Number(e.target.value) })}
            />
          </div>
          <button
            onClick={() => addStage.mutate()}
            disabled={!String(stage.name ?? '').trim() || addStage.isPending}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Add
          </button>
          <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-2 text-sm hover:bg-accent">
            Cancel
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {pipeline.stages.map((s) => (
          <div
            key={s.id}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border p-3',
              s.isWon && 'border-emerald-500/40 bg-emerald-500/5',
              s.isLost && 'border-red-500/40 bg-red-500/5',
              !s.active && 'opacity-60',
            )}
          >
            <input
              className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-sm font-medium focus:bg-background focus:ring-1 focus:ring-ring"
              defaultValue={s.name}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== s.name) {
                  updateStage.mutate({ id: s.id, body: { name: e.target.value.trim() } })
                }
              }}
            />

            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                className="w-16 rounded border bg-background px-2 py-1 text-right text-xs"
                defaultValue={s.probability}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (v !== s.probability) updateStage.mutate({ id: s.id, body: { probability: v } })
                }}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>

            {s.isWon && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                Won
              </span>
            )}
            {s.isLost && (
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">
                Lost
              </span>
            )}

            <div className="flex gap-1">
              <button
                onClick={() => updateStage.mutate({ id: s.id, body: { active: !s.active } })}
                title={s.active ? 'Hide this stage (deals stay put)' : 'Show again'}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent"
              >
                {s.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => removeStage.mutate(s)}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Probability drives the weighted forecast. Names save when you click away.
      </p>
    </div>
  )
}

function LostReasons() {
  const qc = useQueryClient()
  const [name, setName] = useState('')

  const { data: reasons = [] } = useQuery({ queryKey: ['lost-reasons'], queryFn: pipelinesApi.lostReasons })

  const add = useMutation({
    mutationFn: () => pipelinesApi.createLostReason(name),
    onSuccess: () => {
      setName('')
      qc.invalidateQueries({ queryKey: ['lost-reasons'] })
    },
  })

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Lost reasons</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Required when a deal is marked lost, so &ldquo;why do we lose?&rdquo; stays a
        question you can answer with a chart rather than by reading three hundred notes.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <span key={r.id} className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {r.name}
          </span>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          className={input}
          placeholder="Add a reason…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && add.mutate()}
        />
        <button
          onClick={() => add.mutate()}
          disabled={!name.trim() || add.isPending}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function NewPipelineModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  // Pre-filled with a workable process, because a pipeline with no stages has
  // no board — and because most people want to edit a starting point rather
  // than invent one from a blank list.
  const [stages, setStages] = useState([
    { name: 'New', probability: 5, isWon: false, isLost: false },
    { name: 'Qualified', probability: 25, isWon: false, isLost: false },
    { name: 'Proposal', probability: 60, isWon: false, isLost: false },
    { name: 'Negotiation', probability: 80, isWon: false, isLost: false },
    { name: 'Won', probability: 100, isWon: true, isLost: false },
    { name: 'Lost', probability: 0, isWon: false, isLost: true },
  ])

  const create = useMutation({
    mutationFn: () => pipelinesApi.create({ name, stages }),
    onSuccess: () => {
      toast.success('Pipeline created')
      onCreated()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  const setStage = (i: number, patch: Partial<(typeof stages)[number]>) =>
    setStages((s) => s.map((x, j) => (i === j ? { ...x, ...patch } : x)))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">New pipeline</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <input
              className={input}
              placeholder="Enterprise Sales"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Stages</label>
            <div className="space-y-2">
              {stages.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={input}
                    value={s.name}
                    onChange={(e) => setStage(i, { name: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="w-20 rounded-lg border bg-background px-2 py-2 text-right text-sm"
                    value={s.probability}
                    onChange={(e) => setStage(i, { probability: Number(e.target.value) })}
                  />
                  <button
                    onClick={() => setStages((x) => x.filter((_, j) => j !== i))}
                    disabled={stages.length <= 1}
                    className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setStages((s) => [...s, { name: '', probability: 50, isWon: false, isLost: false }])
              }
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              + Add stage
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || stages.some((s) => !s.name.trim()) || create.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
