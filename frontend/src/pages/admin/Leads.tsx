import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, leadConfigApi, usersApi } from '@/lib/api'
import { downloadBlob } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { BulkActionBar } from '@/components/leads/BulkActionBar'
import { ImportCsvModal } from '@/components/leads/ImportCsvModal'
import { UpdateStatusModal } from '@/components/leads/UpdateStatusModal'
import { QuickEditModal } from '@/components/leads/QuickEditModal'
import { WhatsappSendModal } from '@/components/leads/WhatsappSendModal'
import { LeadCard, getWebsiteConfig } from '@/components/leads/LeadCard'
import { MultiSelectDropdown } from '@/components/common/MultiSelectDropdown'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'
import { useSavedFilters } from '@/hooks/useSavedFilters'
import type { Lead } from '@/types'
import {
  Plus, Search, Download, Upload,
  ChevronLeft, ChevronRight, Filter, Loader2,
  Bookmark, BookmarkCheck,
  User,
  RefreshCw,
  ClipboardCheck, X, Ban,
} from 'lucide-react'

const FRESH_STATUS_VALUE = 'fresh'

// ─── Filter State ─────────────────────────────────────────────────────────────
type FilterState = {
  search: string; departmentId: string; leadStatusId: string; leadSubStatusId: string
  website: string; source: string; event: string; state: string; city: string; country: string
  intrestedCourse: string; fromDate: string; toDate: string
  followupFrom: string; followupTo: string; called: string; wapp: string
  isDuplicate: string
  // Dashboard deep-link filters. `enrolled='1'` = enrolled students,
  // `enrolled='0'` = active pipeline (not enrolled + null). `overdue='1'` =
  // real overdue follow-ups (excludes 0001-01-01 placeholders, matching the
  // dashboard's Overdue card exactly).
  enrolled: string
  overdue: string
  // JSON-encoded array of "min-max" bucket tokens, e.g. ["10-20","20-30","100-"].
  // Empty upper ("100-") means "and above".
  leadScoreRanges: string
  assignedCounsellors: string // comma-separated counsellor ids (admin only)
  // Filters on AsignedLead.createdAt — "leads assigned (to me / to picked
  // counsellors) within this window". Useful for finding newly handed-over
  // leads regardless of when the lead itself was created.
  assignedFrom: string; assignedTo: string
  // '1' = negate every user-selected filter, '' = include (default).
  excludeMode: string
  // Comma-separated lead IDs — set when the page is opened from a Calling Task
  // "View leads" button to scope the list to that batch. `batchLabel` is a
  // display-only hint shown in the task-scope banner.
  ids: string
  batchLabel: string
  [k: string]: string
}
const emptyFilters: FilterState = {
  search: '', departmentId: '', leadStatusId: '', leadSubStatusId: '',
  website: '', source: '', event: '', state: '', city: '', country: '', intrestedCourse: '',
  fromDate: '', toDate: '', followupFrom: '', followupTo: '', called: '', wapp: '',
  isDuplicate: '', leadScoreRanges: '', assignedCounsellors: '',
  assignedFrom: '', assignedTo: '', excludeMode: '',
  ids: '', batchLabel: '',
  enrolled: '', overdue: '',
}

function parseMultiFilterValue(value?: string | null): string[] {
  if (!value) return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean)
      }
    } catch {
      // Older saved filters use comma-separated strings; fall through to that.
    }
  }
  return trimmed.split(',').map((v) => v.trim()).filter(Boolean)
}

function stringifyMultiFilterValue(values: string[]): string {
  const clean = values.map((v) => String(v).trim()).filter(Boolean)
  return clean.length ? JSON.stringify(clean) : ''
}

// Filter keys the user actually PICKED, mapped to the clause key the API tags
// them with. These are the only ones Exclude mode may invert.
//
// Everything else the page sends is navigation scope, not a choice: the
// department sub-nav (`departmentId`), the lead-type tab (`statusLeadTypeId`),
// a Calling-Task batch (`ids`) and the dashboard deep-links (`enrolled`,
// `overdue`). Those used to be negated along with everything else, which is why
// Exclude appeared broken — flipping it while sitting in a department/tab threw
// you out of that very department/tab (the API returned everything BUT it)
// while the UI still highlighted the tab, and the tab/department badges — which
// re-run the same query — went with it.
const EXCLUDABLE_FILTER_KEYS: Array<{ keys: Array<keyof FilterState>; clause: string }> = [
  { keys: ['search'], clause: 'search' },
  { keys: ['leadStatusId'], clause: 'leadStatusId' },
  { keys: ['leadSubStatusId'], clause: 'leadSubStatusId' },
  { keys: ['website'], clause: 'website' },
  { keys: ['source'], clause: 'source' },
  { keys: ['event'], clause: 'event' },
  { keys: ['state'], clause: 'state' },
  { keys: ['city'], clause: 'city' },
  { keys: ['country'], clause: 'country' },
  { keys: ['intrestedCourse'], clause: 'intrestedCourse' },
  { keys: ['leadScoreRanges'], clause: 'leadScoreRanges' },
  { keys: ['called'], clause: 'called' },
  { keys: ['wapp'], clause: 'wapp' },
  { keys: ['isDuplicate'], clause: 'isDuplicate' },
  { keys: ['assignedCounsellors'], clause: 'assignedCounsellors' },
  { keys: ['fromDate', 'toDate'], clause: 'createdAt' },
  { keys: ['followupFrom', 'followupTo'], clause: 'followupDate' },
  { keys: ['assignedFrom', 'assignedTo'], clause: 'assignedDate' },
]

function buildParams(f: FilterState, page: number, limit: number, activeTab: string) {
  const p: Record<string, string> = { page: String(page), limit: String(limit) }
  if (f.search) p.search = f.search
  if (f.departmentId) p.departmentId = f.departmentId
  if (f.leadStatusId) p.leadStatusId = f.leadStatusId
  if (f.leadSubStatusId) p.leadSubStatusId = f.leadSubStatusId
  if (f.website) p.website = f.website
  if (f.source) p.source = f.source
  if (f.event) p.event = f.event
  if (f.state) p.state = f.state
  if (f.city) p.city = f.city
  if (f.country) p.country = f.country
  if (f.intrestedCourse) p.intrestedCourse = f.intrestedCourse
  if (f.fromDate) p.fromDate = f.fromDate
  if (f.toDate) p.toDate = f.toDate
  if (f.followupFrom) p.followupFrom = f.followupFrom
  if (f.followupTo) p.followupTo = f.followupTo
  if (f.assignedFrom) p.assignedFrom = f.assignedFrom
  if (f.assignedTo) p.assignedTo = f.assignedTo
  if (f.called) p.called = f.called
  if (f.wapp) p.wapp = f.wapp
  if (f.isDuplicate) p.isDuplicate = f.isDuplicate
  if (f.leadScoreRanges) p.leadScoreRanges = f.leadScoreRanges
  if (f.assignedCounsellors) p.assignedCounsellors = f.assignedCounsellors
  if (f.excludeMode === '1') {
    // Scope the negation to the filters the user actually picked (see
    // EXCLUDABLE_FILTER_KEYS). Sending the list explicitly keeps the API's
    // legacy "negate everything" behaviour intact for other callers.
    const fields = EXCLUDABLE_FILTER_KEYS
      .filter((e) => e.keys.some((k) => f[k]))
      .map((e) => e.clause)
    if (fields.length) {
      p.excludeMode = '1'
      p.excludeFields = fields.join(',')
    }
  }
  if (f.ids) p.ids = f.ids
  if (f.enrolled === '0' || f.enrolled === '1') p.enrolled = f.enrolled
  if (f.overdue === '1') p.overdue = '1'
  // NOTE: batchLabel is a display-only hint — never sent to the API.
  if (activeTab && activeTab !== 'all') p.statusLeadTypeId = activeTab
  return p
}
function activeFilterCount(f: FilterState) {
  // Don't count excludeMode toward the filter badge — it modifies how filters
  // are matched but isn't itself a filter. `ids` and `batchLabel` are shown as
  // their own task-scope banner, not counted here.
  const skip = new Set(['excludeMode', 'ids', 'batchLabel'])
  return Object.entries(f).filter(([k, v]) => !skip.has(k) && v !== '').length
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function Leads() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  // Exporting leads is restricted to the top-level admin only.
  const canExport = useAuthStore((s) => s.isFullAdmin())

  // URL is the only source of truth for filters / tab / dept / page. Visiting
  // /app/leads with no query string (e.g. clicking the sidebar link) lands on
  // a fresh, unfiltered view. Pagination + filters are mirrored to the URL via
  // replaceState (below) so going page 1 → 2 → 3 — or refreshing mid-paging —
  // keeps the same filtered view applied. Dashboard deep-links keep working
  // because they pass the filters as query params.
  const initialFilters: FilterState = (() => {
    if (typeof window === 'undefined') return emptyFilters
    const sp = new URLSearchParams(window.location.search)
    const f: FilterState = { ...emptyFilters }
    for (const key of Object.keys(emptyFilters)) {
      const v = sp.get(key)
      if (v) f[key] = v
    }
    return f
  })()
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'all'
    return new URLSearchParams(window.location.search).get('tab') ?? 'all'
  })()
  const initialDept = (() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('dept') ?? ''
  })()
  const initialPage = (() => {
    if (typeof window === 'undefined') return 1
    const v = new URLSearchParams(window.location.search).get('page')
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : 1
  })()
  const initialPageSize = (() => {
    if (typeof window === 'undefined') return 25
    const v = new URLSearchParams(window.location.search).get('pageSize')
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : 25
  })()

  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [filters, setFilters] = useState<FilterState>(initialFilters)
  const [pendingFilters, setPendingFilters] = useState<FilterState>(initialFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [activeTab, setActiveTab] = useState(initialTab)
  const [activeDept, setActiveDept] = useState(initialDept)
  const [statusModalLead, setStatusModalLead] = useState<Lead | null>(null)
  const [quickEditLead, setQuickEditLead] = useState<Lead | null>(null)
  const [wappModalLead, setWappModalLead] = useState<Lead | null>(null)

  // Merge activeDept into filters for query building
  const effectiveFilters = { ...filters, departmentId: activeDept }
  const params = buildParams(effectiveFilters, page, pageSize, activeTab)

  // Mirror pagination + tab + active filters into the URL via replaceState so
  // refresh / back-button / pagination clicks preserve the exact view. Using
  // replaceState (not navigate) keeps the history stack clean and avoids
  // re-triggering router route-loaders for every page/tab click.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v) sp.set(k, v)
    }
    if (activeTab && activeTab !== 'all') sp.set('tab', activeTab)
    if (activeDept) sp.set('dept', activeDept)
    if (page > 1) sp.set('page', String(page))
    if (pageSize !== 25) sp.set('pageSize', String(pageSize))
    const qs = sp.toString()
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next)
    }
  }, [page, pageSize, activeTab, activeDept, filters])

  const { data, isLoading, refetch } = useQuery({ queryKey: ['leads', params], queryFn: () => leadsApi.list(params) })
  const { data: departments = [] } = useQuery({ queryKey: ['lead-config-departments'], queryFn: leadConfigApi.departments })
  const { data: statuses = [] } = useQuery({ queryKey: ['lead-config-statuses'], queryFn: leadConfigApi.statuses })
  const { data: subStatuses = [] } = useQuery({
    queryKey: ['lead-config-sub-statuses', pendingFilters.leadStatusId],
    queryFn: () => leadConfigApi.subStatuses(pendingFilters.leadStatusId ? Number(pendingFilters.leadStatusId) : undefined),
    enabled: !!pendingFilters.leadStatusId && pendingFilters.leadStatusId !== FRESH_STATUS_VALUE,
  })
  const tabParams = { ...params }
  delete tabParams.statusLeadTypeId
  const { data: tabData } = useQuery({ queryKey: ['lead-tab-counts', tabParams], queryFn: () => leadsApi.tabCounts(tabParams), staleTime: 30_000 })

  // Per-department counts use the same filters but ignore the current dept /
  // type so each tab shows its own total — switching tabs becomes one-click.
  const deptCountParams = { ...params }
  delete deptCountParams.departmentId
  delete deptCountParams.statusLeadTypeId
  const { data: deptCountsData } = useQuery({
    queryKey: ['lead-department-counts', deptCountParams],
    queryFn: () => leadsApi.departmentCounts(deptCountParams),
    staleTime: 30_000,
  })
  const deptCountById = new Map<string, number>(
    (deptCountsData?.departments ?? []).map((d: { id: number; count: number }) => [String(d.id), d.count])
  )

  // Counsellor list for the admin-only "Assigned to" multi-select filter
  const { data: counsellorsList = [] } = useQuery<Array<{ id: number; name: string; role: string }>>({
    queryKey: ['users', 'counsellors'],
    queryFn: usersApi.counsellors,
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  })

  // Baseline (unfiltered) values so dropdowns are NEVER empty on load or reset
  const { data: defaultWebsites = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'website'],
    queryFn: () => leadsApi.fieldValues('website'),
    staleTime: 5 * 60_000,
  })
  const { data: defaultCountries = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'country'],
    queryFn: () => leadsApi.fieldValues('country'),
    staleTime: 5 * 60_000,
  })
  const { data: defaultStates = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'state'],
    queryFn: () => leadsApi.fieldValues('state'),
    staleTime: 5 * 60_000,
  })
  const { data: defaultCities = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'city'],
    queryFn: () => leadsApi.fieldValues('city'),
    staleTime: 5 * 60_000,
  })
  const { data: defaultCourses = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'intrestedCourse'],
    queryFn: () => leadsApi.fieldValues('intrestedCourse'),
    staleTime: 5 * 60_000,
  })
  const { data: defaultEvents = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'event'],
    queryFn: () => leadsApi.fieldValues('event'),
    staleTime: 5 * 60_000,
  })
  const { data: defaultSources = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'source'],
    queryFn: () => leadsApi.fieldValues('source'),
    staleTime: 5 * 60_000,
  })

  const defaultEventOrSourceValues = useMemo(() => {
    const seen = new Map<string, string>()
    for (const v of [...defaultEvents, ...defaultSources]) {
      if (!v) continue
      const trimmed = String(v).trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, trimmed)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [defaultEvents, defaultSources])

  // Dynamic cascading filter options based on pending filters & active dept
  const pendingOptionsParams = useMemo(() => {
    return buildParams({ ...pendingFilters, departmentId: activeDept || pendingFilters.departmentId }, 1, 25, activeTab)
  }, [pendingFilters, activeDept, activeTab])

  const { data: dynamicOptions } = useQuery({
    queryKey: ['lead-filter-options', pendingOptionsParams],
    queryFn: () => leadsApi.filterOptions(pendingOptionsParams),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  })

  const filteredStatuses = useMemo(() => {
    if (!dynamicOptions) return statuses
    const set = new Set(dynamicOptions.statusIds)
    if (pendingFilters.leadStatusId && pendingFilters.leadStatusId !== FRESH_STATUS_VALUE) {
      set.add(pendingFilters.leadStatusId)
    }
    return statuses.filter((s: any) => set.has(String(s.id)))
  }, [statuses, dynamicOptions, pendingFilters.leadStatusId])

  const showFreshStatus = !dynamicOptions || dynamicOptions.hasFresh || pendingFilters.leadStatusId === FRESH_STATUS_VALUE

  const filteredSubStatuses = useMemo(() => {
    if (!dynamicOptions) return subStatuses
    const set = new Set(dynamicOptions.subStatusIds)
    if (pendingFilters.leadSubStatusId) {
      set.add(pendingFilters.leadSubStatusId)
    }
    return subStatuses.filter((s: any) => set.has(String(s.id)))
  }, [subStatuses, dynamicOptions, pendingFilters.leadSubStatusId])

  const websiteValues = useMemo(() => {
    const list = dynamicOptions ? dynamicOptions.websites : defaultWebsites
    const set = new Set(list)
    if (pendingFilters.website) set.add(pendingFilters.website)
    return Array.from(set).sort()
  }, [dynamicOptions, defaultWebsites, pendingFilters.website])

  const countryValues = useMemo(() => {
    const list = dynamicOptions && dynamicOptions.countries ? dynamicOptions.countries : defaultCountries
    const selected = parseMultiFilterValue(pendingFilters.country)
    const set = new Set([...list, ...selected])
    return Array.from(set).sort()
  }, [dynamicOptions, defaultCountries, pendingFilters.country])

  const stateValues = useMemo(() => {
    const list = dynamicOptions ? dynamicOptions.states : defaultStates
    const selected = parseMultiFilterValue(pendingFilters.state)
    const set = new Set([...list, ...selected])
    return Array.from(set).sort()
  }, [dynamicOptions, defaultStates, pendingFilters.state])

  const cityValues = useMemo(() => {
    const list = dynamicOptions ? dynamicOptions.cities : defaultCities
    const selected = parseMultiFilterValue(pendingFilters.city)
    const set = new Set([...list, ...selected])
    return Array.from(set).sort()
  }, [dynamicOptions, defaultCities, pendingFilters.city])

  const courseValues = useMemo(() => {
    const list = dynamicOptions ? dynamicOptions.courses : defaultCourses
    const selected = parseMultiFilterValue(pendingFilters.intrestedCourse)
    const set = new Set([...list, ...selected])
    return Array.from(set).sort()
  }, [dynamicOptions, defaultCourses, pendingFilters.intrestedCourse])

  // Lead-score bucket options: "0-10", "10-20", ... up to ceil((max+1)/10)*10.
  // Uses dynamicOptions.maxLeadScore so the last bucket always contains the
  // highest actual score in the visible dataset. Values are inclusive-lower /
  // exclusive-upper on the backend (0-10 = [0,10), matching the token format).
  const leadScoreBucketValues = useMemo(() => {
    const max = dynamicOptions?.maxLeadScore ?? 0
    const roundedTop = Math.max(10, Math.ceil((max + 1) / 10) * 10)
    const arr: string[] = []
    for (let lo = 0; lo < roundedTop; lo += 10) arr.push(`${lo}-${lo + 10}`)
    // Always surface any currently-selected buckets so they don't drop off the
    // list when the visible max shrinks after other filters are applied.
    for (const v of parseMultiFilterValue(pendingFilters.leadScoreRanges)) {
      if (!arr.includes(v)) arr.push(v)
    }
    return arr
  }, [dynamicOptions?.maxLeadScore, pendingFilters.leadScoreRanges])

  const eventOrSourceValues = useMemo(() => {
    const list = dynamicOptions ? dynamicOptions.events : defaultEventOrSourceValues
    const selected = parseMultiFilterValue(pendingFilters.event)
    const set = new Set([...list, ...selected])
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [dynamicOptions, defaultEventOrSourceValues, pendingFilters.event])
  const selectedCounsellorIds = pendingFilters.assignedCounsellors
    ? pendingFilters.assignedCounsellors.split(',').filter(Boolean)
    : []
  function toggleCounsellor(id: string) {
    const set = new Set(selectedCounsellorIds)
    set.has(id) ? set.delete(id) : set.add(id)
    setPendingFilters((f) => ({ ...f, assignedCounsellors: Array.from(set).join(',') }))
  }
  const [counsellorSearch, setCounsellorSearch] = useState('')
  const filteredCounsellors = counsellorsList.filter((u) =>
    !counsellorSearch.trim() ||
    u.name.toLowerCase().includes(counsellorSearch.toLowerCase())
  )

  const toggleWapp = useMutation({ mutationFn: (id: number) => leadsApi.toggleWapp(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }), onError: () => toast.error('Failed') })

  function applyFilters() { setFilters(pendingFilters); setPage(1); setShowFilters(false) }
  function toggleSelect(id: number) { setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function selectAll() { if (data) setSelected(new Set(data.data.map((l: any) => l.id))) }
  async function handleExport() {
    try {
      const blob = selected.size > 0 ? await leadsApi.exportSelected(Array.from(selected)) : await leadsApi.exportCsv(params)
      downloadBlob(blob, 'leads.csv'); toast.success('Exported')
    } catch { toast.error('Export failed') }
  }

  const filterCount = activeFilterCount(filters)
  const { saved: savedFilters, save: saveFilter, remove: removeFilter } = useSavedFilters<FilterState>('leads')

  function handleSaveFilter() {
    if (filterCount === 0) { toast.error('No active filters to save'); return }
    const name = window.prompt('Name this filter set:')
    if (!name) return
    saveFilter(name, filters)
    toast.success(`Saved "${name}"`)
  }

  function handleApplySavedFilter(filters: FilterState) {
    setPendingFilters(filters)
    setFilters(filters)
    setPage(1)
  }

  function handleDeptChange(deptId: string) {
    // Preserve filters when switching departments — users who land here from a
    // dashboard deep-link (e.g. ?event=meta_ads_2026) expect the event/source
    // chip to survive a department switch so they can compare campaign
    // performance across departments without re-entering the filter.
    // Lead-type tab is reset because tab IDs are department-scoped.
    setActiveDept(deptId)
    setActiveTab('all')
    setPage(1)
  }

  function handleResetAll() {
    setPendingFilters(emptyFilters)
    setFilters(emptyFilters)
    setActiveDept('')
    setActiveTab('all')
    setPage(1)
    setShowFilters(false)
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          {data && <p className="text-sm text-muted-foreground mt-0.5">{data.total?.toLocaleString()} leads total</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-accent transition-colors">
            <Upload className="h-4 w-4" /> Import
          </button>
          {canExport && (
            <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-accent transition-colors">
              <Download className="h-4 w-4" /> {selected.size > 0 ? `Export (${selected.size})` : 'Export CSV'}
            </button>
          )}
          <button onClick={() => navigate({ to: '/app/leads/new' })}
            className="flex items-center gap-2 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Add Lead
          </button>
        </div>
      </div>

      {/* ── Task-scope banner ── shown when the page was opened from a Calling Task
          via its "View leads" button. `ids` param scopes the list to that batch. */}
      {filters.ids && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardCheck className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-primary">
                Task view: {filters.batchLabel || 'Calling task'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Showing {filters.ids.split(',').filter(Boolean).length} lead{filters.ids.split(',').filter(Boolean).length === 1 ? '' : 's'} from this task. Update statuses / follow-ups here — the task auto-tracks progress.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              const next = { ...filters, ids: '', batchLabel: '' }
              setPendingFilters(next); setFilters(next); setPage(1)
            }}
            className="flex items-center gap-1 rounded-md border border-primary/40 bg-background px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
            title="Clear task scope and see all leads"
          >
            <X className="h-3 w-3" /> Clear task scope
          </button>
        </div>
      )}

      {/* ── Department Tabs ── */}
      <div className="bg-card border rounded-xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => handleDeptChange('')}
            className={`px-4 py-2 text-sm rounded-lg font-semibold transition-all ${!activeDept ? 'bg-primary text-primary-foreground shadow-sm' : 'border text-muted-foreground hover:bg-accent'}`}>
            All Departments
            {deptCountsData && (
              <span className="ml-1 opacity-70">({deptCountsData.all ?? 0})</span>
            )}
          </button>
          {departments.map((d: any) => {
            const count = deptCountById.get(String(d.id))
            return (
              <button key={d.id} onClick={() => handleDeptChange(String(d.id))}
                className={`px-4 py-2 text-sm rounded-lg font-semibold transition-all ${activeDept === String(d.id) ? 'bg-primary text-primary-foreground shadow-sm' : count === 0 ? 'border opacity-40 text-muted-foreground' : 'border text-muted-foreground hover:bg-accent'}`}>
                {d.name}
                {count !== undefined && (
                  <span className="ml-1 opacity-70">({count})</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="bg-card border rounded-xl px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px] max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={pendingFilters.search}
              onChange={(e) => setPendingFilters(f => ({ ...f, search: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters() }}
              placeholder="Search by ID, Name, Mobile and Email"
              className="w-full pl-10 pr-3 py-2.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <button onClick={applyFilters} className="px-5 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold">
            Search
          </button>
          <button onClick={handleResetAll} className="px-5 py-2.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-semibold">
            Reset
          </button>
          <button onClick={() => setShowFilters(v => !v)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm border rounded-lg transition-colors font-medium ${showFilters ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
            <Filter className="h-4 w-4" /> {showFilters ? 'Hide Filter' : 'Advance Search'}
            {filterCount > 0 && <span className="absolute -top-1.5 -right-1.5 h-5 w-5 flex items-center justify-center rounded-full bg-destructive text-[10px] font-black text-white">{filterCount}</span>}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="text-sm border rounded-lg px-3 py-2.5 bg-background">
              {[25, 50, 100, 500].map(s => <option key={s} value={s}>Show {s}</option>)}
            </select>
            <button onClick={() => refetch()} className="p-2.5 hover:bg-accent rounded-lg transition-colors" title="Refresh">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Active Filter Chips ── shown above the (optionally collapsed)
          advanced panel so the user always knows which filters are applied,
          and can clear any one of them with a single click. */}
      {(filterCount > 0 || filters.excludeMode === '1') && (() => {
        const update = (next: FilterState) => { setPendingFilters(next); setFilters(next); setPage(1) }
        const clearKeys = (keys: (keyof FilterState)[]) => () => {
          const next = { ...filters }
          keys.forEach((k) => { next[k] = '' })
          update(next)
        }
        const clearOne = (k: keyof FilterState) => clearKeys([k])
        const chips: Array<{ key: string; label: string; clear: () => void }> = []
        if (filters.search) chips.push({ key: 'search', label: `Search: ${filters.search}`, clear: clearOne('search') })
        if (filters.leadStatusId) {
          const s = statuses.find((x: any) => String(x.id) === filters.leadStatusId)
          const label = filters.leadStatusId === FRESH_STATUS_VALUE ? 'Fresh' : (s?.title ?? filters.leadStatusId)
          chips.push({ key: 'leadStatusId', label: `Status: ${label}`, clear: clearKeys(['leadStatusId', 'leadSubStatusId']) })
        }
        if (filters.leadSubStatusId) {
          const s = subStatuses.find((x: any) => String(x.id) === filters.leadSubStatusId)
          chips.push({ key: 'leadSubStatusId', label: `Sub-status: ${s?.subStatus ?? filters.leadSubStatusId}`, clear: clearOne('leadSubStatusId') })
        }
        if (filters.website) chips.push({ key: 'website', label: `Website: ${getWebsiteConfig(filters.website).label}`, clear: clearOne('website') })
        if (filters.source) chips.push({ key: 'source', label: `Source: ${filters.source}`, clear: clearOne('source') })
        if (filters.event) {
          const parts = parseMultiFilterValue(filters.event)
          chips.push({ key: 'event', label: `Event/Source: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`, clear: clearOne('event') })
        }
        if (filters.state) {
          const parts = parseMultiFilterValue(filters.state)
          chips.push({ key: 'state', label: `State: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`, clear: clearOne('state') })
        }
        if (filters.city) {
          const parts = parseMultiFilterValue(filters.city)
          chips.push({ key: 'city', label: `City: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`, clear: clearOne('city') })
        }
        if (filters.country) {
          const parts = parseMultiFilterValue(filters.country)
          chips.push({ key: 'country', label: `Country: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`, clear: clearOne('country') })
        }
        if (filters.intrestedCourse) {
          const parts = parseMultiFilterValue(filters.intrestedCourse)
          chips.push({ key: 'intrestedCourse', label: `Product: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`, clear: clearOne('intrestedCourse') })
        }
        if (filters.fromDate || filters.toDate) chips.push({ key: 'created', label: `Created: ${filters.fromDate || '…'} → ${filters.toDate || '…'}`, clear: clearKeys(['fromDate', 'toDate']) })
        if (filters.followupFrom || filters.followupTo) chips.push({ key: 'followup', label: `Follow-up: ${filters.followupFrom || '…'} → ${filters.followupTo || '…'}`, clear: clearKeys(['followupFrom', 'followupTo']) })
        if (filters.assignedFrom || filters.assignedTo) chips.push({ key: 'assigned', label: `Assigned: ${filters.assignedFrom || '…'} → ${filters.assignedTo || '…'}`, clear: clearKeys(['assignedFrom', 'assignedTo']) })
        if (filters.assignedCounsellors) {
          const ids = filters.assignedCounsellors.split(',').filter(Boolean)
          const names = ids.map((id) => counsellorsList.find((u) => String(u.id) === id)?.name).filter(Boolean) as string[]
          chips.push({
            key: 'assignedCounsellors',
            label: `Sales Rep: ${names.length === 1 ? names[0] : `${ids.length} selected`}`,
            clear: clearOne('assignedCounsellors'),
          })
        }
        // Legacy URL-only filters (UI controls were removed, but if a saved or
        // bookmarked URL still carries them, surface a chip so the user can clear).
        if (filters.called) chips.push({ key: 'called', label: `Called: ${filters.called === '1' ? 'Yes' : 'No'}`, clear: clearOne('called') })
        if (filters.wapp) chips.push({ key: 'wapp', label: `WhatsApp: ${filters.wapp === '1' ? 'Sent' : 'Not sent'}`, clear: clearOne('wapp') })
        if (filters.isDuplicate) chips.push({ key: 'isDuplicate', label: `Duplicate: ${filters.isDuplicate === '1' ? 'Duplicates' : 'Originals'}`, clear: clearOne('isDuplicate') })
        if (filters.leadScoreRanges) {
          const parts = parseMultiFilterValue(filters.leadScoreRanges)
          chips.push({
            key: 'leadScoreRanges',
            label: `Score: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`,
            clear: clearOne('leadScoreRanges'),
          })
        }
        // Dashboard deep-link chips — surface so the user knows the list is
        // scoped and can clear back to the full view.
        if (filters.enrolled === '1') chips.push({ key: 'enrolled', label: 'Converted', clear: clearOne('enrolled') })
        else if (filters.enrolled === '0') chips.push({ key: 'enrolled', label: 'Active pipeline', clear: clearOne('enrolled') })
        if (filters.overdue === '1') chips.push({ key: 'overdue', label: 'Overdue follow-ups', clear: clearOne('overdue') })

        // Exclude mode isn't a filter — it flips how the chips beside it are
        // matched — so it gets its own pill rather than a slot in the count.
        // Without it the chips read "City: Mumbai" while the list showed
        // everything EXCEPT Mumbai, with nothing on screen explaining why.
        const isExcluding = filters.excludeMode === '1'
        // Count only the filters Exclude actually inverts — deep-link scopes
        // like "Overdue follow-ups" have chips but are never negated, so they
        // must not make the pill claim it is excluding something.
        const excludedCount = EXCLUDABLE_FILTER_KEYS
          .filter((e) => e.keys.some((k) => filters[k])).length
        if (chips.length === 0 && !isExcluding) return null
        return (
          <div className="bg-card border rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Active filters · {chips.length}
              </span>
              {isExcluding && (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-semibold border border-destructive/30"
                  title={excludedCount
                    ? 'Showing leads that do NOT match the highlighted filters — the department, tab and any dashboard scope still apply normally'
                    : 'Exclude mode is on, but no filter is set for it to invert'}
                >
                  <Ban className="h-3 w-3" />
                  {excludedCount
                    ? `Excluding ${excludedCount === 1 ? 'this filter' : `these ${excludedCount} filters`}`
                    : 'Excluding (no filter set)'}
                  <button
                    onClick={clearOne('excludeMode')}
                    title="Switch back to Include"
                    className="flex items-center justify-center h-4 w-4 rounded-full hover:bg-destructive/20 leading-none"
                  >
                    ×
                  </button>
                </span>
              )}
              {chips.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20"
                >
                  <span className="max-w-[220px] truncate" title={c.label}>{c.label}</span>
                  <button
                    onClick={c.clear}
                    title="Remove this filter"
                    className="flex items-center justify-center h-4 w-4 rounded-full hover:bg-primary/20 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                onClick={handleResetAll}
                className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── Advanced Filter Panel ── */}
      {showFilters && (
        <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Advanced Filters</p>
            <FilterModeToggle
              excludeMode={pendingFilters.excludeMode === '1'}
              onChange={(next) => setPendingFilters((f) => ({ ...f, excludeMode: next ? '1' : '' }))}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="text-xs font-semibold text-muted-foreground">Status</label>
              <select value={pendingFilters.leadStatusId} onChange={e => setPendingFilters(f => ({ ...f, leadStatusId: e.target.value, leadSubStatusId: '' }))} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background">
                <option value="">All</option>
                {showFreshStatus && <option value={FRESH_STATUS_VALUE}>Fresh</option>}
                {filteredStatuses.filter((s: any) => s.title?.toLowerCase() !== 'fresh').map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select></div>
            <div><label className="text-xs font-semibold text-muted-foreground">Sub-Status</label>
              <select value={pendingFilters.leadSubStatusId} disabled={!pendingFilters.leadStatusId || pendingFilters.leadStatusId === FRESH_STATUS_VALUE} onChange={e => setPendingFilters(f => ({ ...f, leadSubStatusId: e.target.value }))} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background disabled:opacity-40">
                <option value="">All</option>{filteredSubStatuses.map((s: any) => <option key={s.id} value={s.id}>{s.subStatus}</option>)}
              </select></div>
            <div><label className="text-xs font-semibold text-muted-foreground">Website</label>
              <select value={pendingFilters.website} onChange={e => setPendingFilters(f => ({ ...f, website: e.target.value }))} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background">
                <option value="">All</option>
                {websiteValues.map((w) => (
                  <option key={w} value={w}>{getWebsiteConfig(w).label}</option>
                ))}
              </select></div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Country</label>
              <MultiSelectDropdown
                options={countryValues}
                value={parseMultiFilterValue(pendingFilters.country)}
                onChange={(v) => setPendingFilters((f) => ({ ...f, country: stringifyMultiFilterValue(v) }))}
                placeholder="Any country"
                searchPlaceholder="Search country..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">State</label>
              <MultiSelectDropdown
                options={stateValues}
                value={parseMultiFilterValue(pendingFilters.state)}
                onChange={(v) => setPendingFilters((f) => ({ ...f, state: stringifyMultiFilterValue(v) }))}
                placeholder="Any state"
                searchPlaceholder="Search state..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">City</label>
              <MultiSelectDropdown
                options={cityValues}
                value={parseMultiFilterValue(pendingFilters.city)}
                onChange={(v) => setPendingFilters((f) => ({ ...f, city: stringifyMultiFilterValue(v) }))}
                placeholder="Any city"
                searchPlaceholder="Search city..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Product</label>
              <MultiSelectDropdown
                options={courseValues}
                value={parseMultiFilterValue(pendingFilters.intrestedCourse)}
                onChange={(v) => setPendingFilters((f) => ({ ...f, intrestedCourse: stringifyMultiFilterValue(v) }))}
                placeholder="Any product"
                searchPlaceholder="Search product..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Event / Source</label>
              <MultiSelectDropdown
                options={eventOrSourceValues}
                value={parseMultiFilterValue(pendingFilters.event)}
                onChange={(v) => setPendingFilters((f) => ({ ...f, event: stringifyMultiFilterValue(v) }))}
                placeholder="Any event or source"
                searchPlaceholder="Search event or source..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Lead Score</label>
              <MultiSelectDropdown
                options={leadScoreBucketValues}
                value={parseMultiFilterValue(pendingFilters.leadScoreRanges)}
                onChange={(v) => setPendingFilters((f) => ({ ...f, leadScoreRanges: stringifyMultiFilterValue(v) }))}
                placeholder="Any score"
                searchPlaceholder="Search range..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[{ l: 'Created From', f: 'fromDate' }, { l: 'Created To', f: 'toDate' }, { l: 'Followup From', f: 'followupFrom' }, { l: 'Followup To', f: 'followupTo' }].map(cfg => (
              <div key={cfg.f}><label className="text-xs font-semibold text-muted-foreground">{cfg.l}</label>
                <input type="date" value={(pendingFilters as any)[cfg.f]} onChange={e => setPendingFilters(f => ({ ...f, [cfg.f]: e.target.value }))} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" /></div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="md:col-span-4 flex items-center gap-2 -mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {isAdmin ? 'Assigned to sales rep — date' : 'Assigned to me — date'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                (filters by when the lead was handed over, not when it was created)
              </span>
            </div>
            {[{ l: 'Assigned From', f: 'assignedFrom' }, { l: 'Assigned To', f: 'assignedTo' }].map(cfg => (
              <div key={cfg.f}><label className="text-xs font-semibold text-muted-foreground">{cfg.l}</label>
                <input type="date" value={(pendingFilters as any)[cfg.f]} onChange={e => setPendingFilters(f => ({ ...f, [cfg.f]: e.target.value }))} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" /></div>
            ))}
            <div className="md:col-span-2 flex items-end gap-1 flex-wrap">
              {[
                { l: 'Today', days: 0 },
                { l: 'Last 7 days', days: 7 },
                { l: 'Last 30 days', days: 30 },
              ].map((preset) => (
                <button
                  key={preset.l}
                  type="button"
                  onClick={() => {
                    const today = new Date()
                    const from = new Date(today)
                    from.setDate(today.getDate() - preset.days)
                    const fmt = (d: Date) => d.toISOString().slice(0, 10)
                    setPendingFilters((f) => ({ ...f, assignedFrom: fmt(from), assignedTo: fmt(today) }))
                  }}
                  className="px-2.5 py-1.5 text-xs border rounded-md hover:bg-accent"
                >
                  {preset.l}
                </button>
              ))}
              {(pendingFilters.assignedFrom || pendingFilters.assignedTo) && (
                <button
                  type="button"
                  onClick={() => setPendingFilters((f) => ({ ...f, assignedFrom: '', assignedTo: '' }))}
                  className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {isAdmin && (
            <div className="pt-3 border-t space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Assigned to (multi-select)
                  {selectedCounsellorIds.length > 0 && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                      {selectedCounsellorIds.length} selected
                    </span>
                  )}
                </label>
                {selectedCounsellorIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPendingFilters((f) => ({ ...f, assignedCounsellors: '' }))}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <input
                type="text"
                value={counsellorSearch}
                onChange={(e) => setCounsellorSearch(e.target.value)}
                placeholder="Search sales rep by name..."
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background"
              />
              <div className="max-h-56 overflow-y-auto border rounded-lg bg-background p-2">
                {filteredCounsellors.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No counsellors found</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {filteredCounsellors.map((u) => {
                      const id = String(u.id)
                      const checked = selectedCounsellorIds.includes(id)
                      return (
                        <label
                          key={id}
                          className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                            checked
                              ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-sm'
                              : 'bg-card border-border/60 hover:bg-accent/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCounsellor(id)}
                            className="h-3.5 w-3.5 rounded accent-primary mt-0.5 shrink-0 cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium leading-tight" title={u.name}>{u.name}</div>
                            <div className="text-[10px] uppercase tracking-wider opacity-60 font-semibold truncate mt-0.5">{u.role}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t flex-wrap">
            <button onClick={applyFilters} className="px-6 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold">Apply</button>
            <button onClick={() => { setPendingFilters(emptyFilters); setFilters(emptyFilters); setShowFilters(false) }} className="px-4 py-2 text-sm border rounded-lg hover:bg-accent">Reset All</button>
            <button
              onClick={handleSaveFilter}
              disabled={activeFilterCount(pendingFilters) === 0}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 text-sm border rounded-lg hover:bg-accent disabled:opacity-50"
            >
              <Bookmark className="h-3.5 w-3.5" /> Save Current
            </button>
          </div>

          {savedFilters.length > 0 && (
            <div className="pt-3 border-t flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2">
                Saved:
              </span>
              {savedFilters.map((sf) => (
                <div
                  key={sf.id}
                  className="group flex items-center gap-1 px-3 py-1.5 bg-accent border border-border rounded-full text-xs"
                >
                  <button
                    onClick={() => handleApplySavedFilter(sf.filters)}
                    className="flex items-center gap-1.5 font-semibold hover:text-primary"
                  >
                    <BookmarkCheck className="h-3 w-3" />
                    {sf.name}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Remove saved filter "${sf.name}"?`)) removeFilter(sf.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 ml-1 text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Lead Type Tabs (status sub-categories) — only when a department is selected ── */}
      {tabData && activeDept && (
        <div className="bg-card border rounded-xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setActiveTab('all'); setPage(1) }}
              className={`px-4 py-2 text-sm rounded-lg font-semibold transition-all ${activeTab === 'all' ? 'bg-primary text-primary-foreground shadow-sm' : 'border text-muted-foreground hover:bg-accent'}`}>
              All <span className="ml-1 opacity-70">({tabData.all ?? tabData.default ?? 0})</span>
            </button>
            {tabData.types?.map((t: { id: number; title: string; count: number }) => (
              <button key={t.id} onClick={() => { setActiveTab(String(t.id)); setPage(1) }}
                className={`px-4 py-2 text-sm rounded-lg font-semibold transition-all ${activeTab === String(t.id) ? 'bg-primary text-primary-foreground shadow-sm' : t.count === 0 ? 'border opacity-40 text-muted-foreground' : 'border text-muted-foreground hover:bg-accent'}`}>
                {t.title} <span className="ml-1 opacity-70">({t.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <BulkActionBar selectedIds={Array.from(selected)} onClearSelection={() => setSelected(new Set())} onRefresh={() => refetch()} />

      {data?.data?.length > 0 && (
        <div className="flex items-center gap-3 px-0.5">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={selected.size === data.data.length && data.data.length > 0} onChange={e => e.target.checked ? selectAll() : setSelected(new Set())} className="rounded border-border h-4 w-4" />
            Select all {data.data.length} on this page
          </label>
          {selected.size > 0 && <span className="text-sm font-bold text-primary">{selected.size} selected</span>}
        </div>
      )}

      {/* ── Cards ── */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-28 bg-card border rounded-xl">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !data?.data?.length ? (
          <div className="flex flex-col items-center justify-center py-28 bg-card border rounded-xl gap-3">
            <div className="h-16 w-16 rounded-full bg-muted/60 flex items-center justify-center">
              <User className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-medium text-muted-foreground">No leads found</p>
            <p className="text-sm text-muted-foreground/50">Try adjusting your filters or add a new lead</p>
          </div>
        ) : (
          data.data.map((lead: any, i: number) => (
            <LeadCard key={lead.id} lead={lead} index={(page - 1) * pageSize + i + 1}
              isSelected={selected.has(lead.id)} onSelect={() => toggleSelect(lead.id)}
              onToggleWapp={() => { toggleWapp.mutate(lead.id); setWappModalLead(lead) }}
              onQuickEdit={() => setQuickEditLead(lead)}
              onUpdateStatus={() => setStatusModalLead(lead)} />
          ))
        )}
      </div>

      {/* ── Pagination ── */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-4 bg-card border rounded-xl">
          <span className="text-sm text-muted-foreground">
            Showing <strong>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)}</strong> of <strong>{data.total.toLocaleString()}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(1)} disabled={page === 1} className="px-3 py-1.5 text-xs rounded-lg border hover:bg-accent disabled:opacity-30 font-medium">«</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border hover:bg-accent disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(7, data.totalPages) }, (_, idx) => {
              const start = Math.min(Math.max(page - 3, 1), data.totalPages - Math.min(7, data.totalPages) + 1)
              const p = start + idx
              return p <= data.totalPages ? (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-9 h-9 text-sm rounded-lg border font-semibold transition-colors ${page === p ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>{p}</button>
              ) : null
            })}
            <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="p-2 rounded-lg border hover:bg-accent disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setPage(data.totalPages)} disabled={page === data.totalPages} className="px-3 py-1.5 text-xs rounded-lg border hover:bg-accent disabled:opacity-30 font-medium">»</button>
          </div>
        </div>
      )}

      {showImport && <ImportCsvModal onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); refetch() }} />}
      {statusModalLead && <UpdateStatusModal lead={statusModalLead} onClose={() => setStatusModalLead(null)} />}
      {quickEditLead && <QuickEditModal lead={quickEditLead} onClose={() => setQuickEditLead(null)} />}
      {wappModalLead && <WhatsappSendModal isOpen={!!wappModalLead} onClose={() => setWappModalLead(null)} lead={wappModalLead} />}
    </div>
  )
}
