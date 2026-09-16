import { Hono } from 'hono'
import { prisma } from '../lib/prisma'

// PUBLIC — no auth. Campaign emails embed <img src=".../tracking/campaign-open/:id.gif">
// and this endpoint stamps the recipient row as opened the first time the
// pixel is fetched. Any error is swallowed so a DB blip never breaks the pixel
// (a missing GIF in the recipient's client is a much louder failure than a
// silently-dropped open event).
export const mailTrackingRoutes = new Hono()

// 1x1 transparent GIF — same trick used by every open-tracking pixel out there.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

// The ".gif" suffix is decorative — some mail clients refuse to load pixel URLs
// that don't end in an image extension. We strip it before parsing the id.
mailTrackingRoutes.get('/campaign-open/:id{.+\\.gif}', async (c) => {
  const raw = c.req.param('id').replace(/\.gif$/i, '')
  const id = /^\d+$/.test(raw) ? BigInt(raw) : null
  if (id !== null) {
    try {
      // Only stamp on first open. Subsequent fetches are a no-op — the field
      // records the first-open moment, which is what "open rate" measures.
      await prisma.emailCampaignRecipient.updateMany({
        where: { id, openedAt: null },
        data: { openedAt: new Date() },
      })
    } catch (err) {
      console.error('[campaign-open] failed to stamp openedAt:', err)
    }
  }
  return c.body(TRANSPARENT_GIF, 200, gifHeaders)
})

// Same idea for quick sends (SentMail rows). Compose's "Send" button + the
// bulk-send endpoints all route through sendOneAndRecord() which embeds this
// pixel URL keyed to the SentMail id. First fetch stamps openedAt so Sent
// History and Reports can show "opened" for quick sends the same way they do
// for scheduled campaigns.
mailTrackingRoutes.get('/quick-open/:id{.+\\.gif}', async (c) => {
  const raw = c.req.param('id').replace(/\.gif$/i, '')
  const id = /^\d+$/.test(raw) ? BigInt(raw) : null
  if (id !== null) {
    try {
      await prisma.sentMail.updateMany({
        where: { id, openedAt: null },
        data: { openedAt: new Date() },
      })
    } catch (err) {
      console.error('[quick-open] failed to stamp openedAt:', err)
    }
  }
  return c.body(TRANSPARENT_GIF, 200, gifHeaders)
})

const gifHeaders = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Expires': '0',
} as const
