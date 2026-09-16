import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  leadsApi, leadConfigApi, usersApi, bulkApi,
  type BulkStep, type BulkRunResult, type BulkPreset,
} from '@/lib/api'
import { toast } from 'sonner'
import {
  Layers, Search, Trash2, ArrowRightLeft, UserCheck, RefreshCw,
  Loader2, Settings2, UserX, Plus, X, Save, Bookmark, History,
  ListPlus, FileDown, Wand2, Eye, AlertTriangle, ClipboardPaste,
  CheckCircle2, MessageSquare, Bell, Tag, Undo2,
} from 'lucide-react'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import type { SelectOption } from '@/components/ui/SearchableSelect'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'

interface WorkflowData {
  departments: { id: number; name: string; slug: string }[]
  statuses: { id: number; title: string; slug: string; departmentId: number; subStatuses: { id: number; subStatus: string }[] }[]
}
interface Counsellor { id: number; name: string; email: string; role?: string }

// ─── Filter shape ────────────────────────────────────────────────────────────
interface FilterState {
  dateFrom: string
  dateTo: string
  departmentId: string
  leadStatusId: string
  statusLeadTypeId: string
  state: string
  source: string
  assignedCounsellorId: string
  unassigned: boolean
  noFollowupSinceDays: string
  hasEmail: boolean
  hasMobile: boolean
  mobilePrefix: string
  includeTrash: boolean
  search: string
  // When true, every user-selected filter clause is negated server-side and
  // bulk actions target leads NOT matching the selections.
  excludeMode: boolean
}

const emptyFilter: FilterState = {
  dateFrom: '', dateTo: '', departmentId: '', leadStatusId: '', statusLeadTypeId: '',
  state: '', source: '', assignedCounsellorId: '', unassigned: false,
  noFollowupSinceDays: '', hasEmail: false, hasMobile: false, mobilePrefix: '',
  includeTrash: false, search: '', excludeMode: false,
}

// Serialize FilterState to the params shape the API accepts. Booleans become '1';
// false/empty are dropped so we don't pollute the cache key.
function filterToParams(f: FilterState): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.dateFrom) p.fromDate = f.dateFrom
  if (f.dateTo) p.toDate = f.dateTo
  if (f.departmentId) p.departmentId = f.departmentId
  if (f.leadStatusId) p.leadStatusId = f.leadStatusId
  if (f.statusLeadTypeId) p.statusLeadTypeId = f.statusLeadTypeId
  if (f.state) p.state = f.state
  if (f.source) p.source = f.source
  if (f.assignedCounsellorId) p.assignedCounsellors = f.assignedCounsellorId
  if (f.unassigned) p.unassigned = '1'
  if (f.noFollowupSinceDays) p.noFollowupSinceDays = f.noFollowupSinceDays
  if (f.hasEmail) p.hasEmail = '1'
  if (f.hasMobile) p.hasMobile = '1'
  if (f.mobilePrefix) p.mobilePrefix = f.mobilePrefix
  if (f.includeTrash) p.includeTrash = '1'
  if (f.search) p.search = f.search
  if (f.excludeMode) p.excludeMode = '1'
  return p
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BulkManagement() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [recipe, setRecipe] = useState<BulkStep[]>([])
  const [pageLimit, setPageLimit] = useState(50)
  const [page, setPage] = useState(1)

  // Selection — `'all-matching'` means "act on the resolved server-side id set
  // for the current filter", not the visible page. `selectedIds` is the
  // explicit-checkbox set used otherwise.
  const [selectionMode, setSelectionMode] = useState<'page' | 'all-matching' | 'pasted'>('page')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [pastedIds, setPastedIds] = useState<number[]>([])
  const [showPasteImport, setShowPasteImport] = useState(false)

  const [showPreview, setShowPreview] = useState<BulkRunResult | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [savePresetOpen, setSavePresetOpen] = useState(false)

  // ── Data queries
  const { data: wf } = useQuery<WorkflowData>({ queryKey: ['lead-config', 'workflow'], queryFn: leadConfigApi.workflow })
  const { data: counsellors = [] } = useQuery<Counsellor[]>({ queryKey: ['users', 'counsellors'], queryFn: usersApi.counsellors })
  const { data: presets = [] } = useQuery<BulkPreset[]>({ queryKey: ['bulk-presets'], queryFn: bulkApi.presets })
  const { data: operations } = useQuery({
    queryKey: ['bulk-operations', { limit: 8 }],
    queryFn: () => bulkApi.operations({ limit: 8 }),
    refetchInterval: 5000,
  })

  const params = useMemo(() => filterToParams(filter), [filter])
  const { data: leadsData, isFetching: leadsLoading, refetch } = useQuery({
    queryKey: ['bulk-leads', params, page, pageLimit],
    queryFn: () => leadsApi.list({ ...params, page: String(page), limit: String(pageLimit) }),
  })

  const leads = leadsData?.data ?? []
  const totalMatching = leadsData?.total ?? 0
  // Marketing is an inbound-only channel, Archive is a terminal admin-managed
  // sink. Neither should be a target for everyday bulk recipes — hide them
  // from the pickers so the recipe editor stays focused on actionable depts.
  const HIDDEN_BULK_DEPT_SLUGS = new Set(['marketing', 'archive'])
  const departments = (wf?.departments ?? []).filter((d) => !HIDDEN_BULK_DEPT_SLUGS.has(d.slug))
  const hiddenDeptIds = new Set(
    (wf?.departments ?? []).filter((d) => HIDDEN_BULK_DEPT_SLUGS.has(d.slug)).map((d) => d.id),
  )
  const statuses = (wf?.statuses ?? []).filter((s) => !hiddenDeptIds.has(s.departmentId))

  const counsellorOpts: SelectOption[] = useMemo(() => counsellors.map((c) => ({
    value: String(c.id), label: c.name, subtitle: [c.role, c.email].filter(Boolean).join(' · '),
  })), [counsellors])

  // ── Derived target set
  // Returns either { leadIds } or { filter } — the shape the engine takes.
  function targetPayload(): { leadIds?: number[]; filter?: Record<string, string> } {
    if (selectionMode === 'all-matching') return { filter: params }
    if (selectionMode === 'pasted') return { leadIds: pastedIds }
    return { leadIds: Array.from(selectedIds) }
  }
  const targetCount =
    selectionMode === 'all-matching' ? totalMatching
    : selectionMode === 'pasted' ? pastedIds.length
    : selectedIds.size

  // ── Mutations
  const previewMut = useMutation({
    mutationFn: () => bulkApi.apply({ ...targetPayload(), recipe, dryRun: true }),
    onSuccess: (r) => setShowPreview(r),
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? 'Preview failed'),
  })
  const executeMut = useMutation({
    mutationFn: () => bulkApi.apply({ ...targetPayload(), recipe, dryRun: false }),
    onSuccess: (r) => {
      toast.success(r.message ?? `Done — ${r.succeeded}/${r.total} processed`)
      qc.invalidateQueries({ queryKey: ['bulk-leads'] })
      qc.invalidateQueries({ queryKey: ['bulk-operations'] })
      setShowPreview(null)
      setShowConfirm(false)
      setSelectedIds(new Set())
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? 'Execution failed'),
  })
  const undoMut = useMutation({
    mutationFn: (id: number) => bulkApi.undo(id),
    onSuccess: (r) => {
      toast.success(r.message)
      qc.invalidateQueries({ queryKey: ['bulk-operations'] })
      qc.invalidateQueries({ queryKey: ['bulk-leads'] })
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? 'Undo failed'),
  })

  // ── Recipe helpers
  const addStep = (step: BulkStep) => setRecipe((r) => [...r, step])
  const removeStep = (idx: number) => setRecipe((r) => r.filter((_, i) => i !== idx))
  const updateStep = (idx: number, patch: Partial<BulkStep>) => setRecipe((r) => r.map((s, i) => i === idx ? { ...s, ...patch } as BulkStep : s))

  // ── Reset selection when filter changes
  useEffect(() => { setSelectedIds(new Set()); setPage(1) }, [params])

  // ── Helpers
  const canExecute = recipe.length > 0 && targetCount > 0 && recipeIsValid(recipe)
  const filterIsActive = Object.values(filter).some((v) => typeof v === 'boolean' ? v : !!v)

  const exportCsv = async () => {
    try {
      const blob = await bulkApi.exportCsv(targetPayload())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `leads-${Date.now()}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Layers className="h-5 w-5 text-white" />
            </div>
            Bulk Lead Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1 ml-[46px]">
            Filter, build a multi-step recipe, preview, then run — with full audit log and one-click undo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/bulk-management/operations"
            className="text-sm px-3 py-2 rounded-lg border bg-card hover:bg-accent flex items-center gap-2">
            <History className="h-4 w-4" /> All operations
          </Link>
        </div>
      </div>

      {/* PRESETS STRIP */}
      {presets.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 flex items-center gap-1">
            <Bookmark className="h-3 w-3" /> Presets
          </span>
          {presets.map((p) => (
            <button key={p.id} onClick={() => { setFilter({ ...emptyFilter, ...(p.filter as Partial<FilterState>) }); setRecipe(p.recipe); toast.success(`Loaded preset: ${p.name}`) }}
              className="shrink-0 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 text-xs font-medium flex items-center gap-1.5">
              {p.name}
              <span className="text-[10px] text-muted-foreground">· {p.recipe.length} step{p.recipe.length > 1 ? 's' : ''}</span>
              <X className="h-3 w-3 text-muted-foreground hover:text-destructive ml-1" onClick={(e) => { e.stopPropagation(); bulkApi.deletePreset(p.id).then(() => qc.invalidateQueries({ queryKey: ['bulk-presets'] })) }} />
            </button>
          ))}
        </div>
      )}

      {/* GRID */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* LEFT — FILTER */}
        <div className="xl:col-span-4 space-y-4">
          <SectionCard title="Filter Leads" icon={Search}>
            <FilterPanel
              filter={filter}
              onChange={setFilter}
              departments={departments}
              statuses={statuses}
              counsellorOpts={counsellorOpts}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => refetch()}
                className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-semibold hover:opacity-90 flex items-center justify-center gap-2">
                <Search className="h-4 w-4" /> Apply
              </button>
              <button onClick={() => setFilter(emptyFilter)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-muted">Reset</button>
            </div>
          </SectionCard>
        </div>

        {/* CENTER — TARGET SET + LEADS */}
        <div className="xl:col-span-5 space-y-4">
          <SectionCard title={`Target Set — ${targetCount.toLocaleString()} lead${targetCount === 1 ? '' : 's'}`} icon={ListPlus}>
            {/* Selection mode bar */}
            <div className="flex flex-wrap gap-2 mb-3">
              <ModeChip active={selectionMode === 'page'} onClick={() => setSelectionMode('page')}>
                Selected on page ({selectedIds.size})
              </ModeChip>
              <ModeChip active={selectionMode === 'all-matching'} onClick={() => setSelectionMode('all-matching')}>
                All matching filter ({totalMatching.toLocaleString()})
              </ModeChip>
              <ModeChip active={selectionMode === 'pasted'} onClick={() => { setSelectionMode('pasted'); setShowPasteImport(true) }}>
                <ClipboardPaste className="h-3.5 w-3.5" /> Pasted list ({pastedIds.length})
              </ModeChip>
              <button onClick={exportCsv}
                className="ml-auto text-xs px-2.5 py-1.5 rounded-md border hover:bg-muted flex items-center gap-1.5">
                <FileDown className="h-3.5 w-3.5" /> Export CSV
              </button>
            </div>

            {/* Leads table */}
            {!filterIsActive ? (
              <EmptyHint icon={Search} title="Set a filter" subtitle="Or paste a list of IDs/mobiles to start." />
            ) : leadsLoading ? (
              <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></div>
            ) : leads.length === 0 ? (
              <EmptyHint icon={CheckCircle2} title="No leads match" subtitle="Try widening the filter." />
            ) : (
              <>
                {/* Gmail-style promote-to-all-matching banner */}
                {selectionMode !== 'all-matching' && leads.length > 0 && leads.every((l: { id: number }) => selectedIds.has(Number(l.id))) && totalMatching > leads.length && (
                  <div className="mb-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span><span className="font-semibold">All {selectedIds.size} on this page selected.</span></span>
                    <button onClick={() => setSelectionMode('all-matching')}
                      className="text-primary font-semibold hover:underline shrink-0">
                      Select all {totalMatching.toLocaleString()} matching →
                    </button>
                  </div>
                )}
                {selectionMode === 'all-matching' && (
                  <div className="mb-2 bg-primary/10 border border-primary/30 rounded-md px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span className="font-semibold">All {totalMatching.toLocaleString()} leads matching the filter are selected.</span>
                    <button onClick={() => { setSelectionMode('page'); setSelectedIds(new Set()) }}
                      className="text-muted-foreground hover:underline shrink-0">
                      Clear selection
                    </button>
                  </div>
                )}
                <div className="overflow-y-auto border rounded-lg" style={{ maxHeight: 360 }}>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground bg-muted/30 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <input type="checkbox"
                            checked={selectionMode === 'all-matching' || (leads.length > 0 && leads.every((l: { id: number }) => selectedIds.has(Number(l.id))))}
                            onChange={(e) => {
                              if (selectionMode === 'all-matching') {
                                setSelectionMode('page'); setSelectedIds(new Set())
                                return
                              }
                              const next = new Set(selectedIds)
                              if (e.target.checked) leads.forEach((l: { id: number }) => next.add(Number(l.id)))
                              else leads.forEach((l: { id: number }) => next.delete(Number(l.id)))
                              setSelectedIds(next); setSelectionMode('page')
                            }} />
                        </th>
                        <th className="px-3 py-2 text-left font-medium">Lead</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {leads.map((l: { id: number; name: string; mobile?: string; email?: string; leadStatus?: string; createdAt: string }) => {
                        const allMatching = selectionMode === 'all-matching'
                        const checked = allMatching || selectedIds.has(Number(l.id))
                        return (
                          <tr key={l.id} className={checked ? 'bg-primary/5' : ''}>
                            <td className="px-3 py-2"><input type="checkbox" checked={checked} disabled={allMatching}
                              onChange={() => {
                                const next = new Set(selectedIds)
                                if (next.has(Number(l.id))) next.delete(Number(l.id))
                                else next.add(Number(l.id))
                                setSelectedIds(next); setSelectionMode('page')
                              }} /></td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{l.name}</div>
                              <div className="text-xs text-muted-foreground">{l.email ?? '—'} · {l.mobile ?? '—'}</div>
                            </td>
                            <td className="px-3 py-2 text-xs">{l.leadStatus ?? 'Fresh'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <div className="text-muted-foreground">
                    Page {page} · {leads.length} of {totalMatching.toLocaleString()} shown
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 border rounded disabled:opacity-30">«</button>
                    <button onClick={() => setPage((p) => p + 1)} disabled={leads.length < pageLimit} className="px-2 py-1 border rounded disabled:opacity-30">»</button>
                    <select value={pageLimit} onChange={(e) => setPageLimit(Number(e.target.value))} className="ml-2 border rounded px-1 py-0.5">
                      {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </div>

        {/* RIGHT — RECIPE BUILDER + RUN */}
        <div className="xl:col-span-3 space-y-4">
          <SectionCard title="Recipe" icon={Wand2}>
            {recipe.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Stack one or more steps — they'll run in order on every targeted lead.</p>
            ) : (
              <div className="space-y-2">
                {recipe.map((step, idx) => (
                  <RecipeStepEditor
                    key={idx} idx={idx} step={step} departments={departments} statuses={statuses} counsellorOpts={counsellorOpts}
                    onChange={(patch) => updateStep(idx, patch)} onRemove={() => removeStep(idx)}
                  />
                ))}
              </div>
            )}
            <AddStepMenu onAdd={addStep} />

            <div className="flex flex-col gap-2 mt-3 pt-3 border-t">
              <button onClick={() => previewMut.mutate()} disabled={!canExecute || previewMut.isPending}
                className="w-full py-2 rounded-lg text-sm font-semibold border bg-card hover:bg-accent disabled:opacity-40 flex items-center justify-center gap-2">
                {previewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview ({targetCount.toLocaleString()})
              </button>
              <button onClick={() => setSavePresetOpen(true)} disabled={recipe.length === 0}
                className="w-full py-2 rounded-lg text-xs font-medium border hover:bg-accent disabled:opacity-40 flex items-center justify-center gap-1.5">
                <Save className="h-3.5 w-3.5" /> Save as preset
              </button>
            </div>
          </SectionCard>

          {/* Operations strip */}
          <SectionCard title="Recent operations" icon={History}>
            {operations && operations.data.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {operations.data.map((op) => (
                  <div key={op.id} className="text-xs border rounded-lg p-2.5 hover:bg-muted/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{op.kind}</span>
                      <StatusBadge status={op.status} />
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {op.succeeded}/{op.total} · {timeAgo(op.createdAt)} · {op.actor.name}
                    </div>
                    {op.status !== 'undone' && !op.dryRun && isReversibleRecipe(op.recipe) && (
                      <button onClick={() => undoMut.mutate(op.id)}
                        className="mt-1.5 text-[11px] text-amber-700 hover:underline flex items-center gap-1">
                        <Undo2 className="h-3 w-3" /> Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-1">No operations yet.</p>
            )}
          </SectionCard>
        </div>
      </div>

      {/* PREVIEW MODAL */}
      {showPreview && (
        <PreviewModal
          result={showPreview}
          recipe={recipe}
          onConfirm={() => { setShowPreview(null); setShowConfirm(true) }}
          onClose={() => setShowPreview(null)}
        />
      )}

      {/* CONFIRM EXECUTION */}
      {showConfirm && (
        <ConfirmModal
          target={targetCount}
          recipe={recipe}
          loading={executeMut.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => executeMut.mutate()}
        />
      )}

      {/* PASTE IMPORT */}
      {showPasteImport && (
        <PasteImportModal
          onClose={() => setShowPasteImport(false)}
          onResolved={(ids) => { setPastedIds(ids); setSelectionMode('pasted'); setShowPasteImport(false) }}
        />
      )}

      {/* SAVE PRESET */}
      {savePresetOpen && (
        <SavePresetModal
          filter={params}
          recipe={recipe}
          onClose={() => setSavePresetOpen(false)}
          onSaved={() => { setSavePresetOpen(false); qc.invalidateQueries({ queryKey: ['bulk-presets'] }) }}
        />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-xl shadow-sm p-4">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h3>
      {children}
    </div>
  )
}

function ModeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all flex items-center gap-1 ${
        active ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-card hover:bg-accent'
      }`}>
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    running: 'bg-blue-100 text-blue-700',
    undone: 'bg-slate-100 text-slate-700',
    pending: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-slate-100 text-slate-700',
  }
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${map[status] ?? 'bg-muted'}`}>{status}</span>
}

function EmptyHint({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <div className="py-10 text-center text-muted-foreground">
      <Icon className="h-8 w-8 mx-auto opacity-30 mb-2" />
      <p className="font-medium text-sm">{title}</p>
      <p className="text-xs mt-1">{subtitle}</p>
    </div>
  )
}

function FilterPanel({ filter, onChange, departments, statuses, counsellorOpts }: {
  filter: FilterState
  onChange: (f: FilterState) => void
  departments: { id: number; name: string }[]
  statuses: { id: number; title: string; departmentId: number }[]
  counsellorOpts: SelectOption[]
}) {
  const cls = 'w-full px-2.5 py-1.5 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring'
  const lbl = 'text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1'
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <FilterModeToggle
          excludeMode={filter.excludeMode}
          onChange={(next) => onChange({ ...filter, excludeMode: next })}
          label=""
        />
      </div>
      <div>
        <label className={lbl}>Search</label>
        <input value={filter.search} onChange={(e) => onChange({ ...filter, search: e.target.value })} className={cls} placeholder="Name, email, mobile..." />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={lbl}>From</label><input type="date" value={filter.dateFrom} onChange={(e) => onChange({ ...filter, dateFrom: e.target.value })} className={cls} /></div>
        <div><label className={lbl}>To</label><input type="date" value={filter.dateTo} onChange={(e) => onChange({ ...filter, dateTo: e.target.value })} className={cls} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lbl}>Department</label>
          <IdMultiSelect
            options={departments.map((d) => ({ value: String(d.id), label: d.name }))}
            value={filter.departmentId ? filter.departmentId.split(',').filter(Boolean) : []}
            onChange={(ids) => onChange({ ...filter, departmentId: ids.join(','), leadStatusId: '' })}
            placeholder="All departments"
          />
        </div>
        <div>
          <label className={lbl}>Status</label>
          {(() => {
            const pickedDepts = filter.departmentId ? new Set(filter.departmentId.split(',').filter(Boolean)) : null
            const filteredStatuses = pickedDepts ? statuses.filter((s) => pickedDepts.has(String(s.departmentId))) : statuses
            return (
              <select value={filter.leadStatusId} onChange={(e) => onChange({ ...filter, leadStatusId: e.target.value })} className={cls}>
                <option value="">All</option>
                {filteredStatuses.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            )
          })()}
        </div>
      </div>
      <div>
        <label className={lbl}>Assigned counsellor</label>
        <SearchableSelect options={counsellorOpts} value={filter.assignedCounsellorId} onChange={(v) => onChange({ ...filter, assignedCounsellorId: v, unassigned: false })} placeholder="Anyone" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={lbl}>State</label><input value={filter.state} onChange={(e) => onChange({ ...filter, state: e.target.value })} className={cls} placeholder="Delhi" /></div>
        <div><label className={lbl}>Source</label><input value={filter.source} onChange={(e) => onChange({ ...filter, source: e.target.value })} className={cls} placeholder="Facebook" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={lbl}>Mobile prefix</label><input value={filter.mobilePrefix} onChange={(e) => onChange({ ...filter, mobilePrefix: e.target.value })} className={cls} placeholder="+91" /></div>
        <div><label className={lbl}>No follow-up (days)</label><input type="number" value={filter.noFollowupSinceDays} onChange={(e) => onChange({ ...filter, noFollowupSinceDays: e.target.value })} className={cls} placeholder="30" /></div>
      </div>
      <div className="pt-2 border-t space-y-1.5">
        <CheckboxRow checked={filter.unassigned} onChange={(v) => onChange({ ...filter, unassigned: v, assignedCounsellorId: '' })} label="Unassigned only" />
        <CheckboxRow checked={filter.hasEmail} onChange={(v) => onChange({ ...filter, hasEmail: v })} label="Has email" />
        <CheckboxRow checked={filter.hasMobile} onChange={(v) => onChange({ ...filter, hasMobile: v })} label="Has mobile" />
        <CheckboxRow checked={filter.includeTrash} onChange={(v) => onChange({ ...filter, includeTrash: v })} label="Include trash" />
      </div>
    </div>
  )
}

// Searchable multi-select for {value, label} options. Used for Department —
// where we store ids in the filter but display names. Plain MultiSelectDropdown
// only takes flat strings, which would collapse two depts with the same name.
function IdMultiSelect({ options, value, onChange, placeholder }: {
  options: { value: string; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const selectedSet = new Set(value)
  const filtered = options.filter((o) =>
    !search.trim() || o.label.toLowerCase().includes(search.toLowerCase()),
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = (v: string) => {
    const set = new Set(selectedSet)
    set.has(v) ? set.delete(v) : set.add(v)
    onChange(Array.from(set))
  }

  const label =
    value.length === 0 ? <span className="text-muted-foreground">{placeholder ?? 'Any'}</span>
    : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? value[0])
    : `${value.length} selected`

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full px-2.5 py-1.5 text-sm border rounded-md bg-background text-left flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground text-xs shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-background border rounded-lg shadow-lg flex flex-col max-h-72">
          <div className="p-2 border-b">
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1.5 text-sm border rounded bg-background" />
          </div>
          <div className="overflow-y-auto flex-1 divide-y">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
            ) : filtered.map((opt) => {
              const checked = selectedSet.has(opt.value)
              return (
                <label key={opt.value}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/40 ${checked ? 'bg-primary/5' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)}
                    className="h-4 w-4 rounded accent-primary" />
                  <span className="flex-1 truncate">{opt.label}</span>
                </label>
              )
            })}
          </div>
          {value.length > 0 && (
            <div className="border-t p-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{value.length} selected</span>
              <button type="button" onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CheckboxRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  )
}

function AddStepMenu({ onAdd }: { onAdd: (s: BulkStep) => void }) {
  const [open, setOpen] = useState(false)
  const items: { type: BulkStep['type']; label: string; icon: React.ComponentType<{ className?: string }>; build: () => BulkStep }[] = [
    { type: 'assign', label: 'Assign counsellor', icon: UserCheck, build: () => ({ type: 'assign', counsellorId: 0 }) },
    { type: 'unassign', label: 'Unassign all', icon: UserX, build: () => ({ type: 'unassign' }) },
    { type: 'move', label: 'Move department', icon: ArrowRightLeft, build: () => ({ type: 'move', departmentId: 0 }) },
    { type: 'status', label: 'Set status', icon: Settings2, build: () => ({ type: 'status' }) },
    { type: 'reset-status', label: 'Reset to Fresh', icon: RefreshCw, build: () => ({ type: 'reset-status' }) },
    { type: 'note', label: 'Add note', icon: MessageSquare, build: () => ({ type: 'note', note: '' }) },
    { type: 'comment', label: 'Add comment', icon: MessageSquare, build: () => ({ type: 'comment', comment: '' }) },
    { type: 'followup', label: 'Add follow-up', icon: MessageSquare, build: () => ({ type: 'followup', comment: '' }) },
    { type: 'reminder', label: 'Set reminder', icon: Bell, build: () => ({ type: 'reminder', reminderDate: '' }) },
    { type: 'call-status', label: 'Mark called / WA', icon: CheckCircle2, build: () => ({ type: 'call-status', called: 1 }) },
    { type: 'tag', label: 'Tag (source/event/website)', icon: Tag, build: () => ({ type: 'tag', field: 'event', value: '' }) },
    { type: 'field-update', label: 'Field update', icon: Settings2, build: () => ({ type: 'field-update', field: 'city', value: '' }) },
    { type: 'trash', label: 'Move to trash', icon: Trash2, build: () => ({ type: 'trash' }) },
    { type: 'restore', label: 'Restore from trash', icon: RefreshCw, build: () => ({ type: 'restore' }) },
    { type: 'permanent-delete', label: 'Permanent delete', icon: Trash2, build: () => ({ type: 'permanent-delete' }) },
  ]
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="mt-3 w-full py-2 rounded-lg text-sm font-medium border-2 border-dashed hover:bg-accent flex items-center justify-center gap-2">
        <Plus className="h-4 w-4" /> Add step
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-card border rounded-lg shadow-xl z-10 max-h-72 overflow-y-auto">
          {items.map((it) => (
            <button key={it.type} onClick={() => { onAdd(it.build()); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2">
              <it.icon className="h-4 w-4 text-muted-foreground" /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeStepEditor({ idx, step, departments, statuses, counsellorOpts, onChange, onRemove }: {
  idx: number; step: BulkStep
  departments: { id: number; name: string }[]
  statuses: { id: number; title: string; departmentId: number; subStatuses: { id: number; subStatus: string }[] }[]
  counsellorOpts: SelectOption[]
  onChange: (patch: Partial<BulkStep>) => void
  onRemove: () => void
}) {
  const cls = 'w-full px-2 py-1 border rounded text-xs bg-background mt-1'
  const fieldLbl = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="border rounded-lg p-2.5 bg-muted/20 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">Step {idx + 1} — {prettyStepLabel(step.type)}</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
      </div>
      {step.type === 'assign' && (
        <SearchableSelect options={counsellorOpts} value={step.counsellorId ? String(step.counsellorId) : ''} onChange={(v) => onChange({ counsellorId: Number(v) } as Partial<BulkStep>)} placeholder="Pick counsellor" />
      )}
      {step.type === 'unassign' && (
        <div>
          <SearchableSelect options={[{ value: '', label: 'Unassign every counsellor' }, ...counsellorOpts]} value={step.counsellorId ? String(step.counsellorId) : ''} onChange={(v) => onChange({ counsellorId: v ? Number(v) : undefined } as Partial<BulkStep>)} placeholder="All" />
        </div>
      )}
      {step.type === 'move' && (
        // Move = dept (required) + optionally drop the lead into a specific
        // status / sub-status under that dept so it surfaces in the right tab
        // instead of the destination dept's "Default" bucket.
        <div className="space-y-2">
          <div>
            <label className={fieldLbl}>Destination department</label>
            <select value={step.departmentId || ''}
              onChange={(e) => onChange({
                departmentId: Number(e.target.value),
                leadStatusId: undefined,
                leadSubStatusId: undefined,
              } as Partial<BulkStep>)} className={cls}>
              <option value="">Pick department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={fieldLbl}>Status <span className="font-normal text-muted-foreground/70 normal-case">(optional)</span></label>
            <select value={step.leadStatusId || ''}
              onChange={(e) => onChange({
                leadStatusId: e.target.value ? Number(e.target.value) : undefined,
                leadSubStatusId: undefined,
              } as Partial<BulkStep>)}
              disabled={!step.departmentId}
              className={cls + ' disabled:opacity-50'}>
              <option value="">{step.departmentId ? 'Keep status / pick one' : 'Pick department first'}</option>
              {statuses
                .filter((s) => !step.departmentId || s.departmentId === step.departmentId)
                .map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          {(() => {
            const sel = statuses.find((s) => s.id === step.leadStatusId)
            if (!sel || sel.subStatuses.length === 0) return null
            return (
              <div>
                <label className={fieldLbl}>Sub-status <span className="font-normal text-muted-foreground/70 normal-case">(optional)</span></label>
                <select value={step.leadSubStatusId || ''}
                  onChange={(e) => onChange({ leadSubStatusId: e.target.value ? Number(e.target.value) : undefined } as Partial<BulkStep>)}
                  className={cls}>
                  <option value="">None</option>
                  {sel.subStatuses.map((ss) => <option key={ss.id} value={ss.id}>{ss.subStatus}</option>)}
                </select>
              </div>
            )
          })()}
          <p className="text-[10px] text-muted-foreground leading-snug">
            Picking a status drops the lead into that status's tab in the new
            department. Leave blank to land in the Default tab.
          </p>
        </div>
      )}
      {step.type === 'status' && (
        // Pick department first so the status list isn't a flat list of 22
        // statuses from 10 departments. Status + sub-status reset whenever
        // the dept changes — they're scoped to it.
        <div className="space-y-2">
          <div>
            <label className={fieldLbl}>Department</label>
            <select
              value={step.departmentId || ''}
              onChange={(e) => onChange({
                departmentId: e.target.value ? Number(e.target.value) : undefined,
                leadStatusId: undefined,
                leadSubStatusId: undefined,
              } as Partial<BulkStep>)}
              className={cls}
            >
              <option value="">Pick department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={fieldLbl}>Status</label>
            <select
              value={step.leadStatusId || ''}
              onChange={(e) => onChange({ leadStatusId: Number(e.target.value), leadSubStatusId: undefined } as Partial<BulkStep>)}
              disabled={!step.departmentId}
              className={cls + ' disabled:opacity-50'}
            >
              <option value="">{step.departmentId ? 'Pick status' : 'Pick department first'}</option>
              {statuses
                .filter((s) => !step.departmentId || s.departmentId === step.departmentId)
                .map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          {(() => {
            const sel = statuses.find((s) => s.id === step.leadStatusId)
            return sel && sel.subStatuses.length > 0 ? (
              <div>
                <label className={fieldLbl}>Sub-status</label>
                <select value={step.leadSubStatusId || ''} onChange={(e) => onChange({ leadSubStatusId: Number(e.target.value) } as Partial<BulkStep>)} className={cls}>
                  <option value="">None</option>
                  {sel.subStatuses.map((ss) => <option key={ss.id} value={ss.id}>{ss.subStatus}</option>)}
                </select>
              </div>
            ) : null
          })()}
        </div>
      )}
      {step.type === 'note' && <textarea value={step.note} onChange={(e) => onChange({ note: e.target.value } as Partial<BulkStep>)} className={cls} rows={2} placeholder="Note to attach to every lead" />}
      {step.type === 'comment' && <textarea value={step.comment} onChange={(e) => onChange({ comment: e.target.value } as Partial<BulkStep>)} className={cls} rows={2} placeholder="Comment text" />}
      {step.type === 'followup' && (
        <FollowupStepEditor
          step={step}
          departments={departments}
          statuses={statuses}
          onChange={onChange}
        />
      )}
      {step.type === 'reminder' && (
        <>
          <input type="datetime-local" value={step.reminderDate} onChange={(e) => onChange({ reminderDate: e.target.value } as Partial<BulkStep>)} className={cls} />
          <input value={step.note ?? ''} onChange={(e) => onChange({ note: e.target.value } as Partial<BulkStep>)} className={cls} placeholder="Optional note" />
        </>
      )}
      {step.type === 'call-status' && (
        <div className="flex gap-3 text-xs mt-1">
          <label className="flex items-center gap-1"><input type="checkbox" checked={step.called === 1} onChange={(e) => onChange({ called: e.target.checked ? 1 : 0 } as Partial<BulkStep>)} /> Called</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={step.wapp === 1} onChange={(e) => onChange({ wapp: e.target.checked ? 1 : 0 } as Partial<BulkStep>)} /> WhatsApp</label>
        </div>
      )}
      {step.type === 'tag' && (
        <>
          <select value={step.field} onChange={(e) => onChange({ field: e.target.value as 'event' | 'source' | 'website' } as Partial<BulkStep>)} className={cls}>
            <option value="event">event</option><option value="source">source</option><option value="website">website</option>
          </select>
          <input value={step.value} onChange={(e) => onChange({ value: e.target.value } as Partial<BulkStep>)} className={cls} placeholder="Value" />
        </>
      )}
      {step.type === 'field-update' && (
        <>
          <select value={step.field} onChange={(e) => onChange({ field: e.target.value } as Partial<BulkStep>)} className={cls}>
            {['city', 'state', 'country', 'nationality', 'source', 'event', 'website', 'intrestedCourse', 'leadType'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <input value={String(step.value ?? '')} onChange={(e) => onChange({ value: e.target.value } as Partial<BulkStep>)} className={cls} placeholder="New value" />
        </>
      )}
      {step.type === 'permanent-delete' && (
        <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Permanent — cannot be undone.</p>
      )}
    </div>
  )
}

// Bulk follow-up editor — mirrors the single-lead UpdateStatusModal: dept →
// status → sub-status cascade plus comment, follow-up date, N/A toggle. The
// engine actually mutates the lead row (sets status/dept/bucket and writes a
// status-history entry) so this stays equivalent to the normal modal — no
// half-followup writes that leave the lead drifting in its old status.
function FollowupStepEditor({ step, departments, statuses, onChange }: {
  step: Extract<BulkStep, { type: 'followup' }>
  departments: { id: number; name: string }[]
  statuses: { id: number; title: string; departmentId: number; subStatuses: { id: number; subStatus: string }[] }[]
  onChange: (patch: Partial<BulkStep>) => void
}) {
  const cls = 'w-full px-2 py-1 border rounded text-xs bg-background mt-1'
  const fieldLbl = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'

  // The picked status implicitly defines a dept. We seed local pickedDeptId
  // from the picked status so reloading a saved preset shows the right dept.
  const initialDept = step.leadStatusId
    ? statuses.find((s) => s.id === step.leadStatusId)?.departmentId ?? null
    : null
  const [pickedDeptId, setPickedDeptId] = useState<number | null>(initialDept)
  const selStatus = step.leadStatusId ? statuses.find((s) => s.id === step.leadStatusId) : undefined
  const statusesInDept = pickedDeptId
    ? statuses.filter((s) => s.departmentId === pickedDeptId)
    : []

  return (
    <div className="space-y-2">
      <div>
        <label className={fieldLbl}>Department <span className="font-normal text-muted-foreground/70 normal-case">(optional — scopes status list)</span></label>
        <select
          value={pickedDeptId ?? ''}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null
            setPickedDeptId(v)
            // Switching dept invalidates any previously picked status/sub.
            onChange({ leadStatusId: undefined, leadSubStatusId: undefined } as Partial<BulkStep>)
          }}
          className={cls}
        >
          <option value="">— no status change —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      {pickedDeptId !== null && (
        <div>
          <label className={fieldLbl}>Status</label>
          <select
            value={step.leadStatusId || ''}
            onChange={(e) => onChange({
              leadStatusId: e.target.value ? Number(e.target.value) : undefined,
              leadSubStatusId: undefined,
            } as Partial<BulkStep>)}
            className={cls}
          >
            <option value="">{statusesInDept.length ? 'Pick status' : 'No statuses in this dept'}</option>
            {statusesInDept.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
      )}
      {selStatus && selStatus.subStatuses.length > 0 && (
        <div>
          <label className={fieldLbl}>Sub-status <span className="font-normal text-muted-foreground/70 normal-case">(optional)</span></label>
          <select
            value={step.leadSubStatusId || ''}
            onChange={(e) => onChange({ leadSubStatusId: e.target.value ? Number(e.target.value) : undefined } as Partial<BulkStep>)}
            className={cls}
          >
            <option value="">None</option>
            {selStatus.subStatuses.map((ss) => <option key={ss.id} value={ss.id}>{ss.subStatus}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={fieldLbl}>Comment <span className="font-normal text-muted-foreground/70 normal-case">(optional when status is set)</span></label>
        <textarea
          value={step.comment}
          onChange={(e) => onChange({ comment: e.target.value } as Partial<BulkStep>)}
          className={cls}
          rows={2}
          placeholder="Follow-up comment"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={fieldLbl}>Next follow-up</label>
          <input
            type="date"
            value={step.followupDate ?? ''}
            onChange={(e) => onChange({ followupDate: e.target.value, followupNA: false } as Partial<BulkStep>)}
            disabled={!!step.followupNA}
            className={cls + ' disabled:opacity-50'}
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-1.5 text-[11px] pb-1.5">
            <input
              type="checkbox"
              checked={!!step.followupNA}
              onChange={(e) => onChange({
                followupNA: e.target.checked,
                followupDate: e.target.checked ? '' : step.followupDate,
              } as Partial<BulkStep>)}
            />
            Mark N/A
          </label>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Records a follow-up per lead. If a status / sub-status is picked, the
        lead is moved to that status and its mapped department.
      </p>
    </div>
  )
}

function PreviewModal({ result, recipe, onConfirm, onClose }: { result: BulkRunResult; recipe: BulkStep[]; onConfirm: () => void; onClose: () => void }) {
  return (
    <ModalShell title={`Preview — ${result.total.toLocaleString()} lead${result.total === 1 ? '' : 's'}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{result.message}</p>
      <div className="border rounded-lg p-3 bg-muted/30">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2">Recipe</p>
        <ol className="space-y-1 text-sm list-decimal pl-5">
          {recipe.map((s, i) => <li key={i}><code className="text-xs bg-card px-1.5 py-0.5 rounded">{s.type}</code> {summarizeStep(s)}</li>)}
        </ol>
      </div>
      {result.sample && result.sample.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2">Sample (first {result.sample.length})</p>
          <div className="border rounded text-xs divide-y max-h-48 overflow-y-auto">
            {result.sample.map((s) => (
              <div key={s.id} className="px-2 py-1.5"><span className="font-medium">#{s.id}</span> · {s.name} · {s.mobile ?? '—'}</div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 flex items-center gap-2">
          Confirm & run
        </button>
      </div>
    </ModalShell>
  )
}

function ConfirmModal({ target, recipe, loading, onCancel, onConfirm }: { target: number; recipe: BulkStep[]; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  const destructive = recipe.some((s) => s.type === 'trash' || s.type === 'permanent-delete' || s.type === 'unassign')
  return (
    <ModalShell title={`Run on ${target.toLocaleString()} lead${target === 1 ? '' : 's'}?`} onClose={onCancel}>
      <p className="text-sm">This will execute {recipe.length} step{recipe.length === 1 ? '' : 's'}. {destructive && <span className="text-red-600 font-semibold">Some steps are destructive.</span>}</p>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={loading} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">Cancel</button>
        <button onClick={onConfirm} disabled={loading} className={`px-4 py-2 text-sm rounded-md text-white flex items-center gap-2 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:opacity-90'}`}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Yes, run
        </button>
      </div>
    </ModalShell>
  )
}

function PasteImportModal({ onClose, onResolved }: { onClose: () => void; onResolved: (ids: number[]) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ matched: number; missing: string[] } | null>(null)
  const submit = async () => {
    const tokens = text.split(/[\s,;\n\r]+/).map((t) => t.trim()).filter(Boolean)
    if (!tokens.length) return
    setBusy(true)
    try {
      const r = await bulkApi.resolveImport(tokens)
      setReport({ matched: r.matched.length, missing: r.missing })
      if (r.matched.length) onResolved(r.matched.map((m) => m.id))
      else toast.error('Nothing matched')
    } finally { setBusy(false) }
  }
  return (
    <ModalShell title="Paste lead IDs or mobile numbers" onClose={onClose}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full h-40 border rounded p-2 text-sm font-mono" placeholder="123, 456, 9876543210, +919876543211, ..." />
      {report && (
        <p className="text-xs">
          Matched <span className="font-semibold text-emerald-600">{report.matched}</span>
          {report.missing.length > 0 && <> · Missing <span className="font-semibold text-amber-600">{report.missing.length}</span></>}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">Cancel</button>
        <button onClick={submit} disabled={busy || !text.trim()} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Resolve
        </button>
      </div>
    </ModalShell>
  )
}

function SavePresetModal({ filter, recipe, onClose, onSaved }: { filter: Record<string, string>; recipe: BulkStep[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const save = useMutation({
    mutationFn: () => bulkApi.createPreset({ name, filter, recipe }),
    onSuccess: () => { toast.success(`Saved "${name}"`); onSaved() },
    onError: () => toast.error('Failed to save'),
  })
  return (
    <ModalShell title="Save as preset" onClose={onClose}>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" placeholder="e.g. Stale Delhi leads → reassign" autoFocus />
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">Cancel</button>
        <button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md flex items-center gap-2">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Same predicate as the BulkOperations page — keep them aligned with the
// engine's snapshot-capable step types.
function isReversibleRecipe(recipe: BulkStep[]): boolean {
  // Keep aligned with SNAPSHOT_KINDS in backend bulk-engine.ts. 'followup' is
  // included because a bulk follow-up now mutates lead status/dept when a
  // status is bundled in — undo rolls those columns back (the follow-up row
  // itself stays, mirroring the single-lead behaviour).
  const types = new Set(['assign', 'unassign', 'move', 'status', 'reset-status', 'trash', 'restore', 'tag', 'call-status', 'followup'])
  return recipe.some((s) => types.has(s.type))
}

function recipeIsValid(recipe: BulkStep[]): boolean {
  return recipe.every((s) => {
    switch (s.type) {
      case 'assign': return !!s.counsellorId
      case 'move': return !!s.departmentId
      case 'status': return !!(s.leadStatusId || s.leadSubStatusId)
      case 'note': return !!s.note.trim()
      case 'comment': return !!s.comment.trim()
      // A bulk follow-up is valid if it has a comment OR if it carries a
      // status / sub-status change OR a follow-up date (mirrors the single
      // lead modal — counsellor can save status-only or date-only follow-ups).
      case 'followup': return !!s.comment.trim() || !!s.leadStatusId || !!s.leadSubStatusId || !!s.followupDate || !!s.followupNA
      case 'reminder': return !!s.reminderDate
      case 'tag': return !!s.value && !!s.field
      case 'field-update': return !!s.field
      default: return true
    }
  })
}

function prettyStepLabel(type: BulkStep['type']): string {
  const map: Record<BulkStep['type'], string> = {
    assign: 'Assign counsellor',
    unassign: 'Unassign',
    move: 'Move department',
    status: 'Set status',
    'reset-status': 'Reset to Fresh',
    note: 'Add note',
    comment: 'Add comment',
    followup: 'Add follow-up',
    reminder: 'Set reminder',
    'call-status': 'Mark called / WA',
    tag: 'Tag',
    'field-update': 'Field update',
    trash: 'Move to trash',
    restore: 'Restore from trash',
    'permanent-delete': 'Permanent delete',
  }
  return map[type] ?? type
}

function summarizeStep(s: BulkStep): string {
  switch (s.type) {
    case 'assign': return `→ counsellor #${s.counsellorId}`
    case 'unassign': return s.counsellorId ? `← from counsellor #${s.counsellorId}` : '← from all counsellors'
    case 'move': return [
      `→ department #${s.departmentId}`,
      s.leadStatusId && `status #${s.leadStatusId}`,
      s.leadSubStatusId && `sub #${s.leadSubStatusId}`,
    ].filter(Boolean).join(' · ')
    case 'status': return [s.leadStatusId && `status #${s.leadStatusId}`, s.leadSubStatusId && `sub #${s.leadSubStatusId}`].filter(Boolean).join(' / ')
    case 'reset-status': return '→ Fresh'
    case 'note': return `"${s.note.slice(0, 40)}${s.note.length > 40 ? '…' : ''}"`
    case 'comment': return `"${s.comment.slice(0, 40)}${s.comment.length > 40 ? '…' : ''}"`
    case 'followup': return `${s.followupNA ? 'N/A' : (s.followupDate ?? 'no-date')} — "${s.comment.slice(0, 30)}…"`
    case 'reminder': return `at ${s.reminderDate}`
    case 'call-status': return [s.called != null && `called=${s.called}`, s.wapp != null && `wapp=${s.wapp}`].filter(Boolean).join(', ')
    case 'tag': return `${s.field} = "${s.value}"`
    case 'field-update': return `${s.field} = "${s.value}"`
    case 'trash': return 'soft delete'
    case 'restore': return 'restore from trash'
    case 'permanent-delete': return '⚠ permanent delete'
    default: return ''
  }
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
