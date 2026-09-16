import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Megaphone, CheckCircle2, X } from 'lucide-react'
import { announcementsApi, type AnnouncementDto } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

// Snooze duration when the user dismisses without reading — re-prompt this long
// afterwards, matching the "show every 2 hr" UX requirement.
const SNOOZE_MS = 2 * 60 * 60 * 1000
const SNOOZE_KEY = 'announcement-snooze-v1'

type SnoozeMap = Record<string, number> // announcementId -> epoch ms until

function loadSnoozes(): SnoozeMap {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SnoozeMap
    // Prune expired entries on read so the object can't grow unbounded.
    const now = Date.now()
    const fresh: SnoozeMap = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && v > now) fresh[k] = v
    }
    return fresh
  } catch {
    return {}
  }
}

function saveSnooze(id: number) {
  const current = loadSnoozes()
  current[String(id)] = Date.now() + SNOOZE_MS
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(current))
}

// Global popup — picks the oldest unread, not-currently-snoozed announcement
// and forces the user to either tick the "I read this" checkbox + OK
// (permanent ack stored in DB), or close it (2-hour snooze stored locally).
export function AnnouncementPopup() {
  const qc = useQueryClient()
  const isAuthed = useAuthStore((s) => s.isAuthenticated)

  // Tick to force re-evaluation of the snooze map when timers expire while the
  // tab is open. We bump it on a 1-minute interval.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isAuthed) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [isAuthed])

  const { data: announcements = [] } = useQuery<AnnouncementDto[]>({
    queryKey: ['announcements'],
    queryFn: announcementsApi.list,
    enabled: isAuthed,
    // Refetch periodically so a freshly-posted announcement pops up without
    // requiring a manual page reload.
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  })

  const target = useMemo(() => {
    if (!announcements.length) return null
    const snoozes = loadSnoozes()
    const now = Date.now()
    // Oldest unread first — same order users expect when reading top-down.
    const candidates = announcements
      .filter((a) => !a.readByMe)
      .filter((a) => {
        const until = snoozes[String(a.id)]
        return !until || until <= now
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return candidates[0] ?? null
    // tick is intentionally in deps so snooze expiry re-evaluates this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcements, tick])

  const [confirmed, setConfirmed] = useState(false)
  // Reset the read-checkbox whenever the target changes so the user can't
  // accidentally dismiss the next one in a single click.
  useEffect(() => {
    setConfirmed(false)
  }, [target?.id])

  const markRead = useMutation({
    mutationFn: (id: number) => announcementsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] })
    },
  })

  if (!isAuthed || !target) return null

  const handleSnooze = () => {
    saveSnooze(target.id)
    // Bump the tick so the next unread (if any) is picked up immediately.
    setTick((n) => n + 1)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-white/20">
              <Megaphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">New Announcement</p>
              <p className="text-xs opacity-90">
                Posted by {target.createdBy?.name || 'Admin'} · {new Date(target.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={handleSnooze}
            title="Remind me in 2 hours"
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-3 break-words">{target.title}</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {target.description}
          </p>
        </div>

        <div className="px-6 py-4 bg-gray-50/80 border-t border-gray-100 space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-amber-500"
            />
            <span className="text-sm text-gray-700">
              I have read this announcement.
            </span>
          </label>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={handleSnooze}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              Remind me later
            </button>
            <button
              onClick={() => markRead.mutate(target.id)}
              disabled={!confirmed || markRead.isPending}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-sm shadow-amber-500/20 transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              {markRead.isPending ? 'Saving...' : 'OK, got it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
