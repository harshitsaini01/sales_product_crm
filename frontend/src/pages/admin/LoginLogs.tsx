import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Monitor, Smartphone, ShieldCheck, Search, Filter,
  Users, Calendar, Copy, Check, RefreshCw, ChevronLeft, ChevronRight,
  Globe, Laptop, Clock
} from 'lucide-react'
import { activityApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom'

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDateTime(s: string): string {
  const d = new Date(s)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function getRoleBadge(role: string) {
  switch (role) {
    case 'admin':
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-rose-100 text-rose-800 border border-rose-200">
          Admin
        </span>
      )
    case 'sub-admin':
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-100 text-amber-800 border border-amber-200">
          Sub Admin
        </span>
      )
    case 'sales-head':
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-purple-100 text-purple-800 border border-purple-200">
          Sales Head
        </span>
      )
    case 'counsellor':
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-blue-100 text-blue-800 border border-blue-200">
          Counsellor
        </span>
      )
    default:
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-gray-100 text-gray-700 border border-gray-200">
          {role}
        </span>
      )
  }
}

function parseUrlParams(): { userId: string; preset: DatePreset } {
  const sp = new URLSearchParams(window.location.search)
  const rawId = sp.get('userId') || ''
  const userId = rawId ? decodeURIComponent(rawId).replace(/["']/g, '').trim() : ''
  const preset = (sp.get('datePreset') as DatePreset) || (userId ? 'all' : 'today')
  return { userId, preset }
}

export default function LoginLogs() {
  const currentUser = useAuthStore((s) => s.user)
  const hasTeamLogAccess = !!currentUser?.roles?.some((role) =>
    role === 'admin' || role === 'sub-admin' || role === 'sales-head',
  )
  const isSelfOnly = !!currentUser && !hasTeamLogAccess

  const todayStr = useMemo(() => toISODate(new Date()), [])

  // Initialize from URL on first render
  const init = useMemo(() => parseUrlParams(), [])
  const [datePreset, setDatePreset] = useState<DatePreset>(init.preset)
  const [customFrom, setCustomFrom] = useState(todayStr)
  const [customTo, setCustomTo] = useState(todayStr)

  const [selectedUserId, setSelectedUserId] = useState<string>(init.userId)
  const [selectedRole, setSelectedRole] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [adminOnly, setAdminOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)

  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const activeUserId = isSelfOnly ? String(currentUser.id) : selectedUserId

  // ── KEY FIX: re-sync state whenever the URL search string changes ─────────
  // useMemo([], []) only runs ONCE on mount. When TanStack Router navigates to
  // /app/login-logs?userId=327 while the component is already mounted (cached),
  // the old state stays. This effect listens to actual URL changes and updates.
  const lastSearch = useRef(window.location.search)
  useEffect(() => {
    function onUrlChange() {
      const currentSearch = window.location.search
      if (currentSearch === lastSearch.current) return
      lastSearch.current = currentSearch
      const { userId, preset } = parseUrlParams()
      setSelectedUserId(userId)
      setDatePreset(preset)
      setSelectedRole('')
      setSearchQuery('')
      setAdminOnly(false)
      setPage(1)
    }
    // popstate fires on back/forward navigation
    window.addEventListener('popstate', onUrlChange)
    // TanStack Router uses history.pushState — intercept it
    const origPush = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)
    history.pushState = (...args) => { origPush(...args); onUrlChange() }
    history.replaceState = (...args) => { origReplace(...args); onUrlChange() }
    return () => {
      window.removeEventListener('popstate', onUrlChange)
      history.pushState = origPush
      history.replaceState = origReplace
    }
  }, [])

  // Compute date range ISOs
  const { fromISO, toISO } = useMemo(() => {
    if (datePreset === 'all') {
      return { fromISO: undefined, toISO: undefined }
    }

    const now = new Date()
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString()
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString()

    if (datePreset === 'today') {
      return { fromISO: startOfDay(now), toISO: endOfDay(now) }
    }
    if (datePreset === 'yesterday') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { fromISO: startOfDay(y), toISO: endOfDay(y) }
    }
    if (datePreset === 'last7') {
      const d = new Date(now)
      d.setDate(d.getDate() - 6)
      return { fromISO: startOfDay(d), toISO: endOfDay(now) }
    }
    if (datePreset === 'last30') {
      const d = new Date(now)
      d.setDate(d.getDate() - 29)
      return { fromISO: startOfDay(d), toISO: endOfDay(now) }
    }
    if (datePreset === 'thisMonth') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return { fromISO: startOfDay(d), toISO: endOfDay(now) }
    }
    if (datePreset === 'custom' && customFrom && customTo) {
      const f = new Date(`${customFrom}T00:00:00`)
      const t = new Date(`${customTo}T23:59:59`)
      return { fromISO: f.toISOString(), toISO: t.toISOString() }
    }
    return { fromISO: undefined, toISO: undefined }
  }, [datePreset, customFrom, customTo])

  // Fetch available users filter dropdown
  const { data: userOptions } = useQuery({
    queryKey: ['login-log-users'],
    queryFn: activityApi.loginLogUsers,
    staleTime: 5 * 60_000,
    enabled: hasTeamLogAccess,
  })

  // Fetch login logs
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['login-logs', fromISO, toISO, activeUserId, selectedRole, searchQuery, adminOnly, page, limit],
    queryFn: () =>
      activityApi.loginLogs({
        from: fromISO,
        to: toISO,
        userId: activeUserId ? Number(activeUserId) : undefined,
        role: selectedRole || undefined,
        q: searchQuery.trim() || undefined,
        adminOnly: adminOnly ? true : undefined,
        page,
        limit,
      }),
  })

  const copyIp = (ip: string) => {
    navigator.clipboard.writeText(ip)
    setCopiedIp(ip)
    setTimeout(() => setCopiedIp(null), 2000)
  }

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    setPage(1)
  }

  const stats = data?.stats ?? {
    totalLogins: data?.total ?? 0,
    uniqueUsers: 0,
    webLogins: 0,
    appLogins: 0,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Login Audit & Logs</h1>
              <p className="text-xs text-gray-500">
                Track sign-ins, devices, IP addresses, and user activity timestamps
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Selected User Active Filter Banner */}
      {!isSelfOnly && selectedUserId && data?.data?.[0] && (
        <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold flex items-center justify-center text-sm shadow-md">
              {data.data[0].userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-900 text-sm">{data.data[0].userName}</span>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  {data.data[0].userRole}
                </span>
                <span className="text-xs text-gray-500 font-mono bg-white/80 px-2 py-0.5 rounded-md border border-gray-200">
                  User ID: {selectedUserId}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{data.data[0].userEmail}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setSelectedUserId('')
              setPage(1)
            }}
            className="px-3.5 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all"
          >
            Clear Filter (Show All Logs)
          </button>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Logins</p>
            <p className="text-xl font-extrabold text-gray-900">{stats.totalLogins}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
          <div className="p-3 rounded-xl bg-purple-50 text-purple-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Active Users</p>
            <p className="text-xl font-extrabold text-gray-900">{stats.uniqueUsers}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
          <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Web Logins</p>
            <p className="text-xl font-extrabold text-gray-900">{stats.webLogins}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Mobile App Logins</p>
            <p className="text-xl font-extrabold text-gray-900">{stats.appLogins}</p>
          </div>
        </div>
      </div>

      {/* Date Presets + Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        {/* Date Presets */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Date Range:
            </span>

            {[
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'last7', label: 'Last 7 Days' },
              { id: 'last30', label: 'Last 30 Days' },
              { id: 'thisMonth', label: 'This Month' },
              { id: 'custom', label: 'Custom Range' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetChange(preset.id as DatePreset)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  datePreset === preset.id
                    ? 'bg-black text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value)
                  setPage(1)
                }}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-black outline-none"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value)
                  setPage(1)
                }}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-black outline-none"
              />
            </div>
          )}
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* User Select */}
          {!isSelfOnly && <div className="flex flex-col">
            <label className="text-[11px] font-medium text-gray-500 mb-1">User / Team Member</label>
            <select
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value)
                setPage(1)
              }}
              className="px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-black outline-none"
            >
              <option value="">All Users</option>
              {selectedUserId && !userOptions?.some((u) => String(u.id) === selectedUserId) && data?.data?.[0] && (
                <option value={selectedUserId}>
                  {data.data[0].userName} ({data.data[0].userRole})
                </option>
              )}
              {userOptions?.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>}

          {/* Role Filter */}
          {!isSelfOnly && <div className="flex flex-col">
            <label className="text-[11px] font-medium text-gray-500 mb-1">Role</label>
            <select
              value={selectedRole}
              onChange={(e) => {
                setSelectedRole(e.target.value)
                setPage(1)
              }}
              className="px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-black outline-none"
            >
              <option value="">All Roles</option>
              <option value="counsellor">Sales Rep</option>
              <option value="sales-head">Sales Head</option>
              <option value="sub-admin">Sub Admin</option>
              <option value="admin">Admin</option>
              <option value="agent">Partner Agent</option>
              <option value="employee">Employee</option>
            </select>
          </div>}

          {/* Search Input */}
          <div className={`flex flex-col ${isSelfOnly ? 'sm:col-span-2 md:col-span-4' : 'sm:col-span-2'}`}>
            <label className="text-[11px] font-medium text-gray-500 mb-1">Search Keywords</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by user name, email, IP address, browser..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-black outline-none"
              />
            </div>
          </div>
        </div>

        {/* Toggle options for Admin / Sub-Admin */}
        {(currentUser?.role === 'admin' || currentUser?.role === 'sub-admin' || currentUser?.roles?.includes('admin') || currentUser?.roles?.includes('sub-admin')) && (
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setAdminOnly((v) => !v)
                setPage(1)
              }}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                adminOnly
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white border-amber-600 shadow-sm shadow-amber-500/20'
                  : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{adminOnly ? 'Showing Admin & Sub-Admin Logins Only' : 'Show Admin & Sub-Admin Logins'}</span>
            </button>
            <span className="text-[11px] text-gray-500 italic">
              {adminOnly ? '(Only showing admin/sub-admin logins)' : '(Admin & Sub-Admin logins are hidden by default)'}
            </span>
          </div>
        )}
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-semibold uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3.5">User</th>
                <th className="text-left px-4 py-3.5">Role</th>
                <th className="text-left px-4 py-3.5">IP Address</th>
                <th className="text-left px-4 py-3.5">Device & Browser</th>
                <th className="text-left px-5 py-3.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-gray-300" />
                    Loading login activity logs...
                  </td>
                </tr>
              )}

              {!isLoading && (data?.data.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                    <Filter className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                    No login records match the selected date range or filters.
                  </td>
                </tr>
              )}

              {data?.data.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50/70 transition-colors">
                  {/* User info */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 font-bold text-xs flex items-center justify-center border border-gray-200 shrink-0">
                        {row.userName?.charAt(0)?.toUpperCase() || 'U'}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-xs">{row.userName}</p>
                        <p className="text-[11px] text-gray-500">{row.userEmail}</p>
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td className="px-4 py-3.5">{getRoleBadge(row.userRole)}</td>

                  {/* IP Address */}
                  <td className="px-4 py-3.5">
                    {row.ip ? (
                      <button
                        onClick={() => copyIp(row.ip!)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 font-mono text-[11px] text-gray-800 transition-colors group"
                        title="Click to copy IP address"
                      >
                        <Globe className="w-3 h-3 text-gray-400" />
                        <span>{row.ip}</span>
                        {copiedIp === row.ip ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Device / Browser */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      {row.browser === 'Android App' ? (
                        <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                          <Smartphone className="w-4 h-4 shrink-0" />
                        </div>
                      ) : (
                        <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                          <Monitor className="w-4 h-4 shrink-0" />
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-gray-800 text-xs truncate max-w-[220px]" title={row.browser || undefined}>
                          {row.browser || 'Web Browser'}
                        </p>
                        {row.os && <p className="text-[10px] text-gray-500">{row.os}</p>}
                      </div>
                    </div>
                  </td>

                  {/* Timestamp */}
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900 text-xs">{fmtDateTime(row.createdAt)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination & Limits Footer */}
        {data && data.totalPages >= 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap text-xs text-gray-600 bg-gray-50/50">
            <div className="flex items-center gap-4">
              <span>
                Showing <strong>{data.data.length}</strong> of <strong>{data.total}</strong> logins
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Per page:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value))
                    setPage(1)
                  }}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white outline-none"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="mr-2">
                Page <strong>{data.page}</strong> of <strong>{data.totalPages}</strong>
              </span>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 bg-white font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 bg-white font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
