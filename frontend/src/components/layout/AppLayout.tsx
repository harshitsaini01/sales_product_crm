import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/lib/api'
import { ShieldAlert } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { AnnouncementPopup } from '@/components/common/AnnouncementPopup'
import { InactivityTracker } from '@/components/common/InactivityTracker'
import { AutoLogoutListener } from '@/components/common/AutoLogoutListener'
import { useAuthStore } from '@/stores/auth.store'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const {
    user, isImpersonating, stopImpersonating, stopTenantImpersonation,
    impersonatedBy, tenant, setTenantMeta, scope,
  } = useAuthStore()
  const navigate = useNavigate()

  // /auth/me is the authoritative source for the customer's plan and modules —
  // a super admin can switch a module off while somebody is signed in, and the
  // sidebar should follow without needing a re-login.
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: scope === 'tenant',
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!me) return
    setTenantMeta({
      tenant: me.tenant ?? null,
      features: me.features ?? {},
      leadFields: me.leadFields ?? { hiddenGroups: [], hiddenFields: [] },
      labels: me.labels ?? {},
      impersonatedBy: me.impersonatedBy ?? null,
    })
  }, [me, setTenantMeta])

  function handleStopImpersonating() {
    // Two different kinds of impersonation end here. A super admin who came in
    // via "Log in as" returns to the control plane on their platform session; an
    // admin acting as one of their own staff returns to Team Members.
    if (impersonatedBy) {
      stopTenantImpersonation()
      navigate({ to: '/super/customers' })
      return
    }
    stopImpersonating()
    navigate({ to: '/app/users' })
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        {/* Super admin acting as a customer. Deliberately red and louder than
            the ordinary impersonation banner: this session is inside somebody
            else's company data, and it expires in 15 minutes. */}
        {impersonatedBy && (
          <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-semibold flex flex-wrap items-center justify-center gap-2 border-b border-red-700 shrink-0">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>
              Super admin session — viewing <strong>{tenant?.name ?? 'a customer'}</strong> as{' '}
              <strong>{user?.name}</strong>. Anything you change here is their live data.
            </span>
            <button
              onClick={handleStopImpersonating}
              className="bg-white text-red-700 hover:bg-red-50 px-3 py-1 rounded-md text-xs transition-colors font-bold ml-2 shadow-sm"
            >
              Exit
            </button>
          </div>
        )}

        {isImpersonating && !impersonatedBy && (
          <div className="bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-semibold flex items-center justify-center gap-2 border-b border-amber-600 shrink-0">
            <span>You are logged in as <strong>{user?.name}</strong> ({user?.role})</span>
            <button
              onClick={handleStopImpersonating}
              className="bg-amber-950 text-amber-100 hover:bg-amber-900 px-3 py-1 rounded-md text-xs transition-colors font-bold ml-2 shadow-sm"
            >
              Exit Impersonation
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 custom-scrollbar">
          <Outlet />
        </main>
      </div>
      {/* Global popup — surfaces any unread announcement on any page. */}
      <AnnouncementPopup />
      {/* Inactivity tracker — counsellors only. Polls the server for the
          combined web+mobile idle window and shows warning/alert/halfday. */}
      <InactivityTracker />
      {/* Auto logout listener — logs out user after 1 hour of inactivity */}
      <AutoLogoutListener />
    </div>
  )
}
