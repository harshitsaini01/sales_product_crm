import { useState } from 'react'
import { useLeaves, useCreateLeave, useReviewLeave } from '@/hooks/useLeaves'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate } from '@/lib/utils'
import { Loader2, Plus, CheckCircle, XCircle, Clock } from 'lucide-react'

interface Leave {
  id: number
  fromDate: string
  toDate: string
  reason?: string
  status: string
  approvalNote?: string
  createdAt: string
  user: { id: number; name: string; designation?: string }
}

const statusIcon: Record<string, React.ReactNode> = {
  approved: <CheckCircle className="h-4 w-4 text-green-500" />,
  rejected: <XCircle className="h-4 w-4 text-red-500" />,
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
}
const statusColor: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
}

export function Leaves() {
  const { isAdmin, isCounsellor } = useAuthStore()
  const [showAdd, setShowAdd] = useState(false)
  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const { data: leaves = [], isLoading } = useLeaves() as { data: Leave[]; isLoading: boolean }
  const review = useReviewLeave()

  const handleReject = (id: number) => {
    review.mutate(
      { id, status: 'rejected', approvalNote: rejectNote || undefined },
      {
        onSuccess: () => {
          setRejectingId(null)
          setRejectNote('')
        },
      },
    )
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leave Requests</h1>
        {isCounsellor() && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Request Leave
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : leaves.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No leave requests</p>
      ) : (
        <div className="space-y-3">
          {leaves.map((leave) => (
            <div key={leave.id} className="bg-card border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1">
                  {isAdmin() && (
                    <p className="font-medium text-sm">
                      {leave.user.name}{' '}
                      <span className="text-muted-foreground font-normal">
                        · {leave.user.designation}
                      </span>
                    </p>
                  )}
                  <p className="text-sm">
                    <span className="font-medium">{formatDate(leave.fromDate)}</span>
                    {' — '}
                    <span className="font-medium">{formatDate(leave.toDate)}</span>
                  </p>
                  {leave.reason && (
                    <p className="text-xs text-muted-foreground">{leave.reason}</p>
                  )}
                  {leave.approvalNote && (
                    <p className="text-xs text-muted-foreground italic">
                      Note: {leave.approvalNote}
                    </p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${statusColor[leave.status]}`}
                  >
                    {statusIcon[leave.status]}
                    {leave.status}
                  </span>
                  {isAdmin() && leave.status === 'pending' && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => review.mutate({ id: leave.id, status: 'approved' })}
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setRejectingId(leave.id)}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {rejectingId === leave.id && (
                <div className="mt-3 pt-3 border-t flex items-center gap-2">
                  <input
                    autoFocus
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Reason for rejection (optional)"
                    className="flex-1 px-2 py-1 text-sm border rounded bg-background"
                  />
                  <button
                    onClick={() => handleReject(leave.id)}
                    disabled={review.isPending}
                    className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    Confirm Reject
                  </button>
                  <button
                    onClick={() => {
                      setRejectingId(null)
                      setRejectNote('')
                    }}
                    className="px-3 py-1 text-xs border rounded hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddLeaveModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function AddLeaveModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ fromDate: '', toDate: '', reason: '' })
  const create = useCreateLeave()

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-sm space-y-4">
        <h2 className="font-semibold">Request Leave</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">From Date</label>
            <input
              type="date"
              value={form.fromDate}
              onChange={(e) => setForm((p) => ({ ...p, fromDate: e.target.value }))}
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">To Date</label>
            <input
              type="date"
              value={form.toDate}
              onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))}
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Reason</label>
          <textarea
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            rows={3}
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled={create.isPending || !form.fromDate || !form.toDate || !form.reason}
            onClick={() =>
              create.mutate(form, {
                onSuccess: onClose,
              })
            }
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 flex items-center gap-2"
          >
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Submit
          </button>
        </div>
      </div>
    </div>
  )
}
