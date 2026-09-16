import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, CheckCircle2, XCircle, PhoneOff, Mail, Phone, MessageSquare, Sprout, Search, Upload, Download, MessageSquareOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { leadStagingApi, type LeadStagingBatch, type LeadStagingItem, type LeadStagingUploadRow } from '@/lib/api'
import { downloadTemplate, parseLeadExcel } from '@/lib/lead-upload'
import { Modal } from '@/components/common/Modal'
import { MultiSelectDropdown } from '@/components/common/MultiSelectDropdown'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'
import { useAuthStore } from '@/stores/auth.store'
import { maskPhone } from '@/lib/utils'

type FilterTab = 'all' | 'pending' | 'verified' | 'rejected' | 'call_not_answered' | 'seeded'

export default function FilterLeadsBatch() {
  const { batchId } = useParams({ from: '/app/filter-leads/$batchId' as never }) as { batchId: string }
  const id = Number(batchId)
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  // Phone-mask reveal — only the top-level admin sees full numbers; everyone
  // else (counsellor, sales head, sub-admin) sees the last 5 digits masked.
  const reveal = useAuthStore((s) => s.canRevealPhone())
  // For optimistic attribution — when the current user comments / verifies,
  // we stamp their name onto the cached item immediately.
  const me = useAuthStore((s) => s.user)

  const [tab, setTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  // Options are derived from this batch's own items below, so each folder only
  // surfaces cities/states actually present in that folder's data. Stored as
  // string[] because city names like "ALWAR, SUBHASH NAGAR" contain commas and
  // a CSV would split them mid-name.
  const [cityFilter, setCityFilter] = useState<string[]>([])
  const [stateFilter, setStateFilter] = useState<string[]>([])
  const [noCommentsOnly, setNoCommentsOnly] = useState(false)
  // When true, every USER-SELECTED filter (search/city/state/no-comments) is
  // negated independently. The tab is a view scope and stays untouched.
  const [excludeMode, setExcludeMode] = useState(false)

  // "Add more leads" modal state — admin can append rows to this batch
  // without losing existing data. New rows land at the end of the list.
  const [addOpen, setAddOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingRows, setPendingRows] = useState<LeadStagingUploadRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: batch, isLoading } = useQuery<LeadStagingBatch>({
    queryKey: ['lead-staging', id],
    queryFn: () => leadStagingApi.get(id),
  })

  // Optimistic updates — patch the cached batch immediately so the card flips
  // colour/badge on click. Refetching a 20k+ item batch after every tap would
  // also be wasteful, so we reconcile silently in the background instead of
  // invalidating on success.
  const updateMut = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: { verified?: boolean | null; callNotAnswered?: boolean; comments?: string } }) =>
      leadStagingApi.updateItem(itemId, data),
    onMutate: async ({ itemId, data }) => {
      await qc.cancelQueries({ queryKey: ['lead-staging', id] })
      const prev = qc.getQueryData<LeadStagingBatch>(['lead-staging', id])
      qc.setQueryData<LeadStagingBatch>(['lead-staging', id], (old) => {
        if (!old || !old.items) return old
        // Mirror the backend's mutual-exclusion rule client-side so the card
        // flips instantly without waiting for the server response.
        const meStamp = me ? { id: me.id, name: me.name } : null
        const items = old.items.map((it) => {
          if (it.id !== itemId) return it
          const next = { ...it, ...data }
          if ('callNotAnswered' in data && data.callNotAnswered) next.verified = null
          if ('verified' in data && data.verified !== null) next.callNotAnswered = false
          // Mirror the backend's author-stamping rules so attribution shows up
          // instantly. Clearing a comment clears the author; clearing the
          // verification state keeps the verifier (matches backend behaviour).
          if ('comments' in data) {
            next.commentedBy = data.comments?.trim() ? meStamp : null
          }
          if (('verified' in data && data.verified !== null) || ('callNotAnswered' in data && data.callNotAnswered)) {
            next.verifiedBy = meStamp
          }
          return next
        })
        let verifiedCount = 0
        let callNotAnsweredCount = 0
        for (const it of items) {
          if (it.verified === true) verifiedCount++
          if (it.callNotAnswered) callNotAnsweredCount++
        }
        return { ...old, items, verifiedCount, callNotAnsweredCount }
      })
      return { prev }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['lead-staging', id], ctx.prev)
      toast.error(e?.response?.data?.error || 'Update failed')
    },
    onSettled: () => {
      // Lightweight refresh of the batch-list page (counts on the index view)
      // without refetching this potentially-huge batch payload.
      qc.invalidateQueries({ queryKey: ['lead-staging'], exact: true })
    },
  })

  const appendMut = useMutation({
    mutationFn: (items: LeadStagingUploadRow[]) => leadStagingApi.appendItems(id, items),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lead-staging', id] })
      qc.invalidateQueries({ queryKey: ['lead-staging'] })
      toast.success(`Added ${res.added} lead${res.added === 1 ? '' : 's'} to this batch`)
      resetAdd()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Upload failed'),
  })

  function resetAdd() {
    setAddOpen(false)
    setPendingFile(null)
    setPendingRows([])
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleFile(file: File) {
    setPendingFile(file)
    try {
      const rows = await parseLeadExcel(file)
      if (rows.length === 0) {
        toast.error('No valid rows found. The sheet needs at least a Name / Email / Mobile column.')
        setPendingRows([])
        return
      }
      setPendingRows(rows)
    } catch {
      toast.error('Could not parse the Excel file')
      setPendingRows([])
    }
  }

  const seedMut = useMutation({
    mutationFn: () => leadStagingApi.seed(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lead-staging', id] })
      qc.invalidateQueries({ queryKey: ['lead-staging'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success(`Seeded ${res.seeded} lead${res.seeded === 1 ? '' : 's'} into the CRM`)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Seed failed'),
  })

  const items = batch?.items ?? []
  const counts = useMemo(() => {
    let pending = 0, verified = 0, rejected = 0, callNotAnswered = 0, seeded = 0
    for (const i of items) {
      if (i.seeded) seeded++
      if (i.verified === true) verified++
      else if (i.verified === false) rejected++
      else if (i.callNotAnswered) callNotAnswered++
      else pending++
    }
    return { pending, verified, rejected, callNotAnswered, seeded }
  }, [items])

  // Distinct, sorted city / state values pulled from this batch only — the
  // dropdown options change per folder so each batch shows its own geography.
  const { cityOptions, stateOptions } = useMemo(() => {
    const cities = new Set<string>()
    const states = new Set<string>()
    for (const it of items) {
      const c = it.city?.trim()
      const s = it.state?.trim()
      if (c) cities.add(c)
      if (s) states.add(s)
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    return {
      cityOptions: Array.from(cities).sort(cmp),
      stateOptions: Array.from(states).sort(cmp),
    }
  }, [items])

  const filtered = useMemo(() => {
    const cities = cityFilter.length ? new Set(cityFilter) : null
    const states = stateFilter.length ? new Set(stateFilter) : null
    // In exclude mode, "matches the filter" → drop. Otherwise the original
    // "doesn't match" → drop. The tab filter stays untouched in both modes.
    const reject = (matches: boolean) => (excludeMode ? matches : !matches)
    return items.filter((it) => {
      // "Pending" excludes call-not-answered items since those have their own
      // tab — otherwise they'd double-count in both buckets.
      if (tab === 'pending' && (it.verified !== null || it.callNotAnswered)) return false
      if (tab === 'verified' && it.verified !== true) return false
      if (tab === 'rejected' && it.verified !== false) return false
      if (tab === 'call_not_answered' && !it.callNotAnswered) return false
      if (tab === 'seeded' && !it.seeded) return false
      if (cities && reject(!!(it.city && cities.has(it.city.trim())))) return false
      if (states && reject(!!(it.state && states.has(it.state.trim())))) return false
      if (noCommentsOnly && reject(!it.comments?.trim())) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const matches = `${it.name} ${it.email ?? ''} ${it.phone ?? ''}`.toLowerCase().includes(q)
        if (reject(matches)) return false
      }
      return true
    })
  }, [items, tab, search, cityFilter, stateFilter, noCommentsOnly, excludeMode])

  // Reset to page 1 when filters/search change so we don't land on an empty page
  useEffect(() => { setPage(1) }, [tab, search, perPage, cityFilter, stateFilter, noCommentsOnly, excludeMode])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const paged = filtered.slice((page - 1) * perPage, page * perPage)

  const canSeed = counts.verified > 0 && (batch?.verifiedCount ?? 0) > (batch?.seededCount ?? 0)

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (!batch) return <div className="p-6 text-sm text-destructive">Batch not found</div>

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link
            to="/app/filter-leads"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-3 w-3" /> Back to batches
          </Link>
          <h1 className="text-2xl font-bold truncate">{batch.name}</h1>
          <p className="text-xs text-muted-foreground">
            {batch.fileName || '—'} · uploaded {new Date(batch.createdAt).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-semibold shadow-sm"
              title="Append more leads to this folder — existing leads stay untouched"
            >
              <Upload className="h-4 w-4" />
              Add more leads
            </button>
          )}
          <button
            onClick={() => {
              if (counts.verified === 0) return toast.error('Verify at least one lead first')
              if (confirm(`Seed ${counts.verified - counts.seeded} verified lead(s) into the CRM? Source will be "${batch.name}".`)) {
                seedMut.mutate()
              }
            }}
            disabled={!canSeed || seedMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
          >
            <Sprout className="h-4 w-4" />
            {seedMut.isPending ? 'Seeding…' : 'Seed verified leads'}
          </button>
        </div>
      </div>

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1.5">
          <Tab tab="all" current={tab} onClick={setTab} label={`All (${items.length})`} />
          <Tab tab="pending" current={tab} onClick={setTab} label={`Pending (${counts.pending})`} />
          <Tab tab="verified" current={tab} onClick={setTab} label={`Verified (${counts.verified})`} tone="green" />
          <Tab tab="rejected" current={tab} onClick={setTab} label={`Not Verified (${counts.rejected})`} tone="red" />
          <Tab tab="call_not_answered" current={tab} onClick={setTab} label={`Call Not Answered (${counts.callNotAnswered})`} tone="amber" />
          <Tab tab="seeded" current={tab} onClick={setTab} label={`Seeded (${counts.seeded})`} tone="blue" />
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / email / phone"
            className="pl-8 pr-3 py-2 rounded-lg border bg-background text-sm w-64"
          />
        </div>
      </div>

      {/* Active filter chips — one chip per selected city/state + one for "no
          comments" when on, click × to drop just that one. */}
      {(stateFilter.length > 0 || cityFilter.length > 0 || noCommentsOnly) && (
        <div className="bg-card border rounded-xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Active filters · {stateFilter.length + cityFilter.length + (noCommentsOnly ? 1 : 0)}
            </span>
            {stateFilter.map((s) => (
              <FilterChip
                key={`state:${s}`}
                label={`State: ${s}`}
                onClear={() => setStateFilter((prev) => prev.filter((x) => x !== s))}
              />
            ))}
            {cityFilter.map((c) => (
              <FilterChip
                key={`city:${c}`}
                label={`City: ${c}`}
                onClear={() => setCityFilter((prev) => prev.filter((x) => x !== c))}
              />
            ))}
            {noCommentsOnly && (
              <FilterChip label="No comments" onClear={() => setNoCommentsOnly(false)} />
            )}
            <span className="text-xs text-muted-foreground ml-1">
              · {filtered.length} of {items.length} match
            </span>
            <button
              onClick={() => { setStateFilter([]); setCityFilter([]); setNoCommentsOnly(false) }}
              className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* City / State filters + No Comments toggle */}
      <div className="flex flex-wrap items-end gap-3">
        <FilterModeToggle
          excludeMode={excludeMode}
          onChange={setExcludeMode}
          label="Match"
          className="self-end pb-2"
        />
        <div className="min-w-[160px] flex-1">
          <label className="text-xs font-semibold text-muted-foreground">State</label>
          <MultiSelectDropdown
            options={stateOptions}
            value={stateFilter}
            onChange={setStateFilter}
            placeholder={stateOptions.length ? `All states (${stateOptions.length})` : 'No states in this folder'}
            searchPlaceholder="Search states..."
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="text-xs font-semibold text-muted-foreground">City</label>
          <MultiSelectDropdown
            options={cityOptions}
            value={cityFilter}
            onChange={setCityFilter}
            placeholder={cityOptions.length ? `All cities (${cityOptions.length})` : 'No cities in this folder'}
            searchPlaceholder="Search cities..."
          />
        </div>
        <button
          onClick={() => setNoCommentsOnly((v) => !v)}
          title="Show only leads with no counsellor comment"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
            noCommentsOnly
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card text-muted-foreground border-border hover:bg-accent'
          }`}
        >
          <MessageSquareOff className="h-3.5 w-3.5" />
          No comments
        </button>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="border rounded-2xl p-10 text-center bg-card text-sm text-muted-foreground">
          No leads match this filter.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paged.map((it) => (
              <LeadCard
                key={it.id}
                item={it}
                reveal={reveal}
                onSetVerified={(v) => updateMut.mutate({ itemId: it.id, data: { verified: v } })}
                onSetCallNotAnswered={(v) => updateMut.mutate({ itemId: it.id, data: { callNotAnswered: v } })}
                onSaveComment={(c) => updateMut.mutate({ itemId: it.id, data: { comments: c } })}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-xs text-muted-foreground">
              Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Per page</label>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                className="px-2 py-1 text-sm border rounded bg-background"
              >
                {[50, 100, 200, 500].map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add more leads modal — append to this batch without losing existing data */}
      <Modal
        isOpen={addOpen}
        onClose={resetAdd}
        title={`Add more leads to "${batch.name}"`}
        size="lg"
        footer={
          <>
            <button
              onClick={resetAdd}
              className="px-3 py-2 rounded-lg border text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (pendingRows.length === 0) return toast.error('Pick an Excel file first')
                appendMut.mutate(pendingRows)
              }}
              disabled={appendMut.isPending || pendingRows.length === 0}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {appendMut.isPending ? 'Adding…' : `Add ${pendingRows.length || ''} leads`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            New rows will be appended <strong>after</strong> the existing {batch.totalCount} lead{batch.totalCount === 1 ? '' : 's'} in this folder.
            Existing data is not touched.
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Excel file (.xlsx / .xls / .csv)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Use the same column layout as the original upload.{' '}
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> Download template
              </button>
            </p>
            {pendingFile && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Selected: <span className="font-medium">{pendingFile.name}</span>
              </p>
            )}
          </div>

          {pendingRows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-xs font-medium flex justify-between">
                <span>Preview – first 5 of {pendingRows.length} rows</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Name</th>
                      <th className="px-3 py-1.5 text-left">Email</th>
                      <th className="px-3 py-1.5 text-left">Mobile</th>
                      <th className="px-3 py-1.5 text-left">City</th>
                      <th className="px-3 py-1.5 text-left">State</th>
                      <th className="px-3 py-1.5 text-left">Course</th>
                      <th className="px-3 py-1.5 text-left">Lead Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{r.name || '—'}</td>
                        <td className="px-3 py-1.5">{r.email || '—'}</td>
                        <td className="px-3 py-1.5">{r.phone ? maskPhone(r.phone, reveal) : '—'}</td>
                        <td className="px-3 py-1.5">{r.city || '—'}</td>
                        <td className="px-3 py-1.5">{r.state || '—'}</td>
                        <td className="px-3 py-1.5">{r.intrestedCourse || '—'}</td>
                        <td className="px-3 py-1.5">{r.leadType || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
      <span className="max-w-[220px] truncate" title={label}>{label}</span>
      <button
        onClick={onClear}
        title="Remove this filter"
        className="flex items-center justify-center h-4 w-4 rounded-full hover:bg-primary/20 leading-none"
      >
        ×
      </button>
    </span>
  )
}

function Tab({
  tab, current, onClick, label, tone,
}: {
  tab: FilterTab
  current: FilterTab
  onClick: (t: FilterTab) => void
  label: string
  tone?: 'green' | 'red' | 'blue' | 'amber'
}) {
  const active = current === tab
  const toneCls =
    tone === 'green' ? 'text-emerald-700' :
    tone === 'red' ? 'text-rose-700' :
    tone === 'blue' ? 'text-sky-700' :
    tone === 'amber' ? 'text-amber-700' : ''
  return (
    <button
      onClick={() => onClick(tab)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        active ? 'bg-primary text-primary-foreground border-primary' : `bg-card hover:bg-accent ${toneCls}`
      }`}
    >
      {label}
    </button>
  )
}

function LeadCard({
  item,
  reveal,
  onSetVerified,
  onSetCallNotAnswered,
  onSaveComment,
}: {
  item: LeadStagingItem
  reveal: boolean
  onSetVerified: (v: boolean | null) => void
  onSetCallNotAnswered: (v: boolean) => void
  onSaveComment: (c: string) => void
}) {
  const [comment, setComment] = useState(item.comments ?? '')
  const [editing, setEditing] = useState(false)

  // Keep the textarea's starting value in sync with the latest saved comment
  // — without this, opening the editor after a save shows the previous draft.
  useEffect(() => {
    if (!editing) setComment(item.comments ?? '')
  }, [item.comments, editing])

  // Color rules:
  // seeded + verified → green
  // verified (not seeded) → light green
  // rejected → red
  // call_not_answered → amber (kept out of the seed pool until reached)
  // pending → neutral
  const status: 'seeded' | 'verified' | 'rejected' | 'call_not_answered' | 'pending' =
    item.seeded ? 'seeded'
    : item.verified === true ? 'verified'
    : item.verified === false ? 'rejected'
    : item.callNotAnswered ? 'call_not_answered'
    : 'pending'

  const styles = {
    seeded:   'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/30',
    verified: 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20',
    rejected: 'border-rose-400 bg-rose-50 dark:bg-rose-950/30',
    call_not_answered: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30',
    pending:  'border-border bg-card',
  }[status]

  const badgeFor = () => {
    if (status === 'seeded') return <Badge tone="green-solid">Seeded ✓</Badge>
    if (status === 'verified') return <Badge tone="green">Verified</Badge>
    if (status === 'rejected') return <Badge tone="red">Not Verified</Badge>
    if (status === 'call_not_answered') return <Badge tone="amber">Call Not Answered</Badge>
    return <Badge tone="muted">Pending</Badge>
  }

  const locked = item.seeded

  return (
    <div className={`border-2 rounded-xl p-4 space-y-3 transition-colors ${styles}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{item.name}</h3>
          {/* Attribution — whoever owns this row's review work. After seeding,
              the lead is assigned ONLY to the verifier, so making the name
              visible up-front prevents confusion over multi-assignee folders. */}
          {(item.verifiedBy || item.commentedBy) && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {item.verifiedBy
                ? <>Reviewed by <span className="font-semibold text-foreground/80">{item.verifiedBy.name}</span></>
                : <>Comment by <span className="font-semibold text-foreground/80">{item.commentedBy!.name}</span></>}
            </p>
          )}
        </div>
        {badgeFor()}
      </div>

      <div className="space-y-1 text-xs">
        {item.email && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.email}</span>
          </div>
        )}
        {item.phone && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{maskPhone(item.phone, reveal)}</span>
          </div>
        )}
        {!item.email && !item.phone && (
          <div className="text-xs italic text-muted-foreground/70">No contact info</div>
        )}

        {/* Extra profile fields from the bulk upload — surface anything the
            user provided so the admin can verify against the full record, not
            just name/email/phone. */}
        {(() => {
          const extras: Array<[string, string | null]> = [
            ['Father', item.father],
            ['Mother', item.mother],
            ['Email 2', item.email2],
            ['Email 3', item.email3],
            ['Mobile 2', item.mobile2 ? maskPhone(item.mobile2, reveal) : null],
            ['Mobile 3', item.mobile3 ? maskPhone(item.mobile3, reveal) : null],
            ['Father Mobile', item.fatherMobile ? maskPhone(item.fatherMobile, reveal) : null],
            ['Mother Mobile', item.motherMobile ? maskPhone(item.motherMobile, reveal) : null],
            ['City', item.city],
            ['State', item.state],
            ['Country', item.country],
            ['Pincode', item.pincode],
            ['DOB', item.dob],
            ['Gender', item.gender],
            ['Nationality', item.nationality],
            ['Course', item.intrestedCourse],
            ['University', item.intrestedUniversity],
            ['Event', item.event],
            ['Source', item.source],
            ['Lead Type', item.leadType],
          ].filter((p): p is [string, string] => !!p[1])
          if (extras.length === 0 && !item.leadComment) return null
          return (
            <div className="pt-1.5 mt-1.5 border-t border-border/60 grid grid-cols-2 gap-x-2 gap-y-0.5">
              {extras.map(([k, v]) => (
                <div key={k} className="truncate" title={`${k}: ${v}`}>
                  <span className="text-muted-foreground/70">{k}:</span>{' '}
                  <span className="font-medium">{v}</span>
                </div>
              ))}
              {item.leadComment && (
                <div className="col-span-2 mt-1 text-foreground/80 italic line-clamp-2" title={item.leadComment}>
                  “{item.leadComment}”
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Verify buttons — three mutually-exclusive review states. Tapping the
          active state toggles it back to pending. Call-not-answered items stay
          out of the seed pool until someone reaches them and flips to verified. */}
      {!locked && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onSetVerified(item.verified === true ? null : true)}
            className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              item.verified === true
                ? 'bg-emerald-600 text-white'
                : 'bg-card border hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Verified
          </button>
          <button
            onClick={() => onSetVerified(item.verified === false ? null : false)}
            className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              item.verified === false
                ? 'bg-rose-600 text-white'
                : 'bg-card border hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700'
            }`}
          >
            <XCircle className="h-3.5 w-3.5" />
            Not Verified
          </button>
          <button
            onClick={() => onSetCallNotAnswered(!item.callNotAnswered)}
            title="Couldn't reach this lead — keeps them out of the seed pool until verified"
            className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              item.callNotAnswered
                ? 'bg-amber-500 text-white'
                : 'bg-card border hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'
            }`}
          >
            <PhoneOff className="h-3.5 w-3.5" />
            Call N/A
          </button>
        </div>
      )}

      {/* Comment */}
      <div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <MessageSquare className="h-3 w-3" />
          {item.comments ? 'Edit comment' : 'Add comment'}
        </button>
        {editing ? (
          <div className="mt-1.5 space-y-1.5">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Notes from the call…"
              className="w-full px-2 py-1.5 rounded border bg-background text-xs"
              disabled={locked}
            />
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={() => {
                  setComment(item.comments ?? '')
                  setEditing(false)
                }}
                className="px-2 py-1 rounded text-[11px] border hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onSaveComment(comment)
                  setEditing(false)
                }}
                disabled={locked}
                className="px-2 py-1 rounded text-[11px] bg-primary text-primary-foreground"
              >
                Save
              </button>
            </div>
          </div>
        ) : item.comments ? (
          <div className="mt-1">
            <p className="text-xs italic text-foreground/80 line-clamp-3">“{item.comments}”</p>
            {item.commentedBy && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                — <span className="font-semibold text-foreground/70">{item.commentedBy.name}</span>
              </p>
            )}
          </div>
        ) : null}
      </div>

      {item.seeded && item.leadId && (
        <Link
          to="/app/leads/$leadId"
          params={{ leadId: String(item.leadId) }}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[11px] text-emerald-700 hover:underline font-medium"
        >
          Open in CRM →
        </Link>
      )}
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'green' | 'green-solid' | 'red' | 'amber' | 'muted' }) {
  const cls = {
    'green': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'green-solid': 'bg-emerald-600 text-white border-emerald-700',
    'red': 'bg-rose-100 text-rose-700 border-rose-200',
    'amber': 'bg-amber-100 text-amber-700 border-amber-200',
    'muted': 'bg-muted text-muted-foreground border-border',
  }[tone]
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider shrink-0 ${cls}`}>
      {children}
    </span>
  )
}
