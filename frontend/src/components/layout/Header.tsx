import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { followupsApi, chatApi, notificationsApi } from '@/lib/api'
import { GlobalSearch } from './GlobalSearch'
import {
  Bell, LogOut, User, Menu, ChevronDown,
  Activity, Shield, Settings, MessageCircle, Mail,
} from 'lucide-react'

interface HeaderProps {
  onToggleSidebar?: () => void
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const { data: todayFollowups } = useQuery({
    queryKey: ['followups-today-count'],
    queryFn: () => followupsApi.today({ limit: 1 }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const { data: unread } = useQuery({
    queryKey: ['chat', 'unread-count'],
    queryFn: chatApi.unreadCount,
    refetchInterval: 30_000,
  })
  const unreadCount = unread?.count ?? 0

  const { data: notif } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.feed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const notifCount = notif?.count ?? 0

  function handleLogout() {
    logout()
    navigate({ to: '/login' })
  }

  const closeAll = useCallback(() => {
    setShowUserMenu(false)
  }, [])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAll()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeAll])

  const followupCount = todayFollowups?.total ?? 0

  const iconBtn =
    'relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'

  return (
    <header className="h-14 border-b bg-white flex items-center justify-between px-4 md:px-6 shrink-0 gap-3">
      {/* Left: Sidebar toggle + welcome */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg hover:bg-accent transition-colors lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="text-sm text-muted-foreground hidden md:block truncate">
          Welcome back, <span className="font-medium text-foreground">{user?.name}</span>
        </div>
        {/* Only for customers with the accounts module — see GlobalSearch. */}
        <GlobalSearch />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">

        {user?.role === 'admin' && (
          <Link
            to="/app/webmail-accounts"
            className="hidden sm:inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Webmail Accounts"
          >
            <Mail className="h-4 w-4" />
            Webmail
          </Link>
        )}

        {/* Today's Follow-ups — navigates to /app/followups */}
        <Link
          to="/app/followups"
          className={iconBtn}
          title="Today's follow-ups"
        >
          <Activity className="h-4 w-4" />
          {followupCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-card">
              {followupCount > 99 ? '99+' : followupCount}
            </span>
          )}
        </Link>

        {/* Chat — navigates to /app/chat */}
        <Link
          to="/app/chat"
          className={iconBtn}
          title="Team chat"
        >
          <MessageCircle className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-card">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        {/* Notifications — navigates to /app/notifications */}
        <Link
          to="/app/notifications"
          className={iconBtn}
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notifCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-card">
              {notifCount > 99 ? '99+' : notifCount}
            </span>
          )}
        </Link>

        {/* Role badge (desktop only) */}
        <div className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-muted text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          <span className="capitalize font-medium">{user?.role}</span>
        </div>

        {/* User dropdown */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex items-center gap-2 h-9 pl-1 pr-2 rounded-lg hover:bg-accent transition-colors"
          >
            <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <span className="text-sm font-medium hidden md:block max-w-[120px] truncate">{user?.name}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground hidden md:block transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-card border rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/40">
                <p className="text-sm font-semibold truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>

              <div className="py-1">
                <Link
                  to="/app/account"
                  onClick={closeAll}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                >
                  <User className="h-4 w-4" /> My Account
                </Link>
                {user?.role === 'admin' && (
                  <Link
                    to="/app/webmail-accounts"
                    onClick={closeAll}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                  >
                    <Mail className="h-4 w-4" /> Webmail Accounts
                  </Link>
                )}
                <Link
                  to="/app/settings"
                  onClick={closeAll}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                >
                  <Settings className="h-4 w-4" /> Settings
                </Link>
              </div>

              <div className="border-t py-1">
                <button
                  onClick={() => { closeAll(); handleLogout() }}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
