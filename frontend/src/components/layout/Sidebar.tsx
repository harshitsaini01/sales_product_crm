import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { useLabels } from '@/hooks/useLabels'
import { appReleasesApi } from '@/lib/api'
import { cn, downloadBlob } from '@/lib/utils'
import { toast } from 'sonner'
import {
  LayoutDashboard, Users,
  Mail, Calendar, UserCheck,
  CheckSquare, ClipboardList, Clock, Sliders, Briefcase, Trash2,
  Megaphone, Zap, Network, FileStack,
  Globe, X, UserPlus, RefreshCw, Layers, PhoneCall, BarChart3, Smartphone, Download,
  Info, ChevronDown, FilterX, PhoneOutgoing, Radio, Inbox, History,
  Activity, MessageSquareQuote, ShieldCheck, MapPinned,
  Package,
  Handshake, Receipt, ShoppingBag,
} from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles?: string[]
  /**
   * Plan module this item belongs to (a key from the backend's
   * config/features.ts). When the customer's plan does not include it, the item
   * is hidden and its route redirects — see FEATURE_ROUTES in router/index.tsx.
   */
  feature?: string
}

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'General',
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, feature: 'dashboard' },
    ]
  },
  {
    title: 'Leads',
    items: [
      { to: '/app/bucket', label: '{bucket}', icon: Inbox, feature: 'bucket' },
      { to: '/app/leads', label: '{lead:plural}', icon: Users, feature: 'leads' },
      { to: '/app/leads/new', label: 'Add {lead:plural}', icon: UserPlus, feature: 'leads' },
      { to: '/app/filter-leads', label: 'Filter {lead:plural}', icon: FilterX, feature: 'bucket' },
      { to: '/app/bulk-management', label: 'Bulk Management', icon: Layers, roles: ['admin'], feature: 'bulk_ops' },
      { to: '/app/bulk-management/operations', label: 'Bulk Operations', icon: History, roles: ['admin'], feature: 'bulk_ops' },
      { to: '/app/update-leads', label: 'Update {lead:plural}', icon: RefreshCw, roles: ['admin'], feature: 'bulk_ops' },
      { to: '/app/trash', label: 'Trash', icon: Trash2, roles: ['admin'], feature: 'trash' },
    ]
  },
  {
    title: 'Operations',
    items: [
      { to: '/app/lead-config', label: '{lead} Workflow', icon: Sliders, roles: ['admin'], feature: 'lead_config' },
      { to: '/app/duplicates', label: 'Duplicates', icon: FileStack, roles: ['admin'], feature: 'duplicates' },
      { to: '/app/products', label: 'Products', icon: Package, feature: 'deals' },
      { to: '/app/deals', label: 'Deals', icon: Handshake, feature: 'deals' },
      { to: '/app/orders', label: 'Orders', icon: ShoppingBag, feature: 'sales_docs' },
      { to: '/app/invoices', label: 'Invoices', icon: Receipt, feature: 'sales_docs' },
      { to: '/app/tasks', label: 'Tasks', icon: CheckSquare, feature: 'tasks' },
      { to: '/app/calls', label: 'Calls', icon: PhoneCall, feature: 'call_recording' },
      { to: '/app/remarks', label: 'Remarks', icon: MessageSquareQuote, feature: 'remarks' },
      { to: '/app/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'sub-admin', 'sales-head'], feature: 'reports' },
      { to: '/app/daily-reports', label: 'Daily Reports', icon: ClipboardList, feature: 'daily_reports' },
      { to: '/app/my-activity', label: 'My Activity', icon: Activity, roles: ['counsellor', 'sales-head'], feature: 'activity_tracking' },
      { to: '/app/calendar', label: 'Calendar', icon: Calendar, feature: 'calendar' },
    ]
  },
  {
    title: 'Marketing',
    items: [
      { to: '/app/whatsapp-templates', label: 'WhatsApp Templates', icon: MessageSquareQuote, feature: 'whatsapp' },
      { to: '/app/mail', label: 'Mail Management', icon: Zap, roles: ['admin', 'sub-admin'], feature: 'campaigns' },
      { to: '/app/webmail-accounts', label: 'Webmail Accounts', icon: Mail, roles: ['admin'], feature: 'inbox' },
      { to: '/app/lead-sources', label: '{lead} Sources', icon: Network, roles: ['admin', 'sub-admin'], feature: 'lead_sources' },
    ]
  },
  {
    title: 'App',
    items: [
      { to: '/app/app-release', label: 'App Releases', icon: Smartphone, roles: ['admin', 'sub-admin'], feature: 'mobile_app' },
    ]
  },
  {
    title: 'Tracking',
    items: [
      { to: '/app/inactivity-monitor', label: 'Inactivity Monitor', icon: Activity, roles: ['admin', 'sub-admin'], feature: 'activity_tracking' },
      { to: '/app/login-logs', label: 'Login Logs', icon: ShieldCheck, feature: 'login_logs' },
      { to: '/app/leaves', label: 'Leaves', icon: Clock, feature: 'tasks' },
      { to: '/app/announcements', label: 'Announcements', icon: Megaphone, feature: 'announcements' },
    ]
  },
  {
    title: 'Administration',
    items: [
      { to: '/app/agents', label: '{agent:plural}', icon: Briefcase, roles: ['admin', 'sub-admin'], feature: 'agents' },
      { to: '/app/users', label: 'Team Members', icon: UserCheck, roles: ['admin'], feature: 'users' },
      { to: '/app/live-location', label: 'Live Location', icon: MapPinned, roles: ['admin'], feature: 'location_tracking' },
      { to: '/app/branches', label: '{branch:plural}', icon: Network, roles: ['admin'], feature: 'branches' },
      { to: '/app/settings', label: 'System Settings', icon: Globe, roles: ['admin'], feature: 'settings' },
    ]
  },
  {
    title: 'Outbound',
    items: [
      { to: '/app/auto-dialer', label: 'Auto Dialer', icon: PhoneOutgoing, roles: ['admin', 'sub-admin'], feature: 'auto_dialer' },
      { to: '/app/auto-dialer/my', label: 'My Campaigns', icon: Radio, roles: ['counsellor', 'sales-head'], feature: 'auto_dialer' },
    ]
  }
]

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, hasFeature } = useAuthStore()
  const t = useLabels()
  const [showInstallGuide, setShowInstallGuide] = useState(false)

  // Fetch latest app release for the download button
  const { data: latestRelease } = useQuery({
    queryKey: ['app-releases', 'latest-sidebar'],
    queryFn: appReleasesApi.latest,
    staleTime: 5 * 60_000,
  })

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  const filterItems = (items: NavItem[]) =>
    items.filter((item) => {
      if (item.to === '/app/bucket' && user && !user.roles.includes('admin') && !user.roles.includes('sub-admin') && user.showBucket === false) return false
      // Modules the customer's plan does not include simply are not there.
      if (item.feature && !hasFeature(item.feature)) return false
      return !item.roles || (user && item.roles.some((r) => user.role === r || user.roles.includes(r as never)))
    })

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground truncate">
            {t('brand')}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors lg:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-5 overflow-y-auto custom-scrollbar">
        {navSections.map((section) => {
          const visibleItems = filterItems(section.items)

          // For the 'App' section, also add a direct download button
          if (section.title === 'App') {
            if (!hasFeature('mobile_app')) return null
            return (
              <div key={section.title} className="space-y-1">
                <h4 className="px-3 text-[10px] uppercase tracking-[0.16em] font-semibold text-sidebar-muted mb-2">
                  {section.title}
                </h4>
                <div className="space-y-1.5 px-1">
                  {/* Download card */}
                  {latestRelease?.id ? (
                    <div className="rounded-xl border bg-muted/50 p-3 space-y-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
                          <Smartphone className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-sidebar-foreground">{t('brand')}</p>
                          <p className="text-[10px] text-sidebar-muted">
                            v{latestRelease.versionName}
                            {latestRelease.sizeBytes && (
                              <> · {(latestRelease.sizeBytes / 1024 / 1024).toFixed(1)} MB</>
                            )}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          try {
                            const blob = await appReleasesApi.download(latestRelease.id)
                            downloadBlob(blob, `tutelage-counsellor-${latestRelease.versionName}.apk`)
                            onClose?.()
                          } catch {
                            toast.error('Download failed')
                          }
                        }}
                        className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download APK
                      </button>

                      {/* Installation steps toggle */}
                      <button
                        onClick={() => setShowInstallGuide((v) => !v)}
                        className="flex items-center gap-1.5 w-full text-[10px] text-sidebar-muted hover:text-sidebar-foreground transition-colors pt-0.5"
                      >
                        <Info className="h-3 w-3 shrink-0" />
                        <span className="font-medium">How to install?</span>
                        <ChevronDown className={cn('h-3 w-3 ml-auto transition-transform', showInstallGuide && 'rotate-180')} />
                      </button>

                      {showInstallGuide && (
                        <div className="text-[10px] leading-relaxed text-sidebar-muted space-y-1.5 pt-1 border-t border-sidebar-border">
                          <div className="flex gap-2">
                            <span className="font-semibold text-sidebar-foreground shrink-0">1.</span>
                            <span>Open <strong>Settings → Apps → Special Access → Install Unknown Apps</strong> on your phone</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="font-semibold text-sidebar-foreground shrink-0">2.</span>
                            <span>Select <strong>Chrome</strong> (or your browser) and enable <strong>"Allow from this source"</strong></span>
                          </div>
                          <div className="flex gap-2">
                            <span className="font-semibold text-sidebar-foreground shrink-0">3.</span>
                            <span>Click <strong>Download APK</strong> above using Chrome</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="font-semibold text-sidebar-foreground shrink-0">4.</span>
                            <span>Once downloaded, tap the notification or open <strong>Files → Downloads</strong></span>
                          </div>
                          <div className="flex gap-2">
                            <span className="font-semibold text-sidebar-foreground shrink-0">5.</span>
                            <span>Tap the APK file and press <strong>Install</strong></span>
                          </div>
                          <p className="text-sidebar-muted/80 pt-1 italic">
                            On Samsung: Settings → Biometrics → Install unknown apps
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border bg-muted/50 p-3 flex items-center gap-2.5">
                      <Smartphone className="h-5 w-5 text-sidebar-muted/60" />
                      <p className="text-xs text-sidebar-muted">No app release available yet</p>
                    </div>
                  )}

                  {/* Admin-only link to manage releases */}
                  {visibleItems.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                        'text-slate-500 hover:text-slate-800 hover:bg-slate-50',
                        '[&.active]:bg-primary/10 [&.active]:text-primary [&.active]:hover:bg-primary/10 [&.active]:hover:text-primary'
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {t.template(item.label)}
                    </Link>
                  ))}
                </div>
              </div>
            )
          }
          if (visibleItems.length === 0) return null

          return (
            <div key={section.title} className="space-y-1">
              <h4 className="px-3 text-[10px] uppercase tracking-[0.16em] font-semibold text-sidebar-muted mb-2">
                {section.title}
              </h4>
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                      'text-slate-500 hover:text-slate-800 hover:bg-slate-50',
                      '[&.active]:bg-primary/10 [&.active]:text-primary [&.active]:hover:bg-primary/10 [&.active]:hover:text-primary'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {t.template(item.label)}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* User info at bottom */}
      {user && (
        <div className="p-4 border-t border-sidebar-border shrink-0">
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-sidebar-foreground flex items-center justify-center text-xs font-semibold">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate text-sidebar-foreground">{user.name}</div>
              <div className="text-[10px] text-sidebar-muted flex items-center gap-1.5 leading-none mt-0.5 uppercase tracking-wider font-medium">
                <span className="truncate">{user.role}</span>
                <span className="opacity-40">&bull;</span>
                <span>{user.loginid}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 app-sidebar border-r border-sidebar-border flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile overlay + sidebar */}
      {isOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-400/25" onClick={onClose} />
          {/* Drawer */}
          <aside className="absolute inset-y-0 left-0 w-72 app-sidebar border-r border-sidebar-border flex flex-col shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  )
}
