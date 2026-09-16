import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { verifiedApi, type VerifiedCandidate } from '@/lib/api'
import { toast } from 'sonner'
import {
  BadgeCheck, Loader2, Search, Database, Trash2, Plus,
  ArrowRight, Eye, CheckSquare, Square,
} from 'lucide-react'
import { BulkPreviewModal } from '@/components/leads/BulkPreviewModal'
import { FieldUpdateLogs } from '@/components/leads/FieldUpdateLogs'

const VERIFIABLE_FIELDS = [
  { value: 'city',                label: 'City' },
  { value: 'state',               label: 'State' },
  { value: 'country',             label: 'Country' },
  { value: 'nationality',         label: 'Nationality' },
  { value: 'source',              label: 'Source' },
  { value: 'event',               label: 'Event' },
  { value: 'website',             label: 'Website' },
  { value: 'intrestedCourse',     label: 'Product interest' },
] as const

function labelFor(field: string) {
  return VERIFIABLE_FIELDS.find((f) => f.value === field)?.label ?? field
}

// ─── Panel A: Manage verified values ─────────────────────────────────────────

type FilterMode = 'all' | 'unverified' | 'verified'

function ManageVerified() {
  const queryClient = useQueryClient()
  const [field, setField] = useState<string>('state')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [parentInput, setParentInput] = useState('')
  const [mode, setMode] = useState<FilterMode>('all')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['verified-candidates', field],
    queryFn: () => verifiedApi.candidates(field),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (mode === 'unverified' && r.verified) return false
      if (mode === 'verified' && !r.verified) return false
      if (q && !r.value.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, mode])

  const counts = useMemo(() => {
    let verified = 0, unverified = 0
    for (const r of rows) r.verified ? verified++ : unverified++
    return { all: rows.length, verified, unverified }
  }, [rows])

  const parentFieldFor = (f: string): { field: string; label: string } | null => {
    if (f === 'city') return { field: 'state', label: 'State' }
    if (f === 'state') return { field: 'country', label: 'Country' }
    return null
  }
  const parentCfg = parentFieldFor(field)

  const addBulk = useMutation({
    mutationFn: () => verifiedApi.addBulk({
      field,
      values: Array.from(selected).map((v) => ({ value: v, parent: parentInput.trim() || null })),
    }),
    onSuccess: (r) => {
      toast.success(`${r.added} value${r.added !== 1 ? 's' : ''} verified`)
      setSelected(new Set())
      setParentInput('')
      queryClient.invalidateQueries({ queryKey: ['verified-candidates', field] })
      queryClient.invalidateQueries({ queryKey: ['verified-list', field] })
      queryClient.invalidateQueries({ queryKey: ['verified-all-fields'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to verify'),
  })

  const removeOne = useMutation({
    mutationFn: (id: number) => verifiedApi.remove(id),
    onSuccess: () => {
      toast.success('Unverified')
      queryClient.invalidateQueries({ queryKey: ['verified-candidates', field] })
      queryClient.invalidateQueries({ queryKey: ['verified-list', field] })
      queryClient.invalidateQueries({ queryKey: ['verified-all-fields'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const toggle = (v: string) => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    setSelected(next)
  }
  const selectAllUnverified = () =>
    setSelected(new Set(filtered.filter((r) => !r.verified).map((r) => r.value)))
  const clearSel = () => setSelected(new Set())

  const unverifiedInView = filtered.filter((r) => !r.verified).length

  return (
    <div className="grid lg:grid-cols-4 gap-6">
      {/* Field picker */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b bg-gradient-to-r from-emerald-50/80 to-transparent">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-emerald-500" /> Field
          </h3>
        </div>
        <div className="p-3 space-y-1.5">
          {VERIFIABLE_FIELDS.map((f) => (
            <button key={f.value}
              onClick={() => { setField(f.value); setSelected(new Set()); setSearch(''); setParentInput('') }}
              className={'w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-between ' + (
                field === f.value
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'hover:bg-muted/50 text-muted-foreground border border-transparent'
              )}>
              <span className="flex items-center gap-2">
                <Database className={'h-3.5 w-3.5 ' + (field === f.value ? 'text-emerald-500' : 'text-muted-foreground/40')} />
                {f.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Unified list */}
      <div className="lg:col-span-3 bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b flex items-center justify-between bg-gradient-to-r from-emerald-50/80 to-transparent flex-wrap gap-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            All <span className="capitalize text-emerald-700">{labelFor(field)}</span> values
            <span className="px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-full">{counts.all}</span>
          </h3>
          <div className="flex items-center gap-1 text-xs">
            {(['all', 'unverified', 'verified'] as FilterMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={'px-2.5 py-1 rounded font-medium capitalize transition-colors ' + (
                  mode === m ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:bg-muted'
                )}>
                {m} ({m === 'all' ? counts.all : m === 'verified' ? counts.verified : counts.unverified})
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${labelFor(field).toLowerCase()} values...`}
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </div>
            <div className="flex items-center gap-2 text-xs justify-end">
              <button onClick={selectAllUnverified} disabled={unverifiedInView === 0}
                className="text-blue-600 hover:underline font-medium disabled:opacity-40 disabled:no-underline flex items-center gap-1">
                <CheckSquare className="h-3 w-3" /> Select unverified ({unverifiedInView})
              </button>
              <span className="text-muted-foreground">|</span>
              <button onClick={clearSel} className="text-muted-foreground hover:text-foreground font-medium flex items-center gap-1">
                <Square className="h-3 w-3" /> Clear
              </button>
            </div>
          </div>

          {parentCfg && selected.size > 0 && (
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3">
              <label className="text-xs font-semibold text-emerald-800 uppercase tracking-wide block mb-1.5">
                Attach {parentCfg.label} (optional)
              </label>
              <input value={parentInput} onChange={(e) => setParentInput(e.target.value)}
                placeholder={`e.g. ${parentCfg.field === 'country' ? 'India' : 'Maharashtra'}`}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              <p className="text-xs text-emerald-700 mt-1">
                Records which {parentCfg.label.toLowerCase()} these {labelFor(field).toLowerCase()} values belong to. Used to auto-suggest during cascade fills.
              </p>
            </div>
          )}

          <div className="max-h-[520px] overflow-y-auto border rounded-lg divide-y custom-scrollbar">
            {isLoading ? (
              <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-emerald-500" /></div>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No values match</p>
            ) : filtered.map((r) => (
              <div key={r.value}
                className={'group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ' + (
                  r.verified
                    ? 'bg-emerald-50/40'
                    : selected.has(r.value) ? 'bg-blue-50' : 'hover:bg-muted/40'
                )}>
                {r.verified ? (
                  <BadgeCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <input type="checkbox" checked={selected.has(r.value)} onChange={() => toggle(r.value)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                )}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !r.verified && toggle(r.value)}>
                  <div className={'font-medium truncate ' + (r.verified ? 'text-emerald-900' : '')}>{r.value}</div>
                  {r.parent && <div className="text-xs text-muted-foreground truncate">↳ {r.parent}</div>}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {r.count > 0 ? r.count.toLocaleString() + ' leads' : 'no leads'}
                </span>
                {r.verified && r.verifiedId != null && (
                  <button onClick={() => removeOne.mutate(r.verifiedId!)}
                    title="Unverify"
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button onClick={() => addBulk.mutate()} disabled={selected.size === 0 || addBulk.isPending}
            className="w-full py-3 rounded-lg font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
            {addBulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {selected.size === 0
              ? 'Select values to verify'
              : 'Verify ' + selected.size + ' ' + labelFor(field).toLowerCase() + (selected.size !== 1 ? 's' : '')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Panel B/C: Cascade fill ─────────────────────────────────────────────────

interface CascadeSectionProps {
  title: string
  description: string
  sourceField: string   // e.g. 'city' — the field to filter by
  targetField: string   // e.g. 'state' — the field to write on matched leads
  accent: 'blue' | 'purple'
}

type SourceMode = 'all' | 'missing' | 'conflicting' | 'clean'

const SOURCE_MODES: Array<{ value: SourceMode; label: string; hint: (target: string) => string }> = [
  { value: 'all',         label: 'All',         hint: () => 'Every value found in leads' },
  { value: 'missing',     label: 'Missing',     hint: (t) => `Has leads with no ${t} yet — a cascade would fill them` },
  { value: 'conflicting', label: 'Conflicting', hint: (t) => `Its leads carry more than one ${t} — check before cascading` },
  { value: 'clean',       label: 'Clean',       hint: (t) => `Every lead already carries the same ${t}` },
]

function matchesMode(s: VerifiedCandidate, mode: SourceMode): boolean {
  if (mode === 'all') return true
  if (mode === 'missing') return s.leadParentBlank > 0
  if (mode === 'conflicting') return s.leadParents.length > 1
  return s.leadParentBlank === 0 && s.leadParents.length === 1
}

// Full parent spread for the row's hover — turns a bare "⚠2" into something
// actionable: a junk abbreviation reads differently from a city name that
// genuinely spans two states.
function spreadTooltip(s: VerifiedCandidate, targetLabel: string): string {
  if (s.leadParents.length === 0) return s.parent ? `Verified mapping: ${s.parent}` : ''
  const lines = s.leadParents.map((p) => `${p.value} — ${p.count.toLocaleString()}`)
  if (s.leadParentBlank > 0) {
    lines.push(`(no ${targetLabel.toLowerCase()}) — ${s.leadParentBlank.toLocaleString()}`)
  }
  const shown = s.leadParents.reduce((n, p) => n + p.count, 0) + s.leadParentBlank
  if (shown < s.count) lines.push(`+ ${(s.count - shown).toLocaleString()} more`)
  return lines.join('\n')
}

function CascadeSection({ title, description, sourceField, targetField, accent }: CascadeSectionProps) {
  const queryClient = useQueryClient()
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [sourceMode, setSourceMode] = useState<SourceMode>('all')

  // Source: show ALL distinct values from leads (verified + unverified) so
  // picking is easy. Verified ones are marked with the green tick.
  const { data: allSources = [] } = useQuery({
    queryKey: ['verified-candidates', sourceField],
    queryFn: () => verifiedApi.candidates(sourceField),
  })
  // Target: only verified values are pickable — no free text.
  const { data: verifiedTargets = [] } = useQuery({
    queryKey: ['verified-list', targetField],
    queryFn: () => verifiedApi.list(targetField),
  })

  const filteredSources = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allSources.filter((v) => {
      if (!matchesMode(v, sourceMode)) return false
      return !q || v.value.toLowerCase().includes(q)
    })
  }, [allSources, search, sourceMode])

  const sourceCounts = useMemo(() => {
    let verified = 0, missing = 0, conflicting = 0, clean = 0
    for (const s of allSources) {
      if (s.verified) verified++
      if (matchesMode(s, 'missing')) missing++
      if (matchesMode(s, 'conflicting')) conflicting++
      if (matchesMode(s, 'clean')) clean++
    }
    return {
      all: allSources.length, verified, unverified: allSources.length - verified,
      missing, conflicting, clean,
    }
  }, [allSources])

  const cascade = useMutation({
    mutationFn: (approvedLeadIds: number[]) =>
      verifiedApi.cascadeFill({
        sourceField,
        sourceValues: Array.from(selectedSources),
        targetField,
        targetValue: targetValue.trim(),
        approvedLeadIds: approvedLeadIds.length ? approvedLeadIds : undefined,
      }),
    onSuccess: (d) => {
      toast.success(`${d.count} leads updated`)
      setSelectedSources(new Set())
      setTargetValue('')
      setShowPreview(false)
      queryClient.invalidateQueries({ queryKey: ['bulk-ops-field-update'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Cascade failed'),
  })

  const toggle = (v: string) => {
    const next = new Set(selectedSources)
    if (next.has(v)) next.delete(v); else next.add(v)
    setSelectedSources(next)
  }
  const selectAll = () => setSelectedSources(new Set(filteredSources.map((s) => s.value)))
  const clear = () => setSelectedSources(new Set())

  const canPreview = selectedSources.size > 0 && targetValue.trim()

  const accentBg = accent === 'blue' ? 'from-blue-50/80' : 'from-purple-50/80'
  const accentText = accent === 'blue' ? 'text-blue-500' : 'text-purple-500'
  const accentButton = accent === 'blue'
    ? 'from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
    : 'from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700'

  const targetSuggestions = useMemo(() => {
    if (selectedSources.size === 0) return []
    const parents = new Set<string>()
    for (const src of allSources) {
      if (selectedSources.has(src.value) && src.parent) parents.add(src.parent)
    }
    return Array.from(parents).filter((p) => verifiedTargets.some((t) => t.value === p))
  }, [selectedSources, allSources, verifiedTargets])

  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
      <div className={'px-5 py-3.5 border-b bg-gradient-to-r ' + accentBg + ' to-transparent'}>
        <h3 className="text-sm font-bold flex items-center gap-2">
          <ArrowRight className={'h-4 w-4 ' + accentText} /> {title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 p-4">
        {/* Source multi-select — every distinct value from leads */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              1. Select {labelFor(sourceField)}s
              {selectedSources.size > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-bold bg-blue-100 text-blue-700 rounded-full normal-case">
                  {selectedSources.size} selected
                </span>
              )}
            </label>
            <span className="text-xs text-muted-foreground">
              {sourceCounts.verified}<BadgeCheck className="inline h-3 w-3 text-emerald-500 mx-0.5" />of {sourceCounts.all}
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search all ${labelFor(sourceField).toLowerCase()}s...`}
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className="flex items-center gap-1 text-xs mb-2 flex-wrap">
            {SOURCE_MODES.map((m) => (
              <button key={m.value} onClick={() => setSourceMode(m.value)}
                title={m.hint(labelFor(targetField).toLowerCase())}
                className={'px-2 py-1 rounded font-medium transition-colors ' + (
                  sourceMode === m.value ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
                )}>
                {m.label} ({sourceCounts[m.value].toLocaleString()})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs mb-2">
            <button onClick={selectAll} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
              <CheckSquare className="h-3 w-3" /> Select all ({filteredSources.length})
            </button>
            <span className="text-muted-foreground">|</span>
            <button onClick={clear} className="text-muted-foreground hover:text-foreground font-medium flex items-center gap-1">
              <Square className="h-3 w-3" /> None
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto border rounded-lg bg-muted/10 divide-y custom-scrollbar">
            {filteredSources.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No {labelFor(sourceField).toLowerCase()}s
                {sourceMode !== 'all' ? ' match this filter' : ' in leads yet'}
              </p>
            ) : filteredSources.map((s) => (
              <label key={s.value}
                className={'flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ' + (
                  selectedSources.has(s.value)
                    ? 'bg-blue-50 text-blue-700'
                    : s.verified ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'hover:bg-muted/40'
                )}>
                <input type="checkbox" checked={selectedSources.has(s.value)} onChange={() => toggle(s.value)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {s.verified
                  ? <BadgeCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : <span className="w-3.5 shrink-0" />}
                <span className="truncate flex-1">{s.value}</span>
                {(() => {
                  // State already on this city's leads (falls back to the
                  // verified mapping). Blank when nothing is assigned yet.
                  const assigned = s.leadParent ?? s.parent
                  if (!assigned) return null
                  return (
                    <span className="text-xs text-muted-foreground truncate max-w-[40%]"
                      title={spreadTooltip(s, labelFor(targetField))}>
                      ↳ {assigned}
                      {s.leadParentOthers > 0 && (
                        <span className="text-amber-600 font-semibold"> ⚠{s.leadParentOthers}</span>
                      )}
                    </span>
                  )
                })()}
                {s.leadParentBlank > 0 && (
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200 whitespace-nowrap"
                    title={`${s.leadParentBlank.toLocaleString()} lead${s.leadParentBlank !== 1 ? 's' : ''} with this ${labelFor(sourceField).toLowerCase()} have no ${labelFor(targetField).toLowerCase()} yet — these are the ones a cascade would fill.`}>
                    {s.leadParentBlank.toLocaleString()} no {labelFor(targetField).toLowerCase()}
                  </span>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">{s.count.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Target — verified values shown as picker table, no free text */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              2. Set {labelFor(targetField)} to
              {targetValue && (
                <span className="ml-2 px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-full normal-case inline-flex items-center gap-1">
                  <BadgeCheck className="h-3 w-3" /> {targetValue}
                </span>
              )}
            </label>
            <span className="text-xs text-muted-foreground">{verifiedTargets.length} verified</span>
          </div>

          {verifiedTargets.length === 0 ? (
            <div className="border rounded-lg bg-amber-50 border-amber-200 p-4 text-sm text-amber-800">
              <p className="font-semibold mb-1">No verified {labelFor(targetField).toLowerCase()}s yet</p>
              <p className="text-xs text-amber-700">
                Go to the <strong>{labelFor(targetField)}</strong> field in the section above and verify some values first. Only verified {labelFor(targetField).toLowerCase()}s can be used as the target here — this prevents junk data from creeping back in.
              </p>
            </div>
          ) : (
            <>
              {targetSuggestions.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-medium">Suggested from picks:</span>
                  {targetSuggestions.map((p) => (
                    <button key={p} onClick={() => setTargetValue(p)}
                      className={'text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ' + (
                        targetValue === p
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      )}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-72 overflow-y-auto border rounded-lg divide-y custom-scrollbar">
                <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 py-2 bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span></span>
                  <span>{labelFor(targetField)}</span>
                  <span>Parent</span>
                </div>
                {verifiedTargets.map((t) => (
                  <label key={t.id}
                    className={'grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 py-2 cursor-pointer text-sm transition-colors ' + (
                      targetValue === t.value ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-muted/40'
                    )}>
                    <input type="radio" name={'target-' + targetField} checked={targetValue === t.value}
                      onChange={() => setTargetValue(t.value)}
                      className="h-3.5 w-3.5 border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                    <span className="flex items-center gap-1.5 truncate">
                      <BadgeCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="font-medium truncate">{t.value}</span>
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{t.parent ?? '—'}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          <button onClick={() => setShowPreview(true)} disabled={!canPreview}
            className={'mt-4 w-full py-3 rounded-xl font-semibold text-sm text-white transition-all flex items-center justify-center gap-2 ' + (
              canPreview
                ? 'bg-gradient-to-r ' + accentButton + ' shadow-sm'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}>
            <Eye className="h-4 w-4" /> Preview Changes
          </button>
        </div>
      </div>

      {showPreview && (
        <BulkPreviewModal
          title={title}
          subtitle={`Preview leads with matching ${labelFor(sourceField).toLowerCase()} — their ${labelFor(targetField).toLowerCase()} will be set to "${targetValue.trim()}".`}
          filterField={sourceField}
          filterFieldLabel={labelFor(sourceField)}
          writeField={targetField}
          writeFieldLabel={labelFor(targetField)}
          filterValues={Array.from(selectedSources)}
          newValue={targetValue.trim()}
          onClose={() => setShowPreview(false)}
          onApprove={(ids) => cascade.mutate(ids)}
          isApproving={cascade.isPending}
        />
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VerifiedData() {
  return (
    <div className="space-y-6">
      <ManageVerified />

      <CascadeSection
        title="Update State using Cities"
        description="Pick verified cities → set the state on all leads with those cities. Updates the state field, not the city."
        sourceField="city"
        targetField="state"
        accent="blue"
      />

      <CascadeSection
        title="Update Country using States"
        description="Pick verified states → set the country on all leads with those states. Updates the country field, not the state."
        sourceField="state"
        targetField="country"
        accent="purple"
      />

      <FieldUpdateLogs />
    </div>
  )
}
