import { useState } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth.store'
import { platformApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Building2, ShieldCheck, ScrollText,
  Activity, LogOut, Menu, X, Plus, Gauge,
} from 'lucide-react'

const NAV = [
  { section: 'Manage', items: [
    { to: '/super', label: 'Overview', icon: LayoutDashboard, exact: true },
    { to: '/super/customers', label: 'Customers', icon: Building2 },
  ]},
  { section: 'Platform', items: [
    { to: '/super/admins', label: 'Super Admins', icon: ShieldCheck },
    { to: '/super/api-usage', label: 'API Usage', icon: Gauge },
    { to: '/super/audit', label: 'Audit Log', icon: ScrollText },
    { to: '/super/health', label: 'System Health', icon: Activity },
  ]},
]

/**
 * The control-plane shell.
 *
 * Light, like the rest of the product — but it must never be mistaken for the
 * customer CRM, because the actions in here are destructive across companies.
 * Three things carry that distinction now that a dark background no longer does:
 * the violet identity rail pinned to the top of the viewport, the violet mark and
 * "Super Admin" wordmark, and near-black primary buttons where the CRM uses blue.
 */
export function SuperAdminLayout() {
  const navigate = useNavigate()
  const { platformUser, logout } = useAuthStore()
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  async function onSignOut() {
    await platformApi.logout().catch(() => undefined)
    logout()
    navigate({ to: '/login' })
  }

  const isActive = (item: { to: string; exact?: boolean }) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to)

  const initials = (platformUser?.name ?? 'SA')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="min-h-screen bg-white">
      {/* Identity rail — always on screen, so the panel is recognisable even
          from a glance at a browser thumbnail. */}
      <div className="fixed inset-x-0 top-0 z-50 h-1 bg-violet-600" />

      <header className="sticky top-0 z-40 mt-1 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => setOpen((v) => !v)}
            className="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            aria-label="Toggle navigation"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <Link to="/super" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-[11px] font-bold text-white shadow-sm">
              SA
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-slate-900">
                Super Admin
              </span>
              <span className="mt-0.5 text-[11px] text-slate-400">Sales CRM</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/super/customers/new"
              className="hidden items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 sm:inline-flex"
            >
              <Plus className="h-4 w-4" /> New customer
            </Link>

            <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />

            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                {initials}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-medium text-slate-900">{platformUser?.name}</div>
                <div className="text-[11px] text-slate-400">
                  {platformUser?.isRoot ? 'Root super admin' : 'Super admin'}
                </div>
              </div>
            </div>

            <button
              onClick={onSignOut}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 w-64 shrink-0 border-r border-slate-200 bg-white px-3 pb-6 pt-20 transition-transform',
            'lg:sticky lg:top-[60px] lg:h-[calc(100vh-60px)] lg:translate-x-0 lg:pt-5',
            open ? 'translate-x-0 shadow-xl' : '-translate-x-full lg:shadow-none',
          )}
        >
          <nav className="space-y-6">
            {NAV.map((group) => (
              <div key={group.section}>
                <h3 className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {group.section}
                </h3>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item)
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-violet-50 font-medium text-violet-700'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                        )}
                      >
                        {active && (
                          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-violet-600" />
                        )}
                        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-violet-600' : 'text-slate-400')} />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] leading-relaxed text-slate-500">
              Every customer runs in their own database schema. Nothing you do here can reach
              another customer&apos;s data.
            </p>
          </div>
        </aside>

        {open && (
          <button
            className="fixed inset-0 z-20 bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
