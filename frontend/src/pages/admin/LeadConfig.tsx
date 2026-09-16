import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadConfigApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  Plus, Trash2, Pencil, Loader2, Check,
  ChevronDown, ChevronRight, Layers, GitBranch,
  ArrowUp, ArrowDown, Tag,
  Building2, CircleDot, Hash, Activity, Eye, EyeOff,
  Search, ArrowRight, ListTree,
} from 'lucide-react'

// ─── Color palette for departments ──────────────────────────────────────────
const DEPT_COLORS = [
  { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', ring: 'ring-blue-500/20', dot: 'bg-blue-500' },
  { bg: 'bg-violet-500', light: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', ring: 'ring-violet-500/20', dot: 'bg-violet-500' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', ring: 'ring-emerald-500/20', dot: 'bg-emerald-500' },
  { bg: 'bg-amber-500', light: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', ring: 'ring-amber-500/20', dot: 'bg-amber-500' },
  { bg: 'bg-rose-500', light: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', ring: 'ring-rose-500/20', dot: 'bg-rose-500' },
  { bg: 'bg-cyan-500', light: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', ring: 'ring-cyan-500/20', dot: 'bg-cyan-500' },
  { bg: 'bg-orange-500', light: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', ring: 'ring-orange-500/20', dot: 'bg-orange-500' },
  { bg: 'bg-indigo-500', light: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', ring: 'ring-indigo-500/20', dot: 'bg-indigo-500' },
  { bg: 'bg-teal-500', light: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', ring: 'ring-teal-500/20', dot: 'bg-teal-500' },
  { bg: 'bg-pink-500', light: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', ring: 'ring-pink-500/20', dot: 'bg-pink-500' },
]
function getDeptColor(idx: number) { return DEPT_COLORS[idx % DEPT_COLORS.length] }

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

type FormTab = 'department' | 'type' | 'status' | 'substatus' | 'followup'
type EditingItem = { type: FormTab; id: number } | null

// ─── Types ───────────────────────────────────────────────────────────────────
interface WfDepartment {
  id: number; name: string; slug: string; priority: number; status: number
  leadTypes: WfLeadType[]
}
interface WfLeadType {
  id: number; title: string; slug: string; departmentId: number | null; priority: number
}
interface WfSubStatus {
  id: number; statusId: number; subStatus: string; subStatusSlug: string
  departmentId: number | null; statusLeadTypeId: number | null; moveTo: number | null
}
interface WfStatus {
  id: number; title: string; slug: string; departmentId: number; moveTo: string | null; priority: number
  status?: number // 1 = active, 0 = disabled
  subStatuses: WfSubStatus[]
}
interface WfFollowup { id: number; status: string; shortnote?: string }
interface WorkflowData {
  departments: WfDepartment[]; unlinkedTypes: WfLeadType[]
  statuses: WfStatus[]; followupStatuses: WfFollowup[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function LeadConfig() {
  const qc = useQueryClient()

  // ── State ──
  const [activeForm, setActiveForm] = useState<FormTab>('department')
  const [editing, setEditing] = useState<EditingItem>(null)
  const [expandedDepts, setExpandedDepts] = useState<Set<number>>(new Set())
  const [expandedStatuses, setExpandedStatuses] = useState<Set<number>>(new Set())
  const [subStatusSearch, setSubStatusSearch] = useState('')

  // Forms
  const [deptForm, setDeptForm] = useState({ name: '' })
  const [typeForm, setTypeForm] = useState({ title: '', departmentId: '' })
  const [statusForm, setStatusForm] = useState({ title: '', departmentId: '' })
  const [subStatusForm, setSubStatusForm] = useState({ subStatus: '', statusId: '', moveTo: '', statusLeadTypeId: '' })
  const [followupForm, setFollowupForm] = useState({ status: '' })

  // ── Query ──
  const { data: wf, isLoading } = useQuery<WorkflowData>({
    queryKey: ['lead-config', 'workflow'],
    queryFn: leadConfigApi.workflow,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['lead-config'] })

  // ── Mutations ──
  const createDept = useMutation({
    mutationFn: () => leadConfigApi.createDepartment({ name: deptForm.name, slug: slugify(deptForm.name) }),
    onSuccess: () => { invalidate(); setDeptForm({ name: '' }); toast.success('Department created') },
    onError: () => toast.error('Failed to create department'),
  })
  const updateDept = useMutation({
    mutationFn: () => leadConfigApi.updateDepartment(editing!.id, { name: deptForm.name, slug: slugify(deptForm.name) }),
    onSuccess: () => { invalidate(); cancelEdit(); toast.success('Department updated') },
    onError: () => toast.error('Failed to update'),
  })
  const deleteDept = useMutation({
    mutationFn: (id: number) => leadConfigApi.deleteDepartment(id),
    onSuccess: () => { invalidate(); toast.success('Deleted') },
    onError: () => toast.error('Cannot delete — may have linked lead types'),
  })

  const createType = useMutation({
    mutationFn: () => leadConfigApi.createType({ title: typeForm.title, slug: slugify(typeForm.title), departmentId: typeForm.departmentId ? Number(typeForm.departmentId) : null }),
    onSuccess: () => { invalidate(); setTypeForm({ title: '', departmentId: '' }); toast.success('Lead type created') },
    onError: () => toast.error('Failed to create'),
  })
  const updateType = useMutation({
    mutationFn: () => leadConfigApi.updateType(editing!.id, { title: typeForm.title, slug: slugify(typeForm.title), departmentId: typeForm.departmentId ? Number(typeForm.departmentId) : null }),
    onSuccess: () => { invalidate(); cancelEdit(); toast.success('Lead type updated') },
    onError: () => toast.error('Failed to update'),
  })
  const deleteType = useMutation({
    mutationFn: (id: number) => leadConfigApi.deleteType(id),
    onSuccess: () => { invalidate(); toast.success('Deleted') },
    onError: () => toast.error('Cannot delete — may be in use'),
  })

  const createStatus = useMutation({
    mutationFn: () => leadConfigApi.createStatus({ title: statusForm.title, slug: slugify(statusForm.title), departmentId: Number(statusForm.departmentId) }),
    onSuccess: () => { invalidate(); setStatusForm({ title: '', departmentId: '' }); toast.success('Status created') },
    onError: () => toast.error('Failed — select a department'),
  })
  const updateStatus = useMutation({
    mutationFn: () => leadConfigApi.updateStatus(editing!.id, { title: statusForm.title, slug: slugify(statusForm.title), departmentId: Number(statusForm.departmentId) }),
    onSuccess: () => { invalidate(); cancelEdit(); toast.success('Status updated') },
    onError: () => toast.error('Failed to update'),
  })
  const deleteStatus = useMutation({
    mutationFn: (id: number) => leadConfigApi.deleteStatus(id),
    onSuccess: () => { invalidate(); toast.success('Deleted') },
    onError: () => toast.error('Cannot delete — has sub-statuses or leads linked'),
  })
  // Soft enable/disable: disabled statuses stay in the DB (existing leads keep
  // their history) but are hidden from the leads page filters and status picker.
  const toggleStatusActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      leadConfigApi.updateStatus(id, { status: active ? 1 : 0 }),
    onSuccess: (_d, v) => { invalidate(); toast.success(v.active ? 'Status enabled' : 'Status disabled — hidden from leads page') },
    onError: () => toast.error('Failed to update status'),
  })

  const createSubStatus = useMutation({
    mutationFn: () => leadConfigApi.createSubStatus({
      subStatus: subStatusForm.subStatus,
      subStatusSlug: slugify(subStatusForm.subStatus),
      statusId: Number(subStatusForm.statusId),
      moveTo: subStatusForm.moveTo ? Number(subStatusForm.moveTo) : null,
      statusLeadTypeId: subStatusForm.statusLeadTypeId ? Number(subStatusForm.statusLeadTypeId) : null,
    }),
    onSuccess: () => { invalidate(); setSubStatusForm({ subStatus: '', statusId: '', moveTo: '', statusLeadTypeId: '' }); toast.success('Sub-status created') },
    onError: () => toast.error('Failed — select a parent status'),
  })
  const updateSubStatus = useMutation({
    mutationFn: () => leadConfigApi.updateSubStatus(editing!.id, {
      subStatus: subStatusForm.subStatus,
      subStatusSlug: slugify(subStatusForm.subStatus),
      moveTo: subStatusForm.moveTo ? Number(subStatusForm.moveTo) : null,
      statusLeadTypeId: subStatusForm.statusLeadTypeId ? Number(subStatusForm.statusLeadTypeId) : null,
    }),
    onSuccess: () => { invalidate(); cancelEdit(); toast.success('Sub-status updated') },
    onError: () => toast.error('Failed to update'),
  })
  const deleteSubStatus = useMutation({
    mutationFn: (id: number) => leadConfigApi.deleteSubStatus(id),
    onSuccess: () => { invalidate(); toast.success('Deleted') },
    onError: () => toast.error('Cannot delete — may be in use'),
  })

  const createFollowup = useMutation({
    mutationFn: () => leadConfigApi.createFollowupStatus({ status: followupForm.status }),
    onSuccess: () => { invalidate(); setFollowupForm({ status: '' }); toast.success('Followup status created') },
    onError: () => toast.error('Failed to create'),
  })
  const updateFollowup = useMutation({
    mutationFn: () => leadConfigApi.updateFollowupStatus(editing!.id, { status: followupForm.status }),
    onSuccess: () => { invalidate(); cancelEdit(); toast.success('Updated') },
    onError: () => toast.error('Failed to update'),
  })
  const deleteFollowup = useMutation({
    mutationFn: (id: number) => {
      // Use patch to "soft disable" since there's no delete endpoint; or call the existing API
      return leadConfigApi.updateFollowupStatus(id, { status: '' })
    },
    onSuccess: () => { invalidate(); toast.success('Deleted') },
    onError: () => toast.error('Cannot delete'),
  })

  // ── Reorder ──
  const reorderDepts = useMutation({
    mutationFn: (items: { id: number; priority: number }[]) => leadConfigApi.reorderDepartments(items),
    onSuccess: invalidate,
    onError: () => toast.error('Reorder failed'),
  })
  const reorderTypes = useMutation({
    mutationFn: (items: { id: number; priority: number }[]) => leadConfigApi.reorderTypes(items),
    onSuccess: invalidate,
    onError: () => toast.error('Reorder failed'),
  })
  const reorderStatuses = useMutation({
    mutationFn: (items: { id: number; priority: number }[]) => leadConfigApi.reorderStatuses(items),
    onSuccess: invalidate,
    onError: () => toast.error('Reorder failed'),
  })

  // ── Helpers ──
  function cancelEdit() {
    setEditing(null)
    setDeptForm({ name: '' })
    setTypeForm({ title: '', departmentId: '' })
    setStatusForm({ title: '', departmentId: '' })
    setSubStatusForm({ subStatus: '', statusId: '', moveTo: '', statusLeadTypeId: '' })
    setFollowupForm({ status: '' })
  }

  function startEditDept(d: WfDepartment) {
    setEditing({ type: 'department', id: d.id })
    setDeptForm({ name: d.name })
    setActiveForm('department')
  }
  function startEditType(t: WfLeadType) {
    setEditing({ type: 'type', id: t.id })
    setTypeForm({ title: t.title, departmentId: t.departmentId ? String(t.departmentId) : '' })
    setActiveForm('type')
  }
  function startEditStatus(s: WfStatus) {
    setEditing({ type: 'status', id: s.id })
    setStatusForm({ title: s.title, departmentId: String(s.departmentId) })
    setActiveForm('status')
  }
  function startEditSubStatus(ss: WfSubStatus) {
    setEditing({ type: 'substatus', id: ss.id })
    setSubStatusForm({
      subStatus: ss.subStatus,
      statusId: String(ss.statusId),
      moveTo: ss.moveTo != null ? String(ss.moveTo) : '',
      statusLeadTypeId: ss.statusLeadTypeId != null ? String(ss.statusLeadTypeId) : '',
    })
    setActiveForm('substatus')
  }
  function startEditFollowup(f: WfFollowup) {
    setEditing({ type: 'followup', id: f.id })
    setFollowupForm({ status: f.status })
    setActiveForm('followup')
  }

  function addTypeToDept(deptId: number) {
    cancelEdit()
    setTypeForm({ title: '', departmentId: String(deptId) })
    setActiveForm('type')
    setExpandedDepts((s) => new Set(s).add(deptId))
  }
  function addSubStatusTo(statusId: number) {
    cancelEdit()
    setSubStatusForm({ subStatus: '', statusId: String(statusId), moveTo: '', statusLeadTypeId: '' })
    setActiveForm('substatus')
    setExpandedStatuses((s) => new Set(s).add(statusId))
  }

  function toggleDept(id: number) {
    setExpandedDepts((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleStatus(id: number) {
    setExpandedStatuses((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function moveDept(deptId: number, dir: -1 | 1) {
    if (!wf) return
    const arr = [...wf.departments]
    const idx = arr.findIndex((d) => d.id === deptId)
    if (idx < 0 || (dir === -1 && idx === 0) || (dir === 1 && idx === arr.length - 1)) return
    ;[arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]]
    reorderDepts.mutate(arr.map((d, i) => ({ id: d.id, priority: i })))
  }

  function moveType(deptId: number, typeId: number, dir: -1 | 1) {
    if (!wf) return
    const dept = wf.departments.find((d) => d.id === deptId)
    if (!dept) return
    const arr = [...dept.leadTypes]
    const idx = arr.findIndex((t) => t.id === typeId)
    if (idx < 0 || (dir === -1 && idx === 0) || (dir === 1 && idx === arr.length - 1)) return
    ;[arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]]
    reorderTypes.mutate(arr.map((t, i) => ({ id: t.id, priority: i })))
  }

  function moveStatus(statusId: number, dir: -1 | 1) {
    if (!wf) return
    const arr = [...wf.statuses]
    const idx = arr.findIndex((s) => s.id === statusId)
    if (idx < 0 || (dir === -1 && idx === 0) || (dir === 1 && idx === arr.length - 1)) return
    ;[arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]]
    reorderStatuses.mutate(arr.map((s, i) => ({ id: s.id, priority: i })))
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (activeForm === 'department') {
      if (!deptForm.name.trim()) return
      editing?.type === 'department' ? updateDept.mutate() : createDept.mutate()
    } else if (activeForm === 'type') {
      if (!typeForm.title.trim()) return
      editing?.type === 'type' ? updateType.mutate() : createType.mutate()
    } else if (activeForm === 'status') {
      if (!statusForm.title.trim() || !statusForm.departmentId) return
      editing?.type === 'status' ? updateStatus.mutate() : createStatus.mutate()
    } else if (activeForm === 'substatus') {
      if (!subStatusForm.subStatus.trim() || !subStatusForm.statusId) return
      editing?.type === 'substatus' ? updateSubStatus.mutate() : createSubStatus.mutate()
    } else if (activeForm === 'followup') {
      if (!followupForm.status.trim()) return
      editing?.type === 'followup' ? updateFollowup.mutate() : createFollowup.mutate()
    }
  }

  // ── Delete confirm ──
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: number; name: string } | null>(null)
  function confirmDelete() {
    if (!deleteConfirm) return
    const { type, id } = deleteConfirm
    if (type === 'department') deleteDept.mutate(id)
    else if (type === 'type') deleteType.mutate(id)
    else if (type === 'status') deleteStatus.mutate(id)
    else if (type === 'substatus') deleteSubStatus.mutate(id)
    else if (type === 'followup') deleteFollowup.mutate(id)
    setDeleteConfirm(null)
  }

  const departments = wf?.departments ?? []
  const statuses = wf?.statuses ?? []
  const followupStatuses = wf?.followupStatuses ?? []

  const totalTypes = departments.reduce((sum, d) => sum + d.leadTypes.length, 0)
  const totalSubs = statuses.reduce((sum, s) => sum + s.subStatuses.length, 0)

  // Lookups for resolving sub-status "Move To" routing ids → human names.
  const deptName = (id: number | null) =>
    id == null ? null : departments.find((d) => d.id === id)?.name ?? `#${id}`
  const allLeadTypes = [...departments.flatMap((d) => d.leadTypes), ...(wf?.unlinkedTypes ?? [])]
  const leadTypeName = (id: number | null) =>
    id == null ? null : allLeadTypes.find((t) => t.id === id)?.title ?? `#${id}`

  // Lookup map for backward-direction detection. A sub-status is "backward"
  // when its target department has a LOWER pipeline priority than the parent
  // status's department — counsellors are blocked from those moves (the new
  // pipeline guard), so admins should be aware.
  // Slugs for side-branches / archive are excluded from the check (they're
  // not on the linear pipeline).
  const SIDE_BRANCH_SLUGS = new Set(['marketing', 'consultant', 'archive'])
  const deptById = new Map(departments.map((d) => [d.id, d]))
  function isBackwardSubStatus(parentStatusDeptId: number, targetDeptId: number | null): boolean {
    if (!targetDeptId || parentStatusDeptId === targetDeptId) return false
    const from = deptById.get(parentStatusDeptId)
    const to = deptById.get(targetDeptId)
    if (!from || !to) return false
    if (SIDE_BRANCH_SLUGS.has(from.slug) || SIDE_BRANCH_SLUGS.has(to.slug)) return false
    return to.priority < from.priority
  }

  // Flat list of every sub-status across all statuses (old-CRM "Sub Status List").
  // Each row carries its parent status title + source department for context.
  const flatSubStatuses = statuses.flatMap((s) =>
    s.subStatuses.map((ss) => ({
      ...ss,
      statusTitle: s.title,
      statusDisabled: s.status === 0,
      sourceDeptName: deptName(s.departmentId),
      moveDeptName: deptName(ss.moveTo),
      moveTypeName: leadTypeName(ss.statusLeadTypeId),
      isBackward: isBackwardSubStatus(s.departmentId, ss.moveTo),
    }))
  )
  const backwardSubStatuses = flatSubStatuses.filter((r) => r.isBackward)
  const subStatusQuery = subStatusSearch.trim().toLowerCase()
  const filteredSubStatuses = subStatusQuery
    ? flatSubStatuses.filter((r) =>
        [r.subStatus, r.statusTitle, r.sourceDeptName, r.moveDeptName, r.moveTypeName]
          .some((v) => v?.toLowerCase().includes(subStatusQuery))
      )
    : flatSubStatuses

  return (
    <div className="space-y-6">
      {/* ═══════ HEADER ═══════ */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <Layers className="h-5 w-5 text-white" />
            </div>
            Lead Workflow
          </h1>
          <p className="text-sm text-muted-foreground mt-1 ml-[46px]">
            Manage your lead pipeline — departments, types, statuses & sub-statuses
          </p>
        </div>
      </div>

      {/* ═══════ STATS ROW ═══════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Departments', count: departments.length, icon: Building2, color: 'from-blue-500 to-blue-600', light: 'bg-blue-50', text: 'text-blue-700' },
          { label: 'Lead Types', count: totalTypes, icon: Tag, color: 'from-violet-500 to-violet-600', light: 'bg-violet-50', text: 'text-violet-700' },
          { label: 'Statuses', count: statuses.length, icon: GitBranch, color: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-700' },
          { label: 'Sub-Statuses', count: totalSubs, icon: CircleDot, color: 'from-amber-500 to-amber-600', light: 'bg-amber-50', text: 'text-amber-700' },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border rounded-xl p-4 flex items-center gap-3.5 hover:shadow-md transition-shadow">
            <div className={`h-10 w-10 rounded-xl ${stat.light} flex items-center justify-center shrink-0`}>
              <stat.icon className={`h-5 w-5 ${stat.text}`} />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight">{stat.count}</div>
              <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* ═══════ LEFT: FORM PANEL ═══════ */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b bg-gradient-to-r from-primary/5 to-transparent">
              <h3 className="text-sm font-bold flex items-center gap-2">
                {editing ? <Pencil className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4 text-primary" />}
                {editing ? `Edit ${activeForm}` : `Add New`}
              </h3>
            </div>

            {/* Tabs */}
            <div className="flex border-b overflow-x-auto">
              {([
                { id: 'department' as FormTab, label: 'Dept', icon: Building2 },
                { id: 'type' as FormTab, label: 'Type', icon: Tag },
                { id: 'status' as FormTab, label: 'Status', icon: GitBranch },
                { id: 'substatus' as FormTab, label: 'Sub', icon: CircleDot },
                { id: 'followup' as FormTab, label: 'F/Up', icon: Activity },
              ]).map((t) => (
                <button key={t.id} onClick={() => { setActiveForm(t.id); if (editing?.type !== t.id) cancelEdit() }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-all whitespace-nowrap relative ${activeForm === t.id ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
                  <t.icon className="h-3.5 w-3.5" /> {t.label}
                  {activeForm === t.id && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="p-5 space-y-4">
              {activeForm === 'department' && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Department Name</label>
                  <input value={deptForm.name} onChange={(e) => setDeptForm({ name: e.target.value })}
                    className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    placeholder="e.g. Tele Calling Dept" required />
                </div>
              )}

              {activeForm === 'type' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Parent Department</label>
                    <select value={typeForm.departmentId} onChange={(e) => setTypeForm((f) => ({ ...f, departmentId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" required>
                      <option value="">Select Department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Lead Type Name</label>
                    <input value={typeForm.title} onChange={(e) => setTypeForm((f) => ({ ...f, title: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                      placeholder="e.g. Greetings, Cold Leads" required />
                  </div>
                </>
              )}

              {activeForm === 'status' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Department</label>
                    <select value={statusForm.departmentId} onChange={(e) => setStatusForm((f) => ({ ...f, departmentId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" required>
                      <option value="">Select Department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Status Name</label>
                    <input value={statusForm.title} onChange={(e) => setStatusForm((f) => ({ ...f, title: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                      placeholder="e.g. Call Answered, Counselling" required />
                  </div>
                </>
              )}

              {activeForm === 'substatus' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Parent Status</label>
                    <select value={subStatusForm.statusId} onChange={(e) => setSubStatusForm((f) => ({ ...f, statusId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" required>
                      <option value="">Select Status</option>
                      {statuses.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Sub-Status Name</label>
                    <input value={subStatusForm.subStatus} onChange={(e) => setSubStatusForm((f) => ({ ...f, subStatus: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                      placeholder="e.g. Interested, Not Interested" required />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Move To (Department)</label>
                    <select value={subStatusForm.moveTo} onChange={(e) => setSubStatusForm((f) => ({ ...f, moveTo: e.target.value, statusLeadTypeId: '' }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all">
                      <option value="">— None —</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Move To (Lead Type)</label>
                    <select value={subStatusForm.statusLeadTypeId} onChange={(e) => setSubStatusForm((f) => ({ ...f, statusLeadTypeId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all">
                      <option value="">— None —</option>
                      {(() => {
                        const deptId = subStatusForm.moveTo ? Number(subStatusForm.moveTo) : null;
                        const leadTypesToShow = deptId 
                          ? departments.find(d => d.id === deptId)?.leadTypes ?? []
                          : allLeadTypes;
                        return leadTypesToShow.map((t) => <option key={t.id} value={t.id}>{t.title}</option>);
                      })()}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">When a lead moves to this sub-status, it routes to this department &amp; lead type — like the old CRM.</p>
                  </div>
                </>
              )}

              {activeForm === 'followup' && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Followup Status Name</label>
                  <input value={followupForm.status} onChange={(e) => setFollowupForm({ status: e.target.value })}
                    className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    placeholder="e.g. Callback Scheduled" required />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button type="submit"
                  className="flex-1 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground font-semibold py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-sm shadow-primary/20">
                  {editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {editing ? 'Update' : 'Create'}
                </button>
                {editing && (
                  <button type="button" onClick={cancelEdit}
                    className="px-4 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold rounded-lg text-sm transition-all">
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Quick guide */}
          <div className="bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent border border-primary/15 p-4 rounded-xl text-sm">
            <p className="font-bold mb-2 flex items-center gap-2 text-sm">
              <Hash className="h-4 w-4 text-primary" /> Quick Guide
            </p>
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <div className="flex gap-2">
                <div className="h-5 w-5 rounded bg-blue-100 flex items-center justify-center shrink-0 mt-0.5"><Building2 className="h-3 w-3 text-blue-600" /></div>
                <span><strong className="text-foreground">Departments</strong> — top-level tabs on Leads page</span>
              </div>
              <div className="flex gap-2">
                <div className="h-5 w-5 rounded bg-violet-100 flex items-center justify-center shrink-0 mt-0.5"><Tag className="h-3 w-3 text-violet-600" /></div>
                <span><strong className="text-foreground">Lead Types</strong> — filter tabs within each department</span>
              </div>
              <div className="flex gap-2">
                <div className="h-5 w-5 rounded bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5"><GitBranch className="h-3 w-3 text-emerald-600" /></div>
                <span><strong className="text-foreground">Statuses</strong> — track lead progress in the pipeline</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════ RIGHT: WORKFLOW TREE ═══════ */}
        <div className="lg:col-span-8 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 bg-card border rounded-xl">
              <div className="text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground">Loading workflow...</p>
              </div>
            </div>
          ) : (
            <>
              {/* ── SECTION 1: Department Pipeline ── */}
              <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b bg-gradient-to-r from-blue-50/80 to-transparent flex items-center justify-between">
                  <span className="text-sm font-bold flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-blue-600" />
                    </div>
                    Department Pipeline
                    <span className="ml-1 px-2 py-0.5 text-xs font-bold bg-blue-100 text-blue-700 rounded-full">{departments.length}</span>
                  </span>
                  <span className="text-xs text-muted-foreground hidden sm:block">Departments & their lead type filters</span>
                </div>

                {departments.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                      <Building2 className="h-7 w-7 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">No departments yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Use the form to add your first department</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {departments.map((dept, dIdx) => {
                      const isExpanded = expandedDepts.has(dept.id)
                      const color = getDeptColor(dIdx)
                      return (
                        <div key={dept.id}>
                          {/* Dept row */}
                          <div className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-all cursor-pointer group ${isExpanded ? `${color.light}/50` : ''}`}
                            onClick={() => toggleDept(dept.id)}>
                            {/* Reorder */}
                            <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => moveDept(dept.id, -1)} disabled={dIdx === 0}
                                className="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 transition-colors">
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button onClick={() => moveDept(dept.id, 1)} disabled={dIdx === departments.length - 1}
                                className="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 transition-colors">
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>

                            {/* Color dot + badge */}
                            <div className={`w-8 h-8 rounded-lg ${color.light} ${color.border} border flex items-center justify-center text-xs font-bold shrink-0 ${color.text}`}>
                              {dIdx + 1}
                            </div>

                            {/* Left color bar indicator */}
                            <div className={`w-1 h-8 rounded-full ${color.bg} shrink-0 opacity-60`} />

                            {/* Name + count */}
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-sm">{dept.name}</span>
                              {dept.leadTypes.length > 0 && (
                                <span className={`ml-2 px-2 py-0.5 text-[10px] font-bold ${color.light} ${color.text} rounded-full`}>
                                  {dept.leadTypes.length} type{dept.leadTypes.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => addTypeToDept(dept.id)} title="Add Lead Type"
                                className={`p-1.5 ${color.text} hover:${color.light} rounded-lg transition-colors`}>
                                <Plus className="h-4 w-4" />
                              </button>
                              <button onClick={() => startEditDept(dept)} title="Edit"
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setDeleteConfirm({ type: 'department', id: dept.id, name: dept.name })} title="Delete"
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* Chevron */}
                            <div className={`shrink-0 transition-transform ${isExpanded ? 'rotate-0' : ''}`}>
                              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </div>

                          {/* Lead Types */}
                          {isExpanded && (
                            <div className={`border-t ${color.light}/30`}>
                              {dept.leadTypes.length === 0 ? (
                                <div className="flex items-center gap-2 px-4 py-3 pl-[72px]">
                                  <span className="text-xs text-muted-foreground italic">No lead types yet.</span>
                                  <button onClick={() => addTypeToDept(dept.id)}
                                    className={`text-xs font-semibold ${color.text} hover:underline`}>
                                    + Add one
                                  </button>
                                </div>
                              ) : (
                                dept.leadTypes.map((lt, tIdx) => (
                                  <div key={lt.id}
                                    className="flex items-center gap-3 px-4 py-2.5 pl-[72px] border-t border-dashed hover:bg-muted/20 transition-colors group/item">
                                    {/* Reorder */}
                                    <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                      <button onClick={() => moveType(dept.id, lt.id, -1)} disabled={tIdx === 0}
                                        className="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 transition-colors">
                                        <ArrowUp className="h-2.5 w-2.5" />
                                      </button>
                                      <button onClick={() => moveType(dept.id, lt.id, 1)} disabled={tIdx === dept.leadTypes.length - 1}
                                        className="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 transition-colors">
                                        <ArrowDown className="h-2.5 w-2.5" />
                                      </button>
                                    </div>
                                    <div className={`w-2 h-2 rounded-full ${color.dot} opacity-40 shrink-0`} />
                                    <Tag className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                    <span className="flex-1 text-sm">{lt.title}</span>
                                    <span className="text-[10px] text-muted-foreground/50 font-mono">#{lt.id}</span>
                                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                      <button onClick={() => startEditType(lt)}
                                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button onClick={() => setDeleteConfirm({ type: 'type', id: lt.id, name: lt.title })}
                                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── SECTION 2: Status Workflow ── */}
              <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b bg-gradient-to-r from-emerald-50/80 to-transparent flex items-center justify-between">
                  <span className="text-sm font-bold flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <GitBranch className="h-4 w-4 text-emerald-600" />
                    </div>
                    Status Workflow
                    <span className="ml-1 px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-full">{statuses.length}</span>
                  </span>
                  <span className="text-xs text-muted-foreground hidden sm:block">Lead statuses & their sub-statuses</span>
                </div>

                {statuses.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                      <GitBranch className="h-7 w-7 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">No statuses yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Use the form to add your first status</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {statuses.map((status, sIdx) => {
                      const isExpanded = expandedStatuses.has(status.id)
                      const isDisabled = status.status === 0
                      const deptIdx = departments.findIndex((d) => d.id === status.departmentId)
                      const deptDisplayName = deptIdx >= 0 ? departments[deptIdx].name : null
                      const deptColor = deptIdx >= 0 ? getDeptColor(deptIdx) : null
                      return (
                        <div key={status.id}>
                          {/* Status row */}
                          <div className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-all cursor-pointer group ${isExpanded ? 'bg-emerald-50/30' : ''} ${isDisabled ? 'opacity-55' : ''}`}
                            onClick={() => toggleStatus(status.id)}>
                            {/* Reorder */}
                            <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => moveStatus(status.id, -1)} disabled={sIdx === 0}
                                className="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 transition-colors">
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button onClick={() => moveStatus(status.id, 1)} disabled={sIdx === statuses.length - 1}
                                className="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 transition-colors">
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>

                            {/* Number */}
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">
                              {sIdx + 1}
                            </div>

                            {/* Name + dept badge + count */}
                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold text-sm ${isDisabled ? 'text-muted-foreground line-through decoration-muted-foreground/40' : ''}`}>{status.title}</span>
                              {isDisabled && (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border rounded-full uppercase tracking-wider">
                                  Disabled
                                </span>
                              )}
                              {deptDisplayName && deptColor && (
                                <span className={`px-2 py-0.5 text-[10px] font-bold ${deptColor.light} ${deptColor.text} ${deptColor.border} border rounded-full uppercase tracking-wider`}>
                                  {deptDisplayName}
                                </span>
                              )}
                              {status.subStatuses.length > 0 && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded">
                                  {status.subStatuses.length} sub
                                </span>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => toggleStatusActive.mutate({ id: status.id, active: isDisabled })}
                                title={isDisabled ? 'Enable (show on leads page)' : 'Disable (hide from leads page)'}
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                                {isDisabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                              <button onClick={() => addSubStatusTo(status.id)} title="Add Sub-Status"
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Plus className="h-4 w-4" />
                              </button>
                              <button onClick={() => startEditStatus(status)} title="Edit"
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setDeleteConfirm({ type: 'status', id: status.id, name: status.title })} title="Delete"
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* Chevron */}
                            <div className="shrink-0">
                              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </div>

                          {/* Sub-statuses */}
                          {isExpanded && (
                            <div className="border-t bg-emerald-50/20">
                              {status.subStatuses.length === 0 ? (
                                <div className="flex items-center gap-2 px-4 py-3 pl-[72px]">
                                  <span className="text-xs text-muted-foreground italic">No sub-statuses yet.</span>
                                  <button onClick={() => addSubStatusTo(status.id)}
                                    className="text-xs font-semibold text-emerald-600 hover:underline">
                                    + Add one
                                  </button>
                                </div>
                              ) : (
                                status.subStatuses.map((ss) => {
                                  const moveDept = deptName(ss.moveTo)
                                  const moveType = leadTypeName(ss.statusLeadTypeId)
                                  return (
                                  <div key={ss.id}
                                    className="flex items-center gap-3 px-4 py-2.5 pl-[72px] border-t border-dashed hover:bg-muted/20 transition-colors group/item">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 opacity-40 shrink-0" />
                                    <CircleDot className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                    <span className="flex-1 min-w-0 text-sm truncate">{ss.subStatus}</span>
                                    {/* Move To (Department) */}
                                    <span className="hidden md:flex items-center gap-1 shrink-0 w-40">
                                      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">→ Dept</span>
                                      {moveDept
                                        ? <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-full truncate">{moveDept}</span>
                                        : <span className="text-[11px] text-muted-foreground/30 italic">—</span>}
                                    </span>
                                    {/* Move To (Lead Type) */}
                                    <span className="hidden md:flex items-center gap-1 shrink-0 w-40">
                                      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">→ Type</span>
                                      {moveType
                                        ? <span className="px-2 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full truncate">{moveType}</span>
                                        : <span className="text-[11px] text-muted-foreground/30 italic">—</span>}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/50 font-mono">#{ss.id}</span>
                                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                      <button onClick={() => startEditSubStatus(ss)}
                                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button onClick={() => setDeleteConfirm({ type: 'substatus', id: ss.id, name: ss.subStatus })}
                                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                  )
                                })
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── SECTION 3: Followup Statuses ── */}
              <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b bg-gradient-to-r from-amber-50/80 to-transparent flex items-center justify-between">
                  <span className="text-sm font-bold flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Activity className="h-4 w-4 text-amber-600" />
                    </div>
                    Follow-up Statuses
                    <span className="ml-1 px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-700 rounded-full">{followupStatuses.length}</span>
                  </span>
                </div>
                {followupStatuses.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                      <Activity className="h-7 w-7 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">No followup statuses yet</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {followupStatuses.map((f, fIdx) => (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors group">
                        <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                          {fIdx + 1}
                        </div>
                        <div className="w-2 h-2 rounded-full bg-amber-400 opacity-50 shrink-0" />
                        <span className="flex-1 text-sm font-medium">{f.status}</span>
                        {f.shortnote && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{f.shortnote}</span>}
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditFollowup(f)}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── SECTION 4: Sub-Status List (flat routing map, old-CRM style) ── */}
              <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                {/* Backward-direction banner — counsellors are blocked from
                    these via the pipeline guard; admins can still apply them.
                    Surfacing the count here lets admins decide whether to
                    keep, retarget, or delete. */}
                {backwardSubStatuses.length > 0 && (
                  <div className="px-5 py-2.5 border-b bg-amber-50 text-amber-900 text-xs flex items-start gap-2">
                    <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 rotate-180" />
                    <span>
                      <strong>{backwardSubStatuses.length}</strong> sub-status
                      {backwardSubStatuses.length === 1 ? ' moves' : 'es move'} a lead
                      backward through the pipeline ({backwardSubStatuses.map((b) => b.subStatus).join(', ')}).
                      Counsellors are blocked from these; only admins can apply.
                    </span>
                  </div>
                )}
                <div className="px-5 py-3.5 border-b bg-gradient-to-r from-indigo-50/80 to-transparent flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span className="text-sm font-bold flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                      <ListTree className="h-4 w-4 text-indigo-600" />
                    </div>
                    Sub Status List
                    <span className="ml-1 px-2 py-0.5 text-xs font-bold bg-indigo-100 text-indigo-700 rounded-full">{filteredSubStatuses.length}</span>
                  </span>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <input
                      value={subStatusSearch}
                      onChange={(e) => setSubStatusSearch(e.target.value)}
                      placeholder="Search sub-status, status, department…"
                      className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    />
                  </div>
                </div>

                {filteredSubStatuses.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                      <ListTree className="h-7 w-7 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {subStatusQuery ? 'No sub-statuses match your search' : 'No sub-statuses yet'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-left">
                          <th className="px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide w-12">#</th>
                          <th className="px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Sub Status</th>
                          <th className="px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Move To (Department)</th>
                          <th className="px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Move To (Lead Type)</th>
                          <th className="px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide text-right w-24">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredSubStatuses.map((r, idx) => (
                          <tr key={r.id} className={`hover:bg-muted/20 transition-colors group ${r.statusDisabled ? 'opacity-55' : ''}`}>
                            <td className="px-4 py-2.5 text-muted-foreground/60 font-mono text-xs align-top">{idx + 1}</td>
                            <td className="px-4 py-2.5 align-top">
                              <div className="font-medium">{r.subStatus}</div>
                              <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                                <span className="font-semibold">Status:</span> {r.statusTitle}
                                {r.statusDisabled && <span className="ml-1 px-1 py-0.5 text-[9px] font-bold bg-muted text-muted-foreground rounded uppercase">disabled</span>}
                                <br />
                                <span className="font-semibold">Department:</span> {r.sourceDeptName ?? '—'}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              {/* No "Move To" mapping = the sub-status keeps the lead in
                                  its current department (in-dept transition). That's
                                  intentional, not a misconfiguration — render an
                                  explanatory pill instead of an ambiguous "—". */}
                              {r.moveDeptName
                                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-full"><ArrowRight className="h-3 w-3" />{r.moveDeptName}</span>
                                : <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-500 border border-slate-200 rounded-full" title="No department change — lead stays in its current department">Stay in dept</span>}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              {r.moveTypeName
                                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full"><ArrowRight className="h-3 w-3" />{r.moveTypeName}</span>
                                : <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-500 border border-slate-200 rounded-full" title="No bucket change — lead keeps its current lead-type tab">Keep bucket</span>}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEditSubStatus(r)} title="Edit"
                                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => setDeleteConfirm({ type: 'substatus', id: r.id, name: r.subStatus })} title="Delete"
                                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══════ DELETE CONFIRMATION ═══════ */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-card border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Delete {deleteConfirm.type}?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Are you sure you want to delete <strong className="text-foreground">{deleteConfirm.name}</strong>? This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-5 py-2.5 text-sm border rounded-lg hover:bg-accent font-medium transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete}
                className="px-5 py-2.5 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 font-semibold shadow-sm transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
