import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { webmailAccountsApi, type WebmailAccount } from '@/lib/api'
import { toast } from 'sonner'
import {
  Mail, Lock, Globe, Plus, Edit2, Trash2, LogIn, Search,
  Loader2, Eye, EyeOff, X, RefreshCw
} from 'lucide-react'
import { format } from 'date-fns'

const DEFAULT_WEBMAIL_URL = 'https://webmail.tutelagestudy.com'

export function WebmailAccountsPage() {
  const queryClient = useQueryClient()

  // Form state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [webmailUrl, setWebmailUrl] = useState(DEFAULT_WEBMAIL_URL)
  const [showPassword, setShowPassword] = useState(false)
  const [search, setSearch] = useState('')

  // Queries & Mutations
  const { data: accounts = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['webmail-accounts'],
    queryFn: webmailAccountsApi.list,
  })

  const createMutation = useMutation({
    mutationFn: webmailAccountsApi.create,
    onSuccess: () => {
      toast.success('Webmail account added successfully')
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['webmail-accounts'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to add webmail account')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { email: string; password?: string; webmailUrl?: string } }) =>
      webmailAccountsApi.update(id, data),
    onSuccess: () => {
      toast.success('Webmail account updated successfully')
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['webmail-accounts'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to update webmail account')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: webmailAccountsApi.delete,
    onSuccess: () => {
      toast.success('Webmail account deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['webmail-accounts'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to delete webmail account')
    },
  })

  const loginMutation = useMutation({
    mutationFn: webmailAccountsApi.loginUrl,
    onSuccess: (data) => {
      if (data.loginUrl) {
        window.open(data.loginUrl, '_blank', 'noopener,noreferrer')
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to generate webmail login URL')
    },
  })

  function resetForm() {
    setEditingId(null)
    setEmail('')
    setPassword('')
    setWebmailUrl(DEFAULT_WEBMAIL_URL)
    setShowPassword(false)
  }

  function handleStartEdit(acc: WebmailAccount) {
    setEditingId(acc.id)
    setEmail(acc.email)
    setPassword('')
    setWebmailUrl(acc.webmailUrl || DEFAULT_WEBMAIL_URL)
    setShowPassword(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim()
    const trimmedUrl = webmailUrl.trim() || DEFAULT_WEBMAIL_URL

    if (!trimmedEmail) {
      toast.error('Please enter an email address')
      return
    }

    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        data: {
          email: trimmedEmail,
          password: password ? password.trim() : undefined,
          webmailUrl: trimmedUrl,
        },
      })
    } else {
      if (!password) {
        toast.error('Please enter a password')
        return
      }
      createMutation.mutate({
        email: trimmedEmail,
        password: password.trim(),
        webmailUrl: trimmedUrl,
      })
    }
  }

  function handleDelete(id: number, accEmail: string) {
    if (window.confirm(`Are you sure you want to delete the webmail account for "${accEmail}"?`)) {
      deleteMutation.mutate(id)
    }
  }

  function handleLogin(id: number) {
    loginMutation.mutate(id)
  }

  const filteredAccounts = accounts.filter((acc) => {
    if (!search.trim()) return true
    const query = search.toLowerCase()
    return (
      acc.email.toLowerCase().includes(query) ||
      acc.webmailUrl.toLowerCase().includes(query)
    )
  })

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Webmail Accounts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage admin webmail accounts and launch direct cPanel auto-logins
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-accent transition-colors"
          title="Refresh List"
        >
          <RefreshCw className={`h-4 w-4 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Form Card: Add / Edit Account ── */}
      <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-base font-semibold flex items-center gap-2 text-destructive">
            <Mail className="h-4 w-4" />
            {editingId ? 'Update Webmail Account' : 'Add Webmail Account'}
          </h2>
          {editingId && (
            <button
              onClick={resetForm}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Cancel Edit
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Email Field */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Email Address <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter Email"
                  className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Password {editingId ? <span className="text-muted-foreground text-[10px] font-normal">(Leave blank to keep old)</span> : <span className="text-destructive">*</span>}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required={!editingId}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingId ? 'Leave blank to keep old password' : 'Enter Password'}
                  className="w-full pl-9 pr-10 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Webmail URL Field */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Webmail URL <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="url"
                  required
                  value={webmailUrl}
                  onChange={(e) => setWebmailUrl(e.target.value)}
                  placeholder="https://webmail.tutelagestudy.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                <Edit2 className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {editingId ? 'Update Account' : 'Save Account'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-accent font-medium text-muted-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Table Card: Account List ── */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden space-y-3">
        <div className="p-5 border-b flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold flex items-center gap-2 text-destructive">
            Webmail Account List
            <span className="text-xs font-normal text-muted-foreground">({filteredAccounts.length} entries)</span>
          </h2>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b">
              <tr>
                <th className="px-4 py-3 w-16 text-center">S.No.</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Webmail URL</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading webmail accounts...
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No webmail accounts found.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((acc, index) => (
                  <tr key={acc.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-3 text-center text-muted-foreground font-mono text-xs">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {acc.email}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <a
                        href={acc.webmailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {acc.webmailUrl}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {acc.createdAt ? format(new Date(acc.createdAt), 'dd-MM-yyyy hh:mm a') : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Green Login Button */}
                        <button
                          onClick={() => handleLogin(acc.id)}
                          disabled={loginMutation.isPending && loginMutation.variables === acc.id}
                          className="p-1.5 text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 rounded-lg transition-colors"
                          title="Direct Login to Webmail"
                        >
                          {loginMutation.isPending && loginMutation.variables === acc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <LogIn className="h-4 w-4" />
                          )}
                        </button>

                        {/* Blue Edit Button */}
                        <button
                          onClick={() => handleStartEdit(acc)}
                          className="p-1.5 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors"
                          title="Edit Account"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>

                        {/* Red Delete Button */}
                        <button
                          onClick={() => handleDelete(acc.id, acc.email)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 rounded-lg transition-colors"
                          title="Delete Account"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
