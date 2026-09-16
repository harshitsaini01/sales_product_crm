import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, usersApi, branchesApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, normalizePhone } from '@/lib/utils'
import { toast } from 'sonner'
import { Loader2, Plus, UserCheck, UserX, Search, Shield, Eye, EyeOff, Zap, ZapOff, ExternalLink, LogIn } from 'lucide-react'
import type { User } from '@/types'

// Roles that have a dedicated profile page with assigned-leads view.
const PROFILE_ROLES = new Set(['counsellor', 'sub-admin', 'employee', 'sales-head'])

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  'sub-admin': 'bg-orange-100 text-orange-700',
  'sales-head': 'bg-teal-100 text-teal-700',
  counsellor: 'bg-blue-100 text-blue-700',
  employee: 'bg-green-100 text-green-700',
  franchise: 'bg-purple-100 text-purple-700',
  warehouse: 'bg-slate-100 text-slate-700',
  accounts: 'bg-emerald-100 text-emerald-800',
}

export function Users() {
  const { isAdmin, user: currentUser, impersonate: storeImpersonate } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({})

  const togglePasswordVisibility = (id: number) => {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleImpersonate = async (u: User) => {
    try {
      const data = await api.post(`/auth/impersonate/${u.id}`).then((r) => r.data)
      storeImpersonate(data.token, data.user)
      toast.success(`Logged in as ${u.name}`)
      navigate({ to: '/app' })
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to login as this user'
      toast.error(msg)
    }
  }

  function openUser(u: User) {
    if (PROFILE_ROLES.has(u.role)) {
      navigate({ to: '/app/profiles/counsellor/$id', params: { id: String(u.id) } })
    } else {
      setSelectedUser(u)
    }
  }

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users', roleFilter, showInactive],
    queryFn: () => usersApi.list({
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(showInactive ? { includeInactive: 1 } : {}),
    }),
  })

  const activeCount = users.filter((u) => u.status === 1).length
  const inactiveCount = users.filter((u) => u.status === 0).length

  const deactivate = useMutation({
    mutationFn: (id: number) => usersApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User deactivated') },
    onError: () => toast.error('Failed to deactivate user'),
  })

  const reactivate = useMutation({
    mutationFn: (id: number) => usersApi.toggleStatus(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User reactivated') },
    onError: () => toast.error('Failed to reactivate user'),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) =>
      usersApi.changeRole(id, role),
    onMutate: async ({ id, role }) => {
      await qc.cancelQueries({ queryKey: ['users'] })
      const snapshots = qc.getQueriesData<User[]>({ queryKey: ['users'] })
      snapshots.forEach(([key, list]) => {
        if (!Array.isArray(list)) return
        qc.setQueryData<User[]>(
          key,
          list.map((u) => (u.id === id ? { ...u, role } : u)),
        )
      })
      return { snapshots }
    },
    onSuccess: (_d, vars) => toast.success(`Role changed to ${vars.role}`),
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error('Failed to change role')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const toggleAutoAssign = useMutation({
    mutationFn: ({ id, value }: { id: number; value: number }) =>
      usersApi.update(id, { automaticAsignLead: value }),
    onMutate: async ({ id, value }) => {
      await qc.cancelQueries({ queryKey: ['users'] })
      const snapshots = qc.getQueriesData<User[]>({ queryKey: ['users'] })
      snapshots.forEach(([key, list]) => {
        if (!Array.isArray(list)) return
        qc.setQueryData<User[]>(
          key,
          list.map((u) => (u.id === id ? { ...u, automaticAsignLead: value } : u)),
        )
      })
      return { snapshots }
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.value === 1 ? 'Auto-assign enabled' : 'Auto-assign disabled')
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error('Failed to update auto-assign')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const toggleShowFullPhone = useMutation({
    mutationFn: ({ id, value }: { id: number; value: number }) =>
      usersApi.update(id, { showFullPhone: value }),
    onMutate: async ({ id, value }) => {
      await qc.cancelQueries({ queryKey: ['users'] })
      const snapshots = qc.getQueriesData<User[]>({ queryKey: ['users'] })
      snapshots.forEach(([key, list]) => {
        if (!Array.isArray(list)) return
        qc.setQueryData<User[]>(
          key,
          list.map((u) => (u.id === id ? { ...u, showFullPhone: value } : u)),
        )
      })
      return { snapshots }
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.value === 1 ? 'Full phone number permission enabled' : 'Full phone number permission disabled')
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error('Failed to update full phone permission')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const filtered = users.filter((u: User) =>
    !search ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.mobile?.includes(search) ||
    u.loginid?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Team Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {showInactive
              ? `${users.length} total · ${activeCount} active · ${inactiveCount} inactive`
              : `${activeCount} active users`}
          </p>
        </div>
        {isAdmin() && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, mobile..."
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="sub-admin">Sub Admin</option>
          <option value="sales-head">Sales Head</option>
          <option value="counsellor">Sales Rep</option>
          <option value="employee">Employee</option>
          <option value="franchise">Franchise</option>
          <option value="agent">Agent</option>
          <option value="warehouse">Warehouse</option>
          <option value="accounts">Accounts</option>
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-input"
          />
          Show inactive
        </label>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 text-left font-medium text-muted-foreground">#</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Role</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Contact</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Login ID</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Auto-Assign</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Full Phone</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Joined</th>
                {isAdmin() && <th className="p-3 text-left font-medium text-muted-foreground">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    {search ? 'No users match your search' : 'No users found'}
                  </td>
                </tr>
              ) : (
                filtered.map((u: User, i: number) => (
                  <tr key={u.id} className={`border-b hover:bg-muted/30 transition-colors ${u.status === 0 ? 'opacity-60' : ''}`}>
                    <td className="p-3 text-muted-foreground">{i + 1}</td>
                    <td className="p-3">
                      <button
                        onClick={() => openUser(u)}
                        className="font-medium hover:text-primary hover:underline text-left"
                      >
                        {u.name}
                      </button>
                      {u.designation && (
                        <div className="text-xs text-muted-foreground">{u.designation}</div>
                      )}
                    </td>
                    <td className="p-3">
                      {isAdmin() ? (
                        <select
                          value={u.role}
                          onChange={(e) => {
                            const next = e.target.value
                            if (next === u.role) return
                            if (confirm(`Change ${u.name}'s role from "${u.role}" to "${next}"?`)) {
                              changeRole.mutate({ id: u.id, role: next })
                            }
                          }}
                          disabled={changeRole.isPending}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium border-0 outline-none cursor-pointer focus:ring-2 focus:ring-ring disabled:opacity-50 ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}
                          title="Change role"
                        >
                          <option value="admin">admin</option>
                          <option value="sub-admin">sub-admin</option>
                          <option value="sales-head">sales-head</option>
                          <option value="counsellor">counsellor</option>
                          <option value="employee">employee</option>
                          <option value="franchise">franchise</option>
                          <option value="agent">agent</option>
                          <option value="warehouse">warehouse</option>
                          <option value="accounts">accounts</option>
                        </select>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="text-xs space-y-0.5">
                        {u.mobile && <div>{u.mobile}</div>}
                        {u.email && <div className="text-muted-foreground">{u.email}</div>}
                      </div>
                    </td>
                    <td className="p-3 text-xs font-mono text-muted-foreground">
                      <div>{u.loginid}</div>
                      {u.passwordCopy && (
                        <div className="flex items-center gap-1 mt-1 text-xs">
                          <span>
                            {showPasswords[u.id] ? (
                              <span className="font-semibold text-foreground">{u.passwordCopy}</span>
                            ) : (
                              '••••••••'
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility(u.id)}
                            className="p-0.5 rounded hover:bg-accent text-muted-foreground transition-colors"
                            title={showPasswords[u.id] ? 'Hide password' : 'Show password'}
                          >
                            {showPasswords[u.id] ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.status === 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {u.status === 1 ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                        {u.status === 1 ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3">
                      {['counsellor', 'employee', 'sub-admin'].includes(u.role) ? (
                        isAdmin() ? (
                          <button
                            onClick={() =>
                              toggleAutoAssign.mutate({ id: u.id, value: Number(u.automaticAsignLead) === 1 ? 0 : 1 })
                            }
                            disabled={toggleAutoAssign.isPending}
                            className={`relative inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                              Number(u.automaticAsignLead) === 1
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                            title={
                              Number(u.automaticAsignLead) === 1
                                ? 'Auto-assign ON — new leads will be assigned to this user. Click to disable.'
                                : 'Auto-assign OFF — new leads stay in the bucket. Click to enable.'
                            }
                          >
                            {Number(u.automaticAsignLead) === 1 ? (
                              <>
                                <Zap className="h-3 w-3" /> ON
                              </>
                            ) : (
                              <>
                                <ZapOff className="h-3 w-3" /> OFF
                              </>
                            )}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                              Number(u.automaticAsignLead) === 1
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {Number(u.automaticAsignLead) === 1 ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                            {Number(u.automaticAsignLead) === 1 ? 'ON' : 'OFF'}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {['counsellor', 'employee', 'sub-admin', 'sales-head'].includes(u.role) ? (
                        isAdmin() ? (
                          <button
                            onClick={() =>
                              toggleShowFullPhone.mutate({ id: u.id, value: Number(u.showFullPhone) === 1 ? 0 : 1 })
                            }
                            disabled={toggleShowFullPhone.isPending}
                            className={`relative inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                              Number(u.showFullPhone) === 1
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                            title={
                              Number(u.showFullPhone) === 1
                                ? 'Full Phone Number ON — this user can see full unmasked lead numbers. Click to disable.'
                                : 'Full Phone Number OFF — this user sees masked lead numbers. Click to enable.'
                            }
                          >
                            {Number(u.showFullPhone) === 1 ? (
                              <>
                                <Eye className="h-3 w-3" /> ON
                              </>
                            ) : (
                              <>
                                <EyeOff className="h-3 w-3" /> OFF
                              </>
                            )}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                              Number(u.showFullPhone) === 1
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {Number(u.showFullPhone) === 1 ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            {Number(u.showFullPhone) === 1 ? 'ON' : 'OFF'}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {u.joiningDate ? formatDate(u.joiningDate) : formatDate(u.createdAt)}
                    </td>
                    {isAdmin() && (
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {currentUser && u.id !== currentUser.id && u.status === 1 && (
                            <button
                              onClick={() => {
                                if (confirm(`Login as ${u.name}?`)) handleImpersonate(u)
                              }}
                              className="p-1.5 rounded hover:bg-amber-50 hover:text-amber-600 transition-colors text-muted-foreground"
                              title="Login As"
                            >
                              <LogIn className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => openUser(u)}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
                            title={PROFILE_ROLES.has(u.role) ? 'Open full profile' : 'View details'}
                          >
                            {PROFILE_ROLES.has(u.role) ? <ExternalLink className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          {u.status === 1 ? (
                            <button
                              onClick={() => {
                                if (confirm(`Deactivate ${u.name}?`)) deactivate.mutate(u.id)
                              }}
                              className="p-1.5 rounded hover:bg-red-50 hover:text-red-600 transition-colors text-muted-foreground"
                              title="Deactivate"
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (confirm(`Reactivate ${u.name}?`)) reactivate.mutate(u.id)
                              }}
                              className="p-1.5 rounded hover:bg-green-50 hover:text-green-600 transition-colors text-muted-foreground"
                              title="Reactivate"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['users'] }) }}
        />
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  )
}

// ─── Add User Modal ───────────────────────────────────────────────────────────

function AddUserModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile: '',
    role: 'counsellor',
    designation: '',
    city: '',
    state: '',
    branchId: '',
  })

  // Branch list — a user's branch is what scopes them under a sub-admin / sales-head.
  const { data: branches = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
  })

  const create = useMutation({
    mutationFn: () => usersApi.create({ ...form, mobile: normalizePhone(form.mobile) }),
    onSuccess: (data) => {
      toast.success(`User created! Login: ${data.loginid} | Password: ${data.passwordCopy || '(auto-generated)'}`, {
        duration: 8000,
      })
      onSuccess()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to create user')
    },
  })

  const set = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Add New User
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Full Name *</label>
            <input value={form.name} onChange={set('name')} placeholder="Enter full name"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email *</label>
            <input type="email" value={form.email} onChange={set('email')} placeholder="Email address"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Mobile *</label>
            <input value={form.mobile} onChange={set('mobile')} placeholder="Mobile number"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Role *</label>
            <select value={form.role} onChange={set('role')}
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="counsellor">Sales Rep</option>
              <option value="employee">Employee</option>
              <option value="franchise">Franchise</option>
              <option value="agent">Agent</option>
              <option value="sales-head">Sales Head</option>
              <option value="warehouse">Warehouse</option>
              <option value="accounts">Accounts</option>
              <option value="sub-admin">Sub Admin</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Branch</label>
            <select value={form.branchId} onChange={set('branchId')}
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— None —</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Designation</label>
            <input value={form.designation} onChange={set('designation')} placeholder="e.g. Senior Sales Rep"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">City</label>
            <input value={form.city} onChange={set('city')} placeholder="City"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">State</label>
            <input value={form.state} onChange={set('state')} placeholder="State"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          <strong>Note:</strong> Login ID and password will be auto-generated. They will be shown after creating the user — note them down!
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.name || !form.email || !form.mobile}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create User
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── User Detail Modal ────────────────────────────────────────────────────────

function UserDetailModal({ user, onClose }: { user: User; onClose: () => void }) {

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">{user.name}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="space-y-2 text-sm">
          <Row label="Role" value={
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-700'}`}>
              {user.role}
            </span>
          } />
          <Row label="Email" value={user.email} />
          <Row label="Mobile" value={user.mobile} />
          <Row label="Login ID" value={<span className="font-mono">{user.loginid}</span>} />
          <Row label="Designation" value={user.designation} />
          <Row label="City" value={user.city} />
          <Row label="State" value={user.state} />
          <Row label="Status" value={
            <span className={user.status === 1 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
              {user.status === 1 ? 'Active' : 'Inactive'}
            </span>
          } />
          <Row label="Joining Date" value={user.joiningDate ? formatDate(user.joiningDate) : '—'} />
          <Row label="Created" value={formatDate(user.createdAt)} />
        </div>
        <button onClick={onClose} className="w-full px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors">
          Close
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: React.ReactNode | string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-4 py-1 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground text-xs w-28 shrink-0">{label}</span>
      <span className="text-sm font-medium text-right flex-1">{value}</span>
    </div>
  )
}
