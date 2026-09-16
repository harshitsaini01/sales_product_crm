import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { followupsApi, leadConfigApi } from '@/lib/api'

import { toast } from 'sonner'
import {
  X, Loader2, PhoneCall, PhoneOff,
  MessageSquare, CalendarDays, Ban, ArrowRight, Building2,
  ChevronDown,
} from 'lucide-react'
import type { Lead, LeadFollowupStatus } from '@/types'

const FRESH_STATUS_VALUE = '__fresh__'

// ─── Workflow tree returned by GET /api/lead-config/workflow ─────────────────
interface WfDepartment {
  id: number; name: string; slug: string; priority: number; status: number
  leadTypes?: { id: number; title: string; slug: string; departmentId: number; priority: number }[]
}
interface WfSubStatus {
  id: number; statusId: number; subStatus: string
  departmentId: number | null; statusLeadTypeId: number | null; moveTo: number | null
  /** Destination department resolved BY THE SERVER — render this, never
   *  re-derive it from moveTo/departmentId (the two drifted apart before). */
  targetDepartmentId: number | null
}
interface WfStatus {
  id: number; title: string; slug: string
  departmentId: number; priority: number; status: number
  subStatuses: WfSubStatus[]
}
interface Workflow {
  departments: WfDepartment[]
  statuses: WfStatus[]
  followupStatuses: { id: number; status: string; shortnote?: string }[]
}

interface UpdateStatusModalProps {
  lead: Lead
  onClose: () => void
}

export function UpdateStatusModal({ lead, onClose }: UpdateStatusModalProps) {
  const qc = useQueryClient()
  // Form state — picker (status → sub-status)
  const pickedDeptId = lead.departmentId ?? null
  const [leadStatusId, setLeadStatusId] = useState(
    lead.leadStatusId ? String(lead.leadStatusId) : FRESH_STATUS_VALUE,
  )
  const [leadSubStatusId, setLeadSubStatusId] = useState(lead.leadSubStatusId ? String(lead.leadSubStatusId) : '')
  const [callAnsweredStatus, setCallAnsweredStatus] = useState('')
  const [followupDate, setFollowupDate] = useState('')
  const [followupTime, setFollowupTime] = useState('09:00')
  // "N/A" mode — sends 0001-01-01 as the sentinel for "no follow-up needed"
  // (used to flag dead/junk leads so they drop out of follow-up queues).
  const [followupNA, setFollowupNA] = useState(false)
  const [fType, setFType] = useState('followup')
  const [leadFollowStatus, setLeadFollowStatus] = useState(lead.leadFollowStatus ? String(lead.leadFollowStatus) : '')
  const [comment, setComment] = useState('')
  const [lastCommentSeed, setLastCommentSeed] = useState('')

  // Lock body scroll + Escape key
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // ─── Single workflow tree query — replaces 2 separate queries that loaded
  // every status from every dept regardless of context.
  const { data: workflow } = useQuery<Workflow>({
    queryKey: ['lead-config-workflow'],
    queryFn: leadConfigApi.workflow,
  })

  const { data: followupStatuses = [] } = useQuery<LeadFollowupStatus[]>({
    queryKey: ['lead-config-followup-statuses'],
    queryFn: leadConfigApi.followupStatuses,
  })

  // Pull the lead's most recent comment so we can pre-fill the textarea.
  // Counsellor edits the value → it'll be saved as a new follow-up row.
  const { data: pastFollowups } = useQuery<Array<{ id: number; comment: string }>>({
    queryKey: ['followups', lead.id],
    queryFn: () => followupsApi.list(lead.id),
  })
  useEffect(() => {
    if (pastFollowups && pastFollowups.length > 0 && !lastCommentSeed) {
      const latest = pastFollowups[0]?.comment ?? ''
      setComment(latest)
      setLastCommentSeed(latest)
    }
  }, [pastFollowups, lastCommentSeed])

  // ─── Pickable depts — hide Marketing / Archive for counsellor-class roles
  // only. Admins keep full visibility.

  const currentDept = useMemo(() => {
    return (workflow?.departments ?? []).find((d) => d.id === lead.departmentId) ?? null
  }, [workflow, lead.departmentId])

  // Statuses strictly scoped to the picked dept.
  const statusesForDept = useMemo(() => {
    if (!workflow || pickedDeptId === null) return []
    return workflow.statuses
      .filter((s) => s.departmentId === pickedDeptId && s.status === 1)
      .sort((a, b) => a.priority - b.priority)
  }, [workflow, pickedDeptId])

  // Sub-statuses scoped to the picked status.
  const isFreshStatus = leadStatusId === FRESH_STATUS_VALUE

  const subStatusesForStatus = useMemo(() => {
    if (!workflow || !leadStatusId || isFreshStatus) return []
    const s = workflow.statuses.find((x) => x.id === Number(leadStatusId))
    return s?.subStatuses ?? []
  }, [workflow, leadStatusId, isFreshStatus])

  // ─── Where will the lead end up? ─────────────────────────────────────
  // Shown as an always-visible destination card so the counsellor knows
  // EXACTLY where the lead will land before they hit Save.
  //
  // The destination is whatever the SERVER resolved (`targetDepartmentId` on
  // the workflow payload). This block used to re-implement the routing rule
  // client-side and read `subStatus.moveTo` as the department while the write
  // path read `subStatus.departmentId` — so the card promised one department
  // and the save produced another. One rule, resolved in one place, now.
  const destination = useMemo(() => {
    if (!workflow) return null
    const pickedStatus = leadStatusId && !isFreshStatus
      ? workflow.statuses.find((s) => s.id === Number(leadStatusId))
      : null
    const pickedSub = leadSubStatusId && pickedStatus
      ? pickedStatus.subStatuses.find((ss) => ss.id === Number(leadSubStatusId))
      : null
    const targetDeptId: number | null =
      pickedSub?.targetDepartmentId ?? pickedStatus?.departmentId ?? pickedDeptId
    const targetDept = targetDeptId !== null
      ? workflow.departments.find((d) => d.id === targetDeptId) ?? null
      : null

    const targetLeadTypeId = pickedSub?.statusLeadTypeId
    const allLeadTypes = workflow.departments.flatMap(d => d.leadTypes || [])
    const targetLeadType = targetLeadTypeId 
      ? allLeadTypes.find(t => t.id === targetLeadTypeId) ?? null 
      : null

    return {
      targetDept,
      targetStatus: isFreshStatus ? ({ title: 'Fresh' } as WfStatus) : pickedStatus,
      targetSub: pickedSub,
      targetLeadType,
      isMoving: targetDept !== null && currentDept !== null && targetDept.id !== currentDept.id,
      isStatusChange:
        (isFreshStatus || !!pickedStatus) &&
        (isFreshStatus ? 'Fresh' : pickedStatus?.title) !== lead.leadStatus,
    }
  }, [workflow, pickedDeptId, leadStatusId, leadSubStatusId, currentDept, lead.leadStatus, isFreshStatus])



  const addFollowup = useMutation({
    mutationFn: followupsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      qc.invalidateQueries({ queryKey: ['lead-tab-counts'] })
      qc.invalidateQueries({ queryKey: ['lead-department-counts'] })
      qc.invalidateQueries({ queryKey: ['followups-today'] })
      qc.invalidateQueries({ queryKey: ['followups-today-count'] })
      qc.invalidateQueries({ queryKey: ['followups-overdue'] })
      qc.invalidateQueries({ queryKey: ['followups-upcoming'] })
      qc.invalidateQueries({ queryKey: ['followups-pending'] })
      qc.invalidateQueries({ queryKey: ['followups-pending-counts'] })
      qc.invalidateQueries({ queryKey: ['followups', 'today'] })
      toast.success('Status updated successfully')
      onClose()
    },
    onError: (err: unknown) => {
      // Surface the backend pipeline-guard rejection with a clear message so
      // the counsellor knows *why* it didn't go through (vs a generic 500).
      const e = err as { response?: { data?: { error?: string; fromDept?: string; toDept?: string; message?: string } } }
      const data = e?.response?.data
      if (data?.error === 'backward_move_blocked') {
        toast.error(
          `Cannot move lead backward: ${data.fromDept ?? 'current'} → ${data.toDept ?? 'target'}. Ask an admin to recycle this lead.`,
          { duration: 6000 },
        )
        return
      }
      if (data?.error === 'status_dept_mismatch') {
        toast.error(data.message ?? 'This status does not belong to the selected department.')
        return
      }
      toast.error('Failed to update status')
    },
  })

  // All three picker fields are functionally required — but rendered without
  // asterisks / "required" labels so the modal stays clean. Save is disabled
  // until they're satisfied; if the user somehow still submits, we show a
  // focused toast instead of a generic backend error.
  const subsAvailable = !!leadStatusId && subStatusesForStatus.length > 0
  const hasFollowupDate = followupNA || !!followupDate
  const hasComment = comment.trim().length > 0
  const canSubmit =
    pickedDeptId !== null &&
    !!leadStatusId &&
    // Sub-status is only required when the chosen status actually has any
    // configured (some statuses legitimately have none — see DB report).
    (!subsAvailable || !!leadSubStatusId) &&
    hasFollowupDate &&
    hasComment

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      if (pickedDeptId === null) toast.error('Pick a department.')
      else if (!leadStatusId) toast.error('Pick a status.')
      else if (subsAvailable && !leadSubStatusId) toast.error('Pick a sub-status.')
      else if (!hasFollowupDate) toast.error('Pick a follow-up date (or mark as N/A).')
      else if (!hasComment) toast.error('Comment is required.')
      return
    }
    const trimmed = comment.trim()
    const edited = trimmed && trimmed !== lastCommentSeed.trim()
    const followupPayload = followupNA
      ? '0001-01-01T00:00:00.000Z'
      : followupDate
        ? `${followupDate}T${followupTime || '09:00'}:00`
        : undefined
    addFollowup.mutate({
      stdId: lead.id,
      // Comment is required (validated above). Send new text when edited;
      // otherwise skip so we don't spam an identical duplicate of the last one.
      comment: edited ? trimmed : '',
      leadStatus: isFreshStatus ? 'Fresh' : undefined,
      leadStatusId: !isFreshStatus && leadStatusId ? Number(leadStatusId) : undefined,
      leadSubStatusId: !isFreshStatus && leadSubStatusId ? Number(leadSubStatusId) : undefined,
      // Department and bucket are deliberately NOT sent: the server derives
      // both from the chosen status / sub-status via the one shared cascade.
      // Sending a client-computed departmentId here used to OUTRANK that
      // cascade, so a wrong client guess silently became the lead's new home.
      callAnsweredStatus: callAnsweredStatus !== '' ? Number(callAnsweredStatus) : undefined,
      followupDate: followupPayload,
      type: fType || undefined,
      leadFollowStatus: leadFollowStatus ? Number(leadFollowStatus) : undefined,
    })
  }

  const today = new Date().toISOString().split('T')[0]


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-card border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-modal-title"
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b bg-card/95 backdrop-blur-sm rounded-t-2xl z-10">
          <div>
            <h2 id="status-modal-title" className="text-lg font-bold">Update Status</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lead.name} <span className="text-muted-foreground/50">#{lead.id}</span>
              {currentDept && (
                <>
                  <span className="text-muted-foreground/40 mx-1.5">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {currentDept.name}
                  </span>
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent transition-colors" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* ── Step 1: Status (dropdown, scoped to picked dept) ── */}
          <fieldset>
            <legend className="text-sm font-bold text-foreground flex items-center gap-2 mb-2.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                pickedDeptId === null ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
              }`}>1</span>
              Status
              {pickedDeptId === null && (
                <span className="text-[11px] font-normal text-muted-foreground ml-1">
                  Lead has no department
                </span>
              )}
              {pickedDeptId !== null && statusesForDept.length === 0 && (
                <span className="text-[11px] font-normal text-muted-foreground ml-1">
                  (no active statuses in this department)
                </span>
              )}
            </legend>
            <div className="relative">
              <select
                id="modal-lead-status"
                value={leadStatusId}
                onChange={(e) => { setLeadStatusId(e.target.value); setLeadSubStatusId('') }}
                disabled={pickedDeptId === null}
                className="w-full appearance-none px-3 py-2.5 pr-9 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {pickedDeptId === null ? 'No department assigned' : 'Choose a status…'}
                </option>
                {pickedDeptId !== null && (
                  <option value={FRESH_STATUS_VALUE}>Fresh</option>
                )}
                {statusesForDept.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </fieldset>

          {/* ── Step 2: Sub-status (dropdown, scoped to picked status) ── */}
          <fieldset className="border-t pt-4">
            <legend className="text-sm font-bold text-foreground flex items-center gap-2 mb-2.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                !leadStatusId ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
              }`}>2</span>
              Sub-status
              {!leadStatusId && (
                <span className="text-[11px] font-normal text-muted-foreground ml-1">
                  Pick a status first
                </span>
              )}
              {leadStatusId && subStatusesForStatus.length === 0 && (
                <span className="text-[11px] font-normal text-muted-foreground ml-1">
                  (this status has no sub-statuses)
                </span>
              )}
            </legend>
            <div className="relative">
              <select
                id="modal-sub-status"
                value={leadSubStatusId}
                onChange={(e) => setLeadSubStatusId(e.target.value)}
                disabled={!leadStatusId || subStatusesForStatus.length === 0}
                className="w-full appearance-none px-3 py-2.5 pr-9 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!leadStatusId
                    ? 'Select a status first…'
                    : subStatusesForStatus.length === 0
                      ? 'No sub-statuses for this status'
                      : 'Choose a sub-status…'}
                </option>
                {subStatusesForStatus.map((s) => (
                  <option key={s.id} value={s.id}>{s.subStatus}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </fieldset>

          {/* ── Destination preview ──
              Always rendered when a dept is picked, so the counsellor sees
              EXACTLY where the lead will end up before they save. Three
              states:
                a) Just dept picked      → "will land in Default tab"
                b) Dept + status picked  → "will land in {status} under {dept}"
                c) Full pick             → "will land in {status} / {sub} under {dept}"
              The arrow row visually communicates the move (current → target). */}
          {pickedDeptId !== null && destination?.targetDept && (
            <div className="border-t pt-4">
              <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent overflow-hidden">
                <div className="px-4 py-2 border-b bg-primary/5 flex items-center gap-2">
                  <ArrowRight className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    Where this lead will go
                  </span>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
                  {/* FROM */}
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">From</div>
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {currentDept?.name ?? <span className="text-muted-foreground italic">No department</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      Status: <span className="font-medium text-foreground">{lead.leadStatus || '—'}</span>
                      {lead.leadSubStatus && (
                        <span className="block text-[11px] truncate">
                          Sub: <span className="font-medium text-foreground">{lead.leadSubStatus}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* arrow (vertical on mobile, horizontal on sm+) */}
                  <div className="flex sm:flex-col items-center justify-center text-primary">
                    <ArrowRight className="h-5 w-5 hidden sm:block" />
                    <ArrowRight className="h-5 w-5 sm:hidden rotate-90" />
                  </div>

                  {/* TO */}
                  <div className="space-y-1 sm:text-right">
                    <div className="text-[10px] uppercase tracking-wider text-primary font-semibold">To</div>
                    <div className="flex items-center gap-1.5 sm:justify-end text-sm font-bold text-primary">
                      <Building2 className="h-3.5 w-3.5" />
                      {destination.targetDept.name.replace(/\s+/g, ' ').trim()}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      Status:{' '}
                      <span className="font-semibold text-foreground">
                        {destination.targetStatus?.title ?? <span className="italic text-muted-foreground/70">— not picked —</span>}
                      </span>
                      {destination.targetSub && (
                        <span className="block text-[11px] truncate">
                          Sub: <span className="font-semibold text-foreground">{destination.targetSub.subStatus}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer note — explains the bucket the lead will land in */}
                <div className="px-4 py-2.5 border-t bg-muted/30 text-[11px] text-muted-foreground flex items-start gap-2">
                  <span className="mt-0.5">→</span>
                  {!destination.targetStatus ? (
                    <span>
                      No status picked — lead will land in <strong className="text-foreground">{destination.targetDept.name.replace(/\s+/g, ' ').trim()} → Default</strong> tab.
                      Pick a status above for a proper landing.
                    </span>
                  ) : destination.isMoving ? (
                    <span>
                      Lead moves to <strong className="text-foreground">{destination.targetDept.name.replace(/\s+/g, ' ').trim()}</strong>
                      {destination.targetLeadType ? (
                        <> and surfaces under the <strong className="text-foreground">{destination.targetLeadType.title}</strong> lead type.</>
                      ) : (
                        <> and surfaces under the <strong className="text-foreground">{destination.targetStatus.title}</strong> status{destination.targetSub ? <> with sub-status <strong className="text-foreground">{destination.targetSub.subStatus}</strong></> : null}.</>
                      )}
                    </span>
                  ) : destination.isStatusChange ? (
                    <span>
                      Lead stays in <strong className="text-foreground">{destination.targetDept.name.replace(/\s+/g, ' ').trim()}</strong>, status updates to <strong className="text-foreground">{destination.targetStatus.title}</strong>{destination.targetSub ? <> / <strong className="text-foreground">{destination.targetSub.subStatus}</strong></> : null}.
                      {destination.targetLeadType ? <> It will surface under the <strong className="text-foreground">{destination.targetLeadType.title}</strong> lead type.</> : null}
                    </span>
                  ) : (
                    <span>
                      Status unchanged — only follow-up details will be saved.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Follow-up plumbing (unchanged from old modal) ── */}
          <fieldset className="border-t pt-4">
            <legend className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4 text-primary" /> Follow-up details
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="modal-lead-follow-status" className="text-xs font-medium text-muted-foreground">
                  Lead Followup Status
                </label>
                <select
                  id="modal-lead-follow-status"
                  value={leadFollowStatus}
                  onChange={(e) => setLeadFollowStatus(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select</option>
                  {followupStatuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.status}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Call Answer Status
                </label>
                <div className="flex gap-1.5 mt-1 flex-wrap" role="radiogroup" aria-label="Call answer status">
                  {([
                    { v: '1', label: 'Answered', icon: <PhoneCall className="h-3 w-3" />, active: 'text-emerald-600 border-emerald-300 bg-emerald-50' },
                    { v: '0', label: 'Not Answered', icon: <PhoneOff className="h-3 w-3" />, active: 'text-slate-500 border-slate-300 bg-slate-50' },
                  ] as const).map(({ v, label, icon, active }) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={callAnsweredStatus === v}
                      onClick={() => setCallAnsweredStatus(callAnsweredStatus === v ? '' : v)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        callAnsweredStatus === v
                          ? `${active} ring-2 ring-offset-1 ring-primary/30`
                          : 'bg-background text-muted-foreground border-border hover:bg-accent'
                      }`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>

          {/* ── Follow Up ── */}
          <fieldset className="border-t pt-4">
            <legend className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" /> Follow Up
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="modal-followup-date" className="text-xs font-medium text-muted-foreground">
                  Next Follow-up Date <span className="text-red-500">*</span>
                </label>
                {followupNA ? (
                  <div className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-slate-50 dark:bg-slate-900/40 border-slate-300 dark:border-slate-700 flex items-center justify-between gap-2">
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
                    id="modal-followup-date"
                    type="date"
                    value={followupDate}
                    min={today}
                    onChange={(e) => setFollowupDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </div>
              <div>
                <label htmlFor="modal-followup-time" className="text-xs font-medium text-muted-foreground">
                  Time
                </label>
                <input
                  id="modal-followup-time"
                  type="time"
                  value={followupTime}
                  onChange={(e) => setFollowupTime(e.target.value)}
                  disabled={followupNA}
                  className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = !followupNA
                    setFollowupNA(next)
                    if (next) {
                      setFollowupDate('')
                      setFollowupTime('09:00')
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    followupNA
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-400 ring-2 ring-offset-1 ring-slate-300'
                      : 'bg-background text-muted-foreground border-border hover:bg-accent'
                  }`}
                  aria-pressed={followupNA}
                >
                  <Ban className="h-3 w-3" />
                  Mark as N/A — no follow-up needed
                </button>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Use this for dead/junk leads. Sets follow-up date to 01/01/0001 so it drops out of pending queues.
                </p>
              </div>
              <div className="col-span-2">
                <label htmlFor="modal-reminder-type" className="text-xs font-medium text-muted-foreground">Reminder</label>
                <select
                  id="modal-reminder-type"
                  value={fType}
                  onChange={(e) => setFType(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="followup">Follow-up Call</option>
                  <option value="visit">Walk-in Visit</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="meeting">Meeting</option>
                  <option value="note">Internal Note</option>
                </select>
              </div>
            </div>
          </fieldset>

          {/* ── Comment ── */}
          <fieldset className="border-t pt-4">
            <legend className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4 text-primary" /> Comment <span className="text-red-500">*</span>
            </legend>
            <textarea
              id="modal-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              required
              placeholder="Last comment shown here — edit to add a new comment (cannot be empty)..."
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </fieldset>

          {/* ── Actions ── */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={addFollowup.isPending || !canSubmit}
              title={
                !canSubmit
                  ? pickedDeptId === null
                    ? 'Pick a department to continue'
                    : !leadStatusId
                      ? 'Pick a status to continue'
                      : subsAvailable && !leadSubStatusId
                        ? 'Pick a sub-status to continue'
                        : !hasFollowupDate
                          ? 'Pick a follow-up date (or mark N/A) to continue'
                          : 'Add a comment to continue'
                  : undefined
              }
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {addFollowup.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium border rounded-lg hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
