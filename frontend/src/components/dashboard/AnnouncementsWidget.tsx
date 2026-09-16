import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Megaphone, CheckCircle2, ArrowRight, Clock } from 'lucide-react'
import { announcementsApi, type AnnouncementDto } from '@/lib/api'

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// Dashboard widget — shows the top 3 most-recent announcements with a clear
// read/unread state and a one-click "Mark as read" action. Visible to every
// role; everyone sees the same announcements.
export function AnnouncementsWidget() {
  const qc = useQueryClient()
  const { data: announcements = [], isLoading } = useQuery<AnnouncementDto[]>({
    queryKey: ['announcements'],
    queryFn: announcementsApi.list,
  })

  const markRead = useMutation({
    mutationFn: (id: number) => announcementsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  })

  const recent = announcements.slice(0, 3)
  const unreadCount = announcements.filter((a) => !a.readByMe).length

  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between bg-gradient-to-r from-amber-50 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600">
            <Megaphone className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-bold text-sm">Announcements</h2>
            <p className="text-[11px] text-muted-foreground">
              {unreadCount > 0
                ? `${unreadCount} unread of ${announcements.length}`
                : `${announcements.length} total`}
            </p>
          </div>
        </div>
        <Link
          to="/app/announcements"
          className="text-xs font-semibold text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
        >
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="divide-y">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Loading...</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <Megaphone className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            No announcements yet.
          </div>
        ) : (
          recent.map((a) => (
            <article key={a.id} className={`p-4 ${!a.readByMe ? 'bg-amber-50/40' : ''}`}>
              <div className="flex items-start gap-3">
                <div
                  className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                    a.readByMe ? 'bg-gray-300' : 'bg-amber-500 animate-pulse'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-snug break-words">{a.title}</h3>
                    {!a.readByMe && (
                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        New
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1 whitespace-pre-wrap">
                    {a.description}
                  </p>
                  <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {relativeTime(a.createdAt)}
                      {a.createdBy?.name && <> · {a.createdBy.name}</>}
                    </span>
                    {!a.readByMe ? (
                      <button
                        onClick={() => markRead.mutate(a.id)}
                        disabled={markRead.isPending}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Mark as read
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" />
                        Read
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  )
}
