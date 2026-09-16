import { useState } from 'react'
import { Megaphone, Plus, Trash2, Edit, CheckCircle2, Clock, User as UserIcon } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { announcementsApi, type AnnouncementDto } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'

// Formats "2 days ago", "just now", etc. Lightweight — no extra deps.
function relativeTime(iso: string) {
  const d = new Date(iso).getTime()
  const diffMs = Date.now() - d
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function Announcements() {
  const qc = useQueryClient()
  // Edit/Delete is admin + sub-admin only. Sales-head / counsellor can post but
  // not modify after publishing — hide the action buttons for them.
  const canManage = useAuthStore((s) => s.isAdmin())
  const { data: announcements = [], isLoading } = useQuery<AnnouncementDto[]>({
    queryKey: ['announcements'],
    queryFn: announcementsApi.list,
  })

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const resetForm = () => {
    setEditingId(null)
    setTitle('')
    setDescription('')
  }

  const openNew = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEdit = (a: AnnouncementDto) => {
    setEditingId(a.id)
    setTitle(a.title)
    setDescription(a.description)
    setIsModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? announcementsApi.update(editingId, { title, description })
        : announcementsApi.create({ title, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] })
      toast.success(editingId ? 'Announcement updated' : 'Announcement published')
      setIsModalOpen(false)
      resetForm()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Save failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => announcementsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] })
      toast.success('Announcement deleted')
    },
  })

  const markReadMutation = useMutation({
    mutationFn: (id: number) => announcementsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  })

  const unreadCount = announcements.filter((a) => !a.readByMe).length
  const visible = filter === 'unread' ? announcements.filter((a) => !a.readByMe) : announcements

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-600 to-amber-400 bg-clip-text text-transparent flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-amber-500" />
            Announcements
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {announcements.length} total · {unreadCount} unread
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-all font-medium flex items-center gap-2 shadow-sm shadow-amber-500/20"
        >
          <Plus className="w-4 h-4" /> Create Announcement
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
            filter === 'all' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white hover:bg-gray-50 text-gray-700'
          }`}
        >
          All ({announcements.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
            filter === 'unread' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white hover:bg-gray-50 text-gray-700'
          }`}
        >
          Unread ({unreadCount})
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 animate-pulse">
          Loading announcements...
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-500">
          <Megaphone className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="font-medium">
            {filter === 'unread' ? 'You have read every announcement. ' : 'No active announcements.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {visible.map((a) => (
            <article
              key={a.id}
              className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all ${
                a.readByMe ? 'border-gray-100' : 'border-amber-300 ring-1 ring-amber-200/60'
              }`}
            >
              {!a.readByMe && (
                <div className="h-1 bg-gradient-to-r from-amber-400 to-amber-500" />
              )}
              <div className="p-6 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold text-gray-900 break-words">
                        {a.title}
                      </h2>
                      {a.readByMe ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Read
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                          New
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1.5">
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="w-3 h-3" />
                        {a.createdBy?.name || 'Unknown'}
                      </span>
                      <span className="inline-flex items-center gap-1" title={new Date(a.createdAt).toLocaleString()}>
                        <Clock className="w-3 h-3" />
                        {relativeTime(a.createdAt)}
                      </span>
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-1 text-gray-400">
                      <button
                        onClick={() => openEdit(a)}
                        className="p-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this announcement?')) deleteMutation.mutate(a.id)
                        }}
                        className="p-2 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Full content — preserves line breaks so paragraphs/bullets
                    from the textarea render as the author wrote them. */}
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {a.description}
                </p>

                {!a.readByMe && (
                  <div className="pt-3 border-t border-gray-100 flex justify-end">
                    <button
                      onClick={() => markReadMutation.mutate(a.id)}
                      disabled={markReadMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mark as read
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="font-bold text-gray-900 line-clamp-1">
                {editingId ? 'Edit Announcement' : 'New Announcement'}
              </h3>
              <button
                onClick={() => {
                  setIsModalOpen(false)
                  resetForm()
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl focus:border-amber-500 focus:ring-amber-500/20 px-4 py-2 bg-gray-50/50"
                  placeholder="E.g. System Downtime"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Content</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl focus:border-amber-500 focus:ring-amber-500/20 px-4 py-2 h-40 resize-y bg-gray-50/50 text-sm leading-relaxed"
                  placeholder="Write the announcement details here. Line breaks are preserved."
                />
                <p className="text-[11px] text-gray-400 mt-1">Line breaks and paragraphs are preserved as-is.</p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => {
                  setIsModalOpen(false)
                  resetForm()
                }}
                className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!title.trim() || !description.trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                className="px-6 py-2 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 transition-all shadow-sm shadow-amber-500/20 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
