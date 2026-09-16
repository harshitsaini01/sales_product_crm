import { useDeferredValue, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  Copy, Phone, Mail, User, Calendar, MapPin, GitMerge,
  Trash2, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw,
  ChevronDown, ChevronUp, Star, Shield, Globe, Tag, ArrowUpDown,
} from 'lucide-react'
import { getWebsiteConfig } from '@/components/leads/LeadCard'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DupeLead {
  id: number
  name: string
  mobile: string | null
  mobile2: string | null
  email: string | null
  father: string | null
  city: string | null
  state: string | null
  country: string | null
  leadStatus: string
  leadSubStatus: string | null
  leadType: string
  website: string
  source: string | null
  isDuplicate: boolean
  duplicateOfId: number | null
  createdAt: string
  updatedAt: string
  assignedTo: Array<{ counsellor: { id: number; name: string } }>
  _count: { followups: number; notes: number; reminders: number; documents: number }
}

interface DupeGroup {
  type: 'mobile' | 'email'
  mobile?: string
  email?: string
  normalizedMobile?: string
  normalizedEmail?: string
  count: number
  leads: DupeLead[]
}

interface DuplicatesResponse {
  groups: DupeGroup[]
  totalGroups: number
  totalGroupsAvailable?: number
  totalDuplicateLeads: number
  limit?: number
}

// ─── Merge Confirmation Modal ─────────────────────────────────────────────────

function MergeModal({
  group,
  winnerId,
  onConfirm,
  onClose,
  isPending,
}: {
  group: DupeGroup
  winnerId: number
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  const winner = group.leads.find((l) => l.id === winnerId)!
  const toMerge = group.leads.filter((l) => l.id !== winnerId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-orange-500/10 border-b px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
            <GitMerge className="h-5 w-5 text-orange-500" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-base">Confirm Merge</p>
            <p className="text-xs text-muted-foreground">This action cannot be undone</p>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Winner */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Keep (Winner)</p>
            <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">{winner.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  #{winner.id} · {[winner.mobile, winner.email].filter(Boolean).join(' · ')} · {winner.leadStatus}
                </p>
              </div>
            </div>
          </div>

          {/* To trash */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Merge & Trash ({toMerge.length})
            </p>
            <div className="space-y-2">
              {toMerge.map((l) => (
                <div key={l.id} className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                  <Trash2 className="h-4 w-4 text-red-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{l.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      #{l.id} · {[l.mobile, l.email].filter(Boolean).join(' · ')} · {l._count.followups} followups · {l._count.notes} notes
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-700 dark:text-blue-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>All followups, notes, reminders and documents from merged leads will be transferred to the winner. Blank fields on the winner will be filled from the merged leads.</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-card flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border rounded-xl text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isPending ? (
              <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Merging...</>
            ) : (
              <><GitMerge className="h-4 w-4" />Merge & Trash Duplicates</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Single Group Card ────────────────────────────────────────────────────────

function GroupCard({
  group,
  onMerge,
  isMerging,
}: {
  group: DupeGroup
  onMerge: (keepId: number, mergeIds: number[]) => void
  isMerging: boolean
}) {
  // Auto-suggest the first non-isDuplicate lead as winner, else oldest
  const suggested = group.leads.find((l) => !l.isDuplicate) ?? group.leads[0]
  const [winnerId, setWinnerId] = useState<number>(suggested.id)
  const [expanded, setExpanded] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const mergeIds = group.leads.filter((l) => l.id !== winnerId).map((l) => l.id)

  const activityCount = (l: DupeLead) =>
    l._count.followups + l._count.notes + l._count.reminders + l._count.documents

  const groupMobiles = Array.from(new Set(group.leads.map((l) => l.mobile).filter(Boolean))) as string[]
  const groupEmails = Array.from(new Set(group.leads.map((l) => l.email).filter(Boolean))) as string[]

  return (
    <>
      {showModal && (
        <MergeModal
          group={group}
          winnerId={winnerId}
          onConfirm={() => {
            setShowModal(false)
            onMerge(winnerId, mergeIds)
          }}
          onClose={() => setShowModal(false)}
          isPending={isMerging}
        />
      )}

      <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
        {/* Group header */}
        <div
          className="flex items-center justify-between px-5 py-4 bg-muted/30 border-b cursor-pointer select-none hover:bg-muted/50 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Copy className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                {groupMobiles.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-orange-500" />
                    <span className="font-semibold text-sm tracking-wide">{groupMobiles.join(', ')}</span>
                  </div>
                )}
                {groupEmails.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-blue-500" />
                    <span className="font-semibold text-sm tracking-wide">{groupEmails.join(', ')}</span>
                  </div>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 font-semibold">
                  {group.count} records
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Matched by {group.type === 'mobile' ? 'Mobile Number' : 'Email Address'} · {group.leads.filter((l) => l.isDuplicate).length} flagged as duplicate
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); setShowModal(true) }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-semibold hover:bg-orange-600 transition-colors"
            >
              <GitMerge className="h-3.5 w-3.5" />
              Merge
            </button>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Leads list */}
        {expanded && (
          <div className="divide-y">
            {group.leads.map((lead) => {
              const isWinner = lead.id === winnerId
              return (
                <div
                  key={lead.id}
                  className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                    isWinner ? 'bg-green-500/5 border-l-4 border-l-green-500' : 'hover:bg-accent/30'
                  }`}
                >
                  {/* Winner radio */}
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <input
                      type="radio"
                      name={`winner-${group.email || group.mobile}`}
                      checked={isWinner}
                      onChange={() => setWinnerId(lead.id)}
                      className="h-4 w-4 accent-green-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-muted-foreground font-medium">Keep</span>
                  </div>

                  {/* Lead info */}
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                    {/* Name + ID */}
                    <div className="flex items-start gap-2 lg:col-span-1">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {lead.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm truncate">{lead.name}</p>
                          {lead.isDuplicate && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 font-semibold shrink-0">
                              DUPE
                            </span>
                          )}
                          {!lead.isDuplicate && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-semibold shrink-0 flex items-center gap-0.5">
                              <Star className="h-2.5 w-2.5" />ORIGINAL
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">#{lead.id}</p>
                      </div>
                    </div>

                    {/* Contact + status */}
                    <div className="space-y-1">
                      {lead.mobile && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <Phone className="h-3 w-3 text-orange-500 shrink-0" />
                          <span>{lead.mobile}</span>
                          {lead.mobile2 && <span className="text-muted-foreground font-normal">({lead.mobile2})</span>}
                        </div>
                      )}
                      {lead.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="truncate">{lead.email}</span>
                        </div>
                      )}
                      {lead.father && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="h-3 w-3 shrink-0" />
                          <span>Father: {lead.father}</span>
                        </div>
                      )}
                      {(lead.city || lead.state || lead.country) && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span>{[lead.city, lead.state, lead.country].filter(Boolean).join(', ')}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3 shrink-0" />
                        <span>Created {new Date(lead.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                    </div>

                    {/* Stats + badges */}
                    <div className="flex flex-wrap items-center gap-1.5 content-start">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {lead.leadStatus}
                      </span>
                      {lead.website && (() => {
                        const wb = getWebsiteConfig(lead.website)
                        return (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${wb.bg} ${wb.text}`}
                            title={`Website: ${wb.label}`}
                          >
                            <Globe className="h-2.5 w-2.5" />
                            {wb.label}
                          </span>
                        )
                      })()}
                      {lead.source && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 font-medium flex items-center gap-1"
                          title={`Source: ${lead.source}`}
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {lead.source}
                        </span>
                      )}
                      {lead._count.followups > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-medium">
                          {lead._count.followups} followup{lead._count.followups !== 1 ? 's' : ''}
                        </span>
                      )}
                      {lead._count.notes > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 font-medium">
                          {lead._count.notes} note{lead._count.notes !== 1 ? 's' : ''}
                        </span>
                      )}
                      {lead._count.documents > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                          {lead._count.documents} doc{lead._count.documents !== 1 ? 's' : ''}
                        </span>
                      )}
                      {lead.assignedTo.length > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium flex items-center gap-1">
                          <User className="h-2.5 w-2.5" />
                          {lead.assignedTo[0].counsellor.name}
                          {lead.assignedTo.length > 1 ? ` +${lead.assignedTo.length - 1}` : ''}
                        </span>
                      )}
                      {activityCount(lead) === 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground/60 font-medium">
                          No activity
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isWinner && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600 bg-green-500/10 px-2 py-1 rounded-lg">
                        <Shield className="h-3 w-3" />WINNER
                      </span>
                    )}
                    <a
                      href={`/app/leads/${lead.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      title="Open lead in new tab"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer action bar */}
        {expanded && (
          <div className="px-5 py-3 bg-muted/20 border-t flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {group.leads.find(l => l.id === winnerId)?.name ?? '—'}
              </span>
              {' '}will be kept · {mergeIds.length} lead{mergeIds.length !== 1 ? 's' : ''} will be merged & trashed
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-semibold hover:bg-orange-600 transition-colors"
            >
              <GitMerge className="h-3.5 w-3.5" />
              Merge Group
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const GROUP_PAGE_SIZES = [10, 20, 50, 100]

type SortOrder = 'newest' | 'oldest' | 'count'

const groupLatestTime = (g: DupeGroup) =>
  g.leads.reduce((max, l) => Math.max(max, new Date(l.createdAt).getTime()), 0)

export default function Duplicate() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [limit, setLimit] = useState(10)
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [, setPendingMerge] = useState<{ keepId: number; mergeIds: number[]; groupKey: string } | null>(null)

  const { data, isLoading, isFetching, refetch } = useQuery<DuplicatesResponse>({
    queryKey: ['leads', 'duplicates', limit, sortOrder, deferredSearch],
    queryFn: () => leadsApi.duplicates(limit, sortOrder, deferredSearch),
    staleTime: 60_000,
  })

  const mergeMutation = useMutation({
    mutationFn: leadsApi.mergeLeads,
    onSuccess: (_, vars) => {
      qc.setQueriesData<DuplicatesResponse>({ queryKey: ['leads', 'duplicates'] }, (old) => {
        if (!old) return old
        const mergedSet = new Set(vars.mergeIds)
        const newGroups = old.groups
          .map((g) => {
            if (!g.leads.some((l) => mergedSet.has(l.id) || l.id === vars.keepId)) return g
            const remaining = g.leads.filter((l) => !mergedSet.has(l.id))
            if (remaining.length <= 1) return null
            return { ...g, leads: remaining, count: remaining.length }
          })
          .filter(Boolean) as DupeGroup[]

        const totalDuplicateLeads = newGroups.reduce((s, g) => s + (g.count - 1), 0)
        const totalGroupsAvailable =
          old.totalGroupsAvailable != null
            ? Math.max(0, old.totalGroupsAvailable - (old.groups.length - newGroups.length))
            : undefined
        return {
          ...old,
          groups: newGroups,
          totalGroups: newGroups.length,
          totalDuplicateLeads,
          ...(totalGroupsAvailable != null ? { totalGroupsAvailable } : {}),
        }
      })
      qc.invalidateQueries({ queryKey: ['leads', 'duplicates'] })
      toast.success(`Merged ${vars.mergeIds.length} lead(s) successfully`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Merge failed'),
    onSettled: () => setPendingMerge(null),
  })

  const groups = data?.groups ?? []

  const filteredGroups = [...groups]
    .map((g) => ({
      ...g,
      leads: [...g.leads].sort((a, b) => {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return sortOrder === 'oldest' ? -diff : diff
      }),
    }))
    .sort((a, b) => {
      if (sortOrder === 'oldest') {
        return groupLatestTime(a) - groupLatestTime(b)
      }
      if (sortOrder === 'count') {
        if (b.count !== a.count) return b.count - a.count
        return groupLatestTime(b) - groupLatestTime(a)
      }
      return groupLatestTime(b) - groupLatestTime(a)
    })

  function handleMerge(keepId: number, mergeIds: number[], groupKey: string) {
    setPendingMerge({ keepId, mergeIds, groupKey })
    mergeMutation.mutate({ keepId, mergeIds })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <Copy className="h-5 w-5 text-orange-500" />
            </div>
            Duplicate Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and merge duplicate leads grouped by mobile number
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          {isFetching ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {/* Stats bar */}
      {!isLoading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="bg-card border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">Duplicate Groups</p>
            <p className="text-2xl font-bold text-orange-500 mt-1">
              {data.totalGroupsAvailable ?? data.totalGroups}
            </p>
            {data.totalGroupsAvailable != null && data.totalGroupsAvailable > data.totalGroups && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                showing {data.totalGroups} of {data.totalGroupsAvailable}
              </p>
            )}
          </div>
          <div className="bg-card border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">Extra Records</p>
            <p className="text-2xl font-bold text-red-500 mt-1">{data.totalDuplicateLeads}</p>
          </div>
          <div className="bg-card border rounded-xl p-4 col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground font-medium">After Cleanup</p>
            <p className="text-2xl font-bold text-green-500 mt-1">
              {data.totalGroups > 0 ? `${data.totalDuplicateLeads} leads freed` : 'Database clean ✓'}
            </p>
          </div>
        </div>
      )}

      {/* Search + page size */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by mobile, name or email…"
            className="w-full px-4 py-2.5 bg-card border rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/30 pl-10"
          />
          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-card border rounded-xl">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <label className="text-xs text-muted-foreground whitespace-nowrap">Sort by</label>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            className="text-sm bg-transparent border-0 outline-none font-medium cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="count">Most duplicates</option>
          </select>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-card border rounded-xl">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Show groups</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="text-sm bg-transparent border-0 outline-none font-medium"
          >
            {GROUP_PAGE_SIZES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
          {data?.totalGroupsAvailable != null && data.totalGroupsAvailable > limit && (
            <span className="text-[11px] text-muted-foreground">of {data.totalGroupsAvailable}</span>
          )}
        </div>
      </div>

      {/* Groups list */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-card border rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-card border rounded-2xl p-16 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500/30 mx-auto mb-4" />
          <p className="font-semibold text-lg">
            {search ? 'No matching duplicates' : 'No duplicates found!'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? 'Try a different search term' : 'Your lead database is clean.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <GroupCard
              key={group.email || group.mobile || ''}
              group={group}
              onMerge={(keepId, mergeIds) => handleMerge(keepId, mergeIds, group.email || group.mobile || '')}
              isMerging={mergeMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}
