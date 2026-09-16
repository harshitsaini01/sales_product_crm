import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// React-Leaflet 4 runtime is React 18 compatible; these aliases avoid a monorepo
// type-resolution mismatch between the hoisted package and the workspace Leaflet types.
const OpenStreetMap = MapContainer as any
const OpenStreetTiles = TileLayer as any
const RouteLine = Polyline as any
const RoutePoint = CircleMarker as any
const PointTooltip = Tooltip as any
import { useParams, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  User, Phone, Mail, MapPin, Calendar, Briefcase, Activity, Target,
  Search, ChevronLeft, ChevronRight, UserMinus, Loader2,
  UserPlus, AlertTriangle, X, Users as UsersIcon, MessageSquareQuote, Send, Trash2,
  Smartphone, Monitor, PhoneCall, StickyNote, MessageCircle, RefreshCw, LogIn, Eye, EyeOff, ShieldCheck,
} from 'lucide-react'
import { usersApi, leadsApi, branchesApi, remarksApi, type UserActivity, type UserActivityTimelineItem, type UserLocationPoint } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { LeadCard } from '@/components/leads/LeadCard'
import { toast } from 'sonner'
import type { CounsellorRemark } from '@/types'
import { RemarkCardContent } from '@/pages/admin/Remarks'



interface UserDetail {
  id: number
  name: string
  email: string
  mobile?: string
  designation?: string
  role: string
  status: number
  createdAt: string
  branch?: { id: number; name: string; city?: string; state?: string } | null
  roles?: { role: string }[]
  showFullPhone?: number
  showBucket?: boolean
  locationTrackingEnabled?: boolean
  locationRequired?: boolean
  automaticAsignLead?: number
}

interface CounsellorOption {
  id: number
  name: string
  role: string
  designation?: string
}

export default function CounsellorProfile() {
  const { id } = useParams({ strict: false }) as { id: string }
  const userId = Number(id)
  const qc = useQueryClient()

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showReassignModal, setShowReassignModal] = useState<'selected' | 'all' | null>(null)
  const [confirmUnassignAll, setConfirmUnassignAll] = useState(false)
  const pageSize = 10

  const { data: profile, isLoading } = useQuery<UserDetail>({
    queryKey: ['users', userId],
    queryFn: () => usersApi.get(userId),
    enabled: !!userId,
  })
  const { data: leadCount } = useQuery({
    queryKey: ['users', userId, 'lead-count'],
    queryFn: () => usersApi.leadCount(userId),
    enabled: !!userId,
  })

  const leadsParams: Record<string, string> = {
    assignedCounsellors: String(userId),
    page: String(page),
    limit: String(pageSize),
  }
  if (search) leadsParams.search = search

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['users', userId, 'assigned-leads', leadsParams],
    queryFn: () => leadsApi.list(leadsParams),
    enabled: !!userId,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visibleLeadIds: number[] = (leadsData?.data ?? []).map((l: any) => l.id)
  const allVisibleSelected =
    visibleLeadIds.length > 0 && visibleLeadIds.every((id) => selected.has(id))

  function toggleSelect(leadId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleLeadIds.forEach((id) => next.delete(id))
      else visibleLeadIds.forEach((id) => next.add(id))
      return next
    })
  }

  function invalidateLists() {
    qc.invalidateQueries({ queryKey: ['users', userId, 'assigned-leads'] })
    qc.invalidateQueries({ queryKey: ['users', userId, 'lead-count'] })
    qc.invalidateQueries({ queryKey: ['leads'] })
  }

  const unassignOne = useMutation({
    mutationFn: (leadId: number) => leadsApi.unassign(leadId, userId),
    onSuccess: () => { toast.success('Lead unassigned'); invalidateLists() },
    onError: () => toast.error('Failed to unassign lead'),
  })

  const bulkUnassign = useMutation({
    mutationFn: (leadIds: number[]) =>
      leadsApi.bulkUnassign({ leadIds, counsellorId: userId }),
    onSuccess: (r: { unassigned?: number }) => {
      toast.success(`${r?.unassigned ?? 0} lead(s) unassigned`)
      setSelected(new Set())
      invalidateLists()
    },
    onError: () => toast.error('Failed to unassign selected leads'),
  })

  const unassignAll = useMutation({
    mutationFn: () => leadsApi.unassignAll({ counsellorId: userId }),
    onSuccess: () => {
      toast.success(`All leads unassigned from ${profile?.name ?? 'counsellor'}`)
      setSelected(new Set())
      setConfirmUnassignAll(false)
      invalidateLists()
    },
    onError: () => toast.error('Failed to unassign all leads'),
  })

  // Reassign = unassign-from-this-counsellor + assign-to-target. Done in two
  // sequential calls because there's no atomic "move" endpoint; the bulkAssign
  // route is idempotent (skips duplicates) so a retry is safe.
  const reassign = useMutation({
    mutationFn: async ({ leadIds, targetId }: { leadIds: number[]; targetId: number }) => {
      await leadsApi.bulkUnassign({ leadIds, counsellorId: userId })
      return leadsApi.bulkAssign({ leadIds, counsellorId: targetId })
    },
    onSuccess: (r: { assigned?: number }) => {
      toast.success(`${r?.assigned ?? 0} lead(s) reassigned`)
      setSelected(new Set())
      setShowReassignModal(null)
      invalidateLists()
    },
    onError: () => toast.error('Failed to reassign leads'),
  })

  // Reassign ALL — fetch all assigned ids, then run reassign in chunks
  const reassignAll = useMutation({
    mutationFn: async (targetId: number) => {
      // pull the full list of leadIds for this counsellor (cap defensively)
      const all = await leadsApi.list({
        assignedCounsellors: String(userId),
        page: '1',
        limit: '10000',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids: number[] = (all?.data ?? []).map((l: any) => l.id)
      if (!ids.length) return { assigned: 0 }
      await leadsApi.bulkUnassign({ leadIds: ids, counsellorId: userId })
      return leadsApi.bulkAssign({ leadIds: ids, counsellorId: targetId })
    },
    onSuccess: (r: { assigned?: number }) => {
      toast.success(`All ${r?.assigned ?? 0} lead(s) reassigned`)
      setSelected(new Set())
      setShowReassignModal(null)
      invalidateLists()
    },
    onError: () => toast.error('Failed to reassign all leads'),
  })

  const toggleShowFullPhone = useMutation({
    mutationFn: (value: number) => usersApi.update(userId, { showFullPhone: value }),
    onSuccess: (updated: any) => {
      toast.success(Number(updated.showFullPhone) === 1 ? 'Full phone permission enabled' : 'Full phone permission disabled')
      qc.invalidateQueries({ queryKey: ['users', userId] })
    },
    onError: () => toast.error('Failed to update full phone permission'),
  })

  const updateLocationSetting = useMutation({
    mutationFn: (settings: { locationTrackingEnabled?: boolean; locationRequired?: boolean; showBucket?: boolean }) => usersApi.update(userId, settings),
    onSuccess: () => { toast.success('Counsellor setting updated'); qc.invalidateQueries({ queryKey: ['users', userId] }) },
    onError: () => toast.error('Failed to update counsellor setting'),
  })
  if (isLoading) return <div className="p-12 text-center text-gray-500 animate-pulse">Loading profile...</div>
  if (!profile) return <div className="p-12 text-center text-red-500">Profile not found.</div>

  const initials = profile.name?.charAt(0).toUpperCase() || '?'
  const totalAssigned = leadCount?.total ?? 0
  const selectedCount = selected.size

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Briefcase className="w-6 h-6 text-gray-400" />
          Counsellor Profile
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 lg:col-span-1">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden text-center relative pt-12 pb-8 px-6">
            <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-r from-blue-500 to-indigo-600" />
            <div className="relative inline-flex items-center justify-center w-24 h-24 bg-white rounded-full p-1 shadow-md mb-4 border border-gray-100">
              <div className="w-full h-full bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-3xl font-bold">
                {initials}
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900">{profile.name}</h2>
            <p className="text-sm text-gray-500 capitalize">{profile.designation || profile.role}</p>

            <div
              className={`mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                profile.status === 1 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${profile.status === 1 ? 'bg-green-500' : 'bg-gray-400'}`} />
              {profile.status === 1 ? 'Account Active' : 'Inactive'}
            </div>

            <div className="mt-8 space-y-4 text-left text-sm text-gray-600 border-t border-gray-100 pt-6">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-gray-400" /> {profile.email}
              </div>
              {profile.mobile && (
                <div className="flex items-center gap-3">
                  <Phone className="w-4 h-4 text-gray-400" /> {profile.mobile}
                </div>
              )}
              {profile.branch && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  {profile.branch.name}
                  {profile.branch.city ? ` — ${profile.branch.city}` : ''}
                </div>
              )}
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-gray-400" />
                Joined {new Date(profile.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-1 lg:col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <MetricCard icon={<User className="w-3.5 h-3.5" />} label="Assigned Leads" value={leadCount?.total ?? 0} color="text-gray-900" />
            <MetricCard icon={<Activity className="w-3.5 h-3.5" />} label="This Month" value={leadCount?.thisMonth ?? 0} color="text-blue-600" />
            <MetricCard icon={<Target className="w-3.5 h-3.5" />} label="Today" value={leadCount?.today ?? 0} color="text-emerald-600" />
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-6">
            <h3 className="font-bold text-gray-900 mb-6 border-b border-gray-50 flex items-center pb-3">
              Work Configuration
            </h3>

            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Designation</label>
                <div className="font-medium text-gray-900">{profile.designation || '—'}</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Branch</label>
                <ProfileBranchSelect userId={userId} currentBranchId={profile.branch?.id ?? null} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Roles</label>
                <div className="font-medium text-gray-900">
                  {profile.roles?.map((r) => r.role).join(', ') || profile.role}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Email</label>
                <div className="font-medium text-gray-900">{profile.email}</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Full Phone Permission</label>
                {useAuthStore.getState().isAdmin() ? (
                  <button
                    type="button"
                    onClick={() => toggleShowFullPhone.mutate(Number(profile.showFullPhone) === 1 ? 0 : 1)}
                    disabled={toggleShowFullPhone.isPending}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors disabled:opacity-50 ${
                      Number(profile.showFullPhone) === 1
                        ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                    }`}
                  >
                    {Number(profile.showFullPhone) === 1 ? (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Full Number Enabled
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Half Number (Masked)
                      </>
                    )}
                  </button>
                ) : (
                  <div className="font-medium text-gray-900 flex items-center gap-1.5 text-xs">
                    {Number(profile.showFullPhone) === 1 ? (
                      <span className="text-blue-600 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Enabled</span>
                    ) : (
                      <span className="text-gray-500 flex items-center gap-1"><EyeOff className="w-3.5 h-3.5" /> Disabled (Masked)</span>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Show Bucket</label>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" onClick={() => updateLocationSetting.mutate({ showBucket: true })} disabled={updateLocationSetting.isPending || !useAuthStore.getState().isAdmin()} className={`px-3 py-1 text-xs font-semibold disabled:opacity-50 ${profile.showBucket !== false ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Yes</button>
                  <button type="button" onClick={() => updateLocationSetting.mutate({ showBucket: false })} disabled={updateLocationSetting.isPending || !useAuthStore.getState().isAdmin()} className={`px-3 py-1 text-xs font-semibold border-l border-gray-200 disabled:opacity-50 ${profile.showBucket === false ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>No</button>
                </div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Location Tracking</label><button type="button" onClick={() => updateLocationSetting.mutate({ locationTrackingEnabled: !profile.locationTrackingEnabled })} disabled={updateLocationSetting.isPending || !useAuthStore.getState().isAdmin()} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border disabled:opacity-50 ${profile.locationTrackingEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}><MapPin className="w-3.5 h-3.5" /> {profile.locationTrackingEnabled ? 'Enabled' : 'Disabled'}</button></div>
              <div><label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Mandatory Location</label><button type="button" onClick={() => updateLocationSetting.mutate({ locationRequired: !profile.locationRequired })} disabled={updateLocationSetting.isPending || !profile.locationTrackingEnabled || !useAuthStore.getState().isAdmin()} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border disabled:opacity-50 ${profile.locationRequired ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}><ShieldCheck className="w-3.5 h-3.5" /> {profile.locationRequired ? 'App blocked when off' : 'Optional'}</button></div>
            </div>
          </div>

          <UserActivityCard userId={userId} />
          <LocationTimelineCard userId={userId} />

          {(profile.role === 'sub-admin' || profile.role === 'sales-head') && (
            <BranchAccessCard userId={userId} role={profile.role} />
          )}

          <CounsellorRemarksSection userId={userId} counsellorName={profile.name} />
        </div>
      </div>


      {/* ── Assigned Leads ── */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 flex-wrap">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-gray-400" />
            Assigned Leads
            <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full">
              {leadsData?.total ?? 0}
            </span>
          </h3>

          <div className="flex items-center gap-2 flex-wrap">
            <form
              onSubmit={(e) => { e.preventDefault(); setSearch(pendingSearch); setPage(1) }}
              className="relative flex items-center gap-2"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  placeholder="Search by name / mobile / email"
                  className="w-72 pl-9 pr-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Search
              </button>
              {search && (
                <button
                  type="button"
                  onClick={() => { setPendingSearch(''); setSearch(''); setPage(1) }}
                  className="px-3 py-2 text-xs font-semibold border rounded-md hover:bg-muted transition-colors"
                >
                  Clear
                </button>
              )}
            </form>

            <button
              onClick={() => setShowReassignModal('all')}
              disabled={!totalAssigned}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border bg-background text-amber-700 border-amber-200 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Reassign every lead from this counsellor to someone else"
            >
              <UserPlus className="h-3.5 w-3.5" /> Reassign All
            </button>

            <button
              onClick={() => setConfirmUnassignAll(true)}
              disabled={!totalAssigned || unassignAll.isPending}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border bg-background text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Remove every lead from this counsellor's plate"
            >
              {unassignAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              Unassign All
            </button>
          </div>
        </div>

        {/* Selection bar — visible only when something is selected on the page */}
        {selectedCount > 0 && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 bg-primary/5 border-b border-primary/10 flex-wrap">
            <div className="text-sm font-semibold text-primary flex items-center gap-2">
              <span className="px-2 py-0.5 bg-primary text-primary-foreground rounded-full text-xs">
                {selectedCount}
              </span>
              lead{selectedCount === 1 ? '' : 's'} selected
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline ml-2"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowReassignModal('selected')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" /> Reassign to…
              </button>
              <button
                onClick={() => {
                  if (confirm(`Unassign ${selectedCount} lead${selectedCount === 1 ? '' : 's'} from ${profile.name}?`)) {
                    bulkUnassign.mutate(Array.from(selected))
                  }
                }}
                disabled={bulkUnassign.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border bg-background text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {bulkUnassign.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
                Unassign Selected
              </button>
            </div>
          </div>
        )}

        {/* Select-all-on-page toggle */}
        {visibleLeadIds.length > 0 && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-50 bg-gray-50/50">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              Select all on this page ({visibleLeadIds.length})
            </label>
          </div>
        )}

        <div className="p-4 space-y-3">
          {leadsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : !leadsData?.data?.length ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <div className="h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center">
                <User className="h-7 w-7 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">No leads assigned</p>
              <p className="text-xs text-gray-400">
                {search ? 'No matches for this search' : 'This counsellor has no leads on their plate'}
              </p>
            </div>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            leadsData.data.map((lead: any, i: number) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                index={(page - 1) * pageSize + i + 1}
                isSelected={selected.has(lead.id)}
                onSelect={() => toggleSelect(lead.id)}
                extraActions={
                  <button
                    onClick={() => {
                      if (confirm(`Unassign lead "${lead.name}" from ${profile.name}?`)) {
                        unassignOne.mutate(lead.id)
                      }
                    }}
                    disabled={unassignOne.isPending && unassignOne.variables === lead.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-background text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all disabled:opacity-50"
                    title="Unassign this lead"
                  >
                    {unassignOne.isPending && unassignOne.variables === lead.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserMinus className="h-3.5 w-3.5" />
                    )}
                    Unassign
                  </button>
                }
              />
            ))
          )}
        </div>

        {leadsData && leadsData.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-t border-gray-100">
            <span className="text-sm text-gray-600">
              Showing <strong>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, leadsData.total)}</strong> of{' '}
              <strong>{leadsData.total.toLocaleString()}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border hover:bg-white disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 py-1.5 text-sm font-semibold">
                {page} / {leadsData.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(leadsData.totalPages, p + 1))}
                disabled={page === leadsData.totalPages}
                className="p-2 rounded-lg border hover:bg-white disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Reassign Modal ── */}
      {showReassignModal && (
        <ReassignModal
          excludeUserId={userId}
          fromCounsellorName={profile.name}
          target={
            showReassignModal === 'all'
              ? { kind: 'all', count: totalAssigned }
              : { kind: 'selected', count: selectedCount }
          }
          onClose={() => setShowReassignModal(null)}
          onConfirm={(target) => {
            if (showReassignModal === 'all') reassignAll.mutate(target.id)
            else reassign.mutate({ leadIds: Array.from(selected), targetId: target.id })
          }}
          submitting={reassign.isPending || reassignAll.isPending}
        />
      )}

      {/* ── Unassign-All Confirm ── */}
      {confirmUnassignAll && (
        <ConfirmDialog
          title="Unassign ALL leads?"
          message={
            <>
              You are about to remove <strong>{totalAssigned.toLocaleString()}</strong> lead
              {totalAssigned === 1 ? '' : 's'} from <strong>{profile.name}</strong>.
              These leads will become unassigned and will need to be reassigned manually
              (or claimed from the bucket). This action cannot be undone.
            </>
          }
          confirmLabel="Yes, unassign all"
          destructive
          submitting={unassignAll.isPending}
          onCancel={() => setConfirmUnassignAll(false)}
          onConfirm={() => unassignAll.mutate()}
        />
      )}
    </div>
  )
}

// ─── Branch membership (which branch this user belongs to) ───────────────────
// A user's branch is what scopes them under a sub-admin / sales-head, so this
// is editable for every profile role. Saves immediately on change.
function ProfileBranchSelect({ userId, currentBranchId }: { userId: number; currentBranchId: number | null }) {
  const qc = useQueryClient()
  const { data: branches = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
  })
  const save = useMutation({
    mutationFn: (branchId: number | null) => usersApi.update(userId, { branchId }),
    onSuccess: () => {
      toast.success('Branch updated')
      qc.invalidateQueries({ queryKey: ['users', userId] })
    },
    onError: () => toast.error('Failed to update branch'),
  })
  return (
    <select
      value={currentBranchId ?? ''}
      onChange={(e) => save.mutate(e.target.value ? Number(e.target.value) : null)}
      disabled={save.isPending}
      className="w-full px-2 py-1.5 text-sm border rounded-md bg-background font-medium text-gray-900 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">— None —</option>
      {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
    </select>
  )
}

// ─── Branch Access editor (sub-admin / sales-head only) ──────────────────────
// Pick which branches this manager oversees. A sub-admin sees ALL data (calls,
// leads, reports, app-tracking) for employees in these branches; a sales-head
// is a normal counsellor except its Calls section is limited to these branches.
// None selected → no team data.
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function TimelineIcon({ type }: { type: UserActivityTimelineItem['type'] }) {
  const map: Record<UserActivityTimelineItem['type'], { icon: React.ReactNode; cls: string }> = {
    call: { icon: <PhoneCall className="w-3.5 h-3.5" />, cls: 'bg-blue-50 text-blue-600' },
    followup: { icon: <Calendar className="w-3.5 h-3.5" />, cls: 'bg-purple-50 text-purple-600' },
    note: { icon: <StickyNote className="w-3.5 h-3.5" />, cls: 'bg-amber-50 text-amber-600' },
    comment: { icon: <MessageCircle className="w-3.5 h-3.5" />, cls: 'bg-teal-50 text-teal-600' },
    status: { icon: <RefreshCw className="w-3.5 h-3.5" />, cls: 'bg-emerald-50 text-emerald-600' },
  }
  const v = map[type]
  return <div className={`p-1.5 rounded-lg shrink-0 ${v.cls}`}>{v.icon}</div>
}

function UserActivityCard({ userId }: { userId: number }) {
  const today = toISODate(new Date())
  const [date, setDate] = useState(today)

  const { data, isLoading } = useQuery<UserActivity>({
    queryKey: ['users', userId, 'activity', date],
    queryFn: () => usersApi.activity(userId, date),
    enabled: !!userId,
  })

  function shiftDay(delta: number) {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() + delta)
    setDate(toISODate(d))
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-400" /> Activity
        </h3>
        <div className="flex items-center gap-3">
          <Link
            to="/app/login-logs"
            search={{ userId: Number(userId), datePreset: 'all' }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold border border-blue-200 transition-all shadow-sm"
            title="View complete login history for this counsellor in the same tab"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>View Login Activity Logs</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftDay(-1)}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-black focus:border-transparent outline-none"
            />
            <button
              onClick={() => shiftDay(1)}
              disabled={date >= today}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Device + last logins */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="rounded-2xl border border-gray-100 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1.5">
                <Smartphone className="w-3.5 h-3.5" /> App version
              </div>
              {data?.device ? (
                <>
                  <div className="text-sm font-medium text-gray-900">
                    {data.device.appVersion ? `v${data.device.appVersion}` : 'Unknown version'}
                  </div>
                  <div className="text-xs text-gray-500">
                    Last seen {new Date(data.device.lastSeenAt).toLocaleString()}
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-400">No app installed / never opened</div>
              )}
            </div>

            <div className="rounded-2xl border border-gray-100 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1.5">
                <Monitor className="w-3.5 h-3.5" /> Last web login
              </div>
              {data?.lastLoginWeb ? (
                <>
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(data.lastLoginWeb.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{data.lastLoginWeb.ip || '—'}</div>
                </>
              ) : (
                <div className="text-xs text-gray-400">Never logged in on web</div>
              )}
            </div>

            <div className="rounded-2xl border border-gray-100 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1.5">
                <LogIn className="w-3.5 h-3.5" /> Last app login
              </div>
              {data?.lastLoginApp ? (
                <>
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(data.lastLoginApp.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{data.lastLoginApp.ip || '—'}</div>
                </>
              ) : (
                <div className="text-xs text-gray-400">Never logged in on app</div>
              )}
            </div>
          </div>

          {/* Timeline for the selected day */}
          <div className="text-xs font-semibold text-gray-400 uppercase mb-2">
            Activity on {new Date(`${date}T00:00:00`).toLocaleDateString()}
          </div>
          {(data?.timeline.length ?? 0) === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-2xl">
              No recorded activity this day.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {data?.timeline.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-gray-50">
                  <TimelineIcon type={item.type} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-800 truncate">{item.summary}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                      {new Date(item.at).toLocaleTimeString()}
                      {item.leadName && <span>· {item.leadName}</span>}
                      {item.source && <span className="capitalize">· {item.source}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BranchAccessCard({ userId, role }: { userId: number; role: string }) {
  const qc = useQueryClient()
  const scopeText = role === 'sales-head'
    ? 'This sales-head works like a counsellor, but its Calls section only shows calls from employees in these branches.'
    : 'This sub-admin only sees calls, leads, reports and app-tracking for employees in these branches.'
  const { data: branches = [] } = useQuery<{ id: number; name: string; city?: string }[]>({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
  })
  const { data: access, isLoading } = useQuery<number[]>({
    queryKey: ['users', userId, 'branch-access'],
    queryFn: () => usersApi.branchAccess(userId),
    enabled: !!userId,
  })

  // `selected === null` means "unchanged since load"; fall back to the saved set.
  const [selected, setSelected] = useState<Set<number> | null>(null)
  const current = selected ?? new Set(access ?? [])
  const dirty = selected !== null

  const save = useMutation({
    mutationFn: (ids: number[]) => usersApi.setBranchAccess(userId, ids),
    onSuccess: () => {
      toast.success('Branch access updated')
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['users', userId, 'branch-access'] })
    },
    onError: () => toast.error('Failed to update branch access'),
  })

  function toggle(id: number) {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-6">
      <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-gray-400" /> Branch Access
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {scopeText} Untick a branch and save to revoke that access.
      </p>

      {/* Current saved access — always reflects what's stored, independent of edits */}
      {!isLoading && (
        (access?.length ?? 0) > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-500">Currently has access to:</span>
            {(access ?? []).map((id) => {
              const b = branches.find((x) => Number(x.id) === id)
              return (
                <span key={id} className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {b?.name ?? `Branch ${id}`}
                </span>
              )
            })}
          </div>
        ) : (
          <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            No branches assigned yet — this manager currently sees no team data.
          </div>
        )
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : branches.length === 0 ? (
        <p className="text-sm text-gray-400">No branches exist yet. Create branches first.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {branches.map((b) => (
            <label
              key={b.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={current.has(Number(b.id))}
                onChange={() => toggle(Number(b.id))}
                className="h-4 w-4 rounded border-gray-300 accent-blue-600"
              />
              <span className="text-sm text-gray-800">
                {b.name}
                {b.city ? <span className="text-gray-400"> · {b.city}</span> : null}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        {dirty && (
          <button
            onClick={() => setSelected(null)}
            className="px-3 py-2 text-xs font-semibold border rounded-md hover:bg-muted"
          >
            Reset
          </button>
        )}
        <button
          onClick={() => save.mutate(Array.from(current))}
          disabled={save.isPending}
          className="px-4 py-2 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save branch access
        </button>
      </div>
    </div>
  )
}

function LocationTimelineCard({ userId }: { userId: number }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [selected, setSelected] = useState<UserLocationPoint | null>(null)
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['users', userId, 'locations', date],
    queryFn: () => usersApi.locations(userId, { date, limit: 500 }),
    enabled: !!userId,
    refetchInterval: date === today ? 30_000 : false,
  })
  const points = data?.points ?? []
  const route: [number, number][] = points.slice().reverse().map((point) => [point.latitude, point.longitude])
  const latest = points[0]
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-6">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3 flex-wrap">
        <div><h3 className="font-bold text-gray-900 flex items-center gap-2"><MapPin className="w-5 h-5 text-emerald-600" /> Live Route Timeline</h3><p className="text-xs text-gray-500 mt-1">Auto-refreshes every 30 seconds for today. OpenStreetMap, no API key.</p></div>
        <div className="flex items-center gap-2"><input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); setSelected(null) }} className="px-2 py-1.5 text-sm border rounded-lg" />{date === today && <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">Live</span>}</div>
      </div>
      {isLoading ? <div className="h-72 flex items-center justify-center text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading route…</div> : points.length === 0 ? <div className="h-72 flex items-center justify-center text-sm text-gray-400">No location samples for this date.</div> : <>
        <div className="mt-4 h-80 rounded-2xl overflow-hidden border border-gray-200">
          <OpenStreetMap center={route[route.length - 1]} zoom={14} scrollWheelZoom className="h-full w-full"><OpenStreetTiles attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><RouteBounds route={route} /><RouteLine positions={route} pathOptions={{ color: '#2563eb', weight: 4 }} />{points.map((point, index) => <RoutePoint key={point.id} center={[point.latitude, point.longitude]} radius={selected?.id === point.id ? 8 : index === 0 ? 7 : 4} pathOptions={{ color: index === 0 ? '#059669' : '#2563eb', fillColor: index === 0 ? '#10b981' : '#60a5fa', fillOpacity: 1 }} eventHandlers={{ click: () => setSelected(point) }}><PointTooltip direction="top" offset={[0, -6]} opacity={1}>{new Date(point.recordedAt).toLocaleString()}</PointTooltip><Popup><strong>{index === 0 ? 'Latest location' : 'Route point'}</strong><br />{new Date(point.recordedAt).toLocaleString()}<br />Accuracy: {point.accuracyM ? `${Math.round(point.accuracyM)} m` : 'unknown'}</Popup></RoutePoint>)}</OpenStreetMap>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500"><span>{points.length} recorded point{points.length === 1 ? '' : 's'}</span><span>{latest ? `Last updated ${new Date(latest.recordedAt).toLocaleTimeString()}` : ''}{dataUpdatedAt ? ' · CRM refreshed' : ''}</span></div>
        <div className="mt-3 max-h-56 overflow-y-auto divide-y rounded-xl border border-gray-100">{points.map((point, index) => <button key={point.id} type="button" onClick={() => setSelected(point)} className={`w-full text-left px-3 py-2.5 hover:bg-emerald-50 ${selected?.id === point.id ? 'bg-emerald-50' : ''}`}><div className="flex justify-between gap-3 text-sm"><span className="font-medium text-gray-800">{index === 0 ? 'Latest · ' : ''}{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</span><span className="text-xs text-gray-500">{new Date(point.recordedAt).toLocaleString()}</span></div></button>)}</div>
      </>}
    </div>
  )
}

function RouteBounds({ route }: { route: [number, number][] }) {
  const map = useMap()
  useEffect(() => { if (route.length === 1) map.setView(route[0], 15); else if (route.length > 1) map.fitBounds(route, { padding: [24, 24] }) }, [map, route])
  return null
}
function MetricCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center">
      <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`text-3xl font-black ${color}`}>{value.toLocaleString()}</div>
    </div>
  )
}

// ─── Confirm Dialog (red destructive variant) ────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel, destructive, submitting, onConfirm, onCancel,
}: {
  title: string
  message: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  submitting?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${destructive ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg text-gray-900">{title}</h3>
            <div className="mt-2 text-sm text-gray-600 leading-relaxed">{message}</div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className={`px-4 py-2 text-sm font-semibold rounded-md text-white flex items-center gap-2 disabled:opacity-50 transition-colors ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'}`}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Reassign Modal — searchable counsellor picker ───────────────────────────

function ReassignModal({
  excludeUserId, fromCounsellorName, target, onClose, onConfirm, submitting,
}: {
  excludeUserId: number
  fromCounsellorName: string
  target: { kind: 'selected' | 'all'; count: number }
  onClose: () => void
  onConfirm: (target: CounsellorOption) => void
  submitting: boolean
}) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<CounsellorOption | null>(null)

  const { data: counsellors = [], isLoading } = useQuery<CounsellorOption[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: () => usersApi.counsellors(),
    staleTime: 5 * 60_000,
  })

  const filtered = counsellors
    .filter((c) => c.id !== excludeUserId)
    .filter((c) =>
      !search.trim() ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.designation ?? '').toLowerCase().includes(search.toLowerCase())
    )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-600" />
              Reassign {target.kind === 'all' ? 'ALL' : `${target.count}`} lead{target.count === 1 ? '' : 's'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              From <strong>{fromCounsellorName}</strong> → pick a new counsellor
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search counsellors by name…"
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">
              {search ? 'No counsellors match this search' : 'No other counsellors available'}
            </div>
          ) : (
            filtered.map((c) => {
              const isPicked = picked?.id === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPicked(c)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
                    isPicked ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold ${
                    isPicked ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-gray-900 truncate">{c.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {c.designation ? `${c.designation} · ` : ''}<span className="capitalize">{c.role}</span>
                    </div>
                  </div>
                  {isPicked && (
                    <span className="text-xs font-semibold text-blue-600 shrink-0">Selected</span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!picked) { toast.error('Pick a counsellor first'); return }
              if (!confirm(
                target.kind === 'all'
                  ? `Reassign ALL leads from ${fromCounsellorName} to ${picked.name}?`
                  : `Reassign ${target.count} lead${target.count === 1 ? '' : 's'} from ${fromCounsellorName} to ${picked.name}?`
              )) return
              onConfirm(picked)
            }}
            disabled={!picked || submitting}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-2"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <UserPlus className="h-3.5 w-3.5" />
            Reassign{picked ? ` to ${picked.name}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function CounsellorRemarksSection({ userId, counsellorName }: { userId: number; counsellorName: string }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [remarkText, setRemarkText] = useState('')

  const isAdmin = user?.role === 'admin' || user?.role === 'sub-admin' || Boolean(user?.roles?.some((r: string) => r === 'admin' || r === 'sub-admin'))

  const { data: remarks = [], isLoading } = useQuery<CounsellorRemark[]>({
    queryKey: ['remarks', { counsellorId: userId }],
    queryFn: () => remarksApi.list({ counsellorId: userId }),
    enabled: !!userId,
  })

  const createMutation = useMutation({
    mutationFn: (remark: string) => remarksApi.create({ counsellorId: userId, remark }),
    onSuccess: () => {
      toast.success('Remark added')
      setRemarkText('')
      qc.invalidateQueries({ queryKey: ['remarks', { counsellorId: userId }] })
      qc.invalidateQueries({ queryKey: ['remarks'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to add remark')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => remarksApi.delete(id),
    onSuccess: () => {
      toast.success('Remark deleted')
      qc.invalidateQueries({ queryKey: ['remarks', { counsellorId: userId }] })
      qc.invalidateQueries({ queryKey: ['remarks'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to delete remark')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!remarkText.trim()) return
    createMutation.mutate(remarkText)
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <MessageSquareQuote className="w-5 h-5 text-primary" />
          Counsellor Remarks
          <span className="px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full">
            {remarks.length}
          </span>
        </h3>
      </div>

      {isAdmin && (
        <form onSubmit={handleSubmit} className="space-y-3 bg-gray-50/70 p-4 rounded-2xl border border-gray-100">
          <label className="text-xs font-semibold text-gray-600 block">
            Add Remark for {counsellorName}
          </label>
          <textarea
            rows={2}
            value={remarkText}
            onChange={(e) => setRemarkText(e.target.value)}
            placeholder="Type a remark or official notes for this counsellor..."
            className="w-full p-3 border rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending || !remarkText.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm transition-all"
            >
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Save Remark
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        </div>
      ) : remarks.length === 0 ? (
        <div className="text-center py-6 text-xs text-gray-400">
          No remarks recorded for this counsellor yet.
        </div>
      ) : (
        <div className="space-y-3">
          {remarks.map((r) => {
            const canDelete = isAdmin || (r.createdById && Number(r.createdById) === Number(user?.id))
            return (
              <div key={r.id} className="p-3.5 rounded-xl border border-gray-100 bg-gray-50/50 space-y-2 relative">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">{r.createdBy?.name || 'Admin'}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                      {r.createdBy?.role || 'Admin'}
                    </span>
                    <span>&bull;</span>
                    <span>{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this remark?')) deleteMutation.mutate(r.id)
                      }}
                      disabled={deleteMutation.isPending}
                      className="text-gray-400 hover:text-red-600 transition-colors p-1"
                      title="Delete Remark"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <RemarkCardContent remark={r} />
              </div>
            )
          })}

        </div>
      )}
    </div>
  )
}

