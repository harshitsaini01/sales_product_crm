import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { leadsApi, usersApi, leadConfigApi, followupsApi, leadWorkApi } from '@/lib/api'
import { toast } from 'sonner'
// NOTE: `FolderInput` was the Move Dept icon — see the disabled Move Department
// flow below. Re-add it to this import when that flow is switched back on.
import { Loader2, UserPlus, UserMinus, Trash2, X, MessageSquare, Ban, Tag, Eye, ClipboardCheck } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { BulkStatusPreviewModal } from './BulkStatusPreviewModal'
import type { User } from '@/types'

// Local (IST on the office machines) YYYY-MM-DD. `toISOString()` is UTC and
// rolls the date back a day for anyone east of Greenwich after 5:30am.
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  selectedIds: number[]
  onClearSelection: () => void
  onRefresh: () => void
}

export function BulkActionBar({ selectedIds, onClearSelection, onRefresh }: Props) {
  const { isAdmin, isSalesHead } = useAuthStore()
  const qc = useQueryClient()
  const [showStatus, setShowStatus] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [showUnassign, setShowUnassign] = useState(false)
  const [showTask, setShowTask] = useState(false)
  // Move Department is disabled — leads change department through the status
  // cascade instead. Kept (commented) rather than removed so it can come back.
  // const [showMove, setShowMove] = useState(false)
  const [showFollowup, setShowFollowup] = useState(false)

  const canManageAssignments = isAdmin() || isSalesHead()
  const canDelete = isAdmin()

  const bulkDelete = useMutation({
    mutationFn: () => leadsApi.bulkDelete(selectedIds),
    onSuccess: () => {
      toast.success(`${selectedIds.length} leads moved to trash`)
      onClearSelection()
      onRefresh()
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })

  if (selectedIds.length === 0) return null

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg flex-wrap">
        <span className="text-sm font-medium text-primary">{selectedIds.length} selected</span>
        <div className="h-4 w-px bg-border hidden sm:block" />

        {/* Update Status & Sub-status (Available to all users) */}
        <button
          onClick={() => setShowStatus(true)}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-muted transition-colors text-foreground"
        >
          <Tag className="h-3.5 w-3.5 text-primary" /> Update Status
        </button>

        {/* Bulk Follow-up (Available to all users) */}
        <button
          onClick={() => setShowFollowup(true)}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-muted transition-colors text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5 text-blue-600" /> Bulk Follow-up
        </button>

        {canManageAssignments && (
          <>
            <button
              onClick={() => setShowAssign(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-muted transition-colors text-foreground"
            >
              <UserPlus className="h-3.5 w-3.5 text-emerald-600" /> Assign
            </button>
            <button
              onClick={() => setShowUnassign(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
            >
              <UserMinus className="h-3.5 w-3.5" />
              Unassign
            </button>
            {/* Hands the selection to a counsellor as a dated calling task. It
                shows up on /app/tasks for both sides — see AssignTaskModal. */}
            <button
              onClick={() => setShowTask(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-muted transition-colors text-foreground"
            >
              <ClipboardCheck className="h-3.5 w-3.5 text-violet-600" /> Assign Task
            </button>
            {/* Move Dept — disabled on request; department changes flow from
                the status cascade. Restore the button, the `showMove` state,
                the modal render below, the MoveDeptModal function, and the
                FolderInput import together.
            <button
              onClick={() => setShowMove(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-muted transition-colors text-foreground"
            >
              <FolderInput className="h-3.5 w-3.5 text-purple-600" /> Move Dept
            </button>
            */}
          </>
        )}

        {canDelete && (
          <button
            onClick={() => {
              if (confirm(`Move ${selectedIds.length} lead(s) to trash?`)) bulkDelete.mutate()
            }}
            disabled={bulkDelete.isPending}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
          >
            {bulkDelete.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
        )}

        <button
          onClick={onClearSelection}
          className="ml-auto p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {showStatus && (
        <BulkStatusModal
          leadIds={selectedIds}
          onClose={() => setShowStatus(false)}
          onSuccess={() => { setShowStatus(false); onClearSelection(); onRefresh() }}
        />
      )}

      {showAssign && (
        <AssignModal
          leadIds={selectedIds}
          onClose={() => setShowAssign(false)}
          onSuccess={() => { setShowAssign(false); onClearSelection(); onRefresh() }}
        />
      )}

      {showUnassign && (
        <UnassignModal
          leadIds={selectedIds}
          onClose={() => setShowUnassign(false)}
          onSuccess={() => { setShowUnassign(false); onClearSelection(); onRefresh() }}
        />
      )}

      {showTask && (
        <AssignTaskModal
          leadIds={selectedIds}
          onClose={() => setShowTask(false)}
          onSuccess={() => { setShowTask(false); onClearSelection(); onRefresh() }}
        />
      )}

      {/* Move Dept modal — disabled, see the toolbar button above.
      {showMove && (
        <MoveDeptModal
          leadIds={selectedIds}
          onClose={() => setShowMove(false)}
          onSuccess={() => { setShowMove(false); onClearSelection(); onRefresh() }}
        />
      )}
      */}

      {showFollowup && (
        <BulkFollowupModal
          leadIds={selectedIds}
          onClose={() => setShowFollowup(false)}
          onSuccess={() => { setShowFollowup(false); onClearSelection(); onRefresh() }}
        />
      )}
    </>
  )
}

// ─── Bulk Follow-up Modal ─────────────────────────────────────────────────────

function BulkFollowupModal({ leadIds, onClose, onSuccess }: {
  leadIds: number[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [comment, setComment] = useState('')
  const [followupDate, setFollowupDate] = useState('')
  const [followupNA, setFollowupNA] = useState(false)
  // Status change carried by the follow-up. The backend has always accepted
  // leadStatusId / leadSubStatusId here, the UI just never offered them, so
  // bulk follow-up could not move a lead through the pipeline at all. All
  // three are required — a bulk follow-up always states where the lead lands.
  const [selectedDeptId, setSelectedDeptId] = useState('')
  const [leadStatusId, setLeadStatusId] = useState('')
  const [leadSubStatusId, setLeadSubStatusId] = useState('')
  const [step, setStep] = useState<'pick' | 'preview'>('pick')

  const { data: workflow } = useQuery<WorkflowData>({
    queryKey: ['lead-config-workflow'],
    queryFn: leadConfigApi.workflow,
  })

  // Status list scoped by the chosen department (which statuses to OFFER —
  // never the destination; the server derives that from the cascade).
  const filteredStatuses = useMemo(() => {
    if (!workflow?.statuses) return []
    let list = workflow.statuses.filter((s) => s.status === 1)
    if (selectedDeptId) list = list.filter((s) => s.departmentId === Number(selectedDeptId))
    return list.sort((a, b) => a.priority - b.priority)
  }, [workflow, selectedDeptId])

  const selectedStatus = useMemo(
    () => (leadStatusId ? workflow?.statuses?.find((s) => s.id === Number(leadStatusId)) ?? null : null),
    [workflow, leadStatusId],
  )
  const subStatusesForStatus = selectedStatus?.subStatuses ?? []
  const selectedSubStatus = useMemo(
    () => (leadSubStatusId ? subStatusesForStatus.find((ss) => ss.id === Number(leadSubStatusId)) ?? null : null),
    [subStatusesForStatus, leadSubStatusId],
  )
  const targetDept = useMemo(() => {
    if (!workflow?.departments) return null
    const deptId = selectedSubStatus?.targetDepartmentId ?? selectedStatus?.departmentId ?? null
    return deptId ? workflow.departments.find((d) => d.id === deptId) ?? null : null
  }, [workflow, selectedStatus, selectedSubStatus])

  // Every field is required, matching the single-lead Update Status modal.
  // Two conditionals: a status with no configured sub-statuses can't demand
  // one, and "N/A" satisfies the follow-up date (that is how a dead lead is
  // flagged — it writes 0001-01-01 so the lead drops out of pending queues).
  const needsSubStatus = !!leadStatusId && subStatusesForStatus.length > 0
  const missingField =
    !comment.trim() ? 'Add a comment to continue'
    : !selectedDeptId ? 'Pick a department to continue'
    : !leadStatusId ? 'Pick a status to continue'
    : needsSubStatus && !leadSubStatusId ? 'Pick a sub-status to continue'
    : !followupNA && !followupDate ? 'Pick a follow-up date (or mark N/A) to continue'
    : null
  const canContinue = missingField === null

  const qc = useQueryClient()
  const submit = useMutation({
    mutationFn: (approvedIds: number[]) =>
      followupsApi.bulk({
        leadIds: approvedIds.length > 0 ? approvedIds : leadIds,
        comment,
        followupDate: followupNA
          ? '0001-01-01T00:00:00.000Z'
          : (followupDate || undefined),
        leadStatusId: leadStatusId ? Number(leadStatusId) : undefined,
        leadSubStatusId: leadSubStatusId ? Number(leadSubStatusId) : undefined,
      }),
    onSuccess: (r: any, approvedIds: number[]) => {
      const attempted = approvedIds.length > 0 ? approvedIds.length : leadIds.length
      const ok = r?.updated ?? r?.results?.filter((x: any) => x.success).length ?? 0
      const blocked = r?.blockedBackward ?? 0
      const failed = r?.writeFailed ?? 0
      if (failed > 0) {
        toast.error(`Follow-up added to ${ok}/${attempted} leads — ${failed} failed to write`)
      } else if (blocked > 0) {
        toast.warning(`Follow-up added to ${ok}/${attempted} leads · ${blocked} skipped (backward move blocked)`)
      } else {
        toast.success(`Follow-up added to ${ok}/${attempted} leads`)
      }
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead-tab-counts'] })
      qc.invalidateQueries({ queryKey: ['lead-department-counts'] })
      qc.invalidateQueries({ queryKey: ['followups'] })
      qc.invalidateQueries({ queryKey: ['followups-today'] })
      qc.invalidateQueries({ queryKey: ['followups-today-count'] })
      qc.invalidateQueries({ queryKey: ['followups-overdue'] })
      qc.invalidateQueries({ queryKey: ['followups-upcoming'] })
      qc.invalidateQueries({ queryKey: ['followups-pending'] })
      qc.invalidateQueries({ queryKey: ['followups-pending-counts'] })
      leadIds.forEach((id) => qc.invalidateQueries({ queryKey: ['lead', id] }))
      onSuccess()
    },
    onError: () => toast.error('Bulk follow-up failed'),
  })

  // Step 2 — same confirmation screen the status/move flows use, so a
  // follow-up that also changes status shows exactly which leads it moves.
  if (step === 'preview') {
    return (
      <BulkStatusPreviewModal
        title="Preview Bulk Follow-up"
        subtitle="Review every lead — the follow-up is logged and the status change applied"

        confirmLabel="Confirm & Add Follow-up"
        leadIds={leadIds}
        leadStatusId={leadStatusId ? Number(leadStatusId) : undefined}
        leadSubStatusId={leadSubStatusId ? Number(leadSubStatusId) : undefined}
        onBack={() => setStep('pick')}
        onClose={onClose}
        onConfirm={(approvedIds) => submit.mutate(approvedIds)}
        isApplying={submit.isPending}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold">
          Bulk Follow-up · {leadIds.length} lead{leadIds.length > 1 ? 's' : ''}
        </h2>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Comment <span className="text-destructive">*</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="What did you discuss / next steps..."
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* ── Optional status change ── */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Update status
            </span>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Department <span className="text-destructive">*</span>
            </label>
            <select
              value={selectedDeptId}
              onChange={(e) => { setSelectedDeptId(e.target.value); setLeadStatusId(''); setLeadSubStatusId('') }}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select department...</option>
              {workflow?.departments?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Status <span className="text-destructive">*</span>
            </label>
            <select
              value={leadStatusId}
              onChange={(e) => { setLeadStatusId(e.target.value); setLeadSubStatusId('') }}
              disabled={!selectedDeptId}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {selectedDeptId ? 'Select status...' : 'Pick a department first...'}
              </option>
              {filteredStatuses.map((st) => (
                <option key={st.id} value={st.id}>{st.title}</option>
              ))}
            </select>
          </div>

          {leadStatusId && subStatusesForStatus.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Sub-Status <span className="text-destructive">*</span>
              </label>
              <select
                value={leadSubStatusId}
                onChange={(e) => setLeadSubStatusId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select sub-status...</option>
                {subStatusesForStatus.map((ss) => (
                  <option key={ss.id} value={ss.id}>{ss.subStatus}</option>
                ))}
              </select>
            </div>
          )}

          {targetDept && (
            <div className="p-2.5 bg-muted/40 rounded-md border text-xs flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">Leads will land in</span>
              <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold">
                {targetDept.name}
              </span>
              {selectedSubStatus && (
                <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800">
                  {selectedSubStatus.subStatus}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="border-t pt-4">
          <label className="text-xs font-medium text-muted-foreground">
            Next Follow-up Date <span className="text-destructive">*</span>
          </label>
          {followupNA ? (
            <div className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-slate-50 dark:bg-slate-900/40 border-slate-300 dark:border-slate-700 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                <Ban className="h-3.5 w-3.5" /> N/A (01/01/0001)
              </span>
              <button
                type="button"
                onClick={() => setFollowupNA(false)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            </div>
          ) : (
            <input
              type="date"
              value={followupDate}
              onChange={(e) => setFollowupDate(e.target.value)}
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background"
            />
          )}
          <button
            type="button"
            onClick={() => {
              const next = !followupNA
              setFollowupNA(next)
              if (next) setFollowupDate('')
            }}
            className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md border transition-all ${
              followupNA
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-400'
                : 'bg-background text-muted-foreground border-border hover:bg-accent'
            }`}
            aria-pressed={followupNA}
          >
            <Ban className="h-3 w-3" />
            Mark as N/A — no follow-up needed
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled={!canContinue}
            title={missingField ?? undefined}
            onClick={() => setStep('preview')}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview ({leadIds.length})
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function AssignModal({ leadIds, onClose, onSuccess }: {
  leadIds: number[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [counsellorId, setCounsellorId] = useState('')

  const { data: counsellors = [] } = useQuery<User[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: usersApi.counsellors,
  })

  const counsellorOptions = useMemo(() =>
    counsellors.map((u) => ({
      value: String(u.id),
      label: u.name || '',
      subtitle: [u.role, u.email].filter(Boolean).join(' · '),
    })),
    [counsellors]
  )

  const qc = useQueryClient()
  const assign = useMutation({
    mutationFn: () => leadsApi.bulkAssign({ leadIds, counsellorId: Number(counsellorId) }),
    onSuccess: (data: { assigned?: number; skipped?: number; message?: string }) => {
      const skipped = data?.skipped ?? 0
      const assigned = data?.assigned ?? leadIds.length
      toast.success(
        skipped > 0
          ? `${assigned} assigned, ${skipped} already assigned (skipped)`
          : data?.message || 'Leads assigned',
      )
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['assignment-summary'] })
      leadIds.forEach((id) => qc.invalidateQueries({ queryKey: ['lead', id] }))
      onSuccess()
    },
    onError: () => toast.error('Assignment failed'),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-sm space-y-4">
        <h2 className="font-semibold">Assign {leadIds.length} Lead{leadIds.length > 1 ? 's' : ''}</h2>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Sales Rep</label>
          <div className="mt-1">
            <SearchableSelect
              options={counsellorOptions}
              value={counsellorId}
              onChange={setCounsellorId}
              placeholder="Search & select sales rep..."
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => assign.mutate()}
            disabled={assign.isPending || !counsellorId}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {assign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Assign
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assign Task Modal ────────────────────────────────────────────────────────
// Hands the hand-picked selection to one counsellor as a calling task
// (LeadWorkBatch). Deliberately minimal — counsellor, end date, comment — the
// full cohort/priority/sequence controls live in the Task Builder. The task
// lands on /app/tasks for the admin and the counsellor, with per-lead progress.

function AssignTaskModal({ leadIds, onClose, onSuccess }: {
  leadIds: number[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [counsellorId, setCounsellorId] = useState('')
  const [dueDate, setDueDate] = useState(todayISO)
  const [comment, setComment] = useState('')
  const [title, setTitle] = useState('')

  const { data: counsellors = [] } = useQuery<User[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: usersApi.counsellors,
  })

  const counsellorOptions = useMemo(() =>
    counsellors.map((u) => ({
      value: String(u.id),
      label: u.name || '',
      subtitle: [u.role, u.email].filter(Boolean).join(' · '),
    })),
    [counsellors]
  )

  const qc = useQueryClient()
  const assignTask = useMutation({
    mutationFn: () => leadWorkApi.createBatch({
      leadIds,
      assignedToId: Number(counsellorId),
      // No `leadDate`: the selection spans arbitrary created-dates, so the task
      // is recorded as hand-picked rather than as a single-day cohort.
      dueDate,
      // The task shows on the day it is due, so a counsellor opening "today"
      // sees work that is actually due today rather than the creation date.
      workDate: dueDate,
      notes: comment.trim() || undefined,
      title: title.trim() || undefined,
      // Handing out a task must not move the lead. Whoever already owns these
      // leads keeps them; the task assignee is added alongside. Only the
      // assignee sees the task itself.
      keepExistingOwners: true,
    }),
    onSuccess: (data: { id?: number; assigned?: number; skipped?: number }) => {
      const assigned = data?.assigned ?? leadIds.length
      const skipped = data?.skipped ?? 0
      const who = counsellors.find((u) => String(u.id) === counsellorId)?.name || 'counsellor'
      toast.success(
        skipped > 0
          ? `Task created for ${who} — ${assigned} leads (${skipped} already in an open task)`
          : `Task created for ${who} — ${assigned} lead${assigned === 1 ? '' : 's'}`,
      )
      qc.invalidateQueries({ queryKey: ['lead-work-batches'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['assignment-summary'] })
      onSuccess()
    },
    onError: (err: any) => {
      // 409 = every selected lead is already sitting in someone's open task.
      toast.error(err?.response?.data?.error || 'Could not create the task')
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-sm space-y-4">
        <div>
          <h2 className="font-semibold">Assign as Task</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {leadIds.length} lead{leadIds.length > 1 ? 's' : ''} — shows under Tasks for you and the counsellor.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Existing counsellors keep these leads. The task assignee is added alongside them, and only they see the task.
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Sales Rep</label>
          <div className="mt-1">
            <SearchableSelect
              options={counsellorOptions}
              value={counsellorId}
              onChange={setCounsellorId}
              placeholder="Search & select sales rep..."
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Finish by</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full px-3 py-1.5 text-sm border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Comment</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="What should they do with these leads?"
            className="mt-1 w-full px-3 py-1.5 text-sm border rounded-md bg-background resize-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Task title (optional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Call ${leadIds.length} selected lead${leadIds.length === 1 ? '' : 's'}`}
            className="mt-1 w-full px-3 py-1.5 text-sm border rounded-md bg-background"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => assignTask.mutate()}
            disabled={assignTask.isPending || !counsellorId || !dueDate}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {assignTask.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Assign Task
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Unassign Modal ───────────────────────────────────────────────────────────
// Bulk-unassign used to strip every counsellor from every selected lead. Admins
// kept losing the wrong assignments. Now we show who is actually assigned (with
// per-counsellor lead counts) and let admin pick exactly which counsellor /
// sales head to remove. The "All counsellors" choice keeps the old behavior
// available for the rare case where a clean slate is what's wanted.

function UnassignModal({ leadIds, onClose, onSuccess }: {
  leadIds: number[]
  onClose: () => void
  onSuccess: () => void
}) {
  const qc = useQueryClient()
  const [picked, setPicked] = useState<'all' | number | null>(null)
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['leads', 'bulk-assignees', leadIds.slice().sort((a, b) => a - b).join(',')],
    queryFn: () => leadsApi.bulkAssignees(leadIds),
    enabled: leadIds.length > 0,
  })

  const assignees = data?.assignees ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assignees
    return assignees.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (a.role ?? '').toLowerCase().includes(q) ||
      (a.email ?? '').toLowerCase().includes(q),
    )
  }, [assignees, search])

  const unassign = useMutation({
    mutationFn: () =>
      leadsApi.bulkUnassign(
        picked === 'all' || picked === null
          ? { leadIds }
          : { leadIds, counsellorId: picked },
      ),
    onSuccess: (res: { unassigned?: number; message?: string }) => {
      const target =
        picked === 'all' || picked === null
          ? 'all counsellors'
          : assignees.find((a) => a.id === picked)?.name ?? 'counsellor'
      toast.success(
        res?.message
          ? `${res.message} (from ${target})`
          : `${res?.unassigned ?? 0} assignment(s) removed from ${target}`,
      )
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['assignment-summary'] })
      leadIds.forEach((id) => qc.invalidateQueries({ queryKey: ['lead', id] }))
      onSuccess()
    },
    onError: () => toast.error('Unassign failed'),
  })

  const disabled = picked === null || unassign.isPending

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <UserMinus className="h-4 w-4 text-amber-600" />
            Unassign · {leadIds.length} lead{leadIds.length === 1 ? '' : 's'}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Pick the counsellor or sales head to remove. Other assignments stay intact.
          </p>
        </div>

        <div className="p-3 border-b">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or role…"
            className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading ? (
            <div className="py-10 flex justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : assignees.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No active counsellor assignments on the selected leads.
            </div>
          ) : (
            <>
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No matching counsellor</div>
              ) : (
                filtered.map((a) => {
                  const isPicked = picked === a.id
                  return (
                    <button
                      key={a.id}
                      onClick={() => setPicked(a.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                        isPicked ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-muted'
                      }`}
                    >
                      <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{a.name}</div>
                        {a.role && (
                          <div className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">{a.role}</div>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                        {a.count} lead{a.count === 1 ? '' : 's'}
                      </span>
                    </button>
                  )
                })
              )}

              {assignees.length > 0 && (
                <button
                  onClick={() => setPicked('all')}
                  className={`mt-2 w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors border-t ${
                    picked === 'all' ? 'bg-red-50 ring-1 ring-red-300' : 'hover:bg-muted'
                  }`}
                >
                  <div className="h-8 w-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                    <UserMinus className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">All counsellors</div>
                    <div className="text-[11px] text-muted-foreground">Strip every active assignment from the selected leads</div>
                  </div>
                </button>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => unassign.mutate()}
            disabled={disabled}
            className="px-4 py-1.5 text-sm font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
          >
            {unassign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Unassign
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared Workflow Interfaces ───────────────────────────────────────────────

interface WorkflowLeadType {
  id: number
  title: string
  slug: string
  departmentId: number
  priority?: number
}

interface WorkflowDepartment {
  id: number
  name: string
  slug: string
  priority?: number
  status?: number
  leadTypes?: WorkflowLeadType[]
}

interface WorkflowData {
  departments: WorkflowDepartment[]
  statuses: Array<{
    id: number
    title: string
    slug: string
    departmentId: number
    priority: number
    status: number
    subStatuses: Array<{
      id: number
      statusId: number
      subStatus: string
      departmentId: number | null
      statusLeadTypeId: number | null
      moveTo: number | null
      /** Server-resolved destination dept — render this, never re-derive it. */
      targetDepartmentId: number | null
    }>
  }>
}

// ─── Move Department Modal (DISABLED) ────────────────────────────────────────
//
// Commented out on request: leads should change department through the status
// cascade (pick a status/sub-status and the server routes the lead), not by
// being shoved into a department directly. Kept verbatim so it can be switched
// back on — restore this function, the `showMove` state, the toolbar button,
// the modal render, and the `FolderInput` import together.
//
//
// function MoveDeptModal({ leadIds, onClose, onSuccess }: {
//   leadIds: number[]
//   onClose: () => void
//   onSuccess: () => void
// }) {
//   const [departmentId, setDepartmentId] = useState('')
//   const [statusLeadTypeId, setStatusLeadTypeId] = useState('')
//   const [step, setStep] = useState<'pick' | 'preview'>('pick')
//
//   const { data: workflow, isLoading } = useQuery<WorkflowData>({
//     queryKey: ['lead-config-workflow'],
//     queryFn: leadConfigApi.workflow,
//   })
//
//   const selectedDept = useMemo(() => {
//     if (!workflow?.departments || !departmentId) return null
//     return workflow.departments.find((d) => d.id === Number(departmentId)) ?? null
//   }, [workflow, departmentId])
//
//   const availableTypes = useMemo(() => {
//     return selectedDept?.leadTypes ?? []
//   }, [selectedDept])
//
//   const handleDeptChange = (deptId: string) => {
//     setDepartmentId(deptId)
//     setStatusLeadTypeId('')
//   }
//
//   const qc = useQueryClient()
//   const move = useMutation({
//     mutationFn: (approvedIds: number[]) =>
//       leadsApi.bulkMove({
//         leadIds: approvedIds.length > 0 ? approvedIds : leadIds,
//         departmentId: Number(departmentId),
//         statusLeadTypeId: statusLeadTypeId ? Number(statusLeadTypeId) : undefined,
//       }),
//     onSuccess: (_res, approvedIds) => {
//       const n = approvedIds.length > 0 ? approvedIds.length : leadIds.length
//       toast.success(`${n} lead(s) moved`)
//       qc.invalidateQueries({ queryKey: ['leads'] })
//       qc.invalidateQueries({ queryKey: ['tab-counts'] })
//       qc.invalidateQueries({ queryKey: ['department-counts'] })
//       leadIds.forEach((id) => qc.invalidateQueries({ queryKey: ['lead', id] }))
//       onSuccess()
//     },
//     onError: (err: any) => toast.error(err?.response?.data?.error || 'Move failed'),
//   })
//
//   // Step 2 — list every lead with the department it leaves and the one it
//   // lands in, before anything is written.
//   if (step === 'preview') {
//     return (
//       <BulkStatusPreviewModal
//         leadIds={leadIds}
//         departmentId={Number(departmentId)}
//         onBack={() => setStep('pick')}
//         onClose={onClose}
//         onConfirm={(approvedIds) => move.mutate(approvedIds)}
//         isApplying={move.isPending}
//       />
//     )
//   }
//
//   return (
//     <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
//       <div
//         className="bg-card border rounded-lg shadow-2xl w-full max-w-sm p-6 space-y-4"
//         onClick={(e) => e.stopPropagation()}
//       >
//         <div className="flex items-center justify-between border-b pb-3">
//           <h2 className="font-semibold text-base flex items-center gap-2">
//             <FolderInput className="h-4 w-4 text-purple-600" />
//             Move {leadIds.length} Lead{leadIds.length > 1 ? 's' : ''}
//           </h2>
//           <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded-md">
//             <X className="h-4 w-4" />
//           </button>
//         </div>
//
//         {isLoading ? (
//           <div className="py-6 flex justify-center">
//             <Loader2 className="h-5 w-5 animate-spin text-primary" />
//           </div>
//         ) : (
//           <div className="space-y-4">
//             <div>
//               <label className="text-xs font-medium text-muted-foreground">
//                 Target Department <span className="text-destructive">*</span>
//               </label>
//               <select
//                 value={departmentId}
//                 onChange={(e) => handleDeptChange(e.target.value)}
//                 className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
//               >
//                 <option value="">Select department...</option>
//                 {workflow?.departments?.map((d) => (
//                   <option key={d.id} value={d.id}>{d.name}</option>
//                 ))}
//               </select>
//             </div>
//
//             {departmentId && availableTypes.length > 0 && (
//               <div>
//                 <label className="text-xs font-medium text-muted-foreground">Target Lead Type / Bucket (Optional)</label>
//                 <select
//                   value={statusLeadTypeId}
//                   onChange={(e) => setStatusLeadTypeId(e.target.value)}
//                   className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
//                 >
//                   <option value="">Default (All / No specific bucket)</option>
//                   {availableTypes.map((t: WorkflowLeadType) => (
//                     <option key={t.id} value={t.id}>{t.title}</option>
//                   ))}
//                 </select>
//               </div>
//             )}
//           </div>
//         )}
//
//         <div className="flex gap-2 justify-end border-t pt-4">
//           <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
//             Cancel
//           </button>
//           <button
//             onClick={() => setStep('preview')}
//             disabled={!departmentId}
//             className="px-4 py-1.5 text-sm bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
//           >
//             <Eye className="h-3.5 w-3.5" />
//             Preview &amp; Move
//           </button>
//         </div>
//       </div>
//     </div>
//   )
// }
//
// ─── Bulk Status Modal ────────────────────────────────────────────────────────

function BulkStatusModal({
  leadIds,
  onClose,
  onSuccess,
}: {
  leadIds: number[]
  onClose: () => void
  onSuccess: () => void
}) {
  const qc = useQueryClient()
  const [selectedDeptId, setSelectedDeptId] = useState<string>('')
  const [leadStatusId, setLeadStatusId] = useState<string>('')
  const [leadSubStatusId, setLeadSubStatusId] = useState<string>('')
  // 'pick' = choose status/sub-status; 'preview' = per-lead From → To
  // confirmation screen. Nothing is written until Confirm on the preview.
  const [step, setStep] = useState<'pick' | 'preview'>('pick')

  const { data: workflow, isLoading } = useQuery<WorkflowData>({
    queryKey: ['lead-config-workflow'],
    queryFn: leadConfigApi.workflow,
  })

  // Filter statuses based on selected department filter (if any)
  const filteredStatuses = useMemo(() => {
    if (!workflow?.statuses) return []
    let list = workflow.statuses.filter((s) => s.status === 1)
    if (selectedDeptId) {
      list = list.filter((s) => s.departmentId === Number(selectedDeptId))
    }
    return list.sort((a, b) => a.priority - b.priority)
  }, [workflow, selectedDeptId])

  // Sub-statuses available for selected status
  const subStatusesForStatus = useMemo(() => {
    if (!workflow?.statuses || !leadStatusId) return []
    const st = workflow.statuses.find((s) => s.id === Number(leadStatusId))
    return st?.subStatuses ?? []
  }, [workflow, leadStatusId])

  const selectedStatus = useMemo(() => {
    if (!workflow?.statuses || !leadStatusId) return null
    return workflow.statuses.find((s) => s.id === Number(leadStatusId)) ?? null
  }, [workflow, leadStatusId])

  const selectedSubStatus = useMemo(() => {
    if (!selectedStatus || !leadSubStatusId) return null
    return selectedStatus.subStatuses.find((ss) => ss.id === Number(leadSubStatusId)) ?? null
  }, [selectedStatus, leadSubStatusId])

  // Destination department, as resolved BY THE SERVER (`targetDepartmentId` on
  // the workflow payload). This used to re-derive the rule client-side from
  // `moveTo`, which drifted from the backend and previewed the wrong dept.
  const targetDept = useMemo(() => {
    if (!workflow?.departments) return null
    const deptId = selectedSubStatus?.targetDepartmentId ?? selectedStatus?.departmentId ?? null
    return deptId ? workflow.departments.find((d) => d.id === deptId) ?? null : null
  }, [workflow, selectedStatus, selectedSubStatus])

  // Every field is required. Sub-status is the one conditional: a status with
  // no configured sub-statuses can't demand one.
  const needsSubStatus = !!leadStatusId && subStatusesForStatus.length > 0
  const missingField =
    !selectedDeptId ? 'Pick a department to continue'
    : !leadStatusId ? 'Pick a status to continue'
    : needsSubStatus && !leadSubStatusId ? 'Pick a sub-status to continue'
    : null
  const canContinue = missingField === null

  const submit = useMutation({
    mutationFn: (approvedIds: number[]) =>
      leadsApi.bulkStatus({
        leadIds,
        leadStatusId: Number(leadStatusId),
        leadSubStatusId: leadSubStatusId ? Number(leadSubStatusId) : undefined,
        // NOTE: `selectedDeptId` is the SOURCE filter for the status dropdown,
        // never the destination. Sending it here pinned every lead to the
        // department it was already in (explicit departmentId outranks the
        // cascade), so status changes never moved anything. The server derives
        // the target from the chosen status / sub-status.
        approvedIds: approvedIds.length > 0 ? approvedIds : undefined,
      }),
    onSuccess: (res: { updated?: number; moved?: number; skipped?: number; message?: string }) => {
      const updatedCount = res?.updated ?? leadIds.length
      const skippedCount = res?.skipped ?? 0
      const movedCount = res?.moved ?? 0
      if (skippedCount > 0) {
        toast.warning(`${updatedCount} leads updated, ${skippedCount} skipped (backward move blocked)`)
      } else if (movedCount > 0) {
        toast.success(`${updatedCount} lead(s) updated · ${movedCount} moved department`)
      } else {
        toast.success(res?.message || `Status updated for ${updatedCount} lead(s)`)
      }
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['assignment-summary'] })
      qc.invalidateQueries({ queryKey: ['followups-today'] })
      qc.invalidateQueries({ queryKey: ['followups-overdue'] })
      qc.invalidateQueries({ queryKey: ['followups-pending'] })
      leadIds.forEach((id) => qc.invalidateQueries({ queryKey: ['lead', id] }))
      onSuccess()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to update status')
    },
  })

  // Step 2 — per-lead From → To confirmation. The rows come from the server's
  // dry run of this exact change, so nothing here is guesswork.
  if (step === 'preview') {
    return (
      <BulkStatusPreviewModal
        leadIds={leadIds}
        leadStatusId={Number(leadStatusId)}
        leadSubStatusId={leadSubStatusId ? Number(leadSubStatusId) : undefined}
        onBack={() => setStep('pick')}
        onClose={onClose}
        onConfirm={(approvedIds) => submit.mutate(approvedIds)}
        isApplying={submit.isPending}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border rounded-lg shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            Update Status · {leadIds.length} lead{leadIds.length > 1 ? 's' : ''}
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded-md">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Department — required. Scopes WHICH statuses are offered; it is
                NOT the destination and is never sent to the server. The lead's
                target department comes from the status/sub-status cascade. */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Department <span className="text-destructive">*</span>
              </label>
              <select
                value={selectedDeptId}
                onChange={(e) => {
                  setSelectedDeptId(e.target.value)
                  setLeadStatusId('')
                  setLeadSubStatusId('')
                }}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select department...</option>
                {workflow?.departments?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Status <span className="text-destructive">*</span>
              </label>
              <select
                value={leadStatusId}
                onChange={(e) => {
                  setLeadStatusId(e.target.value)
                  setLeadSubStatusId('')
                }}
                disabled={!selectedDeptId}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {selectedDeptId ? 'Select status...' : 'Pick a department first...'}
                </option>
                {filteredStatuses.map((st) => (
                  <option key={st.id} value={st.id}>{st.title}</option>
                ))}
              </select>
            </div>

            {/* Sub-Status — required whenever the chosen status has any.
                Some statuses legitimately have none; those skip this step. */}
            {leadStatusId && subStatusesForStatus.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Sub-Status <span className="text-destructive">*</span>
                </label>
                <select
                  value={leadSubStatusId}
                  onChange={(e) => setLeadSubStatusId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select sub-status...</option>
                  {subStatusesForStatus.map((ss) => (
                    <option key={ss.id} value={ss.id}>
                      {ss.subStatus}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Summary Preview Box */}
            {selectedStatus && (
              <div className="p-3 bg-muted/40 rounded-md border text-xs space-y-1.5">
                <div className="font-medium text-muted-foreground">Summary of changes:</div>
                <div className="flex items-center gap-2 flex-wrap text-foreground">
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                    {selectedStatus.title}
                  </span>
                  {selectedSubStatus && (
                    <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800">
                      {selectedSubStatus.subStatus}
                    </span>
                  )}
                  {targetDept && (
                    <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-medium">
                      Dept: {targetDept.name}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end border-t pt-4">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            disabled={!canContinue}
            title={missingField ?? undefined}
            onClick={() => setStep('preview')}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-primary/90"
          >
            <Eye className="h-3.5 w-3.5" />
            Update ({leadIds.length})
          </button>
        </div>
      </div>
    </div>
  )
}
