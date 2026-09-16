import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, X, LayoutGrid, AlertTriangle, Search, List, Kanban, Clock, Flame } from 'lucide-react'
import {
  dealsApi, pipelinesApi, productsApi, formatMoney, compactMoney,
  type Deal, type BoardColumn, type Product,
} from '@/lib/deals-api'
import { leadsApi } from '@/lib/api'
import { usersApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { useLabels } from '@/hooks/useLabels'
import { LostDealModal } from '@/components/crm/LostDealModal'
import { StatusPill } from '@/components/crm/DocumentLines'
import { cn } from '@/lib/utils'
import type { Lead } from '@/types'

/**
 * The deal board.
 *
 * Drag a card to move it. Dragging into a Lost column opens a reason picker
 * first — "why do we lose?" is unanswerable a month later if it is optional now,
 * so the API refuses a loss without one and this asks before sending.
 *
 * Search, owner and "mine" narrow the board; the list view is the same deals
 * as a sortable table for when a column has fifty cards in it. A card that
 * nobody has touched in two weeks says so — that is the single fact that
 * separates a pipeline from a graveyard.
 */

const STALE_DAYS = 14

export default function Deals() {
  const qc = useQueryClient()
  const t = useLabels()
  const me = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore((s) => s.isAdmin)

  const [pipelineId, setPipelineId] = useState<number | undefined>()
  const [view, setView] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [mine, setMine] = useState(false)
  const [onlyStale, setOnlyStale] = useState(false)
  const [creating, setCreating] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [overStage, setOverStage] = useState<number | null>(null)
  const [losing, setLosing] = useState<{ deal: Deal; stageId: number } | null>(null)

  const { data: pipelines = [] } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list })
  const { data: owners = [] } = useQuery({
    queryKey: ['users', 'counsellors'],
    queryFn: usersApi.counsellors,
    enabled: isAdmin() || me?.role === 'sales-head',
  })
  const { data: board, isLoading, error } = useQuery({
    queryKey: ['deals', 'board', { pipelineId, search, ownerId, mine }],
    queryFn: () => dealsApi.board({ pipelineId, search: search || undefined, ownerId: ownerId || undefined, mine: mine ? 1 : undefined }),
    retry: false,
  })
  const { data: forecast } = useQuery({
    queryKey: ['deals', 'forecast', pipelineId],
    queryFn: () => dealsApi.forecast({ pipelineId }),
    retry: false,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['deals'] })

  const move = useMutation({
    mutationFn: ({ id, stageId, lost }: { id: number; stageId: number; lost?: { lostReasonId: number; lostNotes?: string } }) =>
      dealsApi.moveStage(id, stageId, lost),
    onSuccess: () => {
      setLosing(null)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move that deal'),
  })

  function drop(stage: BoardColumn) {
    setOverStage(null)
    const id = dragging
    setDragging(null)
    if (id == null) return
    const deal = board?.stages.flatMap((s) => s.deals).find((d) => d.id === id)
    if (!deal || deal.stageId === stage.id) return
    if (stage.isLost) {
      setLosing({ deal, stageId: stage.id })
      return
    }
    move.mutate({ id, stageId: stage.id })
  }

  const isStale = (d: Deal) =>
    !d.stage?.isWon && !d.stage?.isLost && !!d.lastActivityAt && Date.now() - new Date(d.lastActivityAt).getTime() > STALE_DAYS * 86_400_000

  // Client-side narrowing the board already fetched; the server took care of
  // search/owner/mine, staleness is a fact about the cards we have.
  const stages = useMemo(
    () => (board?.stages ?? []).map((s) => ({ ...s, deals: onlyStale ? s.deals.filter(isStale) : s.deals })),
    [board, onlyStale],
  )
  const allDeals = useMemo(() => stages.flatMap((s) => s.deals), [stages])
  const staleCount = useMemo(() => (board?.stages ?? []).flatMap((s) => s.deals).filter(isStale).length, [board])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noPipeline = (error as any)?.response?.status === 404

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.plural('deal')}</h1>
          {board && <p className="text-sm text-muted-foreground">{board.pipeline.name}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 && (
            <select
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              value={pipelineId ?? ''}
              onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">Default pipeline</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New {t('deal').toLowerCase()}
          </button>
        </div>
      </div>

      {forecast && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Stat label="Open" value={formatMoney(forecast.openValue)} sub={`${forecast.openCount} open`} />
          <Stat label="Weighted" value={formatMoney(forecast.weightedValue)} sub="value × probability" accent />
          <Stat label="Confirmed" value={formatMoney(forecast.wonValue)} sub={`${forecast.wonCount} confirmed`} />
          <Stat label="Win rate" value={forecast.winRate == null ? '—' : `${forecast.winRate}%`} sub="of decided deals" />
          <Stat label="Avg cycle" value={forecast.averageCycleDays == null ? '—' : `${forecast.averageCycleDays}d`} sub="open to close" />
          <button onClick={() => setOnlyStale((v) => !v)} className="text-left">
            <Stat label="Going cold" value={String(staleCount)} sub={`untouched ${STALE_DAYS}+ days`} warn={staleCount > 0} active={onlyStale} />
          </button>
        </div>
      )}

      {!noPipeline && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-8 text-sm"
              placeholder="Search deals by name or number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button>
            )}
          </div>
          {!!owners.length && (
            <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setMine(false) }}>
              <option value="">Every owner</option>
              {owners.map((u: { id: number; name: string }) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
          <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); if (e.target.checked) setOwnerId('') }} /> My deals
          </label>
          <div className="ml-auto inline-flex rounded-lg border p-0.5">
            <button onClick={() => setView('board')} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', view === 'board' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')} title="Board">
              <Kanban className="h-3.5 w-3.5" /> Board
            </button>
            <button onClick={() => setView('list')} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')} title="List">
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>
        </div>
      )}

      {noPipeline ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <LayoutGrid className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No pipeline set up yet</p>
          <p className="mt-1 text-sm text-muted-foreground">A pipeline defines the stages a {t('deal').toLowerCase()} moves through.</p>
          <Link to="/app/pipelines" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Set one up →</Link>
        </div>
      ) : isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading board…</p>
      ) : view === 'list' ? (
        <DealTable deals={allDeals} stale={isStale} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id) }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => drop(stage)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors',
                overStage === stage.id && 'border-primary bg-primary/5',
                stage.isWon && 'border-emerald-200',
                stage.isLost && 'border-rose-200',
              )}
            >
              <div className="border-b p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{stage.name}</p>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{stage.deals.length}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {compactMoney(stage.deals.reduce((s, d) => s + (d.value ?? 0), 0))}
                  {!stage.isWon && !stage.isLost && stage.probability > 0 && (
                    <span className="ml-1 opacity-70">· {stage.probability}% · {compactMoney(stage.weightedValue)} weighted</span>
                  )}
                </p>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {!stage.deals.length && <p className="py-6 text-center text-xs text-muted-foreground/60">Drop here</p>}
                {stage.deals.map((d) => (
                  <DealCard key={d.id} deal={d} stale={isStale(d)} onDragStart={() => setDragging(d.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <NewDealModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh() }}
          pipelines={pipelines}
          defaultPipelineId={pipelineId}
        />
      )}

      {losing && (
        <LostDealModal
          dealName={losing.deal.name}
          pending={move.isPending}
          title={`Mark “${losing.deal.name}” dropped`}
          confirmLabel="Mark dropped"
          onCancel={() => setLosing(null)}
          onConfirm={(lostReasonId, lostNotes) => move.mutate({ id: losing.deal.id, stageId: losing.stageId, lost: { lostReasonId, lostNotes } })}
        />
      )}
    </div>
  )
}

function Stat({ label, value, sub, accent, warn, active }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean; active?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', accent && 'border-primary/40 bg-primary/5', warn && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20', active && 'ring-2 ring-primary/40')}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-bold', warn && 'text-amber-700')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
}

function DealCard({ deal, stale, onDragStart }: { deal: Deal; stale: boolean; onDragStart: () => void }) {
  // A close date in the past on a still-open deal is the single most useful
  // warning a board can show — it is how forecasts quietly rot.
  const overdue = deal.expectedCloseDate && !deal.stage?.isWon && !deal.stage?.isLost && new Date(deal.expectedCloseDate) < new Date()

  return (
    <Link
      to="/app/deals/$dealId"
      params={{ dealId: String(deal.id) }}
      draggable
      onDragStart={onDragStart}
      className={cn('block cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow active:cursor-grabbing', stale && 'border-amber-200')}
    >
      <p className="truncate text-sm font-medium">{deal.name}</p>
      {deal.lead && <p className="mt-0.5 truncate text-xs text-muted-foreground">{deal.lead.name}</p>}
      {!deal.lead && deal.account && <p className="mt-0.5 truncate text-xs text-muted-foreground">{deal.account.name}</p>}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{compactMoney(deal.value, deal.currency)}</span>
        {deal.owner && <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{deal.owner.name.split(' ')[0]}</span>}
      </div>

      {deal.nextStep && <p className="mt-2 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">{deal.nextStep}</p>}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {deal.expectedCloseDate && (
          <span className={cn('inline-flex items-center gap-1', overdue ? 'font-medium text-amber-600' : 'text-muted-foreground')}>
            {overdue && <AlertTriangle className="h-3 w-3" />}
            {overdue ? 'Past close date' : `closes ${new Date(deal.expectedCloseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
          </span>
        )}
        {stale ? (
          <span className="inline-flex items-center gap-1 font-medium text-amber-600" title={`Last activity ${ago(deal.lastActivityAt)}`}>
            <Flame className="h-3 w-3" /> cold · {ago(deal.lastActivityAt)}
          </span>
        ) : (
          deal.lastActivityAt && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" /> {ago(deal.lastActivityAt)}
            </span>
          )
        )}
      </div>
    </Link>
  )
}

function DealTable({ deals, stale }: { deals: Deal[]; stale: (d: Deal) => boolean }) {
  const [sort, setSort] = useState<{ key: 'name' | 'value' | 'stage' | 'close' | 'touched'; dir: 1 | -1 }>({ key: 'value', dir: -1 })
  const sorted = useMemo(() => {
    const v = (d: Deal) =>
      sort.key === 'name' ? d.name.toLowerCase()
        : sort.key === 'value' ? d.value ?? 0
          : sort.key === 'stage' ? (d.stage?.probability ?? 0)
            : sort.key === 'close' ? (d.expectedCloseDate ? new Date(d.expectedCloseDate).getTime() : Infinity)
              : (d.lastActivityAt ? new Date(d.lastActivityAt).getTime() : 0)
    return [...deals].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir)
  }, [deals, sort])

  const th = (label: string, key: typeof sort.key, right?: boolean) => (
    <th
      className={cn('cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground', right ? 'text-right' : 'text-left')}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
    >
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  if (!deals.length) return <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">Nothing matches.</p>

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50">
          <tr>
            {th('Deal', 'name')}
            {th('Stage', 'stage')}
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Owner</th>
            {th('Close', 'close')}
            {th('Touched', 'touched')}
            {th('Value', 'value', true)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.id} className={cn('border-t hover:bg-accent/40', stale(d) && 'bg-amber-50/30 dark:bg-amber-950/10')}>
              <td className="px-3 py-2">
                <Link to="/app/deals/$dealId" params={{ dealId: String(d.id) }} className="font-medium hover:text-primary">{d.name}</Link>
                <p className="text-xs text-muted-foreground">{[d.dealNumber, d.lead?.name ?? d.account?.name].filter(Boolean).join(' · ')}</p>
              </td>
              <td className="px-3 py-2">
                <StatusPill status={d.stage?.name ?? '—'} />
                {d.stage && !d.stage.isWon && !d.stage.isLost && <span className="ml-1 text-xs text-muted-foreground">{d.probability}%</span>}
              </td>
              <td className="px-3 py-2 text-xs">{d.owner?.name ?? '—'}</td>
              <td className="px-3 py-2 text-xs">{d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString('en-IN') : '—'}</td>
              <td className={cn('px-3 py-2 text-xs', stale(d) && 'font-medium text-amber-700')}>{ago(d.lastActivityAt) || '—'}</td>
              <td className="px-3 py-2 text-right font-semibold">{formatMoney(d.value, d.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── New deal ─────────────────────────────────────────────────────────────────

export function NewDealModal({
  onClose,
  onCreated,
  pipelines,
  defaultPipelineId,
  defaults,
}: {
  onClose: () => void
  onCreated: (deal: Deal) => void
  pipelines: { id: number; name: string; isDefault: boolean; stages: { id: number; name: string; isWon: boolean; isLost: boolean }[] }[]
  defaultPipelineId?: number
  defaults?: { leadId?: number | null; leadName?: string | null; accountId?: number | null; accountName?: string | null; contactId?: number | null; name?: string; value?: number | null }
}) {
  const t = useLabels()
  const me = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const [form, setForm] = useState<Record<string, unknown>>({
    name: defaults?.name ?? '',
    leadId: defaults?.leadId ?? null,
    accountId: defaults?.accountId ?? null,
    primaryContactId: defaults?.contactId ?? null,
    value: defaults?.value ?? null,
    pipelineId: defaultPipelineId ?? pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id,
  })
  const [leadSearch, setLeadSearch] = useState('')
  const [leadName, setLeadName] = useState(defaults?.leadName ?? '')
  const [picked, setPicked] = useState<number[]>([])
  const [productSearch, setProductSearch] = useState('')

  const chosenLead = form.leadId as number | null
  const { data: leadHits } = useQuery({
    queryKey: ['leads', 'picker', leadSearch],
    queryFn: () => leadsApi.list({ search: leadSearch, limit: '10' }),
    enabled: leadSearch.length > 1 && !chosenLead,
  })
  const { data: catalogSends } = useQuery({
    queryKey: ['lead-catalog-sends', chosenLead],
    queryFn: () => leadsApi.catalogSends(chosenLead!),
    enabled: !!chosenLead,
  })
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })
  const { data: owners = [] } = useQuery({ queryKey: ['users', 'counsellors'], queryFn: usersApi.counsellors, enabled: isAdmin() })

  useEffect(() => {
    const last = catalogSends?.[0]
    const ids = (last?.items ?? []).map((i) => i.productId).filter((id): id is number => !!id)
    if (ids.length) setPicked(ids)
  }, [catalogSends])

  const create = useMutation({
    mutationFn: () =>
      dealsApi.create({
        ...form,
        products: picked.map((productId) => ({ productId, quantity: 1 })),
      }),
    onSuccess: (d) => {
      toast.success(`${t('deal')} created`)
      onCreated(d)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'
  const pipeline = pipelines.find((p) => p.id === form.pipelineId)
  const openStages = (pipeline?.stages ?? []).filter((s) => !s.isWon && !s.isLost)
  const leadRows = ((leadHits?.data ?? []) as Lead[])
  const visibleProducts = (products as Product[]).filter((p) => {
    if (!productSearch.trim()) return true
    const q = productSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">New {t('deal').toLowerCase()}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <input className={input} placeholder="Order for…" value={String(form.name ?? '')} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>

          {!defaults?.accountId && (
          <div>
            <label className="mb-1 block text-sm font-medium">Customer *</label>
            {chosenLead ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span>{leadName || `#${chosenLead}`}</span>
                <button onClick={() => { set('leadId', null); setLeadName(''); setPicked([]) }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <>
                <input className={input} placeholder="Search by name, email or mobile…" value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} />
                {!!leadRows.length && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border">
                    {leadRows.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => {
                          set('leadId', l.id)
                          setLeadName(l.name)
                          setLeadSearch('')
                          if (!String(form.name ?? '').trim()) set('name', `${l.name} — order`)
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="font-medium">{l.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{[l.email, l.mobile].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Products</label>
            <input className={`${input} mb-2`} placeholder="Search catalog…" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              {!visibleProducts.length && <p className="py-4 text-center text-xs text-muted-foreground">No products yet.</p>}
              {visibleProducts.map((p) => {
                const on = picked.includes(p.id)
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setPicked((ids) => on ? ids.filter((x) => x !== p.id) : [...ids, p.id])}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatMoney(p.unitPrice, p.currency)}</span>
                  </label>
                )
              })}
            </div>
            {!!picked.length && <p className="mt-1 text-xs text-muted-foreground">{picked.length} selected{catalogSends?.[0] ? ' · started from last catalog send' : ''}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {pipelines.length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-medium">Pipeline</label>
                <select className={input} value={String(form.pipelineId ?? '')} onChange={(e) => { set('pipelineId', Number(e.target.value)); set('stageId', undefined) }}>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {openStages.length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-medium">Starting stage</label>
                <select className={input} value={String(form.stageId ?? '')} onChange={(e) => set('stageId', e.target.value ? Number(e.target.value) : undefined)}>
                  <option value="">{openStages[0].name} (first)</option>
                  {openStages.slice(1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {isAdmin() && !!owners.length && (
              <div>
                <label className="mb-1 block text-sm font-medium">Owner</label>
                <select className={input} value={String(form.ownerId ?? me?.id ?? '')} onChange={(e) => set('ownerId', e.target.value ? Number(e.target.value) : null)}>
                  {me && !owners.some((u: { id: number }) => u.id === me.id) && <option value={me.id}>{me.name} (me)</option>}
                  {owners.map((u: { id: number; name: string }) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!String(form.name ?? '').trim() || (!chosenLead && !form.accountId) || create.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
