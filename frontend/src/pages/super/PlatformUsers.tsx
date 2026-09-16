import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { platformApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import {
  PageHeader, Panel, Field, Loading, Empty, TableWrap, thClass, trClass, tdClass,
  formatDate, inputClass, btnPrimary, btnGhost,
} from './ui'
import { Plus, ShieldCheck, X } from 'lucide-react'

interface Row {
  id: number
  name: string
  email: string
  status: number
  isRoot: boolean
  lastLoginAt: string | null
  createdAt: string
}

export default function SuperPlatformUsers() {
  const queryClient = useQueryClient()
  const isRoot = useAuthStore((s) => s.platformUser?.isRoot ?? false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })

  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ['platform', 'users'],
    queryFn: platformApi.platformUsers,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform', 'users'] })

  const create = useMutation({
    mutationFn: () => platformApi.createPlatformUser(form),
    onSuccess: () => {
      toast.success('Super admin created')
      setForm({ name: '', email: '', password: '' })
      setAdding(false)
      refresh()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  const toggle = useMutation({
    mutationFn: (row: Row) =>
      platformApi.updatePlatformUser(row.id, { status: row.status === 1 ? 0 : 1 }),
    onSuccess: () => { toast.success('Updated'); refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update'),
  })

  const changePassword = useMutation({
    mutationFn: () => platformApi.changeOwnPassword(pw),
    onSuccess: () => {
      toast.success('Password updated')
      setPw({ currentPassword: '', newPassword: '' })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change password'),
  })

  return (
    <>
      <PageHeader
        title="Super admins"
        description="Accounts that can see and manage every customer. Kept entirely separate from any customer's own users."
        actions={
          isRoot && (
            <button onClick={() => setAdding((v) => !v)} className={adding ? btnGhost : btnPrimary}>
              {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {adding ? 'Cancel' : 'Add super admin'}
            </button>
          )
        }
      />

      <Panel title="Accounts">
        {adding && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Password" hint="At least 10 characters.">
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || form.password.length < 10 || !form.email}
              className={`${btnPrimary} mt-4`}
            >
              Create account
            </button>
          </div>
        )}

        {isLoading ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>No super admins yet.</Empty>
        ) : (
          <TableWrap minWidth={660}>
            <thead className="bg-slate-50/80">
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Email</th>
                <th className={thClass}>Last sign-in</th>
                <th className={thClass}>Status</th>
                {isRoot && <th className={`${thClass} text-right`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className={trClass}>
                  <td className={tdClass}>
                    <div className="flex items-center gap-2 font-medium text-slate-900">
                      {row.name}
                      {row.isRoot && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
                          <ShieldCheck className="h-3 w-3" /> root
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${tdClass} text-slate-600`}>{row.email}</td>
                  <td className={`${tdClass} text-slate-600`}>{formatDate(row.lastLoginAt)}</td>
                  <td className={tdClass}>
                    {row.status === 1 ? (
                      <span className="text-xs font-medium text-emerald-600">Active</span>
                    ) : (
                      <span className="text-xs text-slate-400">Disabled</span>
                    )}
                  </td>
                  {isRoot && (
                    <td className={`${tdClass} text-right`}>
                      {!row.isRoot && (
                        <button
                          onClick={() => toggle.mutate(row)}
                          disabled={toggle.isPending}
                          className={`${btnGhost} px-2 py-1 text-xs`}
                        >
                          {row.status === 1 ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div className="mt-5">
        <Panel title="Change your password">
          <div className="grid max-w-lg gap-4 sm:grid-cols-2">
            <Field label="Current password">
              <input
                type="password"
                value={pw.currentPassword}
                onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="New password" hint="At least 10 characters.">
              <input
                type="password"
                value={pw.newPassword}
                onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <button
                onClick={() => changePassword.mutate()}
                disabled={changePassword.isPending || pw.newPassword.length < 10}
                className={btnPrimary}
              >
                Update password
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
