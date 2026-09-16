import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react'
import { activityApi, type InactivityStatus } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

const POLL_INTERVAL_MS = 30_000
// Throttle interaction-driven pings so we don't fire on every click/scroll.
const PING_THROTTLE_MS = 60_000
// Only count *intentional* interactions. `mousemove` is excluded because a
// cursor that drifts over the page (or a desk bumped by accident) would keep
// the user "active" indefinitely. Tabbing back into the window also pings via
// the `visibilitychange` listener below.
const INTERACTION_EVENTS = ['click', 'keydown', 'scroll', 'touchstart']

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

/**
 * Tracks counsellor activity. Polls /activity/status every 30s; when the stage
 * crosses into 'warning' it surfaces a toast, into 'alert' it shows the
 * full-screen modal (with a Mark-as-Read button that hits /activity/ack).
 * 'halfday' is server-side — surfaces here as a final read-only notice.
 *
 * Web + mobile activity is unified server-side on User.lastActivityAt, so this
 * component reflects the combined idle time regardless of where the user was
 * last active.
 */
export function InactivityTracker() {
  const qc = useQueryClient()
  const isAuthed = useAuthStore((s) => s.isAuthenticated)
  const isCounsellor = useAuthStore((s) => s.isCounsellor() || s.isSalesHead())

  const enabled = isAuthed && isCounsellor

  const { data: status } = useQuery<InactivityStatus>({
    queryKey: ['activity-status'],
    queryFn: activityApi.status,
    enabled,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: true,
  })

  // Toast guard — we only want to surface the warning toast once per crossing,
  // not every poll. Reset whenever the stage drops back to 'ok'.
  const lastToastStageRef = useRef<string | null>(null)
  useEffect(() => {
    if (!status) return
    // On-call users are explicitly suppressed server-side (stage forced to 'ok'),
    // but we double-check here so a stale local state never shows a stray toast.
    if (status.stage === 'ok' || status.onCall) {
      lastToastStageRef.current = null
      return
    }
    if (status.stage === 'warning' && lastToastStageRef.current !== 'warning') {
      lastToastStageRef.current = 'warning'
      toast.warning('You have been idle for a while', {
        description: `No activity for ${formatDuration(status.inactiveSeconds)}. Take an action soon to avoid a half-day mark.`,
        icon: <Clock className="w-4 h-4" />,
        duration: 8000,
      })
    }
  }, [status])

  // Send a throttled "I'm here" ping on real user interaction so navigation /
  // scrolling counts even if no API mutation fires. We deliberately skip pings
  // when the tab is hidden so a counsellor with the CRM open in a background
  // tab isn't credited with phantom activity.
  const lastPingRef = useRef(0)
  useEffect(() => {
    if (!enabled) return
    const onActivity = () => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastPingRef.current < PING_THROTTLE_MS) return
      lastPingRef.current = now
      activityApi.ping().catch(() => {})
    }
    const onVisibility = () => {
      // Tabbing back into the window is a genuine return — ping immediately
      // (subject to the same throttle) so the idle counter resets right away.
      if (!document.hidden) onActivity()
    }
    INTERACTION_EVENTS.forEach((evt) =>
      window.addEventListener(evt, onActivity, { passive: true }),
    )
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      INTERACTION_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])

  const ack = useMutation({
    mutationFn: () => activityApi.ack(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity-status'] })
      lastPingRef.current = Date.now()
    },
  })

  const showModal = useMemo(
    () =>
      !status?.onCall &&
      (!!status?.pendingEvent || status?.stage === 'alert' || status?.stage === 'halfday'),
    [status],
  )

  if (!enabled || !status || !showModal) return null

  const isHalfDay = status.stage === 'halfday' || status.pendingEvent?.kind === 'halfday'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div
          className={`px-6 py-4 text-white flex items-center gap-3 ${
            isHalfDay
              ? 'bg-gradient-to-r from-red-600 to-red-700'
              : 'bg-gradient-to-r from-amber-500 to-orange-600'
          }`}
        >
          <div className="p-2 rounded-lg bg-white/20">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">
              {isHalfDay ? 'Half-Day Marked' : 'Inactivity Alert'}
            </p>
            <p className="text-sm font-semibold">
              {isHalfDay ? 'Your day has been auto-marked half' : 'Are you still working?'}
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          {isHalfDay ? (
            <>
              <p className="text-sm text-gray-800 leading-relaxed">
                We didn&apos;t see any activity from you on the web app or mobile app
                for <strong>{formatDuration(status.inactiveSeconds)}</strong>. As per
                policy, your day has been recorded as a <strong>half-day</strong>.
              </p>
              <p className="text-sm text-gray-600 mt-3">
                If you believe this is incorrect, please reach out to your admin to
                adjust the leave record.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-800 leading-relaxed">
                You haven&apos;t made a call, updated a lead status, or taken any other
                action for <strong>{formatDuration(status.inactiveSeconds)}</strong>.
              </p>
              <p className="text-sm text-gray-700 mt-3">
                If you&apos;re still here, press <strong>Mark as Read</strong> to clear
                this alert. If we don&apos;t hear from you, your day will be
                auto-marked as a <strong>half-day</strong>.
              </p>
              <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <strong>Heads up:</strong> activity from both the web CRM and the
                mobile app counts — make a call or update a lead from either to reset
                the timer.
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={() => ack.mutate()}
            disabled={ack.isPending}
            className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-40 ${
              isHalfDay
                ? 'bg-gray-800 hover:bg-gray-900'
                : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {ack.isPending ? 'Saving...' : isHalfDay ? 'Okay, I understand' : 'Mark as Read'}
          </button>
        </div>
      </div>
    </div>
  )
}
