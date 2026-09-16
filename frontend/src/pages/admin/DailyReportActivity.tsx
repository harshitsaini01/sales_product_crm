import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, Loader2, ChevronLeft, ChevronRight, Smartphone, Monitor, LogIn,
  PhoneCall, Calendar as CalendarIcon, StickyNote, MessageCircle, RefreshCw,
  AlertTriangle, CalendarClock, CalendarDays, ArrowRight, User as UserIcon,
} from 'lucide-react'
import { usersApi, followupsApi, type UserActivity, type UserActivityTimelineItem, type PaginatedFollowups, type FollowupLead } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { maskPhone } from '@/lib/utils'
import { CounsellorDetailPanel } from '@/components/reports/CounsellorDetailPanel'

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type BacklogTab = 'overdue' | 'today' | 'upcoming' | null
const TIMELINE_PAGE_SIZE = 50

export default function DailyReportActivity() {
  const { userId: userIdParam } = useParams({ strict: false }) as { userId: string }
  const userId = Number(userIdParam)
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { date?: string }
  const { isAdmin, user: me } = useAuthStore()
  const canBrowseOthers = isAdmin()

  const today = toISODate(new Date())
  const [date, setDate] = useState(() => {
    if (search?.date && /^\d{4}-\d{2}-\d{2}$/.test(search.date)) {
      return search.date
    }
    return today
  })
  const [backlogTab, setBacklogTab] = useState<BacklogTab>(null)
  const [timelinePage, setTimelinePage] = useState(1)

  const { data: counsellors = [] } = useQuery<{ id: number; name: string; role: string; designation?: string }[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: () => usersApi.counsellors(),
    enabled: canBrowseOthers,
    staleTime: 5 * 60_000,
  })

  const { data: profile } = useQuery<{ id: number; name: string }>({
    queryKey: ['users', userId],
    queryFn: () => usersApi.get(userId),
    enabled: !!userId,
  })

  const { data, isLoading } = useQuery<UserActivity>({
    queryKey: ['users', userId, 'activity', date],
    queryFn: () => usersApi.activity(userId, date),
    enabled: !!userId,
  })

  function shiftDay(delta: number) {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() + delta)
    setDate(toISODate(d))
  }

  useEffect(() => {
    setTimelinePage(1)
  }, [date, userId])

  const displayName = profile?.name || (Number(me?.id) === userId ? me?.name : null) || 'Counsellor'
  const isSelf = Number(me?.id) === userId

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          {!isSelf && (
            <Link to="/app/daily-reports" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mb-1">
              <ChevronLeft className="h-3 w-3" /> Back to Daily Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            {isSelf ? 'My Activity' : `${displayName}'s Activity`}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every status change, follow-up update, and call logged on this day — with what it was before and what it became.
          </p>
        </div>

        {canBrowseOthers && counsellors.length > 0 && (
          <select
            value={userId}
            onChange={(e) => navigate({ to: '/app/daily-reports/activity/$userId', params: { userId: e.target.value } })}
            className="px-3 py-2 text-sm border rounded-lg bg-background"
          >
            {counsellors.map((cUser) => (
              <option key={cUser.id} value={cUser.id}>{cUser.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Date controls */}
      <div className="bg-card border rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(today)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
              date === today ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); setDate(toISODate(d)) }}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
              date === toISODate(new Date(Date.now() - 86400000)) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'
            }`}
          >
            Yesterday
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => shiftDay(-1)} className="p-1.5 rounded-lg border hover:bg-muted" aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="px-2.5 py-1.5 border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => shiftDay(1)}
            disabled={date >= today}
            className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Follow-up backlog — scoped to selected date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <BacklogCard
              icon={<AlertTriangle className="h-5 w-5" />}
              label="Overdue Follow-ups"
              value={data?.backlog.overdue ?? 0}
              color="text-red-500"
              active={backlogTab === 'overdue'}
              onClick={() => setBacklogTab(backlogTab === 'overdue' ? null : 'overdue')}
            />
            <BacklogCard
              icon={<CalendarDays className="h-5 w-5" />}
              label={date === today ? "Due Today" : `Due on ${date.split('-').reverse().join('-')}`}
              value={data?.backlog.dueToday ?? 0}
              color="text-blue-500"
              active={backlogTab === 'today'}
              onClick={() => setBacklogTab(backlogTab === 'today' ? null : 'today')}
            />
            <BacklogCard
              icon={<CalendarClock className="h-5 w-5" />}
              label="Upcoming (7 days)"
              value={data?.backlog.upcoming ?? 0}
              color="text-emerald-500"
              active={backlogTab === 'upcoming'}
              onClick={() => setBacklogTab(backlogTab === 'upcoming' ? null : 'upcoming')}
            />
          </div>

          {backlogTab && <BacklogLeadList tab={backlogTab} userId={userId} date={date} />}

          {/* Performance breakdown — scoped to this counsellor and selected date */}
          <div className="bg-card border rounded-xl overflow-hidden">
            <CounsellorDetailPanel counsellorId={userId} date={date} />
          </div>

          {/* Device + logins */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InfoCard icon={<Smartphone className="h-3.5 w-3.5" />} label="App version">
              {data?.device ? (
                <>
                  <div className="text-sm font-medium">
                    {data.device.appVersion ? `v${data.device.appVersion}` : 'Unknown version'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last seen {new Date(data.device.lastSeenAt).toLocaleString()}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No app installed / never opened</div>
              )}
            </InfoCard>
            <InfoCard icon={<Monitor className="h-3.5 w-3.5" />} label="Last web login">
              {data?.lastLoginWeb ? (
                <>
                  <div className="text-sm font-medium">{new Date(data.lastLoginWeb.createdAt).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground font-mono">{data.lastLoginWeb.ip || '—'}</div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">Never logged in on web</div>
              )}
            </InfoCard>
            <InfoCard icon={<LogIn className="h-3.5 w-3.5" />} label="Last app login">
              {data?.lastLoginApp ? (
                <>
                  <div className="text-sm font-medium">{new Date(data.lastLoginApp.createdAt).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground font-mono">{data.lastLoginApp.ip || '—'}</div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">Never logged in on app</div>
              )}
            </InfoCard>
          </div>

          {/* Full activity timeline */}
          <TimelineSection
            date={date}
            timeline={data?.timeline ?? []}
            page={timelinePage}
            onPageChange={setTimelinePage}
          />
        </>
      )}
    </div>
  )
}

function TimelineSection({
  date, timeline, page, onPageChange,
}: {
  date: string
  timeline: UserActivityTimelineItem[]
  page: number
  onPageChange: (p: number) => void
}) {
  const total = timeline.length
  const totalPages = Math.max(1, Math.ceil(total / TIMELINE_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * TIMELINE_PAGE_SIZE
  const pageItems = timeline.slice(start, start + TIMELINE_PAGE_SIZE)

  return (
    <div id="activity-timeline" className="bg-card border rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="font-bold text-base">
          Activity on {new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
        </h2>
      </div>

      {total === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center border border-dashed rounded-xl">
          No recorded activity this day.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {pageItems.map((item, i) => (
              <TimelineEntry key={start + i} item={item} />
            ))}
          </div>

          <div className="text-center text-xs text-muted-foreground mt-5">
            {start + 1}–{Math.min(start + TIMELINE_PAGE_SIZE, total)} of {total}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
              <button
                onClick={() => onPageChange(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
                className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`min-w-[2rem] px-2.5 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
                    p === safePage ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
                disabled={safePage === totalPages}
                className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BacklogCard({
  icon, label, value, color, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all ${
        active ? 'bg-primary/5 border-primary/30 ring-1 ring-primary/10' : 'bg-card hover:bg-accent/30'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center bg-muted ${color}`}>{icon}</div>
        <ArrowRight className={`h-4 w-4 text-muted-foreground transition-transform ${active ? 'rotate-90' : ''}`} />
      </div>
      <p className="text-xs font-semibold text-muted-foreground mt-3">{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </button>
  )
}

function BacklogLeadList({ tab, userId, date }: { tab: 'overdue' | 'today' | 'upcoming'; userId: number; date?: string }) {
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  const fetcher = tab === 'overdue' ? followupsApi.overdue : tab === 'today' ? followupsApi.today : followupsApi.upcoming
  const { data, isLoading } = useQuery<PaginatedFollowups>({
    queryKey: ['followups', tab, userId, date],
    queryFn: () => fetcher({ userId, limit: 50, date }),
  })

  return (
    <div className="bg-card border rounded-xl p-4">
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : !data?.data.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">No leads in this list.</p>
      ) : (
        <div className="space-y-2">
          {data.data.map((lead: FollowupLead) => (
            <Link
              key={lead.id}
              to="/app/leads/$leadId"
              params={{ leadId: String(lead.id) }}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{lead.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {maskPhone(lead.mobile, canRevealPhone)} · {lead.leadStatus}{lead.leadSubStatus ? ` (${lead.leadSubStatus})` : ''}
                  </p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {lead.followupDate ? new Date(lead.followupDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoCard({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase mb-1.5">
        {icon} {label}
      </div>
      {children}
    </div>
  )
}

function TimelineIcon({ type }: { type: UserActivityTimelineItem['type'] }) {
  const map: Record<UserActivityTimelineItem['type'], { icon: React.ReactNode; cls: string }> = {
    call: { icon: <PhoneCall className="w-3.5 h-3.5" />, cls: 'bg-blue-50 text-blue-600' },
    followup: { icon: <CalendarIcon className="w-3.5 h-3.5" />, cls: 'bg-purple-50 text-purple-600' },
    note: { icon: <StickyNote className="w-3.5 h-3.5" />, cls: 'bg-amber-50 text-amber-600' },
    comment: { icon: <MessageCircle className="w-3.5 h-3.5" />, cls: 'bg-teal-50 text-teal-600' },
    status: { icon: <RefreshCw className="w-3.5 h-3.5" />, cls: 'bg-emerald-50 text-emerald-600' },
  }
  const v = map[type]
  return <div className={`p-2 rounded-lg shrink-0 ${v.cls}`}>{v.icon}</div>
}

function formatFollowupDate(d?: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

// "Set 3 days out" / "Set for today" / "Pushed back 2 days" — relative to the
// moment the follow-up was logged (item.at), not to today, so past days still
// read correctly.
function formatDaysOut(newDate?: string | null, loggedAt?: string) {
  if (!newDate || !loggedAt) return null
  const dayMs = 24 * 60 * 60 * 1000
  const target = new Date(new Date(newDate).toDateString()).getTime()
  const logged = new Date(new Date(loggedAt).toDateString()).getTime()
  const days = Math.round((target - logged) / dayMs)
  if (days === 0) return 'set for today'
  if (days > 0) return `set ${days} day${days === 1 ? '' : 's'} out`
  return `set ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} in the past`
}

function TimelineEntry({ item }: { item: UserActivityTimelineItem }) {
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  const body = (
    <>
      <TimelineIcon type={item.type} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-semibold text-sm truncate ${item.leadId ? 'group-hover:underline' : ''}`}>
            {item.leadName || (item.phoneNumber ? maskPhone(item.phoneNumber, canRevealPhone) : 'Unknown number')}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {new Date(item.at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}
            {item.source && <span className="capitalize"> · {item.source}</span>}
          </span>
        </div>

        {item.type === 'status' ? (
          <div className="text-sm">
            <span className="text-muted-foreground">Status: </span>
            <span className="font-medium">{item.fromStatus || '—'}</span>
            {item.fromSubStatus && <span className="text-muted-foreground"> ({item.fromSubStatus})</span>}
            <ArrowRight className="inline h-3 w-3 mx-1.5 text-muted-foreground" />
            <span className="font-medium text-emerald-700">{item.toStatus}</span>
            {item.toSubStatus && <span className="text-muted-foreground"> ({item.toSubStatus})</span>}
            {item.reason && <p className="text-xs text-muted-foreground mt-0.5">"{item.reason}"</p>}
          </div>
        ) : item.type === 'followup' ? (
          <div className="text-sm">
            <span className="text-muted-foreground">Follow-up date: </span>
            <span className="font-medium">{formatFollowupDate(item.oldFollowupDate) || 'None set'}</span>
            <ArrowRight className="inline h-3 w-3 mx-1.5 text-muted-foreground" />
            <span className="font-medium text-emerald-700">{formatFollowupDate(item.newFollowupDate) || 'None set'}</span>
            {formatDaysOut(item.newFollowupDate, item.at) && (
              <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300">
                {formatDaysOut(item.newFollowupDate, item.at)}
              </span>
            )}
            <p className="text-sm text-foreground mt-0.5">{item.summary.replace(/^Follow-up: /, '')}</p>
            {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
          </div>
        ) : (
          <p className="text-sm text-foreground">{item.summary}</p>
        )}
      </div>
    </>
  )

  if (item.leadId) {
    return (
      <Link
        to="/app/leads/$leadId"
        params={{ leadId: String(item.leadId) }}
        className="group flex items-start gap-3 p-3 rounded-xl hover:bg-muted/40 border border-transparent hover:border-border transition-colors"
      >
        {body}
      </Link>
    )
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-transparent">
      {body}
    </div>
  )
}
