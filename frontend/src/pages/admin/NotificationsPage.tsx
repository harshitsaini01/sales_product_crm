import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { notificationsApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import {
  Bell, AlarmClock, Activity, ListChecks,
  MessagesSquare, Search, Inbox, FolderKanban, Receipt, FileSignature,
  // Flag,  // disabled: flag feed not available yet
} from 'lucide-react'

type FilterType = 'all' | 'reminder' | 'followup' | 'task' | 'project' // | 'flag'

const typeConfig: Record<string, { icon: typeof Bell; color: string; bg: string; label: string }> = {
  reminder: { icon: AlarmClock, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Reminder' },
  followup: { icon: Activity, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Follow-up' },
  task: { icon: ListChecks, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Task' },
  project: { icon: FolderKanban, color: 'text-fuchsia-600', bg: 'bg-fuchsia-500/10', label: 'Project' },
  invoice: { icon: Receipt, color: 'text-rose-600', bg: 'bg-rose-500/10', label: 'Overdue invoice' },
  contract: { icon: FileSignature, color: 'text-amber-600', bg: 'bg-amber-500/10', label: 'Renewal' },
  // flag: { icon: Flag, color: 'text-amber-600', bg: 'bg-amber-600/10', label: 'Flag' },
}

function getConfig(type: string) {
  return typeConfig[type] || { icon: MessagesSquare, color: 'text-primary', bg: 'bg-primary/10', label: 'Message' }
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const hasProjects = useAuthStore((s) => s.hasFeature)('projects')

  const { data: notif, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.feed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const queryClient = useQueryClient()

  // Mark all notifications as read when the page mounts so the bell badge clears
  useEffect(() => {
    notificationsApi.markRead().then(() => {
      // Invalidate so the Header re-fetches and the badge drops to 0
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }).catch(() => { /* non-critical — swallow silently */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Flag feed is intentionally hidden — strip flag items so they don't pad the All count.
  const allItems: Array<{ id: string; type: string; title: string; summary: string; at: string | null; link?: string }> =
    (notif?.items ?? []).filter((n: { type: string }) => n.type !== 'flag')

  // Tab badges read from the server-supplied totals, NOT the items array — items are
  // paginated (take: 50 per type backend-side) so falling back to allItems.length would
  // under-report whenever the true count exceeds the page size.
  const serverCounts: { reminders?: number; followups?: number; tasks?: number; projects?: number } = notif?.counts ?? {}
  const trueCount = (key: FilterType): number => {
    if (key === 'reminder') return serverCounts.reminders ?? allItems.filter((n) => n.type === 'reminder').length
    if (key === 'followup') return serverCounts.followups ?? allItems.filter((n) => n.type === 'followup').length
    if (key === 'task') return serverCounts.tasks ?? allItems.filter((n) => n.type === 'task').length
    if (key === 'project') return serverCounts.projects ?? allItems.filter((n) => n.type === 'project').length
    // 'all' — sum of the visible types, server-truth
    return trueCount('reminder') + trueCount('followup') + trueCount('task') + trueCount('project')
  }

  const filteredItems = allItems
    .filter((n) => filter === 'all' || n.type === filter)
    .filter((n) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q)
    })

  const filterTabs: { key: FilterType; label: string; icon: typeof Bell }[] = [
    { key: 'all', label: 'All', icon: Bell },
    { key: 'reminder', label: 'Reminders', icon: AlarmClock },
    { key: 'followup', label: 'Follow-ups', icon: Activity },
    { key: 'task', label: 'Tasks', icon: ListChecks },
    // Only for customers with the module — an empty tab is a question nobody asked.
    ...(hasProjects ? [{ key: 'project' as FilterType, label: 'Projects', icon: FolderKanban }] : []),
    // { key: 'flag', label: 'Flags', icon: Flag },  // hidden — flag feed not wired up
  ]

  const groupedByDate = filteredItems.reduce<Record<string, typeof filteredItems>>((acc, item) => {
    const date = item.at
      ? new Date(item.at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      : 'No date'
    if (!acc[date]) acc[date] = []
    acc[date].push(item)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          Notifications
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Stay updated with all your alerts and reminders</p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {filterTabs.map((tab) => {
          const count = trueCount(tab.key)
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                filter === tab.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-card border hover:bg-accent/50 text-muted-foreground'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                filter === tab.key ? 'bg-primary-foreground/20' : 'bg-muted'
              }`}>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="p-4 border-b">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications..."
              className="w-full pl-9 pr-3 py-2 bg-muted border-none rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="px-6 py-16 text-center">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">Loading notifications...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Inbox className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="font-medium text-muted-foreground">{search ? 'No matching notifications' : "You're all caught up!"}</p>
          </div>
        ) : (
          <div className="divide-y">
            {Object.entries(groupedByDate).map(([dateLabel, items]) => (
              <div key={dateLabel}>
                <div className="px-5 py-2 bg-muted/30 border-b">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{dateLabel}</p>
                </div>
                <div className="divide-y divide-border/50">
                  {items.map((n) => {
                    const cfg = getConfig(n.type)
                    const Icon = cfg.icon
                    const inner = (
                      <div className="flex items-start gap-4 px-5 py-4 hover:bg-accent/30 transition-colors">
                        <div className={`h-10 w-10 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                          <Icon className={`h-5 w-5 ${cfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold">{n.title}</p>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} font-medium uppercase tracking-wider`}>{cfg.label}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.summary}</p>
                          {n.at && <p className="text-xs text-muted-foreground/60 mt-1">{new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                        </div>
                      </div>
                    )
                    return n.link ? (
                      <Link key={n.id} to={n.link} className="block">{inner}</Link>
                    ) : (
                      <div key={n.id}>{inner}</div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
