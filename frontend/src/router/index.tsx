import { createRouter, createRoute, createRootRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth.store'
import { AppLayout } from '@/components/layout/AppLayout'
import { Login } from '@/pages/auth/Login'
import { ForgotPassword } from '@/pages/auth/ForgotPassword'
import { Dashboard } from '@/pages/admin/Dashboard'
import { SuperAdminDashboard } from '@/pages/admin/SuperAdminDashboard'
import { Leads } from '@/pages/admin/Leads'
import { LeadDetail } from '@/pages/admin/LeadDetailPage'
// EmployeeProfile and FranchiseProfile pages removed (out of scope per CLAUDE.md
// — only admin + counsellor roles are supported in the new system).
import { AddLead } from '@/pages/admin/AddLead'
import { Users } from '@/pages/admin/Users'
import { Communication } from '@/pages/admin/Communication'
import { Calendar } from '@/pages/admin/Calendar'
import { Reports } from '@/pages/admin/Reports'
import { Tasks } from '@/pages/admin/Tasks'
import { TaskLeads } from '@/pages/admin/TaskLeads'
import { TaskBuilder } from '@/pages/admin/TaskBuilder'
import { Leaves } from '@/pages/admin/Leaves'
import Settings from '@/pages/admin/Settings'
import LeadConfig from '@/pages/admin/LeadConfig'
import Agents from '@/pages/admin/Agents'
import Accounts from '@/pages/admin/Accounts'
import AccountDetail from '@/pages/admin/AccountDetail'
import Projects from '@/pages/admin/Projects'
import OrderDetail from '@/pages/admin/OrderDetail'
import ContractDetail from '@/pages/admin/ContractDetail'
import SalesDesk from '@/pages/admin/SalesDesk'
import ProjectDetail from '@/pages/admin/ProjectDetail'
import Teams from '@/pages/admin/Teams'
import Contacts from '@/pages/admin/Contacts'
import ContactDetail from '@/pages/admin/ContactDetail'
import CustomFields from '@/pages/admin/CustomFields'
import NoModules from '@/pages/admin/NoModules'
import Deals from '@/pages/admin/Deals'
import DealDetail from '@/pages/admin/DealDetail'
import Pipelines from '@/pages/admin/Pipelines'
import Products from '@/pages/admin/Products'
import SalesOps from '@/pages/admin/SalesOps'
import Quotes, { QuoteDetail } from '@/pages/admin/Quotes'
import Orders, { Contracts } from '@/pages/admin/Orders'
import Invoices, { InvoiceDetail } from '@/pages/admin/Invoices'
import Trash from '@/pages/admin/Trash'
import BulkManagement from '@/pages/admin/BulkManagement'
import BulkOperations from '@/pages/admin/BulkOperations'
import UpdateLeads from '@/pages/admin/UpdateLeads'
import Duplicate from '@/pages/admin/Duplicate'
import Announcements from '@/pages/admin/Announcements'
import Branches from '@/pages/admin/Branches'
import BulkEmail from '@/pages/admin/BulkEmail'
import AgentProfile from '@/pages/admin/AgentProfile'
import CounsellorProfile from '@/pages/admin/CounsellorProfile'
import { LeadSources } from '@/pages/admin/LeadSources'
import MyAccount from '@/pages/admin/MyAccount'
import MailManagement from '@/pages/admin/MailManagement'
import DailyReports from '@/pages/admin/DailyReports'
import DailyReportActivity from '@/pages/admin/DailyReportActivity'
import Calls from '@/pages/admin/Calls'
import AppRelease from '@/pages/admin/AppRelease'
import CampaignGroups from '@/pages/admin/CampaignGroups'
import TodayFollowups from '@/pages/admin/TodayFollowups'
import NotificationsPage from '@/pages/admin/NotificationsPage'
import ChatPage from '@/pages/admin/ChatPage'
import FilterLeads from '@/pages/admin/FilterLeads'
import B2bContacts from '@/pages/admin/B2bContacts'
import AutoDialer from '@/pages/admin/AutoDialer'
import AutoDialerDetail from '@/pages/admin/AutoDialerDetail'
import MyCampaigns from '@/pages/admin/MyCampaigns'
import FilterLeadsBatch from '@/pages/admin/FilterLeadsBatch'
import Bucket from '@/pages/admin/Bucket'
import InactivityMonitor from '@/pages/admin/InactivityMonitor'
import LoginLogs from '@/pages/admin/LoginLogs'
import MyActivity from '@/pages/admin/MyActivity'
import Remarks from '@/pages/admin/Remarks'
import { WebmailAccountsPage } from '@/pages/admin/WebmailAccountsPage'
import LiveLocation from '@/pages/admin/LiveLocation'
import WhatsappTemplates from '@/pages/admin/WhatsappTemplates'
// ── Super Admin (control plane)
import { SuperAdminLayout } from '@/components/layout/SuperAdminLayout'
import SuperOverview from '@/pages/super/Overview'
import SuperCustomers from '@/pages/super/Customers'
import SuperCustomerDetail from '@/pages/super/CustomerDetail'
import SuperNewCustomer from '@/pages/super/NewCustomer'
import SuperPlatformUsers from '@/pages/super/PlatformUsers'
import SuperAuditLog from '@/pages/super/AuditLog'
import SuperSystemHealth from '@/pages/super/SystemHealth'
import SuperApiUsage from '@/pages/super/ApiUsage'


// ─── Root Route ───────────────────────────────────────────────────────────────
const rootRoute = createRootRoute()

// ─── Auth guard ───────────────────────────────────────────────────────────────
/**
 * Routes that only exist when the customer's plan includes the module.
 *
 * The backend is the real gate (requireFeature in routes/index.ts returns 403);
 * this just stops the UI from rendering a page that is guaranteed to fail, and
 * keeps a bookmarked URL from landing on an error screen.
 */
const FEATURE_ROUTES: [string, string][] = [
  ['/app/branches', 'branches'],
  ['/app/tasks', 'tasks'],
  ['/app/leaves', 'tasks'],
  ['/app/whatsapp-templates', 'whatsapp'],
  ['/app/auto-dialer', 'auto_dialer'],
  ['/app/b2b', 'b2b'],
  ['/app/calls', 'call_recording'],
  ['/app/live-location', 'location_tracking'],
  ['/app/webmail-accounts', 'inbox'],
  ['/app/campaign-groups', 'campaigns'],
  ['/app/bulk-email', 'campaigns'],
  ['/app/mail', 'campaigns'],
  ['/app/app-release', 'mobile_app'],
  ['/app/bulk-management', 'bulk_ops'],
  // ── B2B core. Off for the education vertical, so a Tutelage user who lands on
  //    one of these URLs is redirected rather than shown an empty page.
  ['/app/accounts', 'accounts'],
  ['/app/contacts', 'accounts'],
  ['/app/projects', 'projects'],
  ['/app/teams', 'projects'],
  ['/app/custom-fields', 'custom_fields'],
  ['/app/deals', 'deals'],
  ['/app/pipelines', 'deals'],
  ['/app/products', 'deals'],
  ['/app/sales', 'sales_docs'],
  ['/app/quotes', 'sales_docs'],
  ['/app/orders', 'sales_docs'],
  ['/app/contracts', 'sales_docs'],
  ['/app/invoices', 'sales_docs'],
  ['/app/sales-ops', 'sales_docs'],
  ['/app/bucket', 'bucket'],
  ['/app/filter-leads', 'bucket'],
  ['/app/update-leads', 'bulk_ops'],
  ['/app/trash', 'trash'],
  ['/app/lead-config', 'lead_config'],
  ['/app/duplicates', 'duplicates'],
  ['/app/remarks', 'remarks'],
  ['/app/reports', 'reports'],
  ['/app/daily-reports', 'daily_reports'],
  ['/app/my-activity', 'activity_tracking'],
  ['/app/inactivity-monitor', 'activity_tracking'],
  ['/app/calendar', 'calendar'],
  ['/app/lead-sources', 'lead_sources'],
  ['/app/login-logs', 'login_logs'],
  ['/app/announcements', 'announcements'],
  ['/app/agents', 'agents'],
  // The load-bearing four. Gated like everything else now, which is exactly why
  // firstAvailableRoute() below exists — '/app' can no longer be assumed to be
  // somewhere the customer is allowed to go.
  ['/app', 'dashboard'],
  ['/app/leads', 'leads'],
  ['/app/users', 'users'],
  ['/app/settings', 'settings'],
]

/**
 * Somewhere this customer is actually allowed to land.
 *
 * Every module is switchable, including the dashboard, so the old
 * `redirect({ to: '/app' })` could bounce a user straight back into the same
 * gate and spin forever. This walks a preference order and returns the first
 * route whose module is on.
 *
 * Ordered by what a person most likely wants to see first, ending with screens
 * that exist for anyone with a login.
 */
const LANDING_ORDER: [string, string | null][] = [
  ['/app', 'dashboard'],
  ['/app/leads', 'leads'],
  ['/app/bucket', 'bucket'],
  ['/app/products', 'deals'],
  ['/app/tasks', 'tasks'],
  ['/app/calendar', 'calendar'],
  ['/app/reports', 'reports'],
  ['/app/users', 'users'],
  ['/app/settings', 'settings'],
  // No feature gate: reachable as long as the person is signed in at all.
  ['/app/profile', null],
]

export function firstAvailableRoute(): string {
  const { hasFeature } = useAuthStore.getState()
  for (const [path, feature] of LANDING_ORDER) {
    if (!feature || hasFeature(feature)) return path
  }
  // Everything a customer could land on is switched off. Rather than loop, send
  // them somewhere that renders an explanation.
  return '/app/no-modules'
}

export function featureForPath(pathname: string): string | null {
  // Longest prefix wins, so /app/bulk-management/operations resolves the same
  // way as /app/bulk-management.
  let best: [string, string] | null = null
  for (const entry of FEATURE_ROUTES) {
    if (pathname === entry[0] || pathname.startsWith(`${entry[0]}/`)) {
      if (!best || entry[0].length > best[0].length) best = entry
    }
  }
  return best?.[1] ?? null
}

function requireAuth() {
  const { isAuthenticated, lastActivityTime, logout, touchActivity, scope } = useAuthStore.getState()

  // A super admin has no customer data to show here — send them to their panel.
  if (isAuthenticated && scope === 'platform') throw redirect({ to: '/super' })

  if (isAuthenticated) {
    if (lastActivityTime) {
      if (Date.now() - lastActivityTime >= 60 * 60 * 1000) {
        logout()
        throw redirect({ to: '/login' })
      }
    } else {
      touchActivity()
    }
  } else {
    throw redirect({ to: '/login' })
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) throw redirect({ to: '/app' })
  },
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPassword,
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) throw redirect({ to: '/app' })
  },
})

// ─── Root redirect ────────────────────────────────────────────────────────────
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/app' }) },
  component: () => null,
})

// ─── App Layout (protected) ───────────────────────────────────────────────────
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppLayout,
  beforeLoad: ({ location }) => {
    requireAuth()

    // One place to gate every plan-dependent page, rather than a beforeLoad on
    // each of the fifteen routes involved.
    const feature = featureForPath(location.pathname)
    if (feature && !useAuthStore.getState().hasFeature(feature)) {
      const to = firstAvailableRoute()
      // Guard against sending them straight back into this same check.
      if (to !== location.pathname) throw redirect({ to })
      throw redirect({ to: '/app/no-modules' })
    }
  },
})

// ─── App child routes ─────────────────────────────────────────────────────────
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: Dashboard,
  beforeLoad: () => {
    // '/app' is the dashboard, and the dashboard is switchable. Send them to
    // whatever they do have rather than rendering a page whose every call 403s.
    if (!useAuthStore.getState().hasFeature('dashboard')) {
      const to = firstAvailableRoute()
      throw redirect({ to: to === '/app' ? '/app/no-modules' : to })
    }
  },
})

/** The terminal fallback: every landing module is switched off. */
const noModulesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/no-modules',
  component: NoModules,
})

const superAdminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/super-admin',
  component: SuperAdminDashboard,
  beforeLoad: () => {
    const { user } = useAuthStore.getState()
    if (!user?.roles?.includes('admin')) throw redirect({ to: '/app' })
  },
})

const leadsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leads',
  component: Leads,
})

const bucketRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bucket',
  component: Bucket,
  beforeLoad: () => {
    const { user } = useAuthStore.getState()
    if (user && !user.roles.includes('admin') && !user.roles.includes('sub-admin') && user.showBucket === false) throw redirect({ to: '/app' })
  },
})
const addLeadRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leads/new',
  component: AddLead,
})

const leadDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leads/$leadId',
  component: LeadDetail,
})

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users',
  component: Users,
})

const communicationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/communication',
  component: Communication,
})

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar',
  component: Calendar,
})

const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks',
  component: Tasks,
})

const taskLeadsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/$batchId',
  component: TaskLeads,
})

// Lead → counsellor assignment builder. Deliberately its own page (opened in a
// new tab from the "Assign leads" buttons) rather than a modal — it carries a
// multi-day cohort, the full lead filter bar and a large lead table. Kept off
// the /tasks/* prefix so it can never collide with /tasks/$batchId.
const taskBuilderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/task-builder',
  component: TaskBuilder,
})

const leavesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leaves',
  component: Leaves,
})

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports',
  component: Reports,
})

const callsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calls',
  component: Calls,
})

const b2bRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/b2b',
  component: B2bContacts,
})

const autoDialerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/auto-dialer',
  component: AutoDialer,
})

const autoDialerMyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/auto-dialer/my',
  component: MyCampaigns,
})

const autoDialerDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/auto-dialer/$id',
  component: AutoDialerDetail,
})

const appReleaseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/app-release',
  component: AppRelease,
})

const campaignGroupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/campaign-groups',
  component: CampaignGroups,
})

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: Settings,
})

const inactivityMonitorRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inactivity-monitor',
  component: InactivityMonitor,
})

const loginLogsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/login-logs',
  component: LoginLogs,
})

const myActivityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/my-activity',
  component: MyActivity,
})

const leadConfigRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/lead-config',
  component: LeadConfig,
})

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts',
  component: Accounts,
})

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: Projects,
})

const projectDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectId',
  component: ProjectDetail,
})

const teamsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/teams',
  component: Teams,
})

const accountDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts/$accountId',
  component: AccountDetail,
})

const contactsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contacts',
  component: Contacts,
})

const contactDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contacts/$contactId',
  component: ContactDetail,
})

const customFieldsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/custom-fields',
  component: CustomFields,
})

const dealsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/deals',
  component: Deals,
})

const dealDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/deals/$dealId',
  component: DealDetail,
})

const pipelinesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/pipelines',
  component: Pipelines,
})

const productsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/products',
  component: Products,
})

const quotesRoute = createRoute({ getParentRoute: () => appRoute, path: '/quotes', component: Quotes })
const quoteDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/quotes/$quoteId',
  component: QuoteDetail,
})
const ordersRoute = createRoute({ getParentRoute: () => appRoute, path: '/orders', component: Orders })
const orderDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/orders/$orderId',
  component: OrderDetail,
})
const contractsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contracts',
  component: Contracts,
})
const contractDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contracts/$contractId',
  component: ContractDetail,
})
const salesDeskRoute = createRoute({ getParentRoute: () => appRoute, path: '/sales', component: SalesDesk })
const salesOpsRoute = createRoute({ getParentRoute: () => appRoute, path: '/sales-ops', component: SalesOps })
const invoicesRoute = createRoute({ getParentRoute: () => appRoute, path: '/invoices', component: Invoices })
const invoiceDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invoices/$invoiceId',
  component: InvoiceDetail,
})

const agentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/agents',
  component: Agents,
})

const trashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/trash',
  component: Trash,
})

const bulkManagementRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bulk-management',
  component: BulkManagement,
})

const bulkOperationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bulk-management/operations',
  component: BulkOperations,
})

const updateLeadsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/update-leads',
  component: UpdateLeads,
})

const duplicatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/duplicates',
  component: Duplicate,
})

const announcementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/announcements',
  component: Announcements,
})

const branchesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/branches',
  component: Branches,
})

const bulkEmailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bulk-email',
  component: BulkEmail,
})

const agentProfileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profiles/agent/$id',
  component: AgentProfile,
})

const leadSourcesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/lead-sources',
  component: LeadSources,
})

const myAccountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: MyAccount,
})

const mailManagementRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/mail',
  component: MailManagement,
})

const dailyReportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/daily-reports',
  component: DailyReports,
})

const dailyReportActivityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/daily-reports/activity/$userId',
  component: DailyReportActivity,
})

const counsellorProfileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profiles/counsellor/$id',
  component: CounsellorProfile,
})

const followupsPageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/followups',
  component: TodayFollowups,
})

const notificationsPageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/notifications',
  component: NotificationsPage,
})

const chatPageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/chat',
  component: ChatPage,
})

const filterLeadsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/filter-leads',
  component: FilterLeads,
})

const filterLeadsBatchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/filter-leads/$batchId',
  component: FilterLeadsBatch,
})

const remarksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/remarks',
  component: Remarks,
})

const liveLocationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/live-location',
  component: LiveLocation,
  beforeLoad: () => {
    const { user } = useAuthStore.getState()
    if (!user?.roles?.includes('admin')) throw redirect({ to: '/app' })
  },
})
const webmailAccountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/webmail-accounts',
  component: WebmailAccountsPage,
  beforeLoad: () => {
    const { user } = useAuthStore.getState()
    if (user?.role !== 'admin') throw redirect({ to: '/app' })
  },
})

const whatsappTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/whatsapp-templates',
  component: WhatsappTemplates,
})


// ─── Super Admin (control plane) ──────────────────────────────────────────────
//
// A completely separate tree from /app. It runs on the platform token, has its
// own shell, and never touches a customer's data — see SuperAdminLayout.

function requirePlatform() {
  const { isAuthenticated, scope } = useAuthStore.getState()
  if (!isAuthenticated) throw redirect({ to: '/login' })
  // A customer's session landing here is a wrong turn, not an error: send them
  // back to their own app rather than showing a permission wall.
  if (scope !== 'platform') throw redirect({ to: '/app' })
}

const superRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/super',
  component: SuperAdminLayout,
  beforeLoad: requirePlatform,
})

const superIndexRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/',
  component: SuperOverview,
})

const superCustomersRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/customers',
  component: SuperCustomers,
})

// Registered before the :tenantId route so "new" is not read as an id.
const superNewCustomerRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/customers/new',
  component: SuperNewCustomer,
})

const superCustomerDetailRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/customers/$tenantId',
  component: SuperCustomerDetail,
})

const superAdminsRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/admins',
  component: SuperPlatformUsers,
})

const superAuditRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/audit',
  component: SuperAuditLog,
})

const superHealthRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/health',
  component: SuperSystemHealth,
})

// API usage moved here from the customer admin panel: endpoint latency and
// error rates describe the platform, not any single customer.
const superApiUsageRoute = createRoute({
  getParentRoute: () => superRoute,
  path: '/api-usage',
  component: SuperApiUsage,
})

// ─── Route Tree ───────────────────────────────────────────────────────────────
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  forgotPasswordRoute,
  superRoute.addChildren([
    superIndexRoute,
    superCustomersRoute,
    superNewCustomerRoute,
    superCustomerDetailRoute,
    superAdminsRoute,
    superAuditRoute,
    superHealthRoute,
    superApiUsageRoute,
  ]),
  appRoute.addChildren([
    appIndexRoute,
    noModulesRoute,
    superAdminRoute,
    leadsRoute,
    webmailAccountsRoute,
    liveLocationRoute,
    bucketRoute,
    addLeadRoute,
    leadDetailRoute,
    usersRoute,
    communicationRoute,
    calendarRoute,
    tasksRoute,
    taskBuilderRoute,
    taskLeadsRoute,
    leavesRoute,
    reportsRoute,
    callsRoute,
    appReleaseRoute,
    campaignGroupsRoute,
    settingsRoute,
    leadConfigRoute,
    quotesRoute,
    quoteDetailRoute,
    ordersRoute,
    orderDetailRoute,
    contractsRoute,
    contractDetailRoute,
    salesDeskRoute,
    salesOpsRoute,
    invoicesRoute,
    invoiceDetailRoute,
    dealsRoute,
    dealDetailRoute,
    pipelinesRoute,
    productsRoute,
    accountsRoute,
    accountDetailRoute,
    projectsRoute,
    projectDetailRoute,
    teamsRoute,
    contactsRoute,
    contactDetailRoute,
    customFieldsRoute,
    agentsRoute,
    trashRoute,
    bulkManagementRoute,
    bulkOperationsRoute,
    updateLeadsRoute,
    duplicatesRoute,
    announcementsRoute,
    branchesRoute,
    bulkEmailRoute,
    agentProfileRoute,
    counsellorProfileRoute,
    leadSourcesRoute,
    myAccountRoute,
    mailManagementRoute,
    dailyReportsRoute,
    dailyReportActivityRoute,
    followupsPageRoute,
    notificationsPageRoute,
    chatPageRoute,
    filterLeadsRoute,
    filterLeadsBatchRoute,
    b2bRoute,
    autoDialerMyRoute,
    autoDialerRoute,
    autoDialerDetailRoute,
    inactivityMonitorRoute,
    loginLogsRoute,
    myActivityRoute,
    remarksRoute,
    whatsappTemplatesRoute,
  ]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
