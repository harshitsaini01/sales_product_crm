import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { remarksApi, usersApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  MessageSquareQuote,
  Send,
  Trash2,
  Loader2,
  Calendar,
  Search,
  Filter,
} from 'lucide-react'
import type { CounsellorRemark } from '@/types'

export default function Remarks() {
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const isAdmin = user?.role === 'admin' || user?.role === 'sub-admin' || Boolean(user?.roles?.some((r: string) => r === 'admin' || r === 'sub-admin'))

  
  const [selectedCounsellorId, setSelectedCounsellorId] = useState<string>('all')
  const [newRemarkText, setNewRemarkText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch list of counsellors if Admin
  const { data: counsellors } = useQuery({
    queryKey: ['users', 'counsellors'],
    queryFn: () => usersApi.counsellors(),
    enabled: isAdmin,
  })

  // Determine query param for remarks API
  const counsellorIdParam = !isAdmin
    ? user?.id
    : selectedCounsellorId === 'all'
    ? undefined
    : Number(selectedCounsellorId)

  // Fetch remarks
  const { data: remarks = [], isLoading } = useQuery<CounsellorRemark[]>({
    queryKey: ['remarks', { counsellorId: counsellorIdParam }],
    queryFn: () => remarksApi.list(counsellorIdParam ? { counsellorId: counsellorIdParam } : undefined),
  })

  // Create remark mutation
  const createMutation = useMutation({
    mutationFn: (data: { counsellorId: number; remark: string }) => remarksApi.create(data),
    onSuccess: () => {
      toast.success('Remark added successfully')
      setNewRemarkText('')
      qc.invalidateQueries({ queryKey: ['remarks'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to add remark')
    },
  })

  // Delete remark mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => remarksApi.delete(id),
    onSuccess: () => {
      toast.success('Remark deleted')
      qc.invalidateQueries({ queryKey: ['remarks'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to delete remark')
    },
  })

  const handleAddRemark = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRemarkText.trim()) {
      toast.error('Please enter a remark')
      return
    }

    // Determine target counselor
    let targetId: number | undefined = undefined
    if (selectedCounsellorId !== 'all') {
      targetId = Number(selectedCounsellorId)
    } else if (counsellors && counsellors.length === 1) {
      targetId = counsellors[0].id
    }

    if (!targetId) {
      toast.error('Please select a specific counsellor to add a remark')
      return
    }

    createMutation.mutate({ counsellorId: targetId, remark: newRemarkText })
  }

  // Filter remarks by local search query if provided
  const filteredRemarks = remarks.filter((r) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      r.remark.toLowerCase().includes(q) ||
      r.createdBy?.name.toLowerCase().includes(q) ||
      r.counsellor?.name.toLowerCase().includes(q)
    )
  })

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <MessageSquareQuote className="h-7 w-7 text-primary" />
            {isAdmin ? 'Counsellor Remarks' : 'My Remarks'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'View and manage official remarks assigned to counsellors'
              : 'Feedback and remarks assigned to you by administrators'}
          </p>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search remarks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border rounded-xl bg-background text-sm w-48 sm:w-64 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                value={selectedCounsellorId}
                onChange={(e) => setSelectedCounsellorId(e.target.value)}
                className="px-3 py-2 border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 max-w-[200px]"
              >
                <option value="all">All Counsellors</option>
                {counsellors?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.designation ? `(${c.designation})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Admin Add Remark Section */}
      {isAdmin && (
        <div className="bg-card border rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground">
            <MessageSquareQuote className="h-4 w-4 text-primary" />
            Add New Remark
          </h3>

          <form onSubmit={handleAddRemark} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                  Select Counsellor <span className="text-destructive">*</span>
                </label>
                <select
                  value={selectedCounsellorId}
                  onChange={(e) => setSelectedCounsellorId(e.target.value)}
                  className="w-full px-3 me-2 py-2 border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="all" disabled>
                    -- Select Counsellor --
                  </option>
                  {counsellors?.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}

                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                Remark Detail <span className="text-destructive">*</span>
              </label>
              <textarea
                rows={3}
                value={newRemarkText}
                onChange={(e) => setNewRemarkText(e.target.value)}
                placeholder="Type your official remark or performance notes here..."
                className="w-full p-3 border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={createMutation.isPending || !newRemarkText.trim() || selectedCounsellorId === 'all'}
                className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 shadow-sm transition-all"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Remark
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Remarks Feed */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-base text-foreground flex items-center gap-2">
            Remarks History
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
              {filteredRemarks.length}
            </span>
          </h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRemarks.length === 0 ? (
          <div className="bg-card border rounded-2xl p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto text-muted-foreground">
              <MessageSquareQuote className="h-6 w-6" />
            </div>
            <h4 className="font-semibold text-foreground">No remarks found</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {isAdmin
                ? 'Select a counsellor and submit a remark above to add the first entry.'
                : 'You have no remarks assigned to you yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredRemarks.map((remark) => {
              const creatorInitials = remark.createdBy?.name?.charAt(0).toUpperCase() || 'A'
              const canDelete =
                isAdmin || (remark.createdById && Number(remark.createdById) === Number(user?.id))

              return (
                <div
                  key={remark.id}
                  className="bg-card border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow space-y-3 relative group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                        {creatorInitials}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">
                            {remark.createdBy?.name || 'Administrator'}
                          </span>
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            {remark.createdBy?.role || 'Admin'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Calendar className="h-3 w-3" />
                          {new Date(remark.createdAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {isAdmin && remark.counsellor && (
                            <>
                              <span>&bull;</span>
                              <span className="font-medium text-foreground">
                                For: {remark.counsellor.name}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {canDelete && (
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this remark?')) {
                            deleteMutation.mutate(remark.id)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                        title="Delete Remark"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="pl-13">
                    <RemarkCardContent remark={remark} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function RemarkCardContent({ remark }: { remark: CounsellorRemark }) {
  const isHourly = Boolean(remark.hourContext)
  const isCall = Boolean(remark.call)

  return (
    <div className="space-y-2.5">
      {/* Context Badge Header */}
      {isHourly && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-300 p-2.5 rounded-xl text-xs space-y-1">
          <div className="flex items-center gap-2 font-bold">
            <span className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] uppercase">
              ⏰ Hourly Analytics Remark
            </span>
            <span>{remark.hourContext}</span>
          </div>
        </div>
      )}

      {isCall && remark.call && (
        <div className="bg-primary/5 border border-primary/20 p-3 rounded-xl text-xs space-y-1.5">
          <div className="flex items-center justify-between font-bold">
            <span className="px-2 py-0.5 bg-primary text-primary-foreground rounded text-[10px] uppercase">
              📞 Call Log Remark
            </span>
            <span className="text-muted-foreground font-normal">
              {new Date(remark.call.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted-foreground pt-1 border-t border-primary/10">
            <div>Lead / Phone: <strong className="text-foreground block">{remark.call.lead?.name || remark.call.phoneNumber}</strong></div>
            <div>Direction: <strong className="text-foreground block">{remark.call.direction === 'OUTGOING' ? '→ Outgoing' : '← Incoming'}</strong></div>
            <div>Status: <strong className="text-foreground block">{remark.call.status}</strong></div>
            <div>Duration: <strong className="text-foreground block">{Math.floor(remark.call.durationSec / 60)}m {remark.call.durationSec % 60}s</strong></div>
          </div>
        </div>
      )}

      {/* Remark text body */}
      <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed bg-muted/20 p-3.5 rounded-xl border border-muted/30 font-medium">
        {remark.remark}
      </div>
    </div>
  )
}

