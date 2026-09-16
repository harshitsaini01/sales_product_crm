import { PackageX } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

/**
 * The terminal fallback when every landing module is switched off.
 *
 * Every module is switchable per customer, including the dashboard — so it is
 * possible, by configuration, to leave someone with nowhere to go. Without this
 * page the router would bounce them between gates until the browser gave up.
 *
 * It is a dead end on purpose: nothing here can be clicked into the app,
 * because there is nothing to click into. It tells them who to ask.
 */
export default function NoModules() {
  const tenant = useAuthStore((s) => s.tenant)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <PackageX className="mx-auto h-12 w-12 text-muted-foreground/40" />

        <h1 className="mt-4 text-xl font-bold">No modules are switched on</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Your account at <strong>{tenant?.name ?? 'this company'}</strong> is signed in
          correctly, but every module has been turned off, so there is nothing to
          show you.
        </p>

        <p className="mt-3 text-sm text-muted-foreground">
          This is a settings problem, not a fault with your account — ask whoever
          manages your CRM subscription to switch a module back on.
        </p>

        {user && (
          <p className="mt-4 text-xs text-muted-foreground">
            Signed in as {user.name} ({user.email})
          </p>
        )}

        <button
          onClick={logout}
          className="mt-6 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
