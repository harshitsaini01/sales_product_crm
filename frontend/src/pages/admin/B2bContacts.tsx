import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { b2bApi, type B2bContact } from '@/lib/api'
import { ImportB2bModal } from '@/components/b2b/ImportB2bModal'
import { Upload, Search, Trash2, Users, MapPin, Calendar, Phone } from 'lucide-react'
import { toast } from 'sonner'

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  '': { label: 'Any', cls: '' },
  pending: { label: 'Never used', cls: 'bg-muted text-muted-foreground' },
  assigned: { label: 'In active campaign', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  called: { label: 'Called before', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
}

export default function B2bContacts() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [campaignStatus, setCampaignStatus] = useState('')
  const [page, setPage] = useState(1)
  const [showImport, setShowImport] = useState(false)

  const limit = 50

  const params = useMemo(() => {
    const p: Record<string, string> = { page: String(page), limit: String(limit) }
    if (search.trim()) p.search = search.trim()
    if (state) p.state = state
    if (campaignStatus) p.campaignStatus = campaignStatus
    return p
  }, [search, state, campaignStatus, page])

  const listQ = useQuery({
    queryKey: ['b2b', 'contacts', params],
    queryFn: () => b2bApi.list(params),
  })
  const statsQ = useQuery({ queryKey: ['b2b', 'stats'], queryFn: b2bApi.stats })
  const statesQ = useQuery({ queryKey: ['b2b', 'states'], queryFn: b2bApi.states })

  const deleteMut = useMutation({
    mutationFn: (id: number) => b2bApi.delete(id),
    onSuccess: () => {
      toast.success('Deleted')
      qc.invalidateQueries({ queryKey: ['b2b'] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed'
      toast.error(msg)
    },
  })

  const total = listQ.data?.total ?? 0
  const totalPages = listQ.data?.totalPages ?? 1

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">B2B Contacts</h1>
          <p className="text-sm text-muted-foreground">Contact bank for outbound auto-dialer campaigns</p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
        >
          <Upload className="h-4 w-4" /> Import
        </button>
      </div>

      {/* Stats strip */}
      {statsQ.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Total" value={statsQ.data.total} />
          <StatCard icon={<MapPin className="h-4 w-4" />} label="States" value={(statsQ.data.byState || []).length} />
          <StatCard icon={<Calendar className="h-4 w-4" />} label="Uploads" value={(statsQ.data.batches || []).length} />
          <StatCard icon={<Phone className="h-4 w-4" />} label="In campaigns" value={total} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search name, phone, email"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border bg-background"
          />
        </div>
        <select
          value={state}
          onChange={(e) => { setState(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm rounded-md border bg-background"
        >
          <option value="">All states</option>
          {(statesQ.data || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={campaignStatus}
          onChange={(e) => { setCampaignStatus(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm rounded-md border bg-background"
        >
          <option value="">Any usage</option>
          <option value="pending">Never used</option>
          <option value="assigned">In active campaign</option>
          <option value="called">Called before</option>
        </select>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Uploaded</th>
              <th className="px-3 py-2 font-medium">Campaigns</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading ? (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">Loading…</td></tr>
            ) : (listQ.data?.data || []).length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">No contacts. Import a CSV to get started.</td></tr>
            ) : (listQ.data?.data || []).map((c: B2bContact) => {
              const usage = (c._count?.campaignContacts ?? 0) > 0 ? 'called' : 'pending'
              const badge = STATUS_LABELS[usage] || STATUS_LABELS['']
              return (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.email || '—'}</td>
                  <td className="px-3 py-2">{c.state || '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-center">{c._count?.campaignContacts ?? 0}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteMut.mutate(c.id) }}
                      className="p-1 rounded hover:bg-destructive/10 text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{total} contacts · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded border disabled:opacity-50"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded border disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showImport && <ImportB2bModal onClose={() => setShowImport(false)} />}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-bold">{value.toLocaleString()}</div>
      </div>
    </div>
  )
}
