import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Download, FilterX, FileSpreadsheet, Trash2, ChevronRight, CheckCircle2, XCircle, Sprout, UserPlus, UserCog, Search, Loader2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { leadStagingApi, usersApi, type LeadStagingBatch, type LeadStagingUploadRow } from '@/lib/api'
import { downloadTemplate, parseLeadExcel } from '@/lib/lead-upload'
import { Modal } from '@/components/common/Modal'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

interface Counsellor { id: number; name: string; role: string; email?: string }

export default function FilterLeads() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingRows, setPendingRows] = useState<LeadStagingUploadRow[]>([])

  // Counsellors see only their assigned batches (the backend filters the list
  // for them). They cannot upload, assign, delete, or unassign — the controls
  // below are gated on this flag.
  const isAdmin = useAuthStore((s) => s.isAdmin())

  const { data: batches = [], isLoading } = useQuery<LeadStagingBatch[]>({
    queryKey: ['lead-staging', { trash: false }],
    queryFn: () => leadStagingApi.list(),
  })

  // Counsellors don't need the assignee dropdown (everything they see is
  // already theirs), so skip the network call for them.
  const { data: counsellors = [] } = useQuery<Counsellor[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: () => usersApi.counsellors(),
    enabled: isAdmin,
  })

  // Filter state — `assigneeFilter` is one of: 'all', 'unassigned', or the
  // counsellor's user id as a string. Plus a free-text search over batch name.
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [batchSearch, setBatchSearch] = useState('')
  const [excludeMode, setExcludeMode] = useState(false)

  const filteredBatches = useMemo(() => {
    // In exclude mode "matches the filter" → drop. 'all' is the neutral
    // assignee state and is never inverted.
    const reject = (matches: boolean) => (excludeMode ? matches : !matches)
    return batches.filter((b) => {
      if (assigneeFilter === 'unassigned') {
        if (reject(b.assignees.length === 0)) return false
      } else if (assigneeFilter !== 'all') {
        if (reject(b.assignees.some((a) => String(a.id) === assigneeFilter))) return false
      }
      if (batchSearch.trim()) {
        const q = batchSearch.toLowerCase()
        const names = b.assignees.map((a) => a.name).join(' ')
        const hay = `${b.name} ${b.fileName ?? ''} ${names}`.toLowerCase()
        if (reject(hay.includes(q))) return false
      }
      return true
    })
  }, [batches, assigneeFilter, batchSearch, excludeMode])

  // Quick stats for the filter bar — how many batches are assigned vs not.
  const assignedCount = useMemo(
    () => batches.filter((b) => b.assignees.length > 0).length,
    [batches],
  )
  const unassignedCount = batches.length - assignedCount

  const createMut = useMutation({
    mutationFn: leadStagingApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-staging'] })
      toast.success('Batch uploaded')
      resetUpload()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Upload failed'),
  })

  // Soft delete — sends the batch to the unified Trash (/app/trash > Folders).
  // The batch + its items stay in the DB until permanently deleted from there.
  const deleteMut = useMutation({
    mutationFn: leadStagingApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-staging'] })
      toast.success('Moved to Trash — restore from sidebar > Trash > Folders')
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move to trash'),
  })

  const assignMut = useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) =>
      leadStagingApi.assign(id, userIds),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['lead-staging'] })
      toast.success(
        vars.userIds.length === 0
          ? 'All counsellors removed'
          : `Assigned to ${vars.userIds.length} counsellor${vars.userIds.length === 1 ? '' : 's'}`,
      )
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update assignment'),
  })

  const [assignTarget, setAssignTarget] = useState<LeadStagingBatch | null>(null)

  function resetUpload() {
    setUploadOpen(false)
    setBatchName('')
    setPendingFile(null)
    setPendingRows([])
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleFile(file: File) {
    setPendingFile(file)
    try {
      const rows = await parseLeadExcel(file)
      if (rows.length === 0) {
        toast.error('No valid rows found. The sheet needs at least a Name / Email / Mobile column.')
        setPendingRows([])
        return
      }
      setPendingRows(rows)
    } catch {
      toast.error('Could not parse the Excel file')
      setPendingRows([])
    }
  }

  function submitUpload() {
    const name = batchName.trim()
    if (!name) return toast.error('Please name this batch (this becomes the lead source)')
    if (pendingRows.length === 0) return toast.error('Pick an Excel file first')
    createMut.mutate({
      name,
      fileName: pendingFile?.name,
      items: pendingRows,
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FilterX className="h-6 w-6 text-primary" />
            Filter Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'Bulk-upload purchased leads, verify them, then seed the good ones into the CRM.'
              : 'Batches assigned to you — verify each lead, then seed the verified ones into your "My Leads".'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={downloadTemplate}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-accent text-sm font-medium"
            >
              <Download className="h-4 w-4" /> Download Template
            </button>
            <button
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
            >
              <Upload className="h-4 w-4" /> Bulk Upload
            </button>
          </div>
        )}
      </div>

      {/* Filter bar — assignee dropdown (admin only) + batch-name search */}
      {batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-card">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <label className="text-xs font-medium text-muted-foreground">Assigned to</label>
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border bg-background text-sm font-medium min-w-[180px]"
              >
                <option value="all">All ({batches.length})</option>
                <option value="unassigned">Unassigned ({unassignedCount})</option>
                {assignedCount > 0 && (
                  <optgroup label={`Counsellors (${assignedCount} batch${assignedCount === 1 ? '' : 'es'} assigned)`}>
                    {counsellors
                      .filter((c) => batches.some((b) => b.assignees.some((a) => a.id === c.id)))
                      .map((c) => {
                        const count = batches.filter((b) => b.assignees.some((a) => a.id === c.id)).length
                        return (
                          <option key={c.id} value={String(c.id)}>
                            {c.name} ({count})
                          </option>
                        )
                      })}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          <div className="relative ml-auto">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={batchSearch}
              onChange={(e) => setBatchSearch(e.target.value)}
              placeholder="Search batch name / file / counsellor"
              className="pl-8 pr-3 py-1.5 rounded-lg border bg-background text-sm w-72"
            />
          </div>
          <FilterModeToggle excludeMode={excludeMode} onChange={setExcludeMode} label="" />

          {(assigneeFilter !== 'all' || batchSearch || excludeMode) && (
            <button
              onClick={() => { setAssigneeFilter('all'); setBatchSearch(''); setExcludeMode(false) }}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <FilterX className="h-3 w-3" /> Clear filters
            </button>
          )}
        </div>
      )}

      {/* Batches list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="border rounded-2xl p-10 text-center bg-card">
          <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <h3 className="mt-3 font-semibold">No batches yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'Download the template, fill it with leads, then upload it here.'
              : 'Nothing has been assigned to you yet. Once an admin assigns a batch, it will appear here.'}
          </p>
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="border rounded-2xl p-10 text-center bg-card text-sm text-muted-foreground">
          No batches match this filter.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredBatches.map((b) => {
            const pending = b.totalCount - (b.verifiedCount + b.rejectedCount)
            return (
              <div
                key={b.id}
                className="border rounded-xl bg-card p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{b.name}</h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {b.fileName || '—'} · {new Date(b.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm(`Move "${b.name}" to Trash? You can restore it later from Sidebar > Trash > Folders.`)) {
                          deleteMut.mutate(b.id)
                        }
                      }}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Move to Trash"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <Stat label="Total" value={b.totalCount} />
                  <Stat label="Verified" value={b.verifiedCount} tone="green" />
                  <Stat label="Rejected" value={b.rejectedCount} tone="red" />
                  <Stat label="Seeded" value={b.seededCount} tone="blue" />
                </div>
                {pending > 0 && (
                  <p className="text-[11px] text-amber-600 mt-2">
                    {pending} pending verification
                  </p>
                )}

                {/* Assignment row — admins see chips + a single "Manage" button
                    that opens the checkbox modal; counsellors don't need it
                    since the list is already scoped to batches assigned to
                    them. */}
                {isAdmin && (
                  <div className="mt-3 px-2.5 py-2 rounded-lg border bg-muted/30">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-muted-foreground">
                        Assigned to {b.assignees.length > 0 ? `(${b.assignees.length})` : ''}
                      </div>
                      <button
                        onClick={() => setAssignTarget(b)}
                        disabled={assignMut.isPending}
                        className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded text-primary hover:bg-primary/10"
                        title={b.assignees.length > 0 ? 'Manage assignees' : 'Assign'}
                      >
                        {b.assignees.length > 0 ? (
                          <><UserCog className="h-3 w-3" /> Manage</>
                        ) : (
                          <><UserPlus className="h-3 w-3" /> Assign</>
                        )}
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {b.assignees.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">Unassigned</span>
                      ) : (
                        b.assignees.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold"
                          >
                            {a.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <Link
                  to="/app/filter-leads/$batchId"
                  params={{ batchId: String(b.id) }}
                  className="mt-3 flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-muted hover:bg-accent text-sm font-medium"
                >
                  Open <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload modal */}
      <Modal
        isOpen={uploadOpen}
        onClose={resetUpload}
        title="Bulk Upload Leads"
        size="lg"
        footer={
          <>
            <button
              onClick={resetUpload}
              className="px-3 py-2 rounded-lg border text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={submitUpload}
              disabled={createMut.isPending || !batchName.trim() || pendingRows.length === 0}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {createMut.isPending ? 'Uploading…' : `Upload ${pendingRows.length || ''} leads`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
              Batch / Source name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder='e.g. "Hot leads – May 2026"'
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              This becomes the lead <code className="bg-muted px-1 rounded">source</code> when seeded into the CRM.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Excel file (.xlsx / .xls)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Supported columns: <strong>Name, Father, Mother, Email, Email2, Email3, Mobile,
              Mobile2, Mobile3, Father Mobile, Mother Mobile, City, State, Country, Pincode,
              DOB, Gender, Nationality, Intrested Course, Intrested University, Event, Source,
              Lead Type, Comment</strong>. Unknown columns are ignored.{' '}
              <button onClick={downloadTemplate} className="text-primary hover:underline">
                Download template
              </button>
            </p>
          </div>

          {pendingRows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-xs font-medium flex justify-between">
                <span>Preview – first 5 of {pendingRows.length} rows</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Name</th>
                      <th className="px-3 py-1.5 text-left">Email</th>
                      <th className="px-3 py-1.5 text-left">Mobile</th>
                      <th className="px-3 py-1.5 text-left">City</th>
                      <th className="px-3 py-1.5 text-left">State</th>
                      <th className="px-3 py-1.5 text-left">Course</th>
                      <th className="px-3 py-1.5 text-left">Lead Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{r.name || '—'}</td>
                        <td className="px-3 py-1.5">{r.email || '—'}</td>
                        <td className="px-3 py-1.5">{r.phone || '—'}</td>
                        <td className="px-3 py-1.5">{r.city || '—'}</td>
                        <td className="px-3 py-1.5">{r.state || '—'}</td>
                        <td className="px-3 py-1.5">{r.intrestedCourse || '—'}</td>
                        <td className="px-3 py-1.5">{r.leadType || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Assign batch modal */}
      {assignTarget && (
        <AssignBatchModal
          batch={assignTarget}
          onCancel={() => setAssignTarget(null)}
          onSave={(userIds) => {
            assignMut.mutate(
              { id: assignTarget.id, userIds },
              { onSuccess: () => setAssignTarget(null) },
            )
          }}
          isPending={assignMut.isPending}
        />
      )}
    </div>
  )
}

function AssignBatchModal({
  batch, onCancel, onSave, isPending,
}: {
  batch: LeadStagingBatch
  onCancel: () => void
  onSave: (userIds: number[]) => void
  isPending: boolean
}) {
  // Selection model: a Set of counsellor user-ids. Pre-seeded with the batch's
  // current assignees so unchecking a box removes that counsellor on save.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(batch.assignees.map((a) => a.id)),
  )
  const [search, setSearch] = useState('')

  // If the batch reference changes (admin reopens for a different card), reset
  // the selection so the modal doesn't show the previous batch's assignees.
  useEffect(() => {
    setSelected(new Set(batch.assignees.map((a) => a.id)))
  }, [batch.id, batch.assignees])

  const { data: counsellors = [], isLoading } = useQuery<Counsellor[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: () => usersApi.counsellors(),
  })

  const filtered = counsellors.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  )

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Dirty check — disable Save when nothing changed.
  const dirty = useMemo(() => {
    const before = new Set(batch.assignees.map((a) => a.id))
    if (before.size !== selected.size) return true
    for (const id of before) if (!selected.has(id)) return true
    return false
  }, [batch.assignees, selected])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-card border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Manage Assignees
              </h2>
              <p className="text-sm text-muted-foreground mt-1 truncate">
                "{batch.name}" · {batch.totalCount} leads
              </p>
            </div>
            <button onClick={onCancel} className="p-1 rounded hover:bg-accent" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Tick counsellors to assign · untick to remove. When seeded, every verified
            lead is duplicated into each ticked counsellor's "My Leads".
          </p>
          {selected.size > 0 && (
            <div className="mt-2 text-[11px] text-primary font-semibold">
              {selected.size} selected
            </div>
          )}
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search counsellor by name…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No counsellors found</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {filtered.map((c) => {
                const checked = selected.has(c.id)
                return (
                  <label
                    key={c.id}
                    className={cn(
                      'flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-all',
                      checked
                        ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-sm'
                        : 'bg-card border-border/60 hover:bg-accent/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      className="h-3.5 w-3.5 rounded border-input accent-primary mt-0.5 shrink-0 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate leading-tight" title={c.name}>{c.name}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate mt-0.5">{c.role}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center gap-2 justify-between">
          <button
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0 || isPending}
            className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm border rounded-lg hover:bg-accent">Cancel</button>
            <button
              onClick={() => onSave(Array.from(selected))}
              disabled={!dirty || isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' | 'blue' }) {
  const cls =
    tone === 'green' ? 'text-emerald-600' :
    tone === 'red' ? 'text-rose-600' :
    tone === 'blue' ? 'text-sky-600' : ''
  return (
    <div className="rounded-md bg-muted/30 py-1.5">
      <div className={`text-base font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  )
}

// Re-export icon set used elsewhere (keeps import surface tidy)
export { CheckCircle2, XCircle, Sprout }
