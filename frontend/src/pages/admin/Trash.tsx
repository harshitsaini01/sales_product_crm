import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, leadStagingApi, type LeadStagingBatch } from '@/lib/api'
import { toast } from 'sonner'
import {
  Trash2, RotateCcw, AlertTriangle, Loader2, Search,
  ChevronLeft, ChevronRight, XCircle, Inbox, FolderArchive,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TrashTab = 'leads' | 'folders'

export default function Trash() {
  const [tab, setTab] = useState<TrashTab>('leads')

  // Counts for the tab badges — query both even when one tab is hidden so the
  // numbers stay in sync the moment you switch tabs.
  const { data: leadCount = 0 } = useQuery({
    queryKey: ['trash-leads-count'],
    queryFn: () => leadsApi.list({ trash: '1', limit: '1' }).then((r) => r.total || 0),
  })
  const { data: folderBatches = [] } = useQuery<LeadStagingBatch[]>({
    queryKey: ['lead-staging', { trash: true }],
    queryFn: () => leadStagingApi.list({ trash: true }),
  })
  const folderCount = folderBatches.length

  return (
    <div className="space-y-6">
      {/* Page header — single source of truth so both tabs share the title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-lg shadow-red-500/20">
            <Trash2 className="h-5 w-5 text-white" />
          </div>
          Trash Bin
        </h1>
        <p className="text-sm text-muted-foreground mt-1 ml-[46px]">
          Restore or permanently remove deleted items.
        </p>
      </div>

      {/* Tab bar — Leads (individual rows) vs Folders (filter-lead batches) */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab('leads')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'leads'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Inbox className="h-4 w-4" />
          Leads
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
            {leadCount}
          </span>
        </button>
        <button
          onClick={() => setTab('folders')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'folders'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <FolderArchive className="h-4 w-4" />
          Folders
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
            {folderCount}
          </span>
        </button>
      </div>

      {tab === 'leads' ? <LeadsTrashPanel /> : <FoldersTrashPanel batches={folderBatches} />}
    </div>
  )
}

// ─── Leads tab (existing trash UI for individual Lead rows) ────────────────
function LeadsTrashPanel() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showConfirm, setShowConfirm] = useState<'restore' | 'delete' | 'empty' | null>(null)
  const [sortOption, setSortOption] = useState<'recently_deleted' | 'oldest_deleted' | 'newest_created' | 'oldest_created'>('recently_deleted')

  const sortParams = useMemo(() => {
    switch (sortOption) {
      case 'recently_deleted': return { orderBy: 'updatedAt', orderDir: 'desc' }
      case 'oldest_deleted': return { orderBy: 'updatedAt', orderDir: 'asc' }
      case 'newest_created': return { orderBy: 'createdAt', orderDir: 'desc' }
      case 'oldest_created': return { orderBy: 'createdAt', orderDir: 'asc' }
      default: return { orderBy: 'updatedAt', orderDir: 'desc' }
    }
  }, [sortOption])

  const { data, isLoading } = useQuery({
    queryKey: ['trash-leads', page, limit, search, sortParams],
    queryFn: () => leadsApi.list({
      trash: '1',
      page: String(page),
      limit: String(limit),
      ...sortParams,
      ...(search ? { search } : {}),
    }),
  })

  const leads = data?.data || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / limit)

  // Mutations
  const restoreSingle = useMutation({
    mutationFn: (id: number) => leadsApi.restore(id),
    onSuccess: () => { toast.success('Lead restored'); refresh() },
    onError: () => toast.error('Restore failed'),
  })

  const deleteSingle = useMutation({
    mutationFn: (id: number) => leadsApi.deletePermanent(id),
    onSuccess: () => { toast.success('Lead permanently deleted'); refresh() },
    onError: () => toast.error('Delete failed'),
  })

  const bulkRestore = useMutation({
    mutationFn: () => leadsApi.bulkRestore(Array.from(selectedIds)),
    onSuccess: (d) => { toast.success(d.message); refresh() },
    onError: () => toast.error('Bulk restore failed'),
  })

  const bulkPermanentDelete = useMutation({
    mutationFn: () => leadsApi.bulkPermanentDelete(Array.from(selectedIds)),
    onSuccess: (d) => { toast.success(d.message); refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Bulk delete failed'),
  })

  const emptyTrash = useMutation({
    mutationFn: () => leadsApi.emptyTrash(),
    onSuccess: (d) => { toast.success(d.message); refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Empty trash failed'),
  })

  const refresh = () => {
    setSelectedIds(new Set())
    setShowConfirm(null)
    qc.invalidateQueries({ queryKey: ['trash-leads'] })
    qc.invalidateQueries({ queryKey: ['trash-leads-count'] })
  }

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? new Set(leads.map((l: any) => Number(l.id))) : new Set())
  }

  const handleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const confirmAction = () => {
    if (showConfirm === 'restore') bulkRestore.mutate()
    else if (showConfirm === 'delete') bulkPermanentDelete.mutate()
    else if (showConfirm === 'empty') emptyTrash.mutate()
  }

  const isExecuting = bulkRestore.isPending || bulkPermanentDelete.isPending || emptyTrash.isPending

  return (
    <div className="space-y-6">
      {/* Tab subtitle + Empty Trash action */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {total} deleted lead{total !== 1 ? 's' : ''} — restore or permanently remove.
        </p>
        <button
          onClick={() => setShowConfirm('empty')}
          disabled={total === 0}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
        >
          <XCircle className="h-4 w-4" /> Empty Trash
        </button>
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-700">
          Permanently deleted leads cannot be recovered. Restore leads if you need them back.
        </p>
      </div>

      {/* Toolbar */}
      <div className="bg-card border rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={leads.length > 0 && selectedIds.size === leads.length}
              onChange={handleSelectAll}
              className="h-4 w-4 text-primary rounded border-gray-300 focus:ring-primary"
            />
            <span className="text-sm font-medium">
              {selectedIds.size > 0 ? (
                <span className="text-primary">{selectedIds.size} selected</span>
              ) : 'Select All'}
            </span>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 ml-2">
                <button
                  onClick={() => setShowConfirm('restore')}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" /> Restore
                </button>
                <button
                  onClick={() => setShowConfirm('delete')}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1.5"
                >
                  <Trash2 className="h-3 w-3" /> Delete Forever
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search trash..."
                className="pl-9 pr-3 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30 w-48"
              />
            </div>
            {/* Sort order filter */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <select
              value={sortOption}
              onChange={(e) => { setSortOption(e.target.value as any); setPage(1) }}
              className="px-3 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30 font-medium"
            >
              <option value="recently_deleted">Recently Deleted (Top)</option>
              <option value="oldest_deleted">Oldest Trashed</option>
              <option value="newest_created">Created Date (Newest)</option>
              <option value="oldest_created">Created Date (Oldest)</option>
            </select>
            {/* Per page */}
            <select
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
              className="px-2 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">Loading deleted leads...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-12 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <p className="font-medium text-muted-foreground">Trash is empty</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Deleted leads will appear here</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase border-b bg-muted/10">
                  <tr>
                    <th className="px-4 py-3 w-12"></th>
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Mobile</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Deleted Date</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead: any) => {
                    const checked = selectedIds.has(Number(lead.id))
                    return (
                      <tr key={lead.id}
                        className={`hover:bg-muted/30 transition-colors ${checked ? 'bg-primary/[0.03]' : ''}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={checked}
                            onChange={() => handleSelect(Number(lead.id))}
                            className="h-4 w-4 text-primary rounded border-gray-300 focus:ring-primary" />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">#{lead.id}</td>
                        <td className="px-4 py-3 font-medium">{lead.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{lead.email || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{lead.mobile || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 bg-muted rounded font-medium">
                            {lead.leadStatus || 'Fresh'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {lead.updatedAt
                            ? new Date(lead.updatedAt).toLocaleString('en-IN', {
                                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => restoreSingle.mutate(Number(lead.id))}
                              disabled={restoreSingle.isPending}
                              className="px-2.5 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-1"
                            >
                              <RotateCcw className="h-3 w-3" /> Restore
                            </button>
                            <button
                              onClick={() => deleteSingle.mutate(Number(lead.id))}
                              disabled={deleteSingle.isPending}
                              className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1"
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const p = page <= 3 ? i + 1 : page + i - 2
                  if (p < 1 || p > totalPages) return null
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${
                        p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}>
                      {p}
                    </button>
                  )
                })}
                <button
                  onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowConfirm(null)} />
          <div className="relative bg-card border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
                showConfirm === 'restore' ? 'bg-emerald-100' : 'bg-red-100'
              }`}>
                {showConfirm === 'restore'
                  ? <RotateCcw className="h-6 w-6 text-emerald-600" />
                  : <Trash2 className="h-6 w-6 text-red-600" />
                }
              </div>
              <div>
                <h3 className="font-bold text-lg">
                  {showConfirm === 'restore' && 'Restore Leads'}
                  {showConfirm === 'delete' && 'Permanently Delete'}
                  {showConfirm === 'empty' && 'Empty Trash'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {showConfirm === 'restore' && `Restore ${selectedIds.size} lead${selectedIds.size > 1 ? 's' : ''} back to active leads?`}
                  {showConfirm === 'delete' && `Permanently delete ${selectedIds.size} lead${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`}
                  {showConfirm === 'empty' && `Permanently delete ALL ${total} leads in trash? This cannot be undone.`}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(null)}
                className="px-5 py-2.5 text-sm border rounded-lg hover:bg-accent font-medium transition-colors">
                Cancel
              </button>
              <button onClick={confirmAction} disabled={isExecuting}
                className={`px-5 py-2.5 text-sm rounded-lg font-semibold shadow-sm transition-colors flex items-center gap-2 ${
                  showConfirm === 'restore'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}>
                {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isExecuting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Folders tab (deleted lead-staging batches from /app/filter-leads) ─────
// Mirrors the Leads tab's layout (search + per-page + table + confirm modal)
// for visual consistency. Folder rows are coarser than lead rows: each row is
// a whole batch with N items inside.
function FoldersTrashPanel({ batches }: { batches: LeadStagingBatch[] }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<
    { kind: 'restore' | 'delete'; batch: LeadStagingBatch } | null
  >(null)

  const filtered = batches.filter((b) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return `${b.name} ${b.fileName ?? ''}`.toLowerCase().includes(q)
  })

  const refresh = () => {
    setConfirmTarget(null)
    qc.invalidateQueries({ queryKey: ['lead-staging'] })
  }

  const restoreMut = useMutation({
    mutationFn: (id: number) => leadStagingApi.restore(id),
    onSuccess: () => { toast.success('Folder restored'); refresh() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Restore failed'),
  })

  const purgeMut = useMutation({
    mutationFn: (id: number) => leadStagingApi.permanentDelete(id),
    onSuccess: () => { toast.success('Folder permanently deleted'); refresh() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Delete failed'),
  })

  const isExecuting = restoreMut.isPending || purgeMut.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {batches.length} deleted folder{batches.length !== 1 ? 's' : ''} from Filter Leads — restore or permanently remove.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-700">
          Permanently deleting a folder also wipes all its items. Restore the folder if you want to keep them.
        </p>
      </div>

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b flex items-center justify-end gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search folder name / file..."
              className="pl-9 pr-3 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30 w-64"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <FolderArchive className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <p className="font-medium text-muted-foreground">
              {batches.length === 0 ? 'No deleted folders' : 'No folders match this search'}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Folders deleted from Filter Leads will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase border-b bg-muted/10">
                <tr>
                  <th className="px-4 py-3 font-medium">Folder</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Seeded</th>
                  <th className="px-4 py-3 font-medium">Trashed</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-[11px] text-muted-foreground">#{b.id}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{b.fileName || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-semibold">{b.totalCount}</span>
                      <span className="text-[11px] text-muted-foreground"> total</span>
                      {b.verifiedCount > 0 && (
                        <span className="text-[11px] text-emerald-600 ml-1">· {b.verifiedCount} ✓</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{b.seededCount}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {b.deletedAt ? new Date(b.deletedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setConfirmTarget({ kind: 'restore', batch: b })}
                          disabled={isExecuting}
                          className="px-2.5 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" /> Restore
                        </button>
                        <button
                          onClick={() => setConfirmTarget({ kind: 'delete', batch: b })}
                          disabled={isExecuting}
                          className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
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

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmTarget(null)} />
          <div className="relative bg-card border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
                confirmTarget.kind === 'restore' ? 'bg-emerald-100' : 'bg-red-100'
              }`}>
                {confirmTarget.kind === 'restore'
                  ? <RotateCcw className="h-6 w-6 text-emerald-600" />
                  : <Trash2 className="h-6 w-6 text-red-600" />}
              </div>
              <div>
                <h3 className="font-bold text-lg">
                  {confirmTarget.kind === 'restore' ? 'Restore Folder' : 'Permanently Delete Folder'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {confirmTarget.kind === 'restore'
                    ? `Move "${confirmTarget.batch.name}" back to the active list?`
                    : `Permanently delete "${confirmTarget.batch.name}" and all ${confirmTarget.batch.totalCount} item${confirmTarget.batch.totalCount === 1 ? '' : 's'} inside? This cannot be undone.`}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmTarget(null)}
                className="px-5 py-2.5 text-sm border rounded-lg hover:bg-accent font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmTarget.kind === 'restore') restoreMut.mutate(confirmTarget.batch.id)
                  else purgeMut.mutate(confirmTarget.batch.id)
                }}
                disabled={isExecuting}
                className={`px-5 py-2.5 text-sm rounded-lg font-semibold shadow-sm transition-colors flex items-center gap-2 ${
                  confirmTarget.kind === 'restore'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isExecuting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
