import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { followupsApi, eventsApi, usersApi, leadsApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar as CalendarIcon,
  Clock,
  Plus,
  X,
  Trash2,
  Filter,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface FollowupLead {
  id: number
  name: string
  followupDate: string
  leadStatus?: string
  source?: string
  event?: string
  isDone?: boolean
}

interface CalEvent {
  id: number
  title: string
  description?: string
  startDate: string
}

export function Calendar() {
  const qc = useQueryClient()
  const { isFullAdmin } = useAuthStore()
  const [currentDate, setCurrentDate] = useState(new Date())

  const [filterType, setFilterType] = useState<'events' | 'followups'>('followups')
  const [selectedCounsellor, setSelectedCounsellor] = useState<string>('all')
  const [selectedSource, setSelectedSource] = useState<string>('all')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  const { data: counsellors = [] } = useQuery({
    queryKey: ['counsellors'],
    queryFn: () => usersApi.counsellors(),
    enabled: isFullAdmin(),
  })

  const cid = selectedCounsellor !== 'all' ? Number(selectedCounsellor) : undefined

  const { data: followups = [], isLoading: loadingF } = useQuery<FollowupLead[]>({
    queryKey: ['followups', 'range', ymd(monthStart), ymd(monthEnd), cid],
    queryFn: () => followupsApi.range(ymd(monthStart), ymd(monthEnd), cid),
  })
  const { data: events = [], isLoading: loadingE } = useQuery<CalEvent[]>({
    queryKey: ['events', ymd(monthStart), ymd(monthEnd), cid],
    queryFn: () => eventsApi.list({ from: ymd(monthStart), to: ymd(monthEnd), counsellorId: cid }),
  })

  // Distinct course / event values for the filter dropdown
  const { data: eventValues = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'event'],
    queryFn: () => leadsApi.fieldValues('event'),
    staleTime: 5 * 60_000,
  })
  const { data: sourceValues = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'source'],
    queryFn: () => leadsApi.fieldValues('source'),
    staleTime: 5 * 60_000,
  })
  const eventOrSourceValues = useMemo(() => {
    const seen = new Map<string, string>()
    for (const v of [...eventValues, ...sourceValues]) {
      if (!v) continue
      const trimmed = String(v).trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, trimmed)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [eventValues, sourceValues])

  const isLoading = loadingF || loadingE
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const blanks = Array.from({ length: firstDay === 0 ? 6 : firstDay - 1 })

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))
  const today = () => setCurrentDate(new Date())

  const isToday = (day: number) => {
    const d = new Date()
    return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year
  }

  const followupsForDay = (day: number) =>
    filterType === 'events' ? [] : followups.filter((f) => {
      if (!f.followupDate) return false
      if (selectedSource !== 'all') {
        const hasSource = f.source?.toLowerCase() === selectedSource.toLowerCase()
        const hasEvent = f.event?.toLowerCase() === selectedSource.toLowerCase()
        if (!hasSource && !hasEvent) return false
      }
      const d = new Date(f.followupDate)
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year
    })

  const eventsForDay = (day: number) =>
    filterType === 'followups' ? [] : events.filter((e) => {
      const d = new Date(e.startDate)
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year
    })

  // Stats calculation
  const todayStr = ymd(new Date())
  const todayFollowups = followups.filter(f => f.followupDate && ymd(new Date(f.followupDate)) === todayStr)
  
  const totalMonth = followups.length
  const doneMonth = followups.filter(f => f.isDone).length
  const overdueMonth = followups.filter(f => !f.isDone && f.followupDate && ymd(new Date(f.followupDate)) < todayStr).length

  const totalToday = todayFollowups.length
  const doneToday = todayFollowups.filter(f => f.isDone).length

  // Add-event modal
  const [modalOpen, setModalOpen] = useState(false)
  const [eventDate, setEventDate] = useState<string>('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDesc, setEventDesc] = useState('')

  const openModalForDay = (day: number) => {
    const d = new Date(year, month, day)
    setEventDate(ymd(d))
    setEventTitle('')
    setEventDesc('')
    setModalOpen(true)
  }

  const createEventMutation = useMutation({
    mutationFn: () =>
      eventsApi.create({ title: eventTitle, startDate: eventDate, description: eventDesc || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event added')
      setModalOpen(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed'),
  })

  const deleteEventMutation = useMutation({
    mutationFn: (id: number) => eventsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event deleted')
    },
  })

  return (
    <div className="space-y-6 max-w-5xl pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track scheduled follow-ups and personal events
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {isFullAdmin() && (
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <select
                value={selectedCounsellor}
                onChange={(e) => setSelectedCounsellor(e.target.value)}
                className="pl-9 pr-8 py-2 bg-background border rounded-lg text-sm appearance-none focus:ring-2 focus:ring-primary/20 outline-none"
              >
                <option value="all">All Counsellors</option>
                {counsellors.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="pl-9 pr-8 py-2 bg-background border rounded-lg text-sm appearance-none focus:ring-2 focus:ring-primary/20 outline-none"
            >
              <option value="all">All Sources / Events</option>
              {eventOrSourceValues.map((val) => (
                <option key={val} value={val}>{val}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="pl-9 pr-8 py-2 bg-background border rounded-lg text-sm appearance-none focus:ring-2 focus:ring-primary/20 outline-none"
            >
              <option value="followups">Follow-ups</option>
              <option value="events">Events</option>
            </select>
          </div>

          <button
            onClick={today}
            className="px-4 py-2 text-sm border bg-background rounded-lg hover:bg-muted font-medium"
          >
            Today
          </button>
        </div>
      </div>

      {/* Stats Summary Widget */}
      {filterType !== 'events' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border bg-card">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">This Month (Follow-ups)</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-100">
                <p className="text-2xl font-bold text-yellow-700">{totalMonth}</p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-yellow-600 mt-1">Total</p>
              </div>
              <div className="p-2 rounded-lg bg-green-50 border border-green-100">
                <p className="text-2xl font-bold text-green-700">{doneMonth}</p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-green-600 mt-1">Done</p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 border border-red-100">
                <p className="text-2xl font-bold text-red-700">{overdueMonth}</p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-red-600 mt-1">Overdue</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl border bg-card">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Today (Follow-ups)</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-100">
                <p className="text-2xl font-bold text-yellow-700">{totalToday}</p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-yellow-600 mt-1">Total</p>
              </div>
              <div className="p-2 rounded-lg bg-green-50 border border-green-100">
                <p className="text-2xl font-bold text-green-700">{doneToday}</p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-green-600 mt-1">Done</p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 border border-red-100 opacity-50">
                <p className="text-2xl font-bold text-red-700">0</p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-red-600 mt-1">Overdue</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between p-4 border-b bg-muted/20">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            {MONTHS[month]} {year}
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={nextMonth} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b bg-muted/10">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="p-2 text-center text-xs font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 bg-background">
          {blanks.map((_, i) => (
            <div key={`blank-${i}`} className="min-h-[120px] p-2 border-r border-b opacity-50 bg-muted/10" />
          ))}

          {days.map((day) => {
            const dayFollowups = followupsForDay(day)
            const dayEvents = eventsForDay(day)
            return (
              <div
                key={day}
                className={cn(
                  'min-h-[120px] p-2 border-r border-b relative group',
                  isToday(day) ? 'bg-primary/5' : 'hover:bg-muted/30',
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium',
                      isToday(day)
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    {day}
                  </span>
                  <button
                    onClick={() => openModalForDay(day)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground"
                    title="Add event"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                <div className="mt-2 space-y-1">
                  {isLoading && isToday(day) && (
                    <div className="flex justify-center">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {dayFollowups.map((f, i) => {
                    const fDate = f.followupDate ? ymd(new Date(f.followupDate)) : ''
                    const isDone = f.isDone
                    const isOverdue = !isDone && fDate && fDate < todayStr
                    const colorClass = isDone
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : isOverdue
                        ? 'bg-red-100 text-red-800 border-red-200'
                        : 'bg-yellow-100 text-yellow-800 border-yellow-200'

                    return (
                      <div
                        key={`f-${f.id}-${i}`}
                        className={cn("text-[10px] px-1.5 py-1 rounded border truncate flex items-center gap-1", colorClass)}
                        title={`Follow-up: ${f.name} ${isDone ? '(Done)' : ''}`}
                      >
                        <Clock className="h-2.5 w-2.5 shrink-0" />
                        {f.name}
                      </div>
                    )
                  })}
                  {dayEvents.map((e) => (
                    <div
                      key={`e-${e.id}`}
                      className="text-[10px] px-1.5 py-1 bg-blue-100 text-blue-800 rounded border border-blue-200 truncate flex items-center gap-1 group/evt"
                      title={e.description || e.title}
                    >
                      <span className="truncate flex-1">{e.title}</span>
                      <button
                        onClick={() => {
                          if (confirm(`Delete event "${e.title}"?`)) deleteEventMutation.mutate(e.id)
                        }}
                        className="opacity-0 group-hover/evt:opacity-100 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {Array.from({ length: 42 - (blanks.length + days.length) }).map((_, i) => (
            <div key={`end-blank-${i}`} className="min-h-[120px] p-2 border-r border-b opacity-50 bg-muted/10" />
          ))}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
              <h3 className="font-bold">New Event — {eventDate}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Title</label>
                <input
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50/50 focus:bg-white transition-colors"
                  placeholder="Team meeting"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                <textarea
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 h-24 resize-none bg-gray-50/50 focus:bg-white transition-colors"
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                disabled={!eventTitle.trim() || createEventMutation.isPending}
                onClick={() => createEventMutation.mutate()}
                className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-xl disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {createEventMutation.isPending ? 'Saving...' : 'Add Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
