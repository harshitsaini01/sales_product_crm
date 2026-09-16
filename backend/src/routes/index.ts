import { Hono } from 'hono'
import { authRoutes } from './auth.routes'
import { leadsRoutes } from './leads.routes'
import { leadConfigRoutes } from './lead-config.routes'
import { notesRoutes } from './notes.routes'
import { remindersRoutes } from './reminders.routes'
import { usersRoutes } from './users.routes'
import { branchesRoutes } from './branches.routes'
import { dashboardRoutes } from './dashboard.routes'
import { followupsRoutes } from './followups.routes'
import { communicationRoutes } from './communication.routes'
import { financialRoutes } from './financial.routes'
import { eventsRoutes } from './events.routes'
import { tasksRoutes } from './tasks.routes'
import { leavesRoutes } from './leaves.routes'
import { announcementsRoutes } from './announcements.routes'
import { chatRoutes } from './chat.routes'
import { reportsRoutes } from './reports.routes'
import { settingsRoutes } from './settings.routes'
import { publicApiRoutes } from './api.routes'
import { inboundRoutes } from './inbound.routes'
import { leadSourcesRoutes } from './lead-sources.routes'
import { accountsRoutes } from './accounts.routes'
import { contactsRoutes } from './contacts.routes'
import { crmRoutes } from './crm.routes'
import { leadBusinessRoutes } from './lead-business.routes'
import { projectsRoutes } from './projects.routes'
import { teamsRoutes } from './teams.routes'
import { customFieldsRoutes } from './custom-fields.routes'
import { dealsRoutes } from './deals.routes'
import { pipelinesRoutes, productsRoutes } from './pipelines.routes'
import { quotesRoutes, contractsRoutes, ordersRoutes, invoicesRoutes } from './sales.routes'
import { salesChainRoutes } from './sales-chain.routes'
import { commerceRoutes } from './commerce.routes'
import { agentsRoutes } from './agents.routes'
import { dailyReportsRoutes } from './daily-reports.routes'
import { commentsRoutes } from './comments.routes'
import { notificationsRoutes } from './notifications.routes'
import { mobileRoutes } from './mobile.routes'
import { callsRoutes } from './calls.routes'
import { appReleasesRoutes } from './app-releases.routes'
import { campaignsRoutes } from './campaigns.routes'
import { inboxRoutes } from './inbox.routes'
import { leadStagingRoutes } from './lead-staging.routes'
import { b2bRoutes } from './b2b.routes'
import { autoDialerRoutes } from './auto-dialer.routes'
import { activityRoutes } from './activity.routes'
import { bulkRoutes } from './bulk.routes'
import { verifiedRoutes } from './verified.routes'
import { remarksRoutes } from './remarks.routes'
import { activityTracker } from '../middleware/activity-tracker'

import { webmailAccountsRoutes } from './webmail-accounts.routes'
import { locationsRoutes } from './locations.routes'
import { leadWorkRoutes } from './lead-work.routes'
import { mailTrackingRoutes } from './mail-tracking.routes'
import { publicQuotesRoutes } from './public-quotes.routes'
import { publicOrdersRoutes, publicInvoicesRoutes } from './public-commerce.routes'
import { publicCatalogRoutes } from './public-catalog.routes'
import { whatsappTemplateRoutes } from './whatsapp-templates.routes'
import { platformRoutes } from './platform.routes'
import { tenantMiddleware, publicTenantMiddleware, tenantFromApiKey } from '../middleware/tenant'
import { requireFeature } from '../middleware/feature'
import { FEATURES } from '../config/features'

export const routes = new Hono()

// ─── Control plane ────────────────────────────────────────────────────────────
// The super admin panel. Mounted FIRST and deliberately outside tenantMiddleware:
// it talks only to the platform schema and must never inherit a customer's
// context. Its own authenticatePlatform guard uses a separate JWT secret.
routes.route('/platform', platformRoutes)

// ─── Tenant resolution ────────────────────────────────────────────────────────
// Everything below this line runs inside one customer's Postgres schema. This
// must come before any route that touches `prisma` — see middleware/tenant.ts.
routes.use('*', tenantMiddleware())

// Campaign email open pixel — must be public so recipient inboxes can fetch it
// without a JWT. Mounted before activityTracker so anonymous fetches don't try
// to write to lastActivityAt.
routes.use('/tracking/*', publicTenantMiddleware())
routes.route('/tracking', mailTrackingRoutes)
// The customer's no-login quote page (view, accept, decline). Public like the
// pixel, pinned to a customer by `t=`, and gated on the module so a customer
// without Quotes has no public surface here.
routes.use('/public/quotes/*', publicTenantMiddleware())
routes.use('/public/quotes/*', requireFeature('sales_docs'))
routes.route('/public/quotes', publicQuotesRoutes)
routes.use('/public/orders/*', publicTenantMiddleware())
routes.use('/public/orders/*', requireFeature('sales_docs'))
routes.route('/public/orders', publicOrdersRoutes)
routes.use('/public/invoices/*', publicTenantMiddleware())
routes.use('/public/invoices/*', requireFeature('sales_docs'))
routes.route('/public/invoices', publicInvoicesRoutes)
routes.use('/public/catalog/*', publicTenantMiddleware())
routes.use('/public/catalog', publicTenantMiddleware())
routes.route('/public/catalog', publicCatalogRoutes)

// Stamp User.lastActivityAt for counsellors on every authenticated request.
// Runs AFTER each child's authenticate (we read c.get('user') post-next).
// The source ('web' | 'mobile') is read from the JWT's `kind` field so both
// web and mobile traffic feed the same lastActivityAt — that's how the tracker
// "combines no activity from web and app" without double-counting.
routes.use('*', activityTracker())

// Public ingestion. These carry an API key rather than a JWT, so the customer
// is resolved from the key itself (the legacy shared env API_KEY still maps to
// the original install, keeping every existing website integration working).
routes.use('/v1/*', tenantFromApiKey())
routes.use('/v1/*', requireFeature('public_api'))
// Per-partner inbound endpoint — own per-key auth, NOT the env API_KEY.
// Must be registered BEFORE the broader /v1 mount.
routes.route('/v1/inbound', inboundRoutes)
// Public API (external lead creation via env API_KEY — legacy endpoints)
routes.route('/v1', publicApiRoutes)

// Admin-side partner management
routes.route('/lead-sources', leadSourcesRoutes)

// Auth routes (no JWT required)
routes.route('/auth', authRoutes)

// ─── Plan feature gates ───────────────────────────────────────────────────────
// Derived from the catalogue in config/features.ts rather than written out by
// hand, so adding a module there wires up its guard automatically and the
// super admin panel's toggle grid can never drift from what is enforced.
for (const feature of FEATURES) {
  for (const prefix of feature.apiPrefixes) {
    routes.use(prefix, requireFeature(feature.key))
    routes.use(`${prefix}/*`, requireFeature(feature.key))
  }
}

// Protected routes (all require JWT)
routes.route('/leads', leadsRoutes)
routes.route('/lead-config', leadConfigRoutes)
// ── B2B core. The feature loop above gates these on `accounts` / `custom_fields`
//    (config/features.ts), both off by default — so an education customer's
//    requests to any of them 403 before a handler runs.
routes.route('/accounts', accountsRoutes)
routes.route('/contacts', contactsRoutes)
routes.route('/crm', crmRoutes)
routes.route('/lead-business', leadBusinessRoutes)
// Gated on `projects` by the feature loop above.
routes.route('/projects', projectsRoutes)
routes.route('/teams', teamsRoutes)
routes.route('/custom-fields', customFieldsRoutes)
routes.route('/deals', dealsRoutes)
routes.route('/pipelines', pipelinesRoutes)
routes.route('/products', productsRoutes)
routes.route('/quotes', quotesRoutes)
routes.route('/contracts', contractsRoutes)
routes.route('/orders', ordersRoutes)
routes.route('/invoices', invoicesRoutes)
// One family from any link in it, and the Sales Desk lists. Gated on sales_docs.
routes.route('/sales-chain', salesChainRoutes)
routes.route('/commerce', commerceRoutes)
routes.route('/notes', notesRoutes)
routes.route('/reminders', remindersRoutes)
routes.route('/users', usersRoutes)
routes.route('/branches', branchesRoutes)
routes.route('/dashboard', dashboardRoutes)
routes.route('/followups', followupsRoutes)
routes.route('/communication', communicationRoutes)
routes.route('/financial', financialRoutes)
routes.route('/events', eventsRoutes)
routes.route('/tasks', tasksRoutes)
routes.route('/leaves', leavesRoutes)
routes.route('/announcements', announcementsRoutes)
routes.route('/chat', chatRoutes)
routes.route('/reports', reportsRoutes)
routes.route('/settings', settingsRoutes)
routes.route('/agents', agentsRoutes)
routes.route('/daily-reports', dailyReportsRoutes)
routes.route('/comments', commentsRoutes)
routes.route('/notifications', notificationsRoutes)
routes.route('/mobile', mobileRoutes)
routes.route('/calls', callsRoutes)
routes.route('/app-releases', appReleasesRoutes)
routes.route('/campaigns', campaignsRoutes)
routes.route('/inbox', inboxRoutes)
routes.route('/lead-staging', leadStagingRoutes)
routes.route('/b2b', b2bRoutes)
routes.route('/auto-dialer', autoDialerRoutes)
routes.route('/activity', activityRoutes)
routes.route('/bulk', bulkRoutes)
routes.route('/verified', verifiedRoutes)
routes.route('/remarks', remarksRoutes)
routes.route('/webmail-accounts', webmailAccountsRoutes)
routes.route('/lead-work', leadWorkRoutes)
routes.route('/locations', locationsRoutes)
routes.route('/whatsapp-templates', whatsappTemplateRoutes)
// NOTE: /metrics is deliberately NOT mounted here any more. API usage is a
// platform-wide view owned by the super admin — it now lives at
// /api/platform/metrics. The counting middleware still runs in app.ts for every
// request; only the reporting endpoints moved.


