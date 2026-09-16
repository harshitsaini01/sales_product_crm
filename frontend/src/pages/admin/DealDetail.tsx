import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, Building2, Save, Plus, Trash2, Package, Trophy, XCircle, Clock, CalendarDays,
  User, Phone, Mail, ExternalLink, History, FolderKanban, AlertTriangle, ArrowRight,
} from 'lucide-react'
import { formatMoney, compactMoney, dealsApi, pipelinesApi, productsApi, type Deal, type DealProduct } from '@/lib/deals-api'
import { contactsApi } from '@/lib/crm-api'
import { usersApi } from '@/lib/api'
import { projectsApi } from '@/lib/projects-api'
import { useAuthStore } from '@/stores/auth.store'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { ActivityTimeline } from '@/components/crm/ActivityTimeline'
import { CustomFieldsPanel } from '@/components/crm/CustomFieldsPanel'
import { LostDealModal } from '@/components/crm/LostDealModal'
import { ChainBar } from '@/components/crm/ChainBar'
import { StatusBadge as ProjectStatusBadge } from '@/components/projects/bits'
import { NewProjectModal } from '@/components/projects/NewProjectModal'
import { NotesTab } from './AccountDetail'
import { useLabels } from '@/hooks/useLabels'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'products' | 'sales' | 'projects' | 'notes' | 'fields'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * One deal, start to finish.
 *
 * The stage rail is the control and the progress bar; Won and Lost are
 * explicit buttons, not columns you have to find. Underneath sits the sales
 * chain — quoted, ordered, invoiced, received — with the one action the chain
 * is waiting for, so "what do I do next on this?" is answered by the page
 * rather than by memory.
 */
export default function DealDetail() {
  const { dealId } = useParams({ from: '/app/deals/$dealId' })
  const id = Number(dealId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const hasFeature = useAuthStore((st) => st.hasFeature)
  const [tab, setTab] = useState<Tab>('overview')
  const [losing, setLosing] = useState(false)
  const [winning, setWinning] = useState(false)

  const { data: deal, isLoading } = useQuery({ queryKey: ['deals', id], queryFn: () => dealsApi.get(id) })
  const { data: pipelines = [] } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deals'] })
    qc.invalidateQueries({ queryKey: ['crm', 'timeline', 'deal', id] })
  }

  const move = useMutation({
    mutationFn: ({ stageId, lost }: { stageId: number; lost?: { lostReasonId: number; lostNotes?: string } }) => dealsApi.moveStage(id, stageId, lost),
    onSuccess: (d) => {
      setLosing(false)
      refresh()
      if (d.stage?.isWon) toast.success('Won — place the order to raise the invoice.')
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move'),
  })

  const placeOrder = useMutation({
    mutationFn: () => dealsApi.placeOrder(id),
    onSuccess: (r) => {
      toast.success(`Order ${r.orderNumber} placed${r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}`)
      setWinning(false)
      refresh()
      navigate({ to: '/app/orders/$orderId', params: { orderId: String(r.orderId) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not place the order'),
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!deal) return <p className="py-12 text-center text-sm">Not found.</p>

  const stages = pipelines.find((p) => p.id === deal.pipelineId)?.stages ?? []
  const wonStage = stages.find((s) => s.isWon)
  const lostStage = stages.find((s) => s.isLost)
  const open = !deal.stage?.isWon && !deal.stage?.isLost
  const overdue = open && deal.expectedCloseDate && new Date(deal.expectedCloseDate) < new Date()
  const stale = open && (deal.daysInStage ?? 0) >= 14

  const tabs: { key: Tab; label: string; show?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'products', label: `Line items${deal.products?.length ? ` · ${deal.products.length}` : ''}` },
    { key: 'sales', label: 'Order & invoice', show: hasFeature('sales_docs') },
    { key: 'projects', label: 'Projects', show: hasFeature('projects') },
    { key: 'notes', label: 'Notes' },
    { key: 'fields', label: 'Custom fields', show: hasFeature('custom_fields') },
  ]

  return (
    <div className="space-y-5">
      <Link to="/app/deals" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Board
      </Link>

      {/* Header */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted-foreground">{deal.dealNumber}</span>
              {deal.stage && (
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', deal.stage.isWon ? 'bg-emerald-500/10 text-emerald-700' : deal.stage.isLost ? 'bg-rose-500/10 text-rose-700' : 'bg-primary/10 text-primary')}>
                  {deal.stage.name}
                </span>
              )}
              {open && (
                <span className={cn('inline-flex items-center gap-1 text-[11px]', stale ? 'font-semibold text-amber-600' : 'text-muted-foreground')}>
                  <Clock className="h-3 w-3" /> {deal.daysInStage ?? 0}d in stage{stale && ' · going cold'}
                </span>
              )}
              {overdue && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                  <AlertTriangle className="h-3 w-3" /> past close date
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-bold leading-tight">{deal.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {deal.account && (
                <Link to="/app/accounts/$accountId" params={{ accountId: String(deal.account.id) }} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <Building2 className="h-3.5 w-3.5" /> {deal.account.name}
                </Link>
              )}
              {deal.contact && (
                <Link to="/app/contacts/$contactId" params={{ contactId: String(deal.contact.id) }} className="inline-flex items-center gap-1 hover:text-primary">
                  <User className="h-3.5 w-3.5" /> {deal.contact.name}
                </Link>
              )}
              {deal.lead && (
                <Link to="/app/leads/$leadId" params={{ leadId: String(deal.lead.id) }} className="inline-flex items-center gap-1 hover:text-primary">
                  <ExternalLink className="h-3.5 w-3.5" /> from lead {deal.lead.name}
                </Link>
              )}
              {deal.owner && <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" /> {deal.owner.name}</span>}
              {deal.expectedCloseDate && (
                <span className={cn('inline-flex items-center gap-1', overdue && 'text-rose-600')}>
                  <CalendarDays className="h-3.5 w-3.5" /> closes {new Date(deal.expectedCloseDate).toLocaleDateString('en-IN')}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <p className="text-2xl font-bold">{formatMoney(deal.value, deal.currency)}</p>
            <p className="text-xs text-muted-foreground">
              {deal.probability}% · weighted {formatMoney(deal.weightedValue, deal.currency)}
            </p>
          </div>
        </div>

        {/* The stage rail doubles as the progress indicator and the control. */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {stages.filter((s) => !s.isWon && !s.isLost).map((s, i, arr) => {
            const currentIdx = arr.findIndex((x) => x.id === deal.stageId)
            const passed = currentIdx >= 0 && i < currentIdx
            return (
              <button
                key={s.id}
                onClick={() => s.id !== deal.stageId && move.mutate({ stageId: s.id })}
                disabled={move.isPending}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  s.id === deal.stageId
                    ? 'bg-primary text-primary-foreground'
                    : passed
                      ? 'bg-primary/15 text-primary hover:bg-primary/25'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
                title={`${s.probability}%`}
              >
                {s.name}
              </button>
            )
          })}
          <span className="mx-1 hidden text-muted-foreground sm:inline"><ArrowRight className="h-3.5 w-3.5" /></span>
          {wonStage && (
            <button
              onClick={() => !deal.stage?.isWon && setWinning(true)}
              disabled={move.isPending || deal.stage?.isWon}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', deal.stage?.isWon ? 'bg-emerald-600 text-white' : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50')}
            >
              <Trophy className="h-3.5 w-3.5" /> {deal.stage?.isWon ? 'Won' : 'Mark won'}
            </button>
          )}
          {lostStage && (
            <button
              onClick={() => !deal.stage?.isLost && setLosing(true)}
              disabled={move.isPending || deal.stage?.isLost}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', deal.stage?.isLost ? 'bg-rose-600 text-white' : 'border border-rose-300 text-rose-700 hover:bg-rose-50')}
            >
              <XCircle className="h-3.5 w-3.5" /> {deal.stage?.isLost ? 'Lost' : 'Mark lost'}
            </button>
          )}
        </div>

        {deal.lostReason && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
            Lost — {deal.lostReason.name}{deal.lostNotes && `: ${deal.lostNotes}`}
            {!open && stages.length > 0 && (
              <button onClick={() => move.mutate({ stageId: stages.filter((s) => !s.isWon && !s.isLost)[0]?.id })} className="ml-3 text-xs underline">Reopen</button>
            )}
          </p>
        )}
        {deal.stage?.isWon && deal.actualCloseDate && (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            Won on {new Date(deal.actualCloseDate).toLocaleDateString('en-IN')}.
          </p>
        )}
      </div>

      {/* The chain: deal › quote › contract › order › invoice › paid, with the
          next action — the same bar every document page carries. */}
      {hasFeature('sales_docs') && (
        <div className="space-y-2">
          <ChainBar current={{ kind: 'deal', id }} simple hideNext />
          <div className="flex justify-end gap-2">
            {!(deal.chain?.orders ?? []).length && (
              <button onClick={() => setWinning(true)} disabled={placeOrder.isPending || !(deal.products?.length)} title={!deal.products?.length ? 'Add products first' : undefined} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" /> Place order
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 overflow-x-auto border-b">
            {tabs.filter((x) => x.show !== false).map((x) => (
              <button
                key={x.key}
                onClick={() => setTab(x.key)}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === x.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {x.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab deal={deal} onSaved={refresh} />}
          {tab === 'products' && <ProductsTab deal={deal} onSaved={refresh} />}
          {tab === 'sales' && deal.chain && (
            <div className="space-y-3 rounded-xl border bg-card p-4">
              {!deal.chain.orders.length && !deal.chain.invoices.length && (
                <p className="text-sm text-muted-foreground">No order yet. Add products, then place the order.</p>
              )}
              {deal.chain.orders.map((o) => (
                <Link key={o.id} to="/app/orders/$orderId" params={{ orderId: String(o.id) }} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                  <span className="font-mono font-medium">{o.orderNumber}</span>
                  <span className="text-muted-foreground">{o.status.replace(/_/g, ' ')} · {formatMoney(o.total)}</span>
                </Link>
              ))}
              {deal.chain.invoices.map((i) => (
                <Link key={i.id} to="/app/invoices/$invoiceId" params={{ invoiceId: String(i.id) }} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                  <span className="font-mono font-medium">{i.invoiceNumber}</span>
                  <span className="text-muted-foreground">{i.status} · {formatMoney(i.total)}</span>
                </Link>
              ))}
            </div>
          )}
          {tab === 'projects' && <ProjectsTab deal={deal} />}
          {tab === 'notes' && <NotesTab entityType="deal" entityId={id} />}
          {tab === 'fields' && <CustomFieldsPanel entityType="deal" entityId={id} noun="deals" onSaved={refresh} />}
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4 text-muted-foreground" /> Stage history</h3>
            {deal.stageHistory?.length ? (
              <ol className="space-y-2 text-xs">
                <li className="flex items-start gap-2 text-muted-foreground">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>Opened {new Date(deal.createdAt).toLocaleDateString('en-IN')}</span>
                </li>
                {deal.stageHistory.map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>
                      <span className="font-medium">{h.subject}</span>
                      <span className="text-muted-foreground"> · {new Date(h.at).toLocaleDateString('en-IN')}{h.by ? ` · ${h.by}` : ''}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">Still in the stage it opened in, since {new Date(deal.createdAt).toLocaleDateString('en-IN')}.</p>
            )}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold">Activity</h3>
            <ActivityTimeline entityType="deal" entityId={id} />
          </div>
          <DeleteButton
            what="deal"
            label={deal.name}
            showLabel
            note="Moves to the trash. Quotes and orders raised from it are kept."
            onDelete={() => dealsApi.remove(deal.id)}
            onDeleted={() => navigate({ to: '/app/deals' })}
          />
        </aside>
      </div>

      {losing && lostStage && (
        <LostDealModal
          dealName={deal.name}
          pending={move.isPending}
          onCancel={() => setLosing(false)}
          onConfirm={(lostReasonId, lostNotes) => move.mutate({ stageId: lostStage.id, lost: { lostReasonId, lostNotes } })}
        />
      )}
      {winning && wonStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !placeOrder.isPending && !move.isPending && setWinning(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Place the order?</h2>
            <p className="mt-2 text-sm text-muted-foreground">This marks the deal won and raises an order plus invoice from the line items.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={placeOrder.isPending || move.isPending} onClick={() => setWinning(false)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
              <button
                disabled={placeOrder.isPending || move.isPending || !(deal.products?.length)}
                onClick={async () => {
                  if (!deal.stage?.isWon) await move.mutateAsync({ stageId: wonStage.id })
                  placeOrder.mutate()
                }}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {placeOrder.isPending || move.isPending ? 'Placing…' : 'Won + place order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ deal, onSaved }: { deal: Deal; onSaved: () => void }) {
  const t = useLabels()
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const val = (k: keyof Deal) => (k in form ? form[k as string] : deal[k]) ?? ''

  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'byAccount', deal.accountId],
    queryFn: () => contactsApi.list({ accountId: deal.accountId, limit: 50 }),
    enabled: !!deal.accountId,
  })
  const { data: owners = [] } = useQuery({ queryKey: ['users', 'counsellors'], queryFn: usersApi.counsellors, enabled: isAdmin() })

  const save = useMutation({
    mutationFn: () => dealsApi.update(deal.id, form),
    onSuccess: () => {
      toast.success('Saved')
      setForm({})
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const dirty = Object.keys(form).length > 0

  return (
    <div className="space-y-5 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">Name</label>
          <input className={input} value={String(val('name'))} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Value (₹)</label>
          <input type="number" className={input} value={String(val('value'))} onChange={(e) => set('value', e.target.value ? Number(e.target.value) : null)} />
          {!!deal.products?.length && <p className="mt-1 text-xs text-muted-foreground">Kept in step with the line items.</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Probability override (%)</label>
          <input
            type="number" min={0} max={100} className={input}
            placeholder={`Stage default: ${deal.stage?.probability ?? 0}%`}
            value={form.probability !== undefined ? String(form.probability ?? '') : ''}
            onChange={(e) => set('probability', e.target.value ? Number(e.target.value) : null)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Leave empty to follow the stage.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Expected close</label>
          <input type="date" className={input} value={String(val('expectedCloseDate')).slice(0, 10)} onChange={(e) => set('expectedCloseDate', e.target.value || null)} />
        </div>
        {isAdmin() && !!owners.length && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Owner</label>
            <select className={input} value={String(form.ownerId !== undefined ? form.ownerId ?? '' : deal.ownerId ?? '')} onChange={(e) => set('ownerId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Nobody</option>
              {deal.owner && !owners.some((u: { id: number }) => u.id === deal.owner!.id) && <option value={deal.owner.id}>{deal.owner.name}</option>}
              {owners.map((u: { id: number; name: string }) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        {deal.accountId && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Primary {t('contact').toLowerCase()}</label>
            <select className={input} value={String(form.primaryContactId !== undefined ? form.primaryContactId ?? '' : deal.primaryContactId ?? '')} onChange={(e) => set('primaryContactId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Nobody yet</option>
              {(contacts?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.fullName}{c.jobTitle ? ` · ${c.jobTitle}` : ''}</option>
              ))}
            </select>
            {!contacts?.data.length && <p className="mt-1 text-xs text-muted-foreground">No contacts on the account yet — add one from the account page.</p>}
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Source</label>
          <input className={input} value={String(val('source'))} onChange={(e) => set('source', e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Campaign</label>
          <input className={input} value={String(val('campaign'))} onChange={(e) => set('campaign', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Next step</label>
        <input className={input} placeholder="The one thing that has to happen next" value={String(val('nextStep'))} onChange={(e) => set('nextStep', e.target.value)} />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Notes</label>
        <textarea className={input} rows={3} value={String(val('notes'))} onChange={(e) => set('notes', e.target.value)} />
      </div>

      {deal.contact && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primary {t('contact').toLowerCase()}</p>
            <Link to="/app/contacts/$contactId" params={{ contactId: String(deal.contact.id) }} className="mt-0.5 inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
              <User className="h-3.5 w-3.5" /> {deal.contact.name}
            </Link>
          </div>
          {deal.contact.mobile && (
            <a href={`tel:${deal.contact.mobile}`} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent"><Phone className="h-3.5 w-3.5" /> {deal.contact.mobile}</a>
          )}
          {deal.contact.email && (
            <a href={`mailto:${deal.contact.email}`} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent"><Mail className="h-3.5 w-3.5" /> {deal.contact.email}</a>
          )}
        </div>
      )}

      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {dirty ? 'Save changes' : 'No changes'}
      </button>
    </div>
  )
}

// ─── Projects ─────────────────────────────────────────────────────────────────

function ProjectsTab({ deal }: { deal: Deal }) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['projects', { dealId: deal.id }],
    queryFn: () => projectsApi.list({ dealId: deal.id, limit: 50 }),
  })
  const rows = data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
          <Plus className="h-4 w-4" /> New project for this deal
        </button>
      </div>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">No project yet. Hand the brief to IT, Design or Marketing and work the proposal there.</p>
        </div>
      ) : (
        rows.map((p) => (
          <Link key={p.id} to="/app/projects/$projectId" params={{ projectId: String(p.id) }} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 hover:border-primary/40">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-semibold text-muted-foreground">{p.projectNumber}</span>
                <ProjectStatusBadge status={p.status} />
              </div>
              <p className="truncate font-medium">{p.title}</p>
              <p className="truncate text-xs text-muted-foreground">{[p.team?.name, p.assignee ? `with ${p.assignee.name}` : null, `${p.messageCount} messages`].filter(Boolean).join(' · ')}</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>
        ))
      )}
      {creating && (
        <NewProjectModal
          open
          onClose={() => setCreating(false)}
          defaults={{ dealId: deal.id, accountId: deal.accountId, contactId: deal.primaryContactId, title: deal.name, clientName: deal.contact?.name ?? deal.account?.name ?? '', clientEmail: deal.contact?.email ?? deal.accountDetail?.email ?? '' }}
          onCreated={() => qc.invalidateQueries({ queryKey: ['projects'] })}
        />
      )}
    </div>
  )
}

// ─── Line items ───────────────────────────────────────────────────────────────

function ProductsTab({ deal, onSaved }: { deal: Deal; onSaved: () => void }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [line, setLine] = useState<Record<string, unknown>>({ name: '', quantity: 1, unitPrice: 0, discountPercent: 0, taxPercent: 18 })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState<Record<string, unknown>>({})

  const { data: catalogue = [] } = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list(), enabled: adding })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deals', deal.id] })
    onSaved()
  }

  const add = useMutation({
    mutationFn: () => dealsApi.addLine(deal.id, line),
    onSuccess: () => {
      setLine({ name: '', quantity: 1, unitPrice: 0, discountPercent: 0, taxPercent: 18 })
      setAdding(false)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not add'),
  })
  const update = useMutation({
    mutationFn: ({ lineId, body }: { lineId: number; body: Record<string, unknown> }) => dealsApi.updateLine(deal.id, lineId, body),
    onSuccess: () => {
      setEditingId(null)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })
  const remove = useMutation({ mutationFn: (l: DealProduct) => dealsApi.removeLine(deal.id, l.id), onSuccess: refresh })

  const set = (k: string, v: unknown) => setLine((f) => ({ ...f, [k]: v }))
  const lines = deal.products ?? []
  const total = lines.reduce((s, l) => s + Number(l.total), 0)
  const cell = 'w-full rounded border bg-background px-2 py-1 text-right text-sm'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Priced as they stand here; a quote raised from this deal copies them across.</p>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>

      {adding && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          {!!catalogue.length && (
            <select
              className={input}
              onChange={(e) => {
                const p = catalogue.find((x) => String(x.id) === e.target.value)
                if (!p) return
                setLine({ productId: p.id, name: p.name, sku: p.sku, quantity: 1, unitPrice: p.unitPrice ?? 0, discountPercent: 0, taxPercent: p.taxPercent ?? 18 })
              }}
              defaultValue=""
            >
              <option value="">Pick from the catalogue, or type below…</option>
              {catalogue.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.unitPrice != null && `— ${formatMoney(p.unitPrice)}`}</option>
              ))}
            </select>
          )}
          <input className={input} placeholder="Description *" value={String(line.name ?? '')} onChange={(e) => set('name', e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-4">
            <LabeledInput label="Qty" value={line.quantity} onChange={(v) => set('quantity', v)} />
            <LabeledInput label="Unit price" value={line.unitPrice} onChange={(v) => set('unitPrice', v)} />
            <LabeledInput label="Discount %" value={line.discountPercent} onChange={(v) => set('discountPercent', v)} />
            <LabeledInput label="Tax %" value={line.taxPercent} onChange={(v) => set('taxPercent', v)} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => add.mutate()} disabled={!String(line.name ?? '').trim() || add.isPending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Add</button>
            <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
          </div>
        </div>
      )}

      {!lines.length ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">No line items. The deal keeps whatever value you typed.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Disc</th>
                <th className="px-3 py-2 text-right font-medium">Tax</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) =>
                editingId === l.id ? (
                  <tr key={l.id} className="border-t bg-primary/5">
                    <td className="px-2 py-1.5"><input className={cn(cell, 'text-left')} value={String(edit.name ?? '')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></td>
                    <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.quantity)} onChange={(e) => setEdit({ ...edit, quantity: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.unitPrice)} onChange={(e) => setEdit({ ...edit, unitPrice: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.discountPercent)} onChange={(e) => setEdit({ ...edit, discountPercent: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1.5"><input type="number" className={cell} value={String(edit.taxPercent)} onChange={(e) => setEdit({ ...edit, taxPercent: Number(e.target.value) })} /></td>
                    <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">on save</td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <button onClick={() => update.mutate({ lineId: l.id, body: edit })} className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10">Save</button>
                        <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2">{l.name}{l.sku && <span className="ml-1 text-xs text-muted-foreground">({l.sku})</span>}</td>
                    <td className="px-3 py-2 text-right">{Number(l.quantity)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(Number(l.unitPrice))}</td>
                    <td className="px-3 py-2 text-right">{Number(l.discountPercent)}%</td>
                    <td className="px-3 py-2 text-right">{Number(l.taxPercent)}%</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(Number(l.total))}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setEditingId(l.id); setEdit({ name: l.name, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPercent: Number(l.discountPercent), taxPercent: Number(l.taxPercent) }) }}
                          className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button onClick={() => remove.mutate(l)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right font-medium">Total</td>
                <td className="px-3 py-2 text-right font-bold">{formatMoney(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-right text-xs text-muted-foreground">{compactMoney(total)} across {lines.length} line{lines.length === 1 ? '' : 's'}</p>
    </div>
  )
}

function LabeledInput({ label, value, onChange }: { label: string; value: unknown; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <input type="number" className={input} value={String(value ?? '')} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}
