import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, usersApi, verifiedApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, maskPhone, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { DupTag } from '@/components/leads/LeadCard'
import { useLeadFields } from '@/hooks/useLeadFields'
import { StatCard } from '@/components/common/StatCard'
import { MultiSelectFilter } from '@/components/common/MultiSelectFilter'
import {
  Inbox, Search, Loader2, RefreshCw, UserPlus, ChevronLeft, ChevronRight, ChevronDown,
  Mail, Phone, Globe, Clock, Filter, X, CalendarDays, TrendingUp,
  Users as UsersIcon, ArrowUpDown, Flag as FlagIcon, Trash2, Pencil, ArrowRight, Check,
} from 'lucide-react'

interface BucketLead {
  id: number
  name: string
  email: string | null
  mobile: string | null
  city: string | null
  state: string | null
  country: string | null
  leadType: string
  leadStatus: string
  website: string
  source: string | null
  event: string | null
  intrestedCourse: string | null
  comment: string | null
  flagRcv?: number
  flagSend?: number
  emailDup?: boolean
  mobileDup?: boolean
  latestComment: { comment: string; createdAt: string } | null
  flagReason: { message: string; createdAt: string; byName: string | null; type: 'send' | 'rcv' } | null
  assignedTo?: Array<{ clrId: number; counsellor: { id: number; name: string } }>
  createdAt: string
}

interface Facets {
  total: number
  todayCount: number
  unassignedCount: number
  flaggedCount: number
  websites: { value: string; count: number }[]
  sources: { value: string; count: number }[]
  events: { value: string; count: number }[]
  cities?: { value: string; count: number }[]
  states?: { value: string; count: number }[]
}

type BucketMode = 'unassigned' | 'flagged'

interface Counsellor {
  id: number
  name: string
  role: string
  email?: string
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export default function Bucket() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const isAdminUser = isAdmin()
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  // Lead fields a super admin has switched off for this customer.
  const { visible: showField } = useLeadFields()

  const [bucketMode, setBucketMode] = useState<BucketMode>('unassigned')
  const [search, setSearch] = useState('')
  const [website, setWebsite] = useState('')
  const [source, setSource] = useState('')
  const [event, setEvent] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [assignTarget, setAssignTarget] = useState<{ ids: number[] } | null>(null)
  const [locationEditTarget, setLocationEditTarget] = useState<{
    leads: Array<{ id: number; name: string; city: string | null; state: string | null }>
    city: string
    state: string
  } | null>(null)
  const [locationPreviewTarget, setLocationPreviewTarget] = useState<{
    leads: Array<{ id: number; name: string; city: string | null; state: string | null }>
    newCity: string
    newState: string
  } | null>(null)

  const isFlagged = bucketMode === 'flagged'

  const params = useMemo(() => {
    const p: Record<string, string> = {
      page: String(page),
      limit: String(limit),
      orderDir,
    }
    if (search.trim()) p.search = search.trim()
    if (website) p.website = website
    if (source) p.source = source
    if (event) p.event = event
    if (cityFilter) p.city = cityFilter
    if (stateFilter) p.state = stateFilter
    if (fromDate) p.fromDate = fromDate
    if (toDate) p.toDate = toDate
    if (isFlagged) p.flagBucket = '1'
    return p
  }, [search, website, source, event, cityFilter, stateFilter, fromDate, toDate, orderDir, page, limit, isFlagged])

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['leads', 'bucket', params],
    queryFn: () => leadsApi.bucketList(params),
    refetchInterval: 15_000,
  })

  const { data: verifiedCityList = [] } = useQuery({
    queryKey: ['verified-list', 'city'],
    queryFn: () => verifiedApi.list('city'),
    staleTime: 60_000,
  })

  const { data: verifiedStateList = [] } = useQuery({
    queryKey: ['verified-list', 'state'],
    queryFn: () => verifiedApi.list('state'),
    staleTime: 60_000,
  })

  const verifiedCities = useMemo(
    () => new Set((verifiedCityList || []).map((v) => v.value.trim().toLowerCase())),
    [verifiedCityList],
  )

  const verifiedStates = useMemo(
    () => new Set((verifiedStateList || []).map((v) => v.value.trim().toLowerCase())),
    [verifiedStateList],
  )

  const { data: facets } = useQuery<Facets>({
    queryKey: ['leads', 'bucket', 'facets', isFlagged ? 'flag' : 'unassigned'],
    queryFn: () => leadsApi.bucketFacets(isFlagged ? { flagBucket: '1' } : undefined),
    refetchInterval: 30_000,
  })

  const leads: BucketLead[] = data?.data || []
  // Backend returns { data, total, page, limit, totalPages } — flat shape, not nested under `pagination`.
  const total: number = data?.total ?? data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const activeFilterCount =
    (search ? 1 : 0) + (website ? 1 : 0) + (source ? 1 : 0) + (event ? 1 : 0) +
    (cityFilter ? 1 : 0) + (stateFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0)

  const claimMutation = useMutation({
    mutationFn: (leadIds: number[]) => leadsApi.bucketClaim(leadIds),
    onSuccess: (res: { claimed: number; skipped: number; message: string }) => {
      toast.success(res.message)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to claim leads')
    },
  })

  const adminAssignMutation = useMutation({
    mutationFn: ({ leadIds, counsellorId }: { leadIds: number[]; counsellorId: number }) =>
      leadsApi.bulkAssign({ leadIds, counsellorId }),
    onSuccess: (res: { assigned: number; message: string }) => {
      toast.success(res.message || `${res.assigned} lead(s) assigned`)
      setSelected(new Set())
      setAssignTarget(null)
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to assign')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (leadIds: number[]) => leadsApi.bulkDelete(leadIds),
    onSuccess: (res: { message?: string }) => {
      toast.success(res.message || 'Lead(s) moved to trash')
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to delete lead(s)')
    },
  })

  const bulkLocationMutation = useMutation({
    mutationFn: ({ leadIds, city, state }: { leadIds: number[]; city: string; state: string }) =>
      leadsApi.bulkUpdate({
        leadIds,
        data: { city, state },
      }),
    onSuccess: (res: { message?: string }) => {
      toast.success(res.message || 'Location updated successfully')
      setSelected(new Set())
      setLocationEditTarget(null)
      setLocationPreviewTarget(null)
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['verified-candidates'] })
      qc.invalidateQueries({ queryKey: ['verified-list'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to update location')
    },
  })

  const allOnPageSelected = leads.length > 0 && leads.every((l) => selected.has(l.id))

  function toggleAll() {
    if (allOnPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        leads.forEach((l) => next.delete(l.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        leads.forEach((l) => next.add(l.id))
        return next
      })
    }
  }
  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetFilters() {
    setSearch(''); setWebsite(''); setSource(''); setEvent('')
    setCityFilter(''); setStateFilter('')
    setFromDate(''); setToDate('')
    setPage(1)
  }

  function switchMode(mode: BucketMode) {
    if (mode === bucketMode) return
    setBucketMode(mode)
    setSelected(new Set())
    setPage(1)
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Inbox className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Lead Bucket</h1>
            <p className="text-sm text-muted-foreground">
              {isFlagged
                ? 'Leads flagged by counsellors — visible to everyone. Pick one to take it over.'
                : isAdminUser
                  ? 'Unassigned new leads. Assign them to any counsellor from here.'
                  : 'New leads available to claim. Pick any and assign to yourself.'}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-accent"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Bucket-mode tab bar */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 border rounded-lg w-fit">
        <button
          onClick={() => switchMode('unassigned')}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors',
            !isFlagged ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Inbox className="h-4 w-4" />
          Unassigned
          <span className={cn(
            'inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold',
            !isFlagged ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}>
            {facets?.unassignedCount ?? '—'}
          </span>
        </button>
        <button
          onClick={() => switchMode('flagged')}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors',
            isFlagged ? 'bg-background shadow-sm text-amber-700' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <FlagIcon className="h-4 w-4" />
          Flagged
          <span className={cn(
            'inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold',
            isFlagged ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground',
          )}>
            {facets?.flaggedCount ?? '—'}
          </span>
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Inbox className="h-4 w-4" />}
          label={activeFilterCount > 0 ? 'Matching unassigned' : 'Unassigned leads'}
          value={data ? total.toLocaleString() : '—'}
          sub={
            facets
              ? activeFilterCount > 0
                ? `of ${facets.total.toLocaleString()} total unassigned`
                : `${facets.total.toLocaleString()} total unassigned`
              : undefined
          }
          tint="amber"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="New Today"
          value={facets?.todayCount ?? '—'}
          tint="emerald"
        />
        <StatCard
          icon={<Globe className="h-4 w-4" />}
          label="Websites"
          value={facets?.websites?.length ?? '—'}
          tint="blue"
        />
        <StatCard
          icon={<UsersIcon className="h-4 w-4" />}
          label="Selected"
          value={selected.size}
          tint="violet"
        />
      </div>

      {/* Filter bar */}
      <div className="bg-card border rounded-xl p-3 space-y-3 relative overflow-visible z-20">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name, email, or mobile…"
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

          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear all
            </button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 pt-2 border-t">
            <MultiSelectFilter
              label="Source Website"
              value={website}
              onChange={(v) => { setWebsite(v); setPage(1) }}
              options={facets?.websites || []}
              placeholder="All websites"
            />
            <MultiSelectFilter
              label="Source"
              value={source}
              onChange={(v) => { setSource(v); setPage(1) }}
              options={facets?.sources || []}
              placeholder="All sources"
            />
            <MultiSelectFilter
              label="Event / Campaign"
              value={event}
              onChange={(v) => { setEvent(v); setPage(1) }}
              options={facets?.events || []}
              placeholder="All events"
            />
            <MultiSelectFilter
              label="City"
              value={cityFilter}
              onChange={(v) => { setCityFilter(v); setPage(1) }}
              options={facets?.cities || []}
              placeholder="All cities"
            />
            <MultiSelectFilter
              label="State"
              value={stateFilter}
              onChange={(v) => { setStateFilter(v); setPage(1) }}
              options={facets?.states || []}
              placeholder="All states"
            />
            <div className="flex gap-2 sm:col-span-2 md:col-span-1">
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</label>
                <div className="relative mt-1">
                  <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setPage(1) }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</label>
                <div className="relative mt-1">
                  <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => { setToDate(e.target.value); setPage(1) }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active Filter Tags with (x) remove buttons */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t text-xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">
              Active Filters:
            </span>

            {search && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-xs border border-primary/20">
                <span>Search: <strong>{search}</strong></span>
                <button onClick={() => { setSearch(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {website && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium text-xs border border-blue-200 dark:border-blue-800">
                <span>Website: <strong>{website}</strong></span>
                <button onClick={() => { setWebsite(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {source && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-medium text-xs border border-purple-200 dark:border-purple-800">
                <span>Source: <strong>{source}</strong></span>
                <button onClick={() => { setSource(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {event && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-medium text-xs border border-amber-200 dark:border-amber-800">
                <span>Event: <strong>{event}</strong></span>
                <button onClick={() => { setEvent(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {cityFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium text-xs border border-emerald-200 dark:border-emerald-800">
                <span>City: <strong>{cityFilter}</strong></span>
                <button onClick={() => { setCityFilter(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {stateFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-medium text-xs border border-indigo-200 dark:border-indigo-800">
                <span>State: <strong>{stateFilter}</strong></span>
                <button onClick={() => { setStateFilter(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {(fromDate || toDate) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-xs border border-slate-200 dark:border-slate-700">
                <span>Date: <strong>{fromDate || 'Start'} ➔ {toDate || 'End'}</strong></span>
                <button onClick={() => { setFromDate(''); setToDate(''); setPage(1) }} className="hover:text-destructive p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            <button
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-destructive underline font-medium ml-1"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/30 shadow-sm">
          <span className="text-sm font-semibold">
            {selected.size} lead{selected.size === 1 ? '' : 's'} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            {isAdminUser ? (
              <>
                <button
                  onClick={() => {
                    const selLeads = leads.filter((l) => selected.has(l.id))
                    setLocationEditTarget({
                      leads: selLeads,
                      city: selLeads.length === 1 ? (selLeads[0].city || '') : '',
                      state: selLeads.length === 1 ? (selLeads[0].state || '') : '',
                    })
                  }}
                  disabled={adminAssignMutation.isPending || deleteMutation.isPending || bulkLocationMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-white dark:bg-card border border-input text-foreground hover:bg-accent disabled:opacity-50 shadow-xs"
                >
                  <Pencil className="h-3.5 w-3.5 text-primary" />
                  Edit City & State…
                </button>
                <button
                  onClick={() => setAssignTarget({ ids: Array.from(selected) })}
                  disabled={adminAssignMutation.isPending || deleteMutation.isPending || bulkLocationMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Assign to counsellor…
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Move ${selected.size} selected lead(s) to trash?`)) {
                      deleteMutation.mutate(Array.from(selected))
                    }
                  }}
                  disabled={deleteMutation.isPending || adminAssignMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </button>
              </>
            ) : (
              <button
                onClick={() => claimMutation.mutate(Array.from(selected))}
                disabled={claimMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {claimMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Assign to me
              </button>
            )}
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground px-2"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-24 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading bucket…
          </div>
        ) : leads.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-semibold">
              {isFlagged ? 'No flagged leads right now' : 'The bucket is empty'}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {activeFilterCount > 0
                ? 'No leads match the current filters. Try clearing them.'
                : isFlagged
                  ? 'When a counsellor flags a lead it lands here for anyone to take over.'
                  : 'New unassigned leads will appear here automatically.'}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-accent"
              >
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
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      className="rounded border-input"
                    />
                  </th>
                  <th className="text-left px-3 py-3 font-semibold">Lead</th>
                  <th className="text-left px-3 py-3 font-semibold">Contact</th>
                  <th className="text-left px-3 py-3 font-semibold">City</th>
                  <th className="text-left px-3 py-3 font-semibold">State</th>
                  <th className="text-left px-3 py-3 font-semibold">Source</th>
                  <th className="text-left px-3 py-3 font-semibold">
                    {isFlagged ? 'Flag reason / Notes' : 'Notes'}
                  </th>
                  <th className="text-left px-3 py-3 font-semibold">Received</th>
                  <th className="text-right px-3 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((l) => {
                  const isSel = selected.has(l.id)
                  return (
                    <tr key={l.id} className={cn('hover:bg-accent/30 transition-colors', isSel && 'bg-primary/5')}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(l.id)}
                          className="rounded border-input"
                        />
                      </td>
                      <td className="px-3 py-3 max-w-[170px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-foreground break-words leading-tight">{l.name || '—'}</span>
                          {isFlagged && l.flagRcv === 1 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold shrink-0">
                              <FlagIcon className="h-2.5 w-2.5" />
                              COUNSELLOR FLAG
                            </span>
                          )}
                          {isFlagged && l.flagSend === 1 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold shrink-0">
                              <FlagIcon className="h-2.5 w-2.5" />
                              ADMIN FLAG
                            </span>
                          )}
                        </div>
                        {showField('intrestedCourse') && l.intrestedCourse && (
                          <div className="text-xs text-muted-foreground mt-0.5 break-words leading-tight">{l.intrestedCourse}</div>
                        )}
                        {isFlagged && l.assignedTo && l.assignedTo.length > 0 && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <UsersIcon className="h-2.5 w-2.5" />
                            Assigned to {l.assignedTo.map((a) => a.counsellor?.name).filter(Boolean).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-0.5">
                          {showField('mobile') && l.mobile && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span>{maskPhone(l.mobile, canRevealPhone)}</span>
                              {l.mobileDup && <DupTag title="Same number on another lead" />}
                            </div>
                          )}
                          {showField('email') && l.email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground max-w-[220px]">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{l.email}</span>
                              {l.emailDup && <DupTag title="Same email on another lead" />}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 max-w-[125px] break-words text-xs group relative">
                        <div className="flex items-center justify-between gap-1">
                          {l.city ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="font-medium text-foreground leading-tight block break-words">{l.city}</span>
                              {verifiedCities.has(l.city.trim().toLowerCase()) && (
                                <span title="Verified City" className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {isAdminUser && (
                            <button
                              onClick={() => setLocationEditTarget({ leads: [l], city: l.city || '', state: l.state || '' })}
                              title="Edit city & state"
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-opacity shrink-0"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 max-w-[135px] break-words text-xs group relative">
                        <div className="flex items-center justify-between gap-1">
                          {(() => {
                            const stateStr = [l.state, l.country].filter(Boolean).join(', ')
                            const isStateVer = l.state && verifiedStates.has(l.state.trim().toLowerCase())
                            return stateStr ? (
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-foreground leading-tight block break-words">{stateStr}</span>
                                {isStateVer && (
                                  <span title="Verified State" className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )
                          })()}
                          {isAdminUser && (
                            <button
                              onClick={() => setLocationEditTarget({ leads: [l], city: l.city || '', state: l.state || '' })}
                              title="Edit city & state"
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-opacity shrink-0"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {(() => {
                          const isGenericWebsite = !l.website || /^other$/i.test(l.website.trim())
                          const primaryLabel = isGenericWebsite && l.source ? l.source : l.website
                          const secondaryLabel = isGenericWebsite && l.source ? l.website : l.source
                          return (
                            <>
                              <div className="flex items-center gap-1.5">
                                <Globe className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs font-medium">{primaryLabel || '—'}</span>
                              </div>
                              {secondaryLabel && secondaryLabel !== primaryLabel && (
                                <div className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wide">
                                  {secondaryLabel}
                                </div>
                              )}
                              {l.event && (
                                <div className="inline-flex items-center mt-1 ml-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-semibold uppercase tracking-wide">
                                  {l.event}
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-3 max-w-[220px]">
                        <NotesCell lead={l} isFlagged={isFlagged} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                          <div className="leading-tight">
                            <div>{formatDate(l.createdAt)}</div>
                            <div className="text-[10px] text-muted-foreground/80">
                              {new Date(l.createdAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit', minute: '2-digit', hour12: true,
                              })}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isAdminUser ? (
                            <>
                              <button
                                onClick={() => setAssignTarget({ ids: [l.id] })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                              >
                                <UserPlus className="h-3 w-3" />
                                Assign
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Move lead #${l.id} (${l.name}) to trash?`)) {
                                    deleteMutation.mutate([l.id])
                                  }
                                }}
                                disabled={deleteMutation.isPending}
                                title="Move lead to trash"
                                className="p-1.5 text-xs font-semibold rounded-md border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => claimMutation.mutate([l.id])}
                              disabled={claimMutation.isPending}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              <UserPlus className="h-3 w-3" />
                              Assign to me
                            </button>
                          )}
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

      {/* Pagination + page size */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Showing</span>
            <select
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
              className="px-2 py-1 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <span>
              of <strong className="text-foreground">{total}</strong> entries
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page <strong className="text-foreground">{page}</strong> of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Admin assign modal */}
      {assignTarget && isAdminUser && (
        <AssignToCounsellorModal
          count={assignTarget.ids.length}
          onCancel={() => setAssignTarget(null)}
          onAssign={(counsellorId) =>
            adminAssignMutation.mutate({ leadIds: assignTarget.ids, counsellorId })
          }
          isPending={adminAssignMutation.isPending}
        />
      )}

      {/* Location Edit Modal */}
      {locationEditTarget && isAdminUser && (
        <EditLocationModal
          leads={locationEditTarget.leads}
          initialCity={locationEditTarget.city}
          initialState={locationEditTarget.state}
          onCancel={() => setLocationEditTarget(null)}
          onProceedToPreview={(newCity, newState) => {
            setLocationPreviewTarget({
              leads: locationEditTarget.leads,
              newCity,
              newState,
            })
            setLocationEditTarget(null)
          }}
        />
      )}

      {/* Location Preview Confirmation Modal */}
      {locationPreviewTarget && isAdminUser && (
        <ConfirmLocationPreviewModal
          leads={locationPreviewTarget.leads}
          newCity={locationPreviewTarget.newCity}
          newState={locationPreviewTarget.newState}
          onBack={() => {
            setLocationEditTarget({
              leads: locationPreviewTarget.leads,
              city: locationPreviewTarget.newCity,
              state: locationPreviewTarget.newState,
            })
            setLocationPreviewTarget(null)
          }}
          onConfirmSave={() => {
            bulkLocationMutation.mutate({
              leadIds: locationPreviewTarget.leads.map((l) => l.id),
              city: locationPreviewTarget.newCity,
              state: locationPreviewTarget.newState,
            })
          }}
          isPending={bulkLocationMutation.isPending}
        />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NotesCell({ lead, isFlagged }: { lead: BucketLead; isFlagged: boolean }) {
  // Priority in flag mode: flag reason first (that's what the reader needs to
  // decide whether to take it over). Then latest comment, then intake comment.
  const flag = lead.flagReason
  const latest = lead.latestComment
  const intake = lead.comment

  if (!flag && !latest && !intake) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  return (
    <div className="space-y-1 text-xs">
      {isFlagged && flag && (
        <div className="p-1.5 bg-amber-50/80 border border-amber-200/70 rounded-md">
          <div className="flex items-start gap-1">
            <FlagIcon className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-amber-950 font-medium break-words leading-tight">{flag.message}</div>
              <div className="text-[10px] text-amber-700/90 mt-0.5">
                {flag.byName ? `by ${flag.byName} · ` : ''}{formatDate(flag.createdAt)}
              </div>
            </div>
          </div>
        </div>
      )}
      {latest && (
        <div className="text-xs text-muted-foreground break-words leading-tight" title={latest.comment}>
          <span className="font-semibold text-foreground/80">Last comment: </span>
          <span>{latest.comment}</span>
        </div>
      )}
      {!latest && intake && (
        <div className="text-xs text-muted-foreground break-words leading-tight" title={intake}>
          {intake}
        </div>
      )}
    </div>
  )
}

function AssignToCounsellorModal({
  count, onCancel, onAssign, isPending,
}: {
  count: number
  onCancel: () => void
  onAssign: (counsellorId: number) => void
  isPending: boolean
}) {
  const [counsellorId, setCounsellorId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const { data: counsellors = [], isLoading } = useQuery<Counsellor[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: () => usersApi.counsellors(),
  })

  const filtered = counsellors.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-card border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Assign {count} Lead{count === 1 ? '' : 's'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Select a counsellor to assign to.</p>
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search counsellor by name…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No counsellors found</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCounsellorId(c.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                    counsellorId === c.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent',
                  )}
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{c.role}</div>
                  </div>
                  {counsellorId === c.id && (
                    <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
                      ✓
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => counsellorId && onAssign(counsellorId)}
            disabled={!counsellorId || isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Assign
          </button>
        </div>
      </div>
    </div>
  )
}

function LocationSelect({
  label,
  value,
  onChange,
  field,
  zIndexClass = 'z-30',
}: {
  label: string
  value: string
  onChange: (val: string) => void
  field: 'city' | 'state'
  zIndexClass?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['verified-candidates', field],
    queryFn: () => verifiedApi.candidates(field),
    staleTime: 60_000,
  })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isCurrentVerified = useMemo(() => {
    if (!value.trim()) return false
    return candidates.some(
      (c) => c.verified && c.value.toLowerCase() === value.trim().toLowerCase(),
    )
  }, [value, candidates])

  const filteredOptions = useMemo(() => {
    let result = candidates
    if (query.trim()) {
      const q = query.toLowerCase()
      result = candidates.filter((c) => c.value.toLowerCase().includes(q))
    }
    return result.slice(0, 25)
  }, [candidates, query])

  return (
    <div className={cn('relative', zIndexClass)} ref={containerRef}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        {isCurrentVerified && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shadow-2xs">
            <Check className="h-3 w-3 stroke-[3]" /> Verified {label}
          </span>
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={`Select or type ${label.toLowerCase()}...`}
          className={cn(
            'w-full pl-3.5 pr-10 py-2.5 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-2xs',
            isCurrentVerified && 'border-emerald-500/50 bg-emerald-50/20 ring-emerald-500/20',
          )}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isCurrentVerified && (
            <div className="text-emerald-600 font-bold" title="Verified value">
              <Check className="h-4 w-4 stroke-[3]" />
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            tabIndex={-1}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', isOpen && 'rotate-180')} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl shadow-slate-900/20 z-50 p-1.5 divide-y divide-slate-100 dark:divide-slate-800/60">
          {isLoading ? (
            <div className="p-3 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading {label.toLowerCase()} options…
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="p-3 text-xs text-slate-500 dark:text-slate-400 text-center">
              No matching {label.toLowerCase()} found. You can type to add custom value.
            </div>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = opt.value.toLowerCase() === value.trim().toLowerCase()
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setIsOpen(false)
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-left transition-colors my-0.5',
                    isSelected
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100',
                  )}
                >
                  <span className="truncate font-medium">{opt.value}</span>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {opt.count > 0 && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium">
                        {opt.count} lead{opt.count === 1 ? '' : 's'}
                      </span>
                    )}
                    {opt.verified && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                        <Check className="h-3 w-3 stroke-[3]" />
                        Verified
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function EditLocationModal({
  leads,
  initialCity,
  initialState,
  onCancel,
  onProceedToPreview,
}: {
  leads: Array<{ id: number; name: string; city: string | null; state: string | null }>
  initialCity: string
  initialState: string
  onCancel: () => void
  onProceedToPreview: (newCity: string, newState: string) => void
}) {
  const [city, setCity] = useState(initialCity)
  const [state, setState] = useState(initialState)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-card border rounded-xl shadow-2xl w-full max-w-lg min-h-[440px] flex flex-col justify-between relative overflow-visible z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b bg-muted/20 rounded-t-xl">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Edit City & State
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Updating location for {leads.length} lead{leads.length === 1 ? '' : 's'}. Choose from present CRM values or type new ones.
          </p>
        </div>

        <div className="p-6 space-y-6 flex-1 relative overflow-visible">
          <LocationSelect label="City" value={city} onChange={setCity} field="city" zIndexClass="z-30" />
          <LocationSelect label="State" value={state} onChange={setState} field="state" zIndexClass="z-20" />
        </div>

        <div className="p-4 border-t bg-muted/10 flex items-center justify-end gap-2 rounded-b-xl relative z-10">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => onProceedToPreview(city, state)}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Preview Changes
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmLocationPreviewModal({
  leads,
  newCity,
  newState,
  onBack,
  onConfirmSave,
  isPending,
}: {
  leads: Array<{ id: number; name: string; city: string | null; state: string | null }>
  newCity: string
  newState: string
  onBack: () => void
  onConfirmSave: () => void
  isPending: boolean
}) {
  const { data: cityCandidates = [] } = useQuery({
    queryKey: ['verified-candidates', 'city'],
    queryFn: () => verifiedApi.candidates('city'),
    staleTime: 60_000,
  })

  const { data: stateCandidates = [] } = useQuery({
    queryKey: ['verified-candidates', 'state'],
    queryFn: () => verifiedApi.candidates('state'),
    staleTime: 60_000,
  })

  const isNewCityVerified = useMemo(
    () => cityCandidates.some((c) => c.verified && c.value.toLowerCase() === newCity.trim().toLowerCase()),
    [cityCandidates, newCity],
  )

  const isNewStateVerified = useMemo(
    () => stateCandidates.some((c) => c.verified && c.value.toLowerCase() === newState.trim().toLowerCase()),
    [stateCandidates, newState],
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onBack}>
      <div
        className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-600" />
                Confirm Location Changes Preview
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Please review the proposed city/state updates for {leads.length} lead{leads.length === 1 ? '' : 's'}.
              </p>
            </div>
            <button onClick={onBack} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/40 uppercase text-muted-foreground tracking-wider font-semibold">
              <tr>
                <th className="px-3 py-2 rounded-l-md">Lead Name</th>
                <th className="px-3 py-2">City (Old ➔ New)</th>
                <th className="px-3 py-2 rounded-r-md">State (Old ➔ New)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((l) => {
                const oldCity = l.city?.trim() || '—'
                const targetCity = newCity.trim() || '—'
                const isCityChanged = oldCity !== targetCity

                const oldState = l.state?.trim() || '—'
                const targetState = newState.trim() || '—'
                const isStateChanged = oldState !== targetState

                return (
                  <tr key={l.id} className="hover:bg-accent/20">
                    <td className="px-3 py-2.5 font-medium text-foreground">{l.name || `Lead #${l.id}`}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{oldCity}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className={cn('font-semibold inline-flex items-center gap-1', isCityChanged ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded' : 'text-foreground')}>
                          {targetCity}
                          {isNewCityVerified && targetCity !== '—' && (
                            <span title="Verified City" className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                              <Check className="h-2.5 w-2.5 stroke-[3]" />
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{oldState}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className={cn('font-semibold inline-flex items-center gap-1', isStateChanged ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded' : 'text-foreground')}>
                          {targetState}
                          {isNewStateVerified && targetState !== '—' && (
                            <span title="Verified State" className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                              <Check className="h-2.5 w-2.5 stroke-[3]" />
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t bg-muted/10 flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-accent"
          >
            ← Back to Edit
          </button>
          <button
            onClick={onConfirmSave}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm & Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}
