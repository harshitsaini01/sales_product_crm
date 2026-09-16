import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft, ArrowUpDown, Ban, CalendarDays, Check, ChevronLeft, ChevronRight,
  ClipboardCheck, Clock, Filter, Globe, Inbox, Loader2, Mail, Phone, PhoneCall,
  RefreshCw, RotateCcw, Search, StickyNote, TrendingUp, UserPlus, Users as UsersIcon, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { leadConfigApi, leadWorkApi, usersApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { cn, formatDate, maskPhone } from '@/lib/utils'
import { StatCard } from '@/components/common/StatCard'
import { MultiSelectDropdown } from '@/components/common/MultiSelectDropdown'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'

/**
 * Full-page lead → counsellor calling-task builder, at
 * `/app/task-builder?date=YYYY-MM-DD`. The "Assign leads" buttons on /app/tasks
 * and the Lead Workboard open it in a NEW TAB — it carries a whole lead cohort,
 * the advanced filter panel and the counsellor split, which is far too much for
 * a dialog. The opener tab refetches on focus, so tasks appear there on
 * switch-back.
 *
 * Lead picking mirrors the Lead Bucket (stat cards, table, tick-rows flow) and
 * the filter panel mirrors the Leads page (Advanced Filters card, searchable
 * multi-select dropdowns, include/exclude toggle). The counsellor panel below
 * the filters is the original assign step: who gets the work, what they already
 * have on that day, the dates, the comment, and the exact split.
 */

export type LeadRow = {
  id: number
  name: string
  mobile?: string | null
  email?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  interest?: string | null
  source?: string | null
  sourceUrl?: string | null
  website?: string | null
  event?: string | null
  note?: string | null
  leadStatus?: string | null
  leadSubStatus?: string | null
  departmentId?: number | null
  statusLeadTypeId?: number | null
  leadStatusId?: number | null
  leadSubStatusId?: number | null
  called?: boolean
  wapp?: boolean
  isDuplicate?: boolean
  leadScore?: number
  followupDate?: string | null
  createdAt?: string
  /** IST day the lead landed — the batch API takes one lead-created date per call. */
  createdOn: string
  attempted: boolean
  answered: boolean
  pendingFollowup: boolean
  assignedTo: { id: number; name: string; assignedOn?: string | null }[]
}
type TypeFilter = 'INITIAL_CALL' | 'FOLLOWUP' | 'ALL'
type WorkType = 'INITIAL_CALL' | 'FOLLOWUP'
type Counsellor = { id: number; name: string; role?: string; active?: boolean }
/**
 * Which lead days the builder is looking at.
 *  - `all`   — every lead ever (capped server-side)
 *  - `days`  — an explicit set of days, built up by the "Add date" control;
 *              they do not have to be next to each other
 *  - `range` — a continuous From→To window
 */
type Selection =
  | { kind: 'all' }
  | { kind: 'days'; days: string[] }
  | { kind: 'range'; from: string; to: string }

/** Multi-value filters hold a string[]; the rest hold one value. */
type Filters = {
  search: string
  department: string[]
  leadStatus: string[]
  leadSubStatus: string[]
  website: string[]
  source: string[]
  event: string[]
  country: string[]
  state: string[]
  city: string[]
  intrestedCourse: string[]
  leadType: string[]
  counsellor: string[]
  called: string
  wapp: string
  isDuplicate: string
  scoreMin: string
  scoreMax: string
  followupFrom: string
  followupTo: string
  assignedFrom: string
  assignedTo: string
}
const EMPTY_FILTERS: Filters = {
  search: '',
  department: [], leadStatus: [], leadSubStatus: [], website: [], source: [], event: [],
  country: [], state: [], city: [], intrestedCourse: [], leadType: [], counsellor: [],
  called: '', wapp: '', isDuplicate: '', scoreMin: '', scoreMax: '',
  followupFrom: '', followupTo: '', assignedFrom: '', assignedTo: '',
}
const FILTER_LABELS: Record<keyof Filters, string> = {
  search: 'Search', department: 'Department', leadStatus: 'Status', leadSubStatus: 'Sub-status',
  website: 'Website', source: 'Source', event: 'Event', country: 'Country', state: 'State', city: 'City',
  intrestedCourse: 'Course', leadType: 'Lead type', counsellor: 'Counsellor', called: 'Called', wapp: 'WhatsApp',
  isDuplicate: 'Duplicate', scoreMin: 'Score min', scoreMax: 'Score max',
  followupFrom: 'Follow-up from', followupTo: 'Follow-up to',
  assignedFrom: 'Assigned from', assignedTo: 'Assigned till',
}
/** Sentinel for the "no counsellor" entry in the counsellor filter. */
const UNASSIGNED = '— No counsellor —'
/**
 * "Fresh" is not a configured status. A fresh lead carries the TEXT 'Fresh' in
 * `leadStatus` with `leadStatusId` left NULL — that is what the CRM writes on
 * import, on inbound capture and on a status reset. The pipeline config does
 * hold rows titled "Fresh" (one per department), but no lead ever points at
 * them, so filtering on their id matches nothing.
 *
 * So the Status dropdown drops those config rows and offers ONE synthetic entry
 * carrying this sentinel instead, matched on the text column. Same treatment
 * the Leads page gives it (see FRESH_STATUS_VALUE there).
 */
const FRESH_STATUS_ID = 'fresh'
const FRESH_STATUS_LABEL = 'Fresh'
const isFreshLead = (lead: { leadStatus?: string | null }) =>
  (lead.leadStatus || '').trim().toLowerCase() === FRESH_STATUS_ID
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

function iso(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
function localISO(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return iso(value)
}
function shortDay(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}
function dayName(value: string) {
  if (value === localISO()) return 'Today'
  if (value === localISO(-1)) return 'Yesterday'
  return shortDay(value)
}
function selectionLabel(selection: Selection) {
  if (selection.kind === 'all') return 'All time'
  if (selection.kind === 'days') {
    if (!selection.days.length) return 'No day picked'
    // Deliberately never the day's own name. The per-day breakdown under the
    // filters already prints "Today"; printing it here too read as the same day
    // being listed twice.
    return `${selection.days.length} day${selection.days.length === 1 ? '' : 's'} picked`
  }
  if (selection.from && selection.to) return `${shortDay(selection.from)} → ${shortDay(selection.to)}`
  return selection.from ? `From ${shortDay(selection.from)}` : `Up to ${shortDay(selection.to)}`
}
/**
 * The most days one selection may hold. The cohort API slices the `days` list
 * at 62, so anything past that would be dropped without saying so.
 */
const MAX_PICKED_DAYS = 62

/** Every day from `from` to `to` inclusive, oldest → newest. */
function expandRange(from: string, to: string, cap = MAX_PICKED_DAYS + 1) {
  const out: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end && out.length < cap) {
    out.push(iso(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * A selection read as an explicit day list — a From→To window is spelled out
 * day by day. This is what lets the two date controls compose: "Add date" and
 * the range both merge into one set instead of each wiping the other.
 *
 * All-time, and a half-open window with only one end filled, have no finite day
 * list; they come back empty and the caller falls back to replacing.
 */
function selectionDays(selection: Selection): string[] {
  if (selection.kind === 'days') return selection.days
  if (selection.kind === 'range' && selection.from && selection.to) {
    return expandRange(selection.from, selection.to)
  }
  return []
}

/** Query params for a selection — `days` wins over from/to server-side. */
function selectionParams(selection: Selection) {
  if (selection.kind === 'all') return {}
  if (selection.kind === 'days') return { days: selection.days.join(',') }
  return { from: selection.from || undefined, to: selection.to || undefined }
}
/** Stable cache key for a selection. */
function selectionKey(selection: Selection) {
  if (selection.kind === 'all') return 'all'
  if (selection.kind === 'days') return `days:${[...selection.days].sort().join(',')}`
  return `range:${selection.from}:${selection.to}`
}

/**
 * Turns pipeline config rows into dropdown labels and a two-way id map.
 *
 * The pipeline reuses names heavily — "Interested" is a status in both the NEET
 * and Counselling departments, "Not Interested" is a sub-status under nine
 * different statuses — so a filter keyed on the name alone would quietly match
 * the wrong rows. Labels are disambiguated with their parent (and, if that is
 * still not unique, their id), while the filter itself stores ids.
 */
function buildOptionMap(rows: { id: unknown; label: string; parent?: string }[]) {
  const seen = new Map<string, number>()
  for (const row of rows) seen.set(row.label, (seen.get(row.label) || 0) + 1)
  const idByLabel = new Map<string, string>()
  const labelById = new Map<string, string>()
  for (const row of rows) {
    let label = (seen.get(row.label) || 0) > 1 && row.parent ? `${row.label} · ${row.parent}` : row.label
    if (idByLabel.has(label)) label = `${label} #${row.id}`
    idByLabel.set(label, String(row.id))
    labelById.set(String(row.id), label)
  }
  return {
    options: [...idByLabel.keys()].sort((a, b) => a.localeCompare(b)),
    idByLabel,
    labelById,
  }
}

export function TaskBuilder() {
  const queryClient = useQueryClient()
  // Every endpoint this page uses is adminOnly, so a counsellor who lands on the
  // URL would only see failed requests — say so instead.
  const admin = useAuthStore((state) => state.isAdmin)()
  const canRevealPhone = useAuthStore((state) => state.canRevealPhone())
  const queryString = typeof window === 'undefined' ? '' : window.location.search
  const dateParam = new URLSearchParams(queryString).get('date') || ''
  const openedOn = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : localISO()

  const [selection, setSelection] = useState<Selection>({ kind: 'days', days: [openedOn] })
  const [draftRange, setDraftRange] = useState({ from: openedOn, to: openedOn })
  const [workType, setWorkType] = useState<WorkType>('INITIAL_CALL')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('INITIAL_CALL')
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS })
  const [excludeMode, setExcludeMode] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc')
  const [unassignedFirst, setUnassignedFirst] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [assignees, setAssignees] = useState<Set<number>>(new Set())
  const [workDate, setWorkDate] = useState(localISO())
  const [dueDate, setDueDate] = useState(localISO())
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)

  const { data: counsellors = [] } = useQuery<Counsellor[]>({
    queryKey: ['counsellors', 'with-inactive'], queryFn: usersApi.counsellorsWithInactive, enabled: admin,
  })
  // Only the chosen work date's load, not every task ever created — see the
  // /workload route comment for why that distinction matters here.
  const { data: workload } = useQuery({
    queryKey: ['lead-work-workload', workDate], queryFn: () => leadWorkApi.workload(workDate), enabled: admin,
  })
  const { data: departments = [] } = useQuery({
    queryKey: ['lead-config-departments'], queryFn: leadConfigApi.departments, enabled: admin,
  })
  const { data: leadTypes = [] } = useQuery({
    queryKey: ['lead-config-types'], queryFn: leadConfigApi.types, enabled: admin,
  })
  const { data: statusConfig = [] } = useQuery({
    queryKey: ['lead-config-statuses'], queryFn: leadConfigApi.statuses, enabled: admin,
  })
  const { data: subStatusConfig = [] } = useQuery({
    queryKey: ['lead-config-sub-statuses', 'all'], queryFn: () => leadConfigApi.subStatuses(), enabled: admin,
  })

  const { data: cohort, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['lead-cohort', selectionKey(selection)],
    queryFn: () => leadWorkApi.cohort(selectionParams(selection)),
    // A days selection with nothing left in it would ask the API for every lead
    // ever, which is not what removing the last chip means.
    enabled: admin && !(selection.kind === 'days' && selection.days.length === 0),
  })
  const allLeads: LeadRow[] = cohort?.leads || []
  const cohortTotal = allLeads.length
  const serverTotal: number = cohort?.total ?? cohortTotal

  // ── Pipeline cascade ────────────────────────────────────────────────────
  // Department → Lead Type, and Department → Status → Sub-Status. Each dropdown
  // only offers children of what is selected above it, mirroring the Lead
  // Workflow page, and the filters store config ids rather than display names.
  type CfgRow = { id: number | string; title?: string; name?: string; subStatus?: string; departmentId?: number | string | null; statusId?: number | string | null }
  const departmentRows = departments as CfgRow[]
  const typeRows = leadTypes as CfgRow[]
  const statusRows = statusConfig as CfgRow[]
  const subStatusRows = subStatusConfig as CfgRow[]

  const departmentNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of departmentRows) map.set(String(row.id), row.name || `Department #${row.id}`)
    return map
  }, [departmentRows])
  const statusById = useMemo(() => new Map(statusRows.map((row) => [String(row.id), row])), [statusRows])
  const typeById = useMemo(() => new Map(typeRows.map((row) => [String(row.id), row])), [typeRows])
  const subStatusById = useMemo(() => new Map(subStatusRows.map((row) => [String(row.id), row])), [subStatusRows])

  const pickedDepartments = filters.department
  const pickedStatuses = filters.leadStatus

  const departmentOptions = useMemo(() => buildOptionMap(
    departmentRows.map((row) => ({ id: row.id, label: row.name || `Department #${row.id}` })),
  ), [departmentRows])

  // Types shown are only those belonging to the picked department(s).
  const typeOptions = useMemo(() => {
    const scope = new Set(pickedDepartments)
    const rows = typeRows.filter((row) => !scope.size || scope.has(String(row.departmentId ?? '')))
    return buildOptionMap(rows.map((row) => ({
      id: row.id,
      label: row.title || `Type #${row.id}`,
      parent: departmentNameById.get(String(row.departmentId ?? '')),
    })))
  }, [typeRows, pickedDepartments.join(','), departmentNameById])

  // Statuses likewise hang off the department.
  const statusOptions = useMemo(() => {
    const scope = new Set(pickedDepartments)
    const rows = statusRows.filter((row) => (!scope.size || scope.has(String(row.departmentId ?? '')))
      // Config rows titled "Fresh" are dead weight — see FRESH_STATUS_ID. Left
      // in, they showed up once per department ("Fresh · NEET", "Fresh ·
      // Counselling") and every one of them matched zero leads.
      && (row.title || '').trim().toLowerCase() !== FRESH_STATUS_ID)
    const map = buildOptionMap(rows.map((row) => ({
      id: row.id,
      label: row.title || `Status #${row.id}`,
      parent: departmentNameById.get(String(row.departmentId ?? '')),
    })))
    // Fresh is department-agnostic, so it is always on offer and always first.
    map.idByLabel.set(FRESH_STATUS_LABEL, FRESH_STATUS_ID)
    map.labelById.set(FRESH_STATUS_ID, FRESH_STATUS_LABEL)
    return { ...map, options: [FRESH_STATUS_LABEL, ...map.options] }
  }, [statusRows, pickedDepartments.join(','), departmentNameById])

  // Sub-statuses hang off the status — and, when no status is picked, off
  // whatever statuses the chosen department(s) allow.
  const subStatusOptions = useMemo(() => {
    const statusScope = new Set(pickedStatuses)
    const deptScope = new Set(pickedDepartments)
    const rows = subStatusRows.filter((row) => {
      const parentId = String(row.statusId ?? '')
      if (statusScope.size) return statusScope.has(parentId)
      if (!deptScope.size) return true
      return deptScope.has(String(statusById.get(parentId)?.departmentId ?? ''))
    })
    return buildOptionMap(rows.map((row) => ({
      id: row.id,
      label: row.subStatus || `Sub-status #${row.id}`,
      parent: statusById.get(String(row.statusId ?? ''))?.title,
    })))
  }, [subStatusRows, pickedStatuses.join(','), pickedDepartments.join(','), statusById])

  /** Picking a department drops any type/status/sub-status outside it. */
  const setDepartmentFilter = (ids: string[]) => {
    const scope = new Set(ids)
    const inScope = (departmentId: unknown) => !scope.size || scope.has(String(departmentId ?? ''))
    setFilters((prev) => ({
      ...prev,
      department: ids,
      leadType: prev.leadType.filter((id) => inScope(typeById.get(id)?.departmentId)),
      leadStatus: prev.leadStatus.filter((id) =>
        id === FRESH_STATUS_ID || inScope(statusById.get(id)?.departmentId)),
      leadSubStatus: prev.leadSubStatus.filter((id) => {
        const parent = statusById.get(String(subStatusById.get(id)?.statusId ?? ''))
        return inScope(parent?.departmentId)
      }),
    }))
    setPage(1)
  }
  /** Picking a status drops any sub-status that is not one of its children. */
  const setStatusFilter = (ids: string[]) => {
    const scope = new Set(ids)
    setFilters((prev) => ({
      ...prev,
      leadStatus: ids,
      leadSubStatus: prev.leadSubStatus.filter((id) =>
        !scope.size || scope.has(String(subStatusById.get(id)?.statusId ?? ''))),
    }))
    setPage(1)
  }

  const createBatch = useMutation({
    mutationFn: leadWorkApi.createBatch,
    onError: (error: any) => toast.error(error?.response?.data?.error || 'Could not assign this calling task'),
  })
  const assignOwner = useMutation({
    mutationFn: leadWorkApi.assignOwner,
    onSuccess: () => {
      toast.success('Lead reassigned')
      queryClient.invalidateQueries({ queryKey: ['lead-cohort'] })
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || 'Could not reassign lead'),
  })

  const applySelection = (next: Selection) => {
    setSelection(next)
    if (next.kind === 'range') setDraftRange({ from: next.from, to: next.to })
    setSelected(new Set())
    setPage(1)
  }
  /**
   * Merges days into the picked set — the one path both date controls take.
   *
   * Reading the previous selection through selectionDays() is the whole point:
   * a From→To window already in play gets spelled out and kept, where the old
   * code saw "not a day set" and silently threw it away.
   */
  const addDays = (dates: string[]) => {
    if (!dates.length) return
    setSelection((prev) => ({
      kind: 'days',
      days: [...new Set([...selectionDays(prev), ...dates])].sort((a, b) => a.localeCompare(b)),
    }))
    setSelected(new Set())
    setPage(1)
  }
  /** "Add date" — one more day on top of whatever is already picked. */
  const addDate = (date: string) => addDays([date])
  const removeDate = (date: string) => {
    setSelection((prev) => prev.kind === 'days'
      ? { kind: 'days', days: prev.days.filter((value) => value !== date) }
      : prev)
    setSelected(new Set())
    setPage(1)
  }
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }
  const resetFilters = () => {
    setFilters({ ...EMPTY_FILTERS })
    setExcludeMode(false)
    setPage(1)
  }
  /** The Reset button beside the date bar — clears the dates AND every filter. */
  const resetEverything = () => {
    resetFilters()
    applySelection({ kind: 'all' })
    setDraftRange({ from: '', to: '' })
    setTypeFilter('ALL')
    setWorkType('INITIAL_CALL')
    toast.success('Filters and dates reset — showing all leads')
  }

  // ── Filtering ───────────────────────────────────────────────────────────
  const counsellorNameOf = (lead: LeadRow) =>
    lead.assignedTo?.length ? lead.assignedTo.map((a) => a.name) : [UNASSIGNED]

  /**
   * One boolean per ACTIVE filter: did this lead match it?
   *
   * Returned as a list rather than a single verdict so Exclude mode can negate
   * each filter independently — the semantics FilterModeToggle documents and
   * the semantics the API and the Leads page already use:
   *   include:  status=Hot AND source=FB
   *   exclude:  status!=Hot AND source!=FB      (NOT "not (Hot AND FB)")
   * Whole-set negation would have returned every lead that failed EITHER
   * filter, so "exclude Hot, exclude Facebook" still handed back Hot leads.
   *
   * Inactive filters contribute NOTHING to the list. If they contributed a
   * vacuous `true`, Exclude would invert it to `false` and reject every lead.
   *
   * Two-sided ranges (score, follow-up date, assignment date) count as ONE
   * filter, exactly as the API pairs them. Splitting them would make
   * "exclude score 10–50" mean `score < 10 AND score > 50` — never satisfiable,
   * so the list would come back empty.
   */
  const filterHits = (lead: LeadRow): boolean[] => {
    const f = filters
    const hits: boolean[] = []
    const anyOf = (values: string[], candidates: (string | null | undefined)[]) => {
      if (!values.length) return
      hits.push(candidates.some((c) => values.includes((c || '').trim())))
    }
    const byId = (picked: string[], value: unknown) => {
      if (!picked.length) return
      hits.push(picked.includes(String(value ?? '')))
    }

    if (f.search) {
      const q = f.search.trim().toLowerCase()
      hits.push([lead.name, lead.mobile, lead.email, lead.city, lead.state, lead.country,
        lead.source, lead.website, lead.event, lead.interest, lead.note,
        lead.leadStatus, lead.leadSubStatus].some((v) => v?.toLowerCase().includes(q)))
    }
    byId(f.department, lead.departmentId)
    // Status is the one filter that is not a straight id compare: the `fresh`
    // sentinel has to match on `leadStatus` text, because a fresh lead has no
    // leadStatusId to compare against.
    if (f.leadStatus.length) {
      hits.push((f.leadStatus.includes(FRESH_STATUS_ID) && isFreshLead(lead))
        || f.leadStatus.includes(String(lead.leadStatusId ?? '')))
    }
    byId(f.leadSubStatus, lead.leadSubStatusId)
    anyOf(f.website, [lead.website])
    anyOf(f.source, [lead.source])
    anyOf(f.event, [lead.event])
    anyOf(f.country, [lead.country])
    anyOf(f.state, [lead.state])
    anyOf(f.city, [lead.city])
    anyOf(f.intrestedCourse, [lead.interest])
    byId(f.leadType, lead.statusLeadTypeId)
    anyOf(f.counsellor, counsellorNameOf(lead))
    if (f.called) hits.push((lead.called ? '1' : '0') === f.called)
    if (f.wapp) hits.push((lead.wapp ? '1' : '0') === f.wapp)
    if (f.isDuplicate) hits.push((lead.isDuplicate ? '1' : '0') === f.isDuplicate)
    if (f.scoreMin || f.scoreMax) {
      const score = lead.leadScore ?? 0
      hits.push((!f.scoreMin || score >= Number(f.scoreMin))
        && (!f.scoreMax || score <= Number(f.scoreMax)))
    }
    if (f.followupFrom || f.followupTo) {
      hits.push(!!lead.followupDate
        && (!f.followupFrom || lead.followupDate >= f.followupFrom)
        && (!f.followupTo || lead.followupDate <= f.followupTo))
    }
    if (f.assignedFrom || f.assignedTo) {
      // "Handed over inside this window" — true when ANY active assignment fits.
      hits.push((lead.assignedTo || []).some((a) => a.assignedOn
        && (!f.assignedFrom || a.assignedOn >= f.assignedFrom)
        && (!f.assignedTo || a.assignedOn <= f.assignedTo)))
    }
    return hits
  }

  const activeFilters = useMemo(() => (Object.keys(EMPTY_FILTERS) as (keyof Filters)[])
    .map((key) => ({ key, label: FILTER_LABELS[key], value: filters[key] }))
    .filter((row) => Array.isArray(row.value) ? row.value.length > 0 : row.value !== ''),
  [filters])
  const activeFilterCount = activeFilters.length

  /**
   * Everything the search box and the Advanced Filters let through, BEFORE the
   * work-type tab narrows it further.
   *
   * The tab badges and the stat cards count off this list. Reading them off the
   * raw cohort instead is what made "Pending first calls" wrong: it kept
   * reporting every untouched lead of the window while the table under it
   * showed only the handful the filters had matched.
   */
  const scopedLeads = useMemo(() => allLeads.filter((lead) => {
    if (!activeFilterCount) return true
    const hits = filterHits(lead)
    if (!hits.length) return true
    // Include: match every active filter. Exclude: match none of them.
    return excludeMode ? hits.every((h) => !h) : hits.every((h) => h)
  }), [allLeads, filters, excludeMode, activeFilterCount, departmentNameById])

  const scopedTotal = scopedLeads.length
  const pendingCallCount = scopedLeads.filter((lead) => !lead.attempted).length
  const pendingFollowupCount = scopedLeads.filter((lead) => lead.pendingFollowup).length

  const filteredLeads = useMemo(() => {
    const list = scopedLeads.filter((lead) => {
      if (typeFilter === 'INITIAL_CALL' && lead.attempted) return false
      if (typeFilter === 'FOLLOWUP' && !lead.pendingFollowup) return false
      return true
    })
    return [...list].sort((a, b) => {
      if (unassignedFirst) {
        const owned = (a.assignedTo?.length ? 1 : 0) - (b.assignedTo?.length ? 1 : 0)
        if (owned) return owned
      }
      const left = a.createdAt || a.createdOn
      const right = b.createdAt || b.createdOn
      return orderDir === 'desc' ? right.localeCompare(left) : left.localeCompare(right)
    })
  }, [scopedLeads, typeFilter, orderDir, unassignedFirst])

  const total = filteredLeads.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const safePage = Math.min(page, totalPages)
  const pageLeads = filteredLeads.slice((safePage - 1) * limit, safePage * limit)
  const allOnPageSelected = pageLeads.length > 0 && pageLeads.every((lead) => selected.has(lead.id))
  const unassignedInView = filteredLeads.filter((lead) => !lead.assignedTo?.length).length

  /**
   * The picked days with a count each, oldest → newest.
   *
   * The number is how many leads that day contributes to the list currently in
   * view, so every Advanced Filter and the work-type tab are already baked in
   * even though the strip renders above them. A day that survives nothing still
   * shows, at 0: an empty date is an answer, not a missing row.
   */
  const dayBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const lead of filteredLeads) counts.set(lead.createdOn, (counts.get(lead.createdOn) || 0) + 1)
    const days = new Set(counts.keys())
    if (selection.kind === 'days') {
      for (const date of selection.days) days.add(date)
    } else if (selection.kind === 'range' && selection.from && selection.to) {
      // A short window is spelled out in full so its empty days are visible.
      // A long one would drown the strip, so there only days with leads show.
      const cursor = new Date(`${selection.from}T12:00:00`)
      const end = new Date(`${selection.to}T12:00:00`)
      const span = Math.round((end.getTime() - cursor.getTime()) / 86_400_000)
      if (span >= 0 && span <= 45) {
        for (let step = 0; step <= span; step++) {
          days.add(iso(cursor))
          cursor.setDate(cursor.getDate() + 1)
        }
      }
    }
    return [...days]
      .sort((a, b) => a.localeCompare(b))
      .map((date) => ({ date, count: counts.get(date) || 0 }))
  }, [filteredLeads, selection])

  // ── Option lists for the dropdowns, drawn from the loaded cohort ────────
  const options = useMemo(() => {
    const uniq = (get: (lead: LeadRow) => (string | null | undefined)[]) => {
      const set = new Set<string>()
      for (const lead of allLeads) for (const value of get(lead)) {
        const clean = value?.trim()
        if (clean) set.add(clean)
      }
      return [...set].sort((a, b) => a.localeCompare(b))
    }
    return {
      website: uniq((l) => [l.website]),
      source: uniq((l) => [l.source]),
      event: uniq((l) => [l.event]),
      country: uniq((l) => [l.country]),
      state: uniq((l) => [l.state]),
      city: uniq((l) => [l.city]),
      intrestedCourse: uniq((l) => [l.interest]),
      counsellor: uniq(counsellorNameOf),
    }
  }, [allLeads, departmentNameById])

  // ── Selection ───────────────────────────────────────────────────────────
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      pageLeads.forEach((lead) => allOnPageSelected ? next.delete(lead.id) : next.add(lead.id))
      return next
    })
  }
  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAllFiltered = () => setSelected(new Set(filteredLeads.map((lead) => lead.id)))
  const selectedLeads = allLeads.filter((lead) => selected.has(lead.id))

  // ── Counsellors ─────────────────────────────────────────────────────────
  // Most staff accounts in this CRM are deactivated (295 of 306), so the picker
  // lists active counsellors plus ONLY those deactivated ones who still hold a
  // lead here — their leads stay with them unless an admin moves them.
  const leadHolders = useMemo(() => {
    const set = new Set<number>()
    for (const lead of allLeads) for (const a of lead.assignedTo || []) set.add(a.id)
    return set
  }, [allLeads])
  const activeCounsellors = counsellors.filter((c) => c.active !== false)
  const allCounsellorsSelected = activeCounsellors.length > 0 && activeCounsellors.every((c) => assignees.has(c.id))
  const visibleCounsellors = useMemo(() => {
    const rows = counsellors.filter((c) => c.active !== false || leadHolders.has(c.id))
    return [...rows].sort((a, b) => Number(a.active === false) - Number(b.active === false))
  }, [counsellors, leadHolders])
  const toggleAssignee = (id: number) => setAssignees((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  /** How many leads currently in view each counsellor already owns. */
  const alreadyAssignedByCounsellor = useMemo(() => {
    const map = new Map<number, number>()
    for (const lead of filteredLeads) {
      for (const a of lead.assignedTo || []) map.set(a.id, (map.get(a.id) || 0) + 1)
    }
    return map
  }, [filteredLeads])

  /** Existing tasks + pending leads per counsellor on the chosen work date. */
  const workloadByCounsellor = useMemo(() => {
    const map = new Map<number, { tasks: number; remaining: number; total: number }>()
    for (const row of (workload?.counsellors || []) as any[]) {
      map.set(Number(row.counsellorId), { tasks: row.tasks, remaining: row.remaining, total: row.total })
    }
    return map
  }, [workload])

  // Split preview — mirrors the submit rule: a lead already assigned to a
  // counsellor stays with them; only unowned leads are shared out.
  const targetsOrdered = counsellors.filter((c) => assignees.has(c.id) && c.active !== false).map((c) => c.id)
  const shareByCounsellor = useMemo(() => {
    const map = new Map<number, number>()
    const bump = (id: number) => map.set(id, (map.get(id) || 0) + 1)
    let unownedSeen = 0
    for (const lead of selectedLeads) {
      const owner = lead.assignedTo?.[0]?.id
      if (owner) bump(owner)
      else if (targetsOrdered.length) bump(targetsOrdered[unownedSeen++ % targetsOrdered.length])
    }
    return map
  }, [selected, targetsOrdered.join(','), allLeads])

  const assignPending = async () => {
    if (!selected.size) return toast.error('Select leads first')
    if (!targetsOrdered.length) return toast.error('Pick at least one counsellor')
    // The batch API takes one lead-created date per request, so the work is
    // bucketed per (counsellor, lead day).
    const buckets = new Map<string, { counsellorId: number; date: string; leadIds: number[] }>()
    const push = (counsellorId: number, lead: LeadRow) => {
      const key = `${counsellorId}:${lead.createdOn}`
      const row = buckets.get(key) || { counsellorId, date: lead.createdOn, leadIds: [] }
      row.leadIds.push(lead.id)
      buckets.set(key, row)
    }
    const unowned: LeadRow[] = []
    for (const lead of selectedLeads) {
      const owner = lead.assignedTo?.[0]?.id
      if (owner) push(owner, lead)
      else unowned.push(lead)
    }
    unowned.forEach((lead, index) => push(targetsOrdered[index % targetsOrdered.length], lead))

    setPending(true)
    const rows = [...buckets.values()]
    const results = await Promise.allSettled(rows.map((row) => createBatch.mutateAsync({
      leadIds: row.leadIds, assignedToId: row.counsellorId, leadDate: row.date,
      workDate, dueDate, workType, notes: notes || undefined,
    })))
    setPending(false)
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length
    const failed = results.length - ok
    if (ok) toast.success(`Assigned ${ok} task${ok > 1 ? 's' : ''}${failed ? ` · ${failed} skipped` : ''}`)
    else toast.error('Could not assign these leads')
    setSelected(new Set())
    setNotes('')
    queryClient.invalidateQueries({ queryKey: ['lead-work-batches'] })
    queryClient.invalidateQueries({ queryKey: ['lead-work-workload'] })
    queryClient.invalidateQueries({ queryKey: ['lead-work-history'] })
    queryClient.invalidateQueries({ queryKey: ['lead-cohort'] })
  }

  // The four pipeline filters store config ids, so chips resolve them back to
  // the label the dropdown showed.
  const labelLookup: Partial<Record<keyof Filters, Map<string, string>>> = {
    department: departmentOptions.labelById,
    leadType: typeOptions.labelById,
    leadStatus: statusOptions.labelById,
    leadSubStatus: subStatusOptions.labelById,
  }
  const chipValue = (key: keyof Filters, value: string | string[]) => {
    if (!Array.isArray(value)) return value
    const lookup = labelLookup[key]
    return value.map((entry) => lookup?.get(entry) || entry).join(', ')
  }

  if (!admin) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Only admins can assign calling tasks. <Link to="/app/tasks" className="text-primary underline">Back to tasks</Link>
      </div>
    )
  }

  const pickedDays = selection.kind === 'days' ? selection.days : []
  const isOnlyDay = (date: string) => pickedDays.length === 1 && pickedDays[0] === date
  const isRange = (from: string, to: string) =>
    selection.kind === 'range' && selection.from === from && selection.to === to
  const presetClass = (on: boolean) => cn(
    'px-2.5 py-1.5 text-xs font-semibold border rounded-lg transition-colors',
    on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent',
  )

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 text-white flex items-center justify-center shadow-lg shadow-violet-500/20">
            <ClipboardCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Assign Calling Tasks</h1>
            <p className="text-sm text-muted-foreground">
              Choose the lead dates, filter the list, pick the counsellors, then hand the work out.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/tasks" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
            Back to Tasks
          </Link>
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-accent">
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Lead dates ─────────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lead days</span>

          <button onClick={() => applySelection({ kind: 'all' })} className={presetClass(selection.kind === 'all')}>All time</button>
          <button onClick={() => applySelection({ kind: 'days', days: [localISO()] })} className={presetClass(isOnlyDay(localISO()))}>Today</button>
          <button onClick={() => applySelection({ kind: 'days', days: [localISO(-1)] })} className={presetClass(isOnlyDay(localISO(-1)))}>Yesterday</button>
          <button onClick={() => applySelection({ kind: 'range', from: localISO(-6), to: localISO() })} className={presetClass(isRange(localISO(-6), localISO()))}>Last 7 days</button>
          <button onClick={() => applySelection({ kind: 'range', from: localISO(-29), to: localISO() })} className={presetClass(isRange(localISO(-29), localISO()))}>Last 30 days</button>

          <span className="mx-1 h-5 w-px bg-border" />

          {/* Add date — every pick ADDS another day to the selection, so days
              that are nowhere near each other can be worked in one go. Value is
              kept empty so picking the same date twice still fires onChange.
              Composes with the From→To window beside it: both merge into the
              same picked-day set. */}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Add date</span>
          <input
            type="date"
            max={localISO()}
            value=""
            onChange={(e) => { if (e.target.value) addDate(e.target.value) }}
            title="Add another day to the selection"
            className="px-2 py-1.5 text-xs bg-background border rounded-lg"
          />

          <span className="mx-1 h-5 w-px bg-border" />

          {/* Range — a continuous window, ADDED to the picked-day set day by
              day, so it stacks with "Add date" and with a preset rather than
              overwriting either. Only the presets and Reset replace. */}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
          <input
            type="date"
            max={localISO()}
            value={draftRange.from}
            onChange={(e) => setDraftRange((r) => ({ ...r, from: e.target.value }))}
            className="px-2 py-1.5 text-xs bg-background border rounded-lg"
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
          <input
            type="date"
            max={localISO()}
            value={draftRange.to}
            onChange={(e) => setDraftRange((r) => ({ ...r, to: e.target.value }))}
            className="px-2 py-1.5 text-xs bg-background border rounded-lg"
          />
          <button
            onClick={() => {
              const { from, to } = draftRange
              if (!from && !to) return applySelection({ kind: 'all' })
              if (from && to && from > to) return toast.error('"From" must be on or before "To"')
              // Only one end filled — there is no finite day list to merge, so
              // a half-open window still replaces the selection.
              if (!from || !to) {
                applySelection({ kind: 'range', from, to })
                return toast.success(`Showing leads created ${selectionLabel({ kind: 'range', from, to })}`)
              }
              const already = selectionDays(selection)
              const merged = [...new Set([...already, ...expandRange(from, to)])].sort((a, b) => a.localeCompare(b))
              if (merged.length > MAX_PICKED_DAYS) {
                return toast.error(
                  `That comes to ${merged.length}+ days — ${MAX_PICKED_DAYS} is the most that can load at once. `
                  + 'Narrow the window, or use a preset.',
                )
              }
              const added = merged.length - already.length
              applySelection({ kind: 'days', days: merged })
              toast.success(added
                ? `Added ${added} day${added === 1 ? '' : 's'} · ${merged.length} now picked`
                : 'Those days were already picked')
            }}
            title="Add every day in this window to the picked days"
            className="px-2.5 py-1.5 text-xs font-semibold border rounded-lg hover:bg-accent"
          >
            Add range
          </button>

          {/* Reset — clears the dates AND every filter, back to All time. */}
          <button
            onClick={resetEverything}
            title="Clear the dates and every filter"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded-lg hover:bg-accent hover:text-destructive"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset filters &amp; dates
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 mt-2 border-t text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
            <CalendarDays className="h-3 w-3" />
            {selectionLabel(selection)}
          </span>
          <span className="text-muted-foreground">
            {serverTotal.toLocaleString()} lead{serverTotal === 1 ? '' : 's'} in this window
          </span>
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {selection.kind === 'days' && !pickedDays.length && (
            <span className="font-medium text-destructive">
              No day picked — add a date, or choose a preset.
            </span>
          )}
          <span className="text-muted-foreground">
            Each day is listed with its own count under the filters below.
          </span>
        </div>
      </div>

      {/* ── Days in view, oldest → newest ───────────────────────────────
             Sits directly under the date bar it describes. The count beside
             each day is still a count of the FILTERED list, so it answers
             "what will I actually hand out from this date?" rather than "what
             landed that day?" — the filters below feed it, not the other way
             round, so its position on the page does not change the maths. */}
      <div className="bg-card border rounded-xl p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Leads per day
          </span>
          <span className="text-[11px] text-muted-foreground">
            oldest → newest ·{' '}
            {activeFilterCount > 0 || excludeMode ? 'after filters · ' : ''}
            {typeFilter === 'INITIAL_CALL' ? 'first calls · ' : typeFilter === 'FOLLOWUP' ? 'follow-ups · ' : ''}
            {total.toLocaleString()} in view
          </span>
        </div>
        <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {dayBreakdown.length ? dayBreakdown.map((row) => (
            <span
              key={row.date}
              title={row.date}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                row.count ? 'bg-background' : 'bg-muted/40 text-muted-foreground',
              )}
            >
              {dayName(row.date)}
              <span className={cn(
                'inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                row.count ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>
                {row.count}
              </span>
              {selection.kind === 'days' && (
                <button onClick={() => removeDate(row.date)} title="Remove this day" className="p-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          )) : (
            <span className="text-xs text-muted-foreground">
              {isLoading ? 'Loading…' : 'No leads land on the chosen dates once the filters are applied.'}
            </span>
          )}
        </div>
      </div>

      {/* ── Search + filter toggles ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search name, email, mobile, city, source, note…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors',
            showFilters || activeFilterCount > 0 ? 'bg-primary/10 border-primary/30 text-primary' : 'hover:bg-accent',
          )}
        >
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-accent"
          title="Toggle sort order by created date"
        >
          <ArrowUpDown className="h-4 w-4" />
          {orderDir === 'desc' ? 'Newest first' : 'Oldest first'}
        </button>
        <button
          onClick={() => setUnassignedFirst((v) => !v)}
          title="Float leads that have no counsellor to the top"
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors',
            unassignedFirst ? 'bg-primary/10 border-primary/30 text-primary' : 'hover:bg-accent',
          )}
        >
          <UsersIcon className="h-4 w-4" />
          Unassigned first
        </button>
      </div>

      {/* ── Advanced Filters (Leads-page card) ─────────────────────────── */}
      {showFilters && (
        <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Advanced Filters</p>
            <div className="flex items-center gap-3">
              <FilterModeToggle excludeMode={excludeMode} onChange={setExcludeMode} />
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg hover:bg-accent hover:text-destructive"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset filters
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Department</label>
              <MultiSelectDropdown
                options={departmentOptions.options}
                value={filters.department.map((id) => departmentOptions.labelById.get(id)).filter((v): v is string => !!v)}
                onChange={(labels) => setDepartmentFilter(labels.map((l) => departmentOptions.idByLabel.get(l)).filter((v): v is string => !!v))}
                placeholder="Any department"
                searchPlaceholder="Search department..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                Lead Type{pickedDepartments.length > 0 && <span className="ml-1 font-normal text-[10px]">· in selected dept</span>}
              </label>
              <MultiSelectDropdown
                options={typeOptions.options}
                value={filters.leadType.map((id) => typeOptions.labelById.get(id)).filter((v): v is string => !!v)}
                onChange={(labels) => setFilter('leadType', labels.map((l) => typeOptions.idByLabel.get(l)).filter((v): v is string => !!v))}
                placeholder="Any lead type"
                searchPlaceholder="Search lead type..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                Status{pickedDepartments.length > 0 && <span className="ml-1 font-normal text-[10px]">· in selected dept</span>}
              </label>
              <MultiSelectDropdown
                options={statusOptions.options}
                value={filters.leadStatus.map((id) => statusOptions.labelById.get(id)).filter((v): v is string => !!v)}
                onChange={(labels) => setStatusFilter(labels.map((l) => statusOptions.idByLabel.get(l)).filter((v): v is string => !!v))}
                placeholder="Any status"
                searchPlaceholder="Search status..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                Sub-Status{pickedStatuses.length > 0 && <span className="ml-1 font-normal text-[10px]">· in selected status</span>}
              </label>
              <MultiSelectDropdown
                options={subStatusOptions.options}
                value={filters.leadSubStatus.map((id) => subStatusOptions.labelById.get(id)).filter((v): v is string => !!v)}
                onChange={(labels) => setFilter('leadSubStatus', labels.map((l) => subStatusOptions.idByLabel.get(l)).filter((v): v is string => !!v))}
                placeholder="Any sub-status"
                searchPlaceholder="Search sub-status..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Website</label>
              <MultiSelectDropdown options={options.website} value={filters.website} onChange={(v) => setFilter('website', v)} placeholder="Any website" searchPlaceholder="Search website..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Source</label>
              <MultiSelectDropdown options={options.source} value={filters.source} onChange={(v) => setFilter('source', v)} placeholder="Any source" searchPlaceholder="Search source..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Event / Campaign</label>
              <MultiSelectDropdown options={options.event} value={filters.event} onChange={(v) => setFilter('event', v)} placeholder="Any event" searchPlaceholder="Search event..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Country</label>
              <MultiSelectDropdown options={options.country} value={filters.country} onChange={(v) => setFilter('country', v)} placeholder="Any country" searchPlaceholder="Search country..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">State</label>
              <MultiSelectDropdown options={options.state} value={filters.state} onChange={(v) => setFilter('state', v)} placeholder="Any state" searchPlaceholder="Search state..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">City</label>
              <MultiSelectDropdown options={options.city} value={filters.city} onChange={(v) => setFilter('city', v)} placeholder="Any city" searchPlaceholder="Search city..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Course</label>
              <MultiSelectDropdown options={options.intrestedCourse} value={filters.intrestedCourse} onChange={(v) => setFilter('intrestedCourse', v)} placeholder="Any course" searchPlaceholder="Search course..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Current counsellor</label>
              <MultiSelectDropdown options={options.counsellor} value={filters.counsellor} onChange={(v) => setFilter('counsellor', v)} placeholder="Any counsellor" searchPlaceholder="Search counsellor..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Lead Score</label>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} value={filters.scoreMin} onChange={(e) => setFilter('scoreMin', e.target.value)} placeholder="min" className="w-full px-3 py-2 text-sm border rounded-lg bg-background" />
                <span className="text-muted-foreground">–</span>
                <input type="number" min={0} value={filters.scoreMax} onChange={(e) => setFilter('scoreMax', e.target.value)} placeholder="max" className="w-full px-3 py-2 text-sm border rounded-lg bg-background" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Called</label>
              <select value={filters.called} onChange={(e) => setFilter('called', e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background">
                <option value="">All</option><option value="1">Called</option><option value="0">Not called</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">WhatsApp</label>
              <select value={filters.wapp} onChange={(e) => setFilter('wapp', e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background">
                <option value="">All</option><option value="1">Contacted</option><option value="0">Not contacted</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Duplicate</label>
              <select value={filters.isDuplicate} onChange={(e) => setFilter('isDuplicate', e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background">
                <option value="">All</option><option value="1">Duplicates only</option><option value="0">Originals only</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              { l: 'Followup From', f: 'followupFrom' },
              { l: 'Followup To', f: 'followupTo' },
              { l: 'Assigned From', f: 'assignedFrom' },
              { l: 'Assigned To', f: 'assignedTo' },
            ] as const).map((cfg) => (
              <div key={cfg.f}>
                <label className="text-xs font-semibold text-muted-foreground">{cfg.l}</label>
                <input
                  type="date"
                  value={filters[cfg.f]}
                  onChange={(e) => setFilter(cfg.f, e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background"
                />
              </div>
            ))}
            <div className="md:col-span-4 -mt-2 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                "Assigned" filters by when the lead was handed to a counsellor, not when it was created.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {(activeFilterCount > 0 || excludeMode) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">Active Filters:</span>
          {excludeMode && (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 font-semibold border border-red-200"
              title={activeFilterCount
                ? 'Showing leads that match NONE of the filters beside this — each one negated on its own'
                : 'Exclude mode is on, but no filter is set for it to invert'}
            >
              <Ban className="h-3 w-3" />
              {activeFilterCount
                ? `Excluding ${activeFilterCount === 1 ? 'this filter' : `these ${activeFilterCount} filters`}`
                : 'Excluding (no filter set)'}
              <button onClick={() => setExcludeMode(false)} className="hover:text-destructive p-0.5"><X className="h-3 w-3" /></button>
            </span>
          )}
          {activeFilters.map((row) => (
            <span key={row.key} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
              <span>{row.label}: <strong>{chipValue(row.key, row.value)}</strong></span>
              <button
                onClick={() => setFilter(row.key, (Array.isArray(row.value) ? [] : '') as never)}
                className="hover:text-destructive p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button onClick={resetFilters} className="text-xs text-muted-foreground hover:text-destructive underline font-medium ml-1">
            Clear all
          </button>
        </div>
      )}

      {/* ── Work-type tabs + the numbers they produce ───────────────────
             Both sit right above the assign step: by this point the dates and
             every filter are settled, so these are the counts you are actually
             about to hand out. */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-muted/40 border rounded-lg w-fit">
        {([
          { key: 'INITIAL_CALL', work: 'INITIAL_CALL', icon: <PhoneCall className="h-4 w-4" />, label: 'First calls', count: pendingCallCount },
          { key: 'FOLLOWUP', work: 'FOLLOWUP', icon: <Clock className="h-4 w-4" />, label: 'Follow-ups', count: pendingFollowupCount },
          { key: 'ALL', work: 'INITIAL_CALL', icon: <Inbox className="h-4 w-4" />, label: 'All leads', count: scopedTotal },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setWorkType(tab.work as WorkType)
              setTypeFilter(tab.key as TypeFilter)
              setSelected(new Set())
              setPage(1)
            }}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors',
              typeFilter === tab.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
            <span className={cn(
              'inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold',
              typeFilter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Inbox className="h-4 w-4" />}
          label={activeFilterCount > 0 ? 'Matching leads' : 'Leads in view'}
          value={total.toLocaleString()}
          sub={`of ${cohortTotal.toLocaleString()} loaded`}
          tint="amber"
        />
        <StatCard
          icon={<UsersIcon className="h-4 w-4" />}
          label="Without a counsellor"
          value={unassignedInView}
          sub="these need an owner"
          tint="red"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={typeFilter === 'FOLLOWUP' ? 'Follow-ups due' : 'Pending first calls'}
          value={typeFilter === 'FOLLOWUP' ? pendingFollowupCount : pendingCallCount}
          tint="emerald"
        />
        <StatCard
          icon={<Check className="h-4 w-4" />}
          label="Selected"
          value={selected.size}
          tint="violet"
        />
      </div>

      {/* ── Assign panel: who gets the work ────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Assign to counsellors</h2>
            <span className="text-xs text-muted-foreground">
              {selected.size} lead{selected.size === 1 ? '' : 's'} picked · {assignees.size} counsellor{assignees.size === 1 ? '' : 's'} ticked
            </span>
          </div>
          <button
            className="text-[11px] font-bold text-primary hover:underline"
            onClick={() => setAssignees(allCounsellorsSelected ? new Set() : new Set(activeCounsellors.map((c) => c.id)))}
          >
            {allCounsellorsSelected ? 'Clear all' : 'Select all active'}
          </button>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-3">
          {/* Counsellor list */}
          <div className="lg:col-span-2">
            <div className="max-h-72 overflow-y-auto rounded-lg border bg-background">
              {visibleCounsellors.length ? visibleCounsellors.map((counsellor) => {
                const checked = assignees.has(counsellor.id)
                const share = shareByCounsellor.get(counsellor.id) || 0
                const workload = workloadByCounsellor.get(counsellor.id)
                const owns = alreadyAssignedByCounsellor.get(counsellor.id) || 0
                // A counsellor who has left is still shown — leads are often
                // still sitting with them — but flagged so nobody hands them
                // fresh work by accident.
                const inactive = counsellor.active === false
                return (
                  <label
                    key={counsellor.id}
                    className={cn(
                      'flex cursor-pointer flex-wrap items-center gap-2 border-b px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/50',
                      inactive ? 'bg-amber-50' : checked ? 'bg-primary/5' : '',
                    )}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleAssignee(counsellor.id)} className="h-4 w-4 accent-primary" />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {counsellor.name}
                      <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">#{counsellor.id}</span>
                    </span>
                    {inactive && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-black uppercase text-amber-900" title="This user is deactivated">Inactive</span>}
                    {(checked || share > 0) && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-black text-primary-foreground" title="Leads this run will give this counsellor">→ {share} lead{share !== 1 ? 's' : ''}</span>}
                    {owns > 0 && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800" title="Leads in the list below already assigned to them — these stay with them">owns {owns}</span>}
                    {workload
                      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800" title={`Existing tasks on ${workDate}`}>{workload.tasks} task{workload.tasks !== 1 ? 's' : ''} · {workload.remaining}/{workload.total} pending</span>
                      : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">free</span>}
                  </label>
                )
              }) : <p className="p-3 text-xs text-muted-foreground">No counsellors available.</p>}
            </div>

            {/* Split preview */}
            {selected.size > 0 && shareByCounsellor.size > 0 && (
              <div className="mt-3 rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs">
                <b className="block">Split preview — already-owned leads stay with their counsellor; the rest are shared evenly</b>
                <ul className="mt-1 space-y-0.5">
                  {[...shareByCounsellor.entries()].sort((a, b) => b[1] - a[1]).map(([id, share]) => {
                    const counsellor = counsellors.find((c) => c.id === id)
                    const isTicked = assignees.has(id)
                    const inactive = counsellor?.active === false
                    return (
                      <li key={id} className={cn('flex justify-between', inactive && 'rounded bg-amber-50 px-1')}>
                        <span>
                          {counsellor?.name || 'Unknown user'}
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">#{id}</span>
                          {inactive && <span className="ml-1 rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-900">inactive</span>}
                          {!isTicked && <span className="ml-1 rounded-full bg-violet-200 px-1.5 py-0.5 text-[9px] font-black text-violet-800">already owns them</span>}
                        </span>
                        <b>{share} lead{share !== 1 ? 's' : ''}</b>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* Task settings */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Work date</label>
                <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Due date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Assign date</label>
              <input value={formatDate(localISO())} readOnly title="Tasks are stamped as assigned when you press Assign" className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-muted/40 text-muted-foreground" />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <StickyNote className="h-3.5 w-3.5" /> Comments
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Instructions for the counsellor(s)…"
                className="w-full mt-1 h-24 resize-y px-3 py-2 text-sm border rounded-lg bg-background"
              />
            </div>
            <button
              onClick={assignPending}
              disabled={pending || !selected.size || !targetsOrdered.length}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {pending
                ? 'Assigning…'
                : `Assign ${selected.size} lead${selected.size === 1 ? '' : 's'} to ${shareByCounsellor.size || assignees.size} counsellor${(shareByCounsellor.size || assignees.size) === 1 ? '' : 's'}`}
            </button>
            <p className="text-[11px] text-muted-foreground">
              The task appends after each counsellor's existing queue on the work date.
            </p>
          </div>
        </div>
      </div>

      {/* ── Bulk selection bar ─────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/30 shadow-sm">
          <span className="text-sm font-semibold">{selected.size} lead{selected.size === 1 ? '' : 's'} selected</span>
          {selected.size < total && (
            <button onClick={selectAllFiltered} className="text-xs font-semibold text-primary hover:underline">
              Select all {total} matching
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground px-2">
            Clear selection
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading leads…</span>
            {selection.kind === 'all' && (
              <span className="text-xs">Every lead in the CRM — this one takes a few seconds.</span>
            )}
          </div>
        ) : pageLeads.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-semibold">No leads to assign</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {activeFilterCount > 0
                ? 'No leads match the current filters. Try clearing them.'
                : 'Nothing in this date window for this task type. Try another window or tab above.'}
            </p>
            {activeFilterCount > 0 && (
              <button onClick={resetFilters} className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-accent">
                <X className="h-3 w-3" />
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} className="rounded border-input" />
                  </th>
                  <th className="text-left px-3 py-3 font-semibold">Lead</th>
                  <th className="text-left px-3 py-3 font-semibold">Contact</th>
                  <th className="text-left px-3 py-3 font-semibold">City</th>
                  <th className="text-left px-3 py-3 font-semibold">State</th>
                  <th className="text-left px-3 py-3 font-semibold">Source</th>
                  <th className="text-left px-3 py-3 font-semibold">Status</th>
                  <th className="text-left px-3 py-3 font-semibold">Notes</th>
                  <th className="text-left px-3 py-3 font-semibold">Received</th>
                  <th className="text-left px-3 py-3 font-semibold">Sales Rep</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageLeads.map((lead) => {
                  const isSel = selected.has(lead.id)
                  const isGenericWebsite = !lead.website || /^other$/i.test(lead.website.trim())
                  const primaryLabel = isGenericWebsite && lead.source ? lead.source : lead.website
                  const secondaryLabel = isGenericWebsite && lead.source ? lead.website : lead.source
                  return (
                    <tr key={lead.id} className={cn('hover:bg-accent/30 transition-colors', isSel && 'bg-primary/5')}>
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={isSel} onChange={() => toggleOne(lead.id)} className="rounded border-input" />
                      </td>
                      <td className="px-3 py-3 max-w-[190px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-foreground break-words leading-tight">{lead.name || `Lead #${lead.id}`}</span>
                          {lead.attempted && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold shrink-0">CALLED</span>}
                          {lead.pendingFollowup && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200 text-[10px] font-bold shrink-0">FU DUE</span>}
                          {lead.isDuplicate && <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-bold shrink-0">DUP</span>}
                          {lead.wapp && <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-bold shrink-0">WA</span>}
                        </div>
                        {lead.interest && <div className="text-xs text-muted-foreground mt-0.5 break-words leading-tight">{lead.interest}</div>}
                        {(lead.leadScore ?? 0) > 0 && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                            <TrendingUp className="h-2.5 w-2.5" /> score {lead.leadScore}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-0.5">
                          {lead.mobile && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span>{maskPhone(lead.mobile, canRevealPhone)}</span>
                            </div>
                          )}
                          {lead.email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground max-w-[220px]">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{lead.email}</span>
                            </div>
                          )}
                          {!lead.mobile && !lead.email && <span className="text-muted-foreground text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 max-w-[125px] break-words text-xs">
                        {lead.city || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3 max-w-[125px] break-words text-xs">
                        {lead.state || <span className="text-muted-foreground">—</span>}
                        {lead.country && <div className="text-[10px] text-muted-foreground">{lead.country}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <Globe className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-medium">{primaryLabel || '—'}</span>
                        </div>
                        {secondaryLabel && secondaryLabel !== primaryLabel && (
                          <div className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wide">
                            {secondaryLabel}
                          </div>
                        )}
                        {lead.event && (
                          <div className="inline-flex items-center mt-1 ml-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-semibold uppercase tracking-wide">
                            {lead.event}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium">{lead.leadStatus || '—'}</div>
                        {lead.leadSubStatus && <div className="text-[10px] text-muted-foreground">{lead.leadSubStatus}</div>}
                        {lead.followupDate && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-orange-600">
                            <CalendarDays className="h-2.5 w-2.5" /> {shortDay(lead.followupDate)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 max-w-[220px]">
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-3" title={lead.note || ''}>
                          {lead.note || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                          <div className="leading-tight">
                            <div>{lead.createdAt ? formatDate(lead.createdAt) : shortDay(lead.createdOn)}</div>
                            {lead.createdAt && (
                              <div className="text-[10px] text-muted-foreground/80">
                                {new Date(lead.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          {lead.assignedTo?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {lead.assignedTo.map((a) => {
                                const inactive = counsellors.find((c) => c.id === a.id)?.active === false
                                return (
                                  <span
                                    key={a.id}
                                    title={inactive ? 'This counsellor is deactivated' : a.assignedOn ? `Assigned on ${a.assignedOn}` : undefined}
                                    className={cn(
                                      'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                                      inactive ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200',
                                    )}
                                  >
                                    {a.name}{inactive ? ' · inactive' : ''}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-semibold w-fit">
                              No counsellor
                            </span>
                          )}
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) assignOwner.mutate({ leadId: lead.id, counsellorId: Number(e.target.value) }) }}
                            className="px-1.5 py-1 text-[10px] bg-background border rounded-md"
                            title={lead.assignedTo?.length ? 'Move this lead to another counsellor' : 'Give this lead an owner'}
                          >
                            <option value="">{lead.assignedTo?.length ? 'Reassign to…' : 'Assign owner…'}</option>
                            {activeCounsellors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Showing</span>
            <select
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
              className="px-2 py-1 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {PAGE_SIZE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <span>of <strong className="text-foreground">{total}</strong> entries</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page <strong className="text-foreground">{safePage}</strong> of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
              className="p-2 rounded-lg border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage >= totalPages}
              className="p-2 rounded-lg border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
