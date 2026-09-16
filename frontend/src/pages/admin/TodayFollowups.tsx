import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { followupsApi, type FollowupLead, type PaginatedFollowups } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { maskPhone } from '@/lib/utils'
import {
  Activity, CalendarDays, Search, Clock, AlertTriangle,
  ArrowUpRight, Phone, ChevronRight, ChevronLeft, CalendarClock,
} from 'lucide-react'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'

type TabKey = 'today' | 'overdue' | 'upcoming'

const PAGE_SIZE = 100

const EMPTY_PAGE: PaginatedFollowups = { data: [], total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 }

export default function TodayFollowups() {
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  const [activeTab, setActiveTab] = useState<TabKey>('today')
  const [search, setSearch] = useState('')
  const [excludeMode, setExcludeMode] = useState(false)
  const [page, setPage] = useState<Record<TabKey, number>>({ today: 1, overdue: 1, upcoming: 1 })

  const { data: todayRes = EMPTY_PAGE, isLoading: loadingToday } = useQuery<PaginatedFollowups>({
    queryKey: ['followups-today', page.today],
    queryFn: () => followupsApi.today({ page: page.today, limit: PAGE_SIZE }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const { data: overdueRes = EMPTY_PAGE, isLoading: loadingOverdue } = useQuery<PaginatedFollowups>({
    queryKey: ['followups-overdue', page.overdue],
    queryFn: () => followupsApi.overdue({ page: page.overdue, limit: PAGE_SIZE }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const { data: upcomingRes = EMPTY_PAGE, isLoading: loadingUpcoming } = useQuery<PaginatedFollowups>({
    queryKey: ['followups-upcoming', page.upcoming],
    queryFn: () => followupsApi.upcoming({ page: page.upcoming, limit: PAGE_SIZE }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const tabs: { key: TabKey; label: string; icon: typeof Activity; count: number; color: string }[] = [
    { key: 'today', label: "Today's Follow-ups", icon: CalendarDays, count: todayRes.total, color: 'text-blue-500' },
    { key: 'overdue', label: 'Overdue', icon: AlertTriangle, count: overdueRes.total, color: 'text-red-500' },
    { key: 'upcoming', label: 'Upcoming', icon: CalendarClock, count: upcomingRes.total, color: 'text-emerald-500' },
  ]

  const resMap: Record<TabKey, PaginatedFollowups> = { today: todayRes, overdue: overdueRes, upcoming: upcomingRes }
  const loadingMap: Record<TabKey, boolean> = { today: loadingToday, overdue: loadingOverdue, upcoming: loadingUpcoming }
  const currentRes = resMap[activeTab]

  const currentList = currentRes.data.filter((lead: FollowupLead) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const matches =
      (lead.name || '').toLowerCase().includes(q) ||
      (lead.mobile || '').includes(q) ||
      (lead.email || '').toLowerCase().includes(q) ||
      (lead.leadStatus || '').toLowerCase().includes(q)
    return excludeMode ? !matches : matches
  })

  const isLoading = loadingMap[activeTab]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            Follow-ups Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all your scheduled follow-ups in one place
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`group relative p-5 rounded-xl border transition-all text-left ${
              activeTab === tab.key
                ? 'bg-primary/5 border-primary/30 shadow-sm ring-1 ring-primary/10'
                : 'bg-card hover:bg-accent/30 border-border'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                  activeTab === tab.key ? 'bg-primary/15' : 'bg-muted'
                }`}>
                  <tab.icon className={`h-5 w-5 ${tab.color}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{tab.label}</p>
                  <p className="text-2xl font-bold">{tab.count}</p>
                </div>
              </div>
              <ChevronRight className={`h-4 w-4 transition-transform ${
                activeTab === tab.key ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100'
              }`} />
            </div>
          </button>
        ))}
      </div>

      {/* Search + list */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            {tabs.find((t) => t.key === activeTab)?.label}
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {currentRes.total > 0
                ? `${(currentRes.page - 1) * currentRes.limit + 1}–${Math.min(currentRes.page * currentRes.limit, currentRes.total)} of ${currentRes.total}`
                : 0}
            </span>
          </h2>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, email..."
                className="w-full pl-9 pr-3 py-2 bg-muted border-none rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <FilterModeToggle excludeMode={excludeMode} onChange={setExcludeMode} label="" />
          </div>
        </div>

        <div className="divide-y">
          {isLoading ? (
            <div className="px-6 py-16 text-center">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground mt-3">Loading follow-ups...</p>
            </div>
          ) : currentList.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {search ? 'No matching follow-ups found' : `No ${activeTab} follow-ups`}
              </p>
            </div>
          ) : (
            currentList.map((lead: FollowupLead) => (
              <Link
                key={lead.id}
                to="/app/leads/$leadId"
                params={{ leadId: String(lead.id) }}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 px-5 py-4 hover:bg-accent/30 transition-colors group"
              >
                {/* Avatar */}
                <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                  {(lead.name || '?').charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{lead.name || 'Unknown'}</p>
                    {lead.leadStatus && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted font-medium text-muted-foreground uppercase tracking-wider">
                        {lead.leadStatus}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {lead.mobile && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {maskPhone(lead.mobile, canRevealPhone)}
                      </span>
                    )}
                    {lead.followupDate && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(lead.followupDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {lead.lastNote && (
                    <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">
                      Note: {lead.lastNote}
                    </p>
                  )}
                  {lead.lastComment && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
                      Last: {lead.lastComment}
                    </p>
                  )}
                </div>

                {/* Action */}
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            ))
          )}
        </div>

        {/* Pagination */}
        {currentRes.totalPages > 1 && (
          <div className="px-5 py-3 border-t flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              Page <span className="font-semibold text-foreground">{currentRes.page}</span> of {currentRes.totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={currentRes.page <= 1}
                onClick={() => setPage((p) => ({ ...p, [activeTab]: Math.max(1, p[activeTab] - 1) }))}
                className="px-3 py-1.5 rounded-md border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <button
                disabled={currentRes.page >= currentRes.totalPages}
                onClick={() => setPage((p) => ({ ...p, [activeTab]: Math.min(currentRes.totalPages, p[activeTab] + 1) }))}
                className="px-3 py-1.5 rounded-md border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
