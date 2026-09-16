import 'dotenv/config'

// Fix BigInt serialization — Prisma returns BigInt for IDs, which JSON.stringify can't handle
// @ts-ignore
BigInt.prototype.toJSON = function () { return this.toString() }
import { serve } from '@hono/node-server'
import { app } from './app'
import { startRetentionCron } from './services/recording-retention.service'
import { startCampaignEngine } from './services/campaign-engine.service'
import { startInboxPoller } from './services/inbox-poller.service'
import { startInactivityScheduler } from './services/inactivity-scheduler.service'
import { startSalesDispatcher } from './services/crm/sales-events.service'
import { startApiMetrics } from './services/api-metrics.service'
import { captureUsageSnapshots } from './services/tenant-usage.service'
import { getPrimaryTenant } from './services/tenant.service'
import { disconnectAllTenants } from './lib/prisma'

const PORT = Number(process.env.PORT) || 3001

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`)

  // Open-tracking pixels are only embedded when we can build an absolute URL
  // to this backend that recipient mail clients can reach. Without APP_URL /
  // PUBLIC_URL the pixel is silently skipped, and every "Opened" count ends
  // up at 0 — which is exactly what admins were seeing. Warn loudly at boot
  // so a fresh deploy notices before the first campaign goes out.
  if (!process.env.APP_URL && !process.env.PUBLIC_URL) {
    console.warn(
      '[mail] APP_URL not set — open-tracking pixels will NOT be embedded, so Opened counts will stay at 0.\n' +
      '        Set APP_URL to the backend\'s public https URL (e.g. https://api.tutelagestudy.com) in backend/.env',
    )
  }

  startRetentionCron()
  startCampaignEngine()
  startInboxPoller()
  startInactivityScheduler()
  startSalesDispatcher()
  startApiMetrics()
  startUsageSnapshots()

  // The super admin panel cannot resolve any customer until the control plane
  // knows about the original install. Failing loudly at boot beats every
  // request 500ing with a confusing "No primary tenant found".
  getPrimaryTenant()
    .then((t) => console.log(`[crm] "${t.companyName}" · ${t.vertical} · schema ${t.schemaName}`))
    .catch((err) => console.error('[crm] boot:', err.message))
})

/**
 * Nightly usage counts per customer, so the super admin list view renders
 * without fanning COUNT(*) out across every schema on page load.
 */
function startUsageSnapshots(): void {
  if (process.env.SINGLE_TENANT !== '0') return
  const run = () =>
    captureUsageSnapshots()
      .then((n) => n && console.log(`[usage] captured ${n} customer snapshot(s)`))
      .catch((err) => console.error('[usage] snapshot sweep failed', err))

  setTimeout(run, 2 * 60_000).unref?.()
  setInterval(run, 24 * 60 * 60_000).unref?.()
}

// Tenant clients are opened lazily, one pool per customer. Close them cleanly
// so a restart does not leave connections hanging around on the Postgres side.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void disconnectAllTenants().finally(() => process.exit(signal === 'SIGTERM' ? 143 : 130))
  })
}
 
