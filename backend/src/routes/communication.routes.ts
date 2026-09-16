import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import path from 'path'
import { stringify as csvStringify } from 'csv-stringify/sync'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { uploadSingle } from '../middleware/upload'
import { resolveProductTokens, SALES_TOKENS } from '../services/crm/product-email.service'
import { emailService } from '../services/email.service'
import { sendViaGroup } from '../services/campaign-mailer.service'
import * as imap from '../services/imap.service'

export const communicationRoutes = new Hono()

communicationRoutes.use('*', authenticate)

// ─── Letterhead ───────────────────────────────────────────────────────────────
// A single branded header prepended to every outgoing mail — keeps the compose
// preview and the actual sent message identical. Hardcoded for now so we can
// wire the pipeline end-to-end; later swap for a DB-backed asset the admin edits
// from Settings. Frontend fetches this via GET /brand so the preview stays in
// sync automatically.
export const LETTERHEAD_HTML = `
<div style="font-family:Arial,sans-serif;border-bottom:3px solid #7c3aed;padding:14px 20px 12px;margin-bottom:16px;background:#faf9ff;">
  <div style="font-size:20px;font-weight:700;color:#3b0764;letter-spacing:-0.2px;">Sales CRM</div>
  <div style="font-size:12px;color:#6b7280;margin-top:2px;">Product sales</div>
</div>
`.trim()

function publicBaseUrl(c: { req: { header: (name: string) => string | undefined; url: string } }): string {
  const configured = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  if (configured) return configured
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || c.req.header('host') || new URL(c.req.url).host
  const protocol = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(c.req.url).protocol.replace(':', '')
  return `${protocol}://${host}`
}

function publicAssetHtml(html: string, baseUrl: string): string {
  // Upgrade legacy templates that stored a relative /uploads URL.
  return html.replace(/\b(src|href)=(['"])\/uploads\//gi, `$1=$2${baseUrl}/api/uploads/`)
}

function wrapMail(bodyHtml: string, signatureHtml = '', baseUrl = ''): string {
  const body = baseUrl ? publicAssetHtml(bodyHtml, baseUrl) : bodyHtml
  const signature = baseUrl ? publicAssetHtml(signatureHtml, baseUrl) : signatureHtml
  return LETTERHEAD_HTML + body + (signature ? `<br><br>${signature}` : '')
}

// Public brand info — frontend uses this so the preview matches what recipients see.
communicationRoutes.get('/brand', (c) => c.json({ letterhead: LETTERHEAD_HTML }))

// GET /communication/quick-send-stats — Reports tab rolls this up next to the
// scheduled-campaign funnel. Same shape (`counts`) so the frontend can reuse
// the same tile component. Non-admins get their own numbers only.
communicationRoutes.get('/quick-send-stats', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const where: Record<string, unknown> = {}
  if (!isAdmin) where.userId = BigInt(userId)

  const [total, sent, failed, pending, opened] = await Promise.all([
    prisma.sentMail.count({ where }),
    prisma.sentMail.count({ where: { ...where, status: 'sent' } }),
    prisma.sentMail.count({ where: { ...where, status: 'failed' } }),
    prisma.sentMail.count({ where: { ...where, status: 'pending' } }),
    prisma.sentMail.count({ where: { ...where, openedAt: { not: null } } }),
  ])

  // Reply count: for each row we look up, was there ANY inbound mail from
  // that address after we sent to them? Done as one aggregate query per
  // "in the last N sent-to addresses" — cheap and honest.
  const recentTo = await prisma.sentMail.findMany({
    where, select: { toEmail: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5000,
  })
  const toEmails = [...new Set(recentTo.map((r) => r.toEmail))]
  const inbounds = toEmails.length ? await prisma.inboundMail.findMany({
    where: { fromEmail: { in: toEmails, mode: 'insensitive' } },
    select: { fromEmail: true, receivedAt: true },
  }) : []
  const inboundByEmail = new Map<string, Date[]>()
  for (const ib of inbounds) {
    const key = ib.fromEmail.toLowerCase()
    const arr = inboundByEmail.get(key) || []
    arr.push(ib.receivedAt)
    inboundByEmail.set(key, arr)
  }
  let replied = 0
  for (const r of recentTo) {
    const arr = inboundByEmail.get(r.toEmail.toLowerCase())
    if (arr && arr.some((t) => t >= r.createdAt)) replied++
  }

  return c.json({ total, sent, failed, pending, opened, replied })
})

// GET /communication/mail-reports/summary — ONE unified funnel over both
// scheduled campaigns (EmailCampaignRecipient) AND quick sends (SentMail),
// so admins see the whole mail pipeline in a single row of tiles instead of
// two parallel funnels that were confusing to reconcile.
//
// Buckets returned:
//   total     — every recipient row across both sources (audience)
//   queued    — campaign recipients waiting for their chunk to fire + quick sends still 'pending'
//   sent      — SMTP handed it off (campaign SENT + DELIVERED + REPLIED, quick 'sent')
//   opened    — openedAt is stamped (subset of `sent`)
//   replied   — quick sends: any inbound after send; campaign: RecipientStatus REPLIED
//   pending   — same as queued (kept as its own field so the UI can label both intents distinctly)
//   failed    — campaign FAILED + quick 'failed'
//   bounced   — campaign BOUNCED only (SentMail has no separate bounced status)
communicationRoutes.get('/mail-reports/summary', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const sentWhere: Record<string, unknown> = {}
  const campWhere: Record<string, unknown> = {}
  if (!isAdmin) {
    sentWhere.userId = BigInt(userId)
    campWhere.campaign = { userId: BigInt(userId) }
  }

  const [
    // Quick sends (SentMail)
    qsTotal, qsSent, qsFailed, qsPending, qsOpened,
    // Campaign recipients — aggregate per status once, opened separately.
    campByStatus, campOpenedCount, campTotal,
    // Recent recipient addresses for reply detection (quick sends only —
    // campaign recipient has its own repliedAt column already).
    recentTo,
  ] = await Promise.all([
    prisma.sentMail.count({ where: sentWhere }),
    prisma.sentMail.count({ where: { ...sentWhere, status: 'sent' } }),
    prisma.sentMail.count({ where: { ...sentWhere, status: 'failed' } }),
    prisma.sentMail.count({ where: { ...sentWhere, status: 'pending' } }),
    prisma.sentMail.count({ where: { ...sentWhere, openedAt: { not: null } } }),

    prisma.emailCampaignRecipient.groupBy({
      by: ['status'],
      where: campWhere,
      _count: { _all: true },
    }),
    prisma.emailCampaignRecipient.count({ where: { ...campWhere, openedAt: { not: null } } }),
    prisma.emailCampaignRecipient.count({ where: campWhere }),

    prisma.sentMail.findMany({
      where: sentWhere,
      select: { toEmail: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ])

  // Reply count for quick sends — same logic as /quick-send-stats.
  const toEmails = [...new Set(recentTo.map((r) => r.toEmail))]
  const inbounds = toEmails.length ? await prisma.inboundMail.findMany({
    where: { fromEmail: { in: toEmails, mode: 'insensitive' } },
    select: { fromEmail: true, receivedAt: true },
  }) : []
  const inboundByEmail = new Map<string, Date[]>()
  for (const ib of inbounds) {
    const key = ib.fromEmail.toLowerCase()
    const arr = inboundByEmail.get(key) || []
    arr.push(ib.receivedAt)
    inboundByEmail.set(key, arr)
  }
  let qsReplied = 0
  for (const r of recentTo) {
    const arr = inboundByEmail.get(r.toEmail.toLowerCase())
    if (arr && arr.some((t) => t >= r.createdAt)) qsReplied++
  }

  const camp = {
    queued: 0, sent: 0, replied: 0, failed: 0, bounced: 0,
  }
  for (const g of campByStatus) {
    const n = g._count._all
    switch (g.status) {
      case 'QUEUED': camp.queued += n; break
      // SENT / DELIVERED / REPLIED are all "the SMTP send happened" — REPLIED
      // is a superset (already-sent recipient replied), so it still counts as
      // sent for the funnel.
      case 'SENT': camp.sent += n; break
      case 'DELIVERED': camp.sent += n; break
      case 'REPLIED': camp.sent += n; camp.replied += n; break
      case 'FAILED': camp.failed += n; break
      case 'BOUNCED': camp.bounced += n; break
      // UNSUBSCRIBED not shown in the funnel — it's a lifecycle event, not a delivery state.
    }
  }

  const summary = {
    total:   qsTotal + campTotal,
    queued:  qsPending + camp.queued,
    pending: qsPending + camp.queued, // alias — same set, exposed under both labels
    sent:    qsSent + camp.sent,
    opened:  qsOpened + campOpenedCount,
    replied: qsReplied + camp.replied,
    failed:  qsFailed + camp.failed,
    bounced: camp.bounced,
  }
  return c.json(summary)
})

// GET /communication/mail-reports/drilldown?bucket=<name>
// Powers the "click a tile → see what's inside" feature on the Reports tab.
// Returns a merged list from BOTH sources (campaign recipients + quick sends)
// so admins can jump straight to the failing rows without opening two lists.
//
// Response rows are shape-compatible whether they come from a campaign or a
// quick send — a `source` field says which, plus the ids so the UI can link
// back to the campaign detail or the sent-history preview.
const drilldownBucket = z.enum([
  'total', 'queued', 'pending', 'sent', 'opened', 'replied', 'failed', 'bounced',
])
communicationRoutes.get(
  '/mail-reports/drilldown',
  zValidator('query', z.object({
    bucket: drilldownBucket,
    limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  })),
  async (c) => {
    const { userId, role } = c.get('user')
    const isAdmin = ['admin', 'sub-admin'].includes(role)
    const { bucket, limit } = c.req.valid('query')

    const sentWhere: Record<string, unknown> = {}
    const campWhere: Record<string, unknown> = {}
    if (!isAdmin) {
      sentWhere.userId = BigInt(userId)
      campWhere.campaign = { userId: BigInt(userId) }
    }

    // Translate the friendly bucket into the concrete filters each table needs.
    // Kept as inline switches (rather than a shared helper) so the exact SQL
    // shape for each side is obvious.
    let qsFilter: Record<string, unknown> | null = { ...sentWhere }
    let campFilter: Record<string, unknown> | null = { ...campWhere }

    switch (bucket) {
      case 'total':
        break
      case 'queued':
      case 'pending':
        qsFilter = { ...sentWhere, status: 'pending' }
        campFilter = { ...campWhere, status: 'QUEUED' }
        break
      case 'sent':
        qsFilter = { ...sentWhere, status: 'sent' }
        campFilter = { ...campWhere, status: { in: ['SENT', 'DELIVERED', 'REPLIED'] } }
        break
      case 'opened':
        qsFilter = { ...sentWhere, openedAt: { not: null } }
        campFilter = { ...campWhere, openedAt: { not: null } }
        break
      case 'replied':
        // Quick sends have no repliedAt column — reply detection needs the same
        // inbound-mail matching quick-send-stats uses. We approximate here by
        // pulling recent sends and filtering client-side after the query.
        qsFilter = { ...sentWhere }
        campFilter = { ...campWhere, status: 'REPLIED' }
        break
      case 'failed':
        qsFilter = { ...sentWhere, status: 'failed' }
        campFilter = { ...campWhere, status: 'FAILED' }
        break
      case 'bounced':
        // No BOUNCED status on SentMail — only campaigns can be flagged bounced.
        qsFilter = null
        campFilter = { ...campWhere, status: 'BOUNCED' }
        break
    }

    const half = Math.ceil(limit / 2)
    const [quickRows, campRows] = await Promise.all([
      qsFilter
        ? prisma.sentMail.findMany({
            where: qsFilter,
            orderBy: { createdAt: 'desc' },
            take: half,
            select: {
              id: true, toEmail: true, subject: true, body: true, status: true, openedAt: true,
              errorMessage: true, createdAt: true, leadId: true, groupId: true, userId: true,
            },
          })
        : Promise.resolve([]),
      campFilter
        ? prisma.emailCampaignRecipient.findMany({
            where: campFilter,
            orderBy: { createdAt: 'desc' },
            take: half,
            select: {
              id: true, toEmail: true, toName: true, status: true, sentAt: true, openedAt: true,
              repliedAt: true, errorMessage: true, createdAt: true, leadId: true, campaignId: true,
              campaign: { select: { id: true, name: true, subject: true, bodyHtml: true } },
              group: { select: { id: true, name: true, fromEmail: true } },
            },
          })
        : Promise.resolve([]),
    ])

    // For the 'replied' bucket we need to prune quick rows to just those that
    // actually got an inbound after send. Same trick as /quick-send-stats.
    let filteredQuick = quickRows
    if (bucket === 'replied' && quickRows.length) {
      const toEmails = [...new Set(quickRows.map((r) => r.toEmail))]
      const inbounds = await prisma.inboundMail.findMany({
        where: { fromEmail: { in: toEmails, mode: 'insensitive' } },
        select: { fromEmail: true, receivedAt: true },
      })
      const byEmail = new Map<string, Date[]>()
      for (const ib of inbounds) {
        const k = ib.fromEmail.toLowerCase()
        const arr = byEmail.get(k) || []
        arr.push(ib.receivedAt)
        byEmail.set(k, arr)
      }
      filteredQuick = quickRows.filter((r) => {
        const arr = byEmail.get(r.toEmail.toLowerCase())
        return arr && arr.some((t) => t >= r.createdAt)
      })
    }

    // Also resolve the account name for quick-send rows so both sides display
    // "sent via <mailbox>" the same way.
    const groupIds = [...new Set(filteredQuick.map((m) => m.groupId).filter((g): g is bigint => g !== null))]
    const groups = groupIds.length ? await prisma.campaignGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, fromEmail: true, name: true },
    }) : []
    const groupById = new Map(groups.map((g) => [g.id.toString(), g]))

    const quickShaped = filteredQuick.map((m) => ({
      source: 'quick' as const,
      id: Number(m.id),
      leadId: m.leadId ? Number(m.leadId) : null,
      toEmail: m.toEmail,
      toName: null as string | null,
      subject: m.subject,
      body: m.body ?? '',
      status: m.status,
      sentAt: m.status === 'sent' ? m.createdAt : null,
      openedAt: m.openedAt,
      repliedAt: null as Date | null,
      errorMessage: m.errorMessage,
      createdAt: m.createdAt,
      campaignId: null as number | null,
      campaignName: null as string | null,
      group: m.groupId ? (() => {
        const g = groupById.get(m.groupId.toString())
        return g ? { id: Number(g.id), name: g.name, fromEmail: g.fromEmail } : null
      })() : null,
    }))
    const campShaped = campRows.map((r) => ({
      source: 'campaign' as const,
      id: Number(r.id),
      leadId: r.leadId ? Number(r.leadId) : null,
      toEmail: r.toEmail,
      toName: r.toName,
      subject: r.campaign?.subject ?? '',
      body: r.campaign?.bodyHtml ?? '',
      status: r.status,
      sentAt: r.sentAt,
      openedAt: r.openedAt,
      repliedAt: r.repliedAt,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
      campaignId: Number(r.campaignId),
      campaignName: r.campaign?.name ?? null,
      group: r.group ? { id: Number(r.group.id), name: r.group.name, fromEmail: r.group.fromEmail } : null,
    }))

    // Merge, newest first, and trim to the requested limit.
    const merged = [...quickShaped, ...campShaped]
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
      .slice(0, limit)

    return c.json({ bucket, rows: merged })
  },
)

// POST /communication/upload-image
// Accepts a single image file and returns a URL the template/signature editor
// drops into the body as <img src="...">. The multer middleware already
// restricts to jpeg/png/gif/webp; anything else is rejected before we get here.
// The returned URL is server-relative (/uploads/...) so it works both in the
// preview iframe and — with APP_URL prepended by the mailer — in the sent
// email.
communicationRoutes.post('/upload-image', uploadSingle('file'), async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as any)?.incoming as any)?.file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No file uploaded' }, 400)
  if (!file.mimetype.startsWith('image/')) return c.json({ error: 'Only image files are allowed here' }, 400)
  const url = `${publicBaseUrl(c)}/api/uploads/${path.basename(file.filename)}`
  return c.json({ url, filename: file.originalname })
})

// Full list of tokens the mail pipeline understands. Kept as a shared const so
// the frontend editor's "insert" buttons and the backend replacer can't drift —
// GET /communication/tokens returns exactly this list.
export const MAIL_TOKENS = [
  { key: 'name',                 label: 'Recipient full name',   sample: 'Rahul Kumar' },
  { key: 'firstName',            label: 'Recipient first name',  sample: 'Rahul' },
  { key: 'email',                label: 'Recipient email',       sample: 'rahul@example.com' },
  { key: 'mobile',               label: 'Mobile',                sample: '9876543210' },
  { key: 'company',              label: 'Company',               sample: 'Acme Pvt Ltd' },
  { key: 'counsellorName',       label: 'Your (sender) full name', sample: 'Anjali Sharma' },
  { key: 'counsellorFirstName',  label: 'Your first name',       sample: 'Anjali' },
  { key: 'counsellorEmail',      label: 'Your email',            sample: 'anjali@company.com' },
  { key: 'quote_number',         label: 'Quote number',          sample: 'QUO-000042' },
  { key: 'order_number',         label: 'Order number',          sample: 'ORD-000042' },
  { key: 'invoice_number',       label: 'Invoice number',        sample: 'INV-000042' },
  { key: 'tracking_number',      label: 'Tracking number',       sample: 'TRK123' },
  { key: 'product_grid',         label: 'Inserted product cards', sample: '' },
  ...SALES_TOKENS.filter((t) => !['name', 'firstName', 'email', 'mobile', 'company', 'quote_number', 'order_number', 'invoice_number', 'tracking_number', 'product_grid'].includes(t.key)).map((t) => ({ ...t, sample: '' })),
]

// Replace every token — recipient AND counsellor — with real values. Blank name
// falls back to "there" so we never send "Dear ,". Missing counsellor context
// (e.g. an old scheduled campaign whose creator was deleted) collapses to empty
// strings rather than leaking the literal token.
function personalize(
  html: string,
  lead: { name: string | null; email: string | null },
  counsellor?: { name?: string | null; email?: string | null } | null,
): string {
  const name = (lead.name || '').trim() || 'there'
  const firstName = name.split(/\s+/)[0]
  const counsellorName = (counsellor?.name || '').trim()
  const counsellorFirst = counsellorName ? counsellorName.split(/\s+/)[0] : ''
  return html
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email || '')
    .replace(/\{\{\s*counsellorName\s*\}\}/gi, counsellorName)
    .replace(/\{\{\s*counsellorFirstName\s*\}\}/gi, counsellorFirst)
    .replace(/\{\{\s*counsellorEmail\s*\}\}/gi, counsellor?.email || '')
}

// GET /communication/tokens — exposes the token catalog so the frontend editor
// renders "insert" buttons for exactly what the server can replace.
communicationRoutes.get('/tokens', (c) => c.json(MAIL_TOKENS))

// ─── Send + record helper ─────────────────────────────────────────────────────
// Every non-campaign send goes through here so Sent History and Reports show a
// consistent shape for quick sends:
//   1. Insert SentMail with status='pending' → gives us a stable id.
//   2. Build a tracking pixel URL scoped to that id and append it to the html.
//   3. Send via the picked email account, or fall back to the .env SMTP.
//   4. Update SentMail with status='sent' + messageId + groupId on success,
//      or status='failed' + errorMessage on failure. Never throws — callers
//      just check the returned status if they need to.
async function sendOneAndRecord(params: {
  userId: bigint
  leadId?: bigint | null
  toEmail: string
  toName?: string | null
  subject: string
  htmlBody: string      // already personalized + wrapped in letterhead
  signatureHtml: string
  storedBody: string    // what to write into SentMail.body (usually the personalized body without letterhead)
  group: { id: bigint; fromName: string; fromEmail: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; smtpSecure: boolean } | null
  cc?: string
  bcc?: string
}): Promise<{ status: 'sent' | 'failed'; sentMailId: bigint; error?: string }> {
  // 1) Create the row first so we own an id for the pixel.
  const row = await prisma.sentMail.create({
    data: {
      toEmail: params.toEmail,
      subject: params.subject,
      body: params.storedBody,
      userId: params.userId,
      leadId: params.leadId ?? null,
      groupId: params.group?.id ?? null,
      status: 'pending',
    },
  })

  // 2) Append the quick-open tracking pixel — same shape as the campaign one,
  // just a different endpoint keyed by SentMail.id. Skipped in dev where
  // APP_URL is empty (matches campaign engine behaviour).
  const baseUrl = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const pixel = baseUrl
    ? `<img src="${baseUrl}/api/tracking/quick-open/${row.id}.gif" width="1" height="1" alt="" style="display:none;border:0;height:1px;width:1px;" />`
    : ''
  const finalHtml = params.htmlBody + (params.signatureHtml ? `<br><br>${params.signatureHtml}` : '') + pixel

  try {
    let messageId: string | null = null
    if (params.group) {
      // sendViaGroup already returns the RFC Message-ID for reply threading.
      const res = await sendViaGroup(params.group as never, {
        to: params.toEmail,
        toName: params.toName ?? null,
        subject: params.subject,
        html: finalHtml,
      })
      messageId = res.messageId || null
    } else {
      const info = await emailService.send({
        to: params.toEmail,
        subject: params.subject,
        html: finalHtml,
        cc: params.cc,
        bcc: params.bcc,
      })
      messageId = String(info?.messageId || '') || null
    }
    await prisma.sentMail.update({
      where: { id: row.id },
      data: { status: 'sent', messageId },
    })
    if (params.leadId) {
      await prisma.studentMailHistory.create({
        data: { leadId: params.leadId, subject: params.subject, body: params.storedBody },
      }).catch(() => undefined)
    }
    return { status: 'sent', sentMailId: row.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.sentMail.update({
      where: { id: row.id },
      data: { status: 'failed', errorMessage: msg.slice(0, 500) },
    })
    return { status: 'failed', sentMailId: row.id, error: msg }
  }
}

// ─── Mail Templates ───────────────────────────────────────────────────────────

communicationRoutes.get('/templates', async (c) => {
  const { userId } = c.get('user')
  const templates = await prisma.mailTemplate.findMany({
    where: { OR: [{ userId: BigInt(userId) }, { status: 1 }] },
    orderBy: { title: 'asc' },
  })
  return c.json(templates)
})

communicationRoutes.post('/templates', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()

  const template = await prisma.mailTemplate.create({
    data: { ...body, userId: BigInt(userId) },
  })
  return c.json(template, 201)
})

// ─── Send Email ───────────────────────────────────────────────────────────────

const sendEmailSchema = z.object({
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  leadId: z.number().optional(),
  signatureId: z.number().optional(),
  fromEmail: z.string().email().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
})

communicationRoutes.post('/send', zValidator('json', sendEmailSchema), async (c) => {
  const user = c.get('user') as { userId: number; name?: string; email?: string }
  const userId = user.userId
  const body = c.req.valid('json')

  let signature = ''
  if (body.signatureId) {
    const sig = await prisma.signature.findUnique({ where: { id: BigInt(body.signatureId) } })
    signature = sig?.content || ''
  }

  // Look up the lead (if any) so single-send substitutes {{name}} the same way
  // bulk-send does — otherwise "Hi {{name}}" ships literally to one recipient
  // and personalized to the rest.
  const lead = body.leadId
    ? await prisma.lead.findUnique({ where: { id: BigInt(body.leadId) }, select: { name: true, email: true } })
    : null
  const bodyHtml = await resolveProductTokens(
    personalize(body.body, lead || { name: null, email: body.toEmail }, { name: user.name, email: user.email }),
  )

  const result = await sendOneAndRecord({
    userId: BigInt(userId),
    leadId: body.leadId ? BigInt(body.leadId) : null,
    toEmail: body.toEmail,
    toName: lead?.name ?? null,
    subject: body.subject,
    htmlBody: wrapMail(bodyHtml, '', publicBaseUrl(c)), // signature appended by helper
    signatureHtml: publicAssetHtml(signature, publicBaseUrl(c)),
    storedBody: bodyHtml,
    group: null,
    cc: body.cc,
    bcc: body.bcc,
  })

  if (result.status === 'failed') return c.json({ error: result.error || 'Send failed' }, 502)
  return c.json({ message: 'Email sent successfully', sentMailId: Number(result.sentMailId) })
})

// ─── Bulk Email ───────────────────────────────────────────────────────────────

communicationRoutes.post('/send-bulk', async (c) => {
  const { leadIds, subject, body: emailBody, signatureId, cc, bcc, groupId } = await c.req.json()
  const user = c.get('user') as { userId: number; name?: string; email?: string }
  const userId = user.userId
  const counsellor = { name: user.name, email: user.email }

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds.map(BigInt) }, email: { not: null } },
    select: { id: true, name: true, email: true },
  })

  let signature = ''
  if (signatureId) {
    const sig = await prisma.signature.findUnique({ where: { id: BigInt(signatureId) } })
    signature = sig?.content || ''
  }

  // If a specific "Send from" account is picked, use its SMTP transporter so
  // recipients see that address. Otherwise fall back to the SMTP_FROM configured
  // in .env — matches the pre-accounts quick-send behaviour.
  const group = groupId
    ? await prisma.campaignGroup.findUnique({ where: { id: BigInt(groupId) } })
    : null
  if (!groupId || !group || !group.isActive) {
    return c.json({ error: 'Choose an active added email account before sending.' }, 400)
  }

  // Process asynchronously in chunks of 10
  let sent = 0
  let failed = 0
  const chunkSize = 10
  for (let i = 0; i < leads.length; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize)
    await Promise.allSettled(
      chunk.map(async (lead) => {
        if (!lead.email) return
        const personalBody = await resolveProductTokens(personalize(emailBody, lead, counsellor))
        const res = await sendOneAndRecord({
          userId: BigInt(userId),
          leadId: lead.id,
          toEmail: lead.email,
          toName: lead.name,
          subject,
          htmlBody: wrapMail(personalBody, '', publicBaseUrl(c)),
          signatureHtml: publicAssetHtml(signature, publicBaseUrl(c)),
          storedBody: personalBody,
          group,
          cc,
          bcc,
        })
        if (res.status === 'sent') sent++
        else failed++
      })
    )
  }

  return c.json({ message: `Sent to ${sent} of ${leads.length} leads${failed ? ` · ${failed} failed` : ''}`, sent, failed })
})

// POST /api/communication/send-bulk-by-filter — resolve leads by filter, then send.
// Accepts everything the Compose recipient list filters on so the "Send to ALL
// by Filter" button targets EXACTLY the set the counsellor sees on screen —
// otherwise a filter chip that narrowed the list would silently be ignored at
// send time. Multi-value strings are comma-separated (matches the Leads page
// convention).
communicationRoutes.post('/send-bulk-by-filter', async (c) => {
  const user = c.get('user') as { userId: number; name?: string; email?: string }
  const userId = user.userId
  const counsellor = { name: user.name, email: user.email }
  const body = await c.req.json() as {
    subject?: string; body?: string; signatureId?: number | string; groupId?: number | string;
    departmentId?: number | string; leadStatusId?: number | string; leadSubStatusId?: number | string;
    statusLeadTypeId?: number | string;
    website?: string; source?: string; country?: string; city?: string;
    intrestedCourse?: string;
    fromDate?: string; toDate?: string; search?: string;
    all?: boolean; cc?: string; bcc?: string;
  }
  const {
    subject, body: emailBody, signatureId, groupId,
    departmentId, leadStatusId, leadSubStatusId, statusLeadTypeId,
    website, source, country, city, intrestedCourse,
    fromDate, toDate, search,
    all, cc, bcc,
  } = body

  if (!subject || !emailBody) return c.json({ error: 'subject and body required' }, 400)

  const splitCsv = (v: unknown): string[] => typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
  const asIn = (v: unknown) => {
    const list = splitCsv(v)
    return list.length ? { in: list } : undefined
  }
  const parseDay = (v: unknown, endOfDay = false): Date | undefined => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
    // Match the leads-page filter: bounds are IST midnight, not UTC — so
    // "today" here means the same "today" the counsellor was looking at.
    return new Date(`${v}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:30`)
  }

  const where: Record<string, unknown> = { trash: 0, email: { not: null } }
  if (departmentId) where.departmentId = BigInt(String(departmentId))
  if (leadStatusId) where.leadStatusId = BigInt(String(leadStatusId))
  if (leadSubStatusId) where.leadSubStatusId = BigInt(String(leadSubStatusId))
  if (statusLeadTypeId) where.statusLeadTypeId = BigInt(String(statusLeadTypeId))
  const websiteIn = asIn(website); if (websiteIn) where.website = websiteIn
  const sourceIn = asIn(source); if (sourceIn) where.source = sourceIn
  const countryIn = asIn(country); if (countryIn) where.country = countryIn
  const cityIn = asIn(city); if (cityIn) where.city = cityIn
  const courseIn = asIn(intrestedCourse); if (courseIn) where.intrestedCourse = courseIn
  const gte = parseDay(fromDate)
  const lte = parseDay(toDate, true)
  if (gte || lte) where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
  if (typeof search === 'string' && search.trim()) {
    const q = search.trim()
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { mobile: { contains: q } },
    ]
  }
  const hasNarrowing = Boolean(
    departmentId || leadStatusId || leadSubStatusId || statusLeadTypeId
    || websiteIn || sourceIn || countryIn || cityIn || courseIn
    || gte || lte || (typeof search === 'string' && search.trim()),
  )
  if (!all && !hasNarrowing)
    return c.json({ error: 'Must pick at least one filter (or pass all=true) to prevent sending to every lead by accident.' }, 400)

  const leads = await prisma.lead.findMany({
    where, select: { id: true, name: true, email: true },
  })

  let signature = ''
  if (signatureId) {
    const sig = await prisma.signature.findUnique({ where: { id: BigInt(signatureId) } })
    signature = sig?.content || ''
  }
  const group = groupId
    ? await prisma.campaignGroup.findUnique({ where: { id: BigInt(groupId) } })
    : null

  let sent = 0
  let failed = 0
  const chunkSize = 10
  for (let i = 0; i < leads.length; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize)
    await Promise.allSettled(
      chunk.map(async (lead) => {
        if (!lead.email) return
        const personalBody = await resolveProductTokens(personalize(emailBody, lead, counsellor))
        const res = await sendOneAndRecord({
          userId: BigInt(userId),
          leadId: lead.id,
          toEmail: lead.email,
          toName: lead.name,
          subject: subject!,
          htmlBody: wrapMail(personalBody, '', publicBaseUrl(c)),
          signatureHtml: publicAssetHtml(signature, publicBaseUrl(c)),
          storedBody: personalBody,
          group,
          cc,
          bcc,
        })
        if (res.status === 'sent') sent++
        else failed++
      }),
    )
  }

  return c.json({ message: `Sent to ${sent} of ${leads.length} leads${failed ? ` · ${failed} failed` : ''}`, total: leads.length, sent, failed })
})

// ─── Signatures ───────────────────────────────────────────────────────────────

communicationRoutes.get('/signatures', async (c) => {
  const { userId } = c.get('user')
  const sigs = await prisma.signature.findMany({ where: { userId: BigInt(userId) } })
  return c.json(sigs)
})

communicationRoutes.post('/signatures', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()
  const sig = await prisma.signature.create({ data: { ...body, userId: BigInt(userId) } })
  return c.json(sig, 201)
})

communicationRoutes.patch('/signatures/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  const body = await c.req.json()
  const sig = await prisma.signature.update({ where: { id, userId: BigInt(userId) }, data: { title: body.title, content: body.content } })
  return c.json(sig)
})

communicationRoutes.delete('/signatures/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  await prisma.signature.delete({ where: { id, userId: BigInt(userId) } })
  return c.json({ message: 'Deleted' })
})

communicationRoutes.post('/signatures/:id/set-default', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  await prisma.signature.updateMany({ where: { userId: BigInt(userId) }, data: { isDefault: 0 } })
  await prisma.signature.update({ where: { id }, data: { isDefault: 1 } })
  return c.json({ message: 'Default set' })
})

// ─── Templates update/delete ─────────────────────────────────────────────────

communicationRoutes.patch('/templates/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const tpl = await prisma.mailTemplate.update({ where: { id }, data: { title: body.title, subject: body.subject, body: body.body } })
  return c.json(tpl)
})

communicationRoutes.delete('/templates/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.mailTemplate.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})

// ─── Email Headers ────────────────────────────────────────────────────────────

communicationRoutes.get('/headers', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const where = isAdmin ? {} : { userId: BigInt(userId) }
  const headers = await prisma.emailHeader.findMany({ where, orderBy: { name: 'asc' } })
  return c.json(headers)
})

communicationRoutes.post('/headers', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()
  const header = await prisma.emailHeader.create({ data: { name: body.name, email: body.email, userId: BigInt(userId) } })
  return c.json(header, 201)
})

communicationRoutes.patch('/headers/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const header = await prisma.emailHeader.update({ where: { id }, data: { name: body.name, email: body.email } })
  return c.json(header)
})

communicationRoutes.delete('/headers/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.emailHeader.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})

communicationRoutes.post('/headers/:id/set-default', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  await prisma.emailHeader.updateMany({ where: { userId: BigInt(userId) }, data: { isDefault: 0 } })
  await prisma.emailHeader.update({ where: { id }, data: { isDefault: 1 } })
  return c.json({ message: 'Default set' })
})

// ─── Sent history ─────────────────────────────────────────────────────────────

communicationRoutes.get('/sent', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const leadId = c.req.query('leadId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(500, parseInt(c.req.query('limit') || '25'))
  const search = (c.req.query('search') || '').trim()
  const sourceParam = c.req.query('source') // '', 'direct', 'campaign'

  // History merges BOTH sources so every mail we sent shows up in one list —
  // quick sends (SentMail) tagged 'direct', campaign recipients tagged
  // 'campaign'. Admins finally see "which of these went through a campaign?"
  // without switching tabs.
  const quickWhere: Record<string, unknown> = {}
  const campWhere: Record<string, unknown> = {}
  if (!isAdmin) {
    quickWhere.userId = BigInt(userId)
    campWhere.campaign = { userId: BigInt(userId) }
  }
  if (leadId) {
    quickWhere.leadId = BigInt(leadId)
    campWhere.leadId = BigInt(leadId)
  }

  // Free-text search over recipient / subject / campaign name. Case-insensitive
  // "contains" — same UX as the Leads search box. Applies to both sources.
  if (search) {
    quickWhere.OR = [
      { toEmail: { contains: search, mode: 'insensitive' } },
      { subject: { contains: search, mode: 'insensitive' } },
    ]
    campWhere.OR = [
      { toEmail: { contains: search, mode: 'insensitive' } },
      { toName: { contains: search, mode: 'insensitive' } },
      { campaign: { name: { contains: search, mode: 'insensitive' } } },
      { campaign: { subject: { contains: search, mode: 'insensitive' } } },
    ]
  }

  // Source filter — passed down so the counts on either half stay accurate
  // instead of the frontend receiving twice as many rows just to drop half.
  const wantDirect = sourceParam !== 'campaign'
  const wantCampaign = sourceParam !== 'direct'

  // Total = sum of both tables. Pagination fetches (page*limit) newest from
  // each side, merges by createdAt desc, then slices the requested window.
  // Sufficient at typical mail volumes; a huge dataset with wildly unbalanced
  // sources would deserve a raw UNION but this stays fast for the current
  // scale and never misses newer rows on early pages.
  const [quickTotal, campTotal] = await Promise.all([
    wantDirect ? prisma.sentMail.count({ where: quickWhere }) : Promise.resolve(0),
    wantCampaign ? prisma.emailCampaignRecipient.count({ where: campWhere }) : Promise.resolve(0),
  ])
  const total = quickTotal + campTotal
  const take = page * limit

  const [quickRows, campRows] = await Promise.all([
    wantDirect ? prisma.sentMail.findMany({
      where: quickWhere,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        user: { select: { id: true, name: true } },
      },
    }) : Promise.resolve([] as never[]),
    wantCampaign ? prisma.emailCampaignRecipient.findMany({
      where: campWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, toEmail: true, toName: true, status: true, sentAt: true,
        openedAt: true, repliedAt: true, errorMessage: true, createdAt: true,
        leadId: true, campaignId: true, messageId: true,
        campaign: { select: { id: true, name: true, subject: true, bodyHtml: true, userId: true } },
        group: { select: { id: true, name: true, fromEmail: true } },
      },
    }) : Promise.resolve([] as never[]),
  ])

  // Reply detection for quick sends: any InboundMail from the recipient's
  // address received AFTER the send counts as a reply. Bounded to inbounds
  // newer than the oldest quick row on this page.
  const quickToEmails = [...new Set(quickRows.map((m) => m.toEmail))]
  const oldestQuickAt = quickRows.length ? quickRows[quickRows.length - 1].createdAt : new Date()
  const replies = quickToEmails.length ? await prisma.inboundMail.findMany({
    where: {
      fromEmail: { in: quickToEmails, mode: 'insensitive' },
      receivedAt: { gte: oldestQuickAt },
    },
    select: { fromEmail: true, receivedAt: true },
  }) : []
  const repliedAtFor = (toEmail: string, sentAt: Date): Date | null => {
    let earliest: Date | null = null
    for (const r of replies) {
      if (r.fromEmail.toLowerCase() !== toEmail.toLowerCase()) continue
      if (r.receivedAt < sentAt) continue
      if (!earliest || r.receivedAt < earliest) earliest = r.receivedAt
    }
    return earliest
  }

  // Resolve mailbox names for the quick rows (campaign rows already include
  // their group via the include above).
  const groupIds = [...new Set(quickRows.map((m) => m.groupId).filter((g): g is bigint => g !== null))]
  const groups = groupIds.length ? await prisma.campaignGroup.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, fromEmail: true, name: true },
  }) : []
  const groupById = new Map(groups.map((g) => [g.id.toString(), g]))

  // Resolve creator names for campaign rows so the "by <user>" column stays
  // filled — campaign recipients don't carry a userId of their own, they
  // inherit from the campaign creator.
  const campUserIds = [...new Set(campRows.map((r) => r.campaign?.userId).filter((u): u is bigint => u != null))]
  const campUsers = campUserIds.length ? await prisma.user.findMany({
    where: { id: { in: campUserIds } },
    select: { id: true, name: true },
  }) : []
  const userById = new Map(campUsers.map((u) => [u.id.toString(), u]))

  interface Row {
    id: number
    source: 'direct' | 'campaign'
    leadId: number | null
    toEmail: string
    subject: string
    body: string
    status: string
    openedAt: Date | null
    repliedAt: Date | null
    errorMessage: string | null
    createdAt: Date
    user: { id: number; name: string } | null
    group: { id: number; name: string; fromEmail: string } | null
    campaignId: number | null
    campaignName: string | null
  }

  const quickShaped: Row[] = quickRows.map((m) => ({
    id: Number(m.id),
    source: 'direct',
    leadId: m.leadId ? Number(m.leadId) : null,
    toEmail: m.toEmail,
    subject: m.subject,
    body: m.body,
    status: m.status ?? 'sent',
    openedAt: m.openedAt,
    repliedAt: repliedAtFor(m.toEmail, m.createdAt),
    errorMessage: m.errorMessage,
    createdAt: m.createdAt,
    user: m.user ? { id: Number(m.user.id), name: m.user.name } : null,
    group: m.groupId ? (() => {
      const g = groupById.get(m.groupId!.toString())
      return g ? { id: Number(g.id), name: g.name, fromEmail: g.fromEmail } : null
    })() : null,
    campaignId: null,
    campaignName: null,
  }))

  // Campaign recipient → sent-history row. Status text is lower-cased so the
  // existing frontend filter chips ('sent' / 'failed' / etc.) keep working
  // without a shape change. QUEUED stays visible as 'pending' — matches the
  // quick-send convention.
  const mapStatus = (s: string): string => {
    const u = s.toUpperCase()
    if (u === 'QUEUED') return 'pending'
    if (u === 'DELIVERED' || u === 'REPLIED') return 'sent'
    return u.toLowerCase()
  }
  const campShaped: Row[] = campRows.map((r) => ({
    id: Number(r.id),
    source: 'campaign',
    leadId: r.leadId ? Number(r.leadId) : null,
    toEmail: r.toEmail,
    subject: r.campaign?.subject ?? '',
    body: r.campaign?.bodyHtml ?? '',
    status: mapStatus(r.status),
    openedAt: r.openedAt,
    repliedAt: r.repliedAt,
    errorMessage: r.errorMessage,
    createdAt: r.sentAt ?? r.createdAt,
    user: r.campaign?.userId
      ? (() => {
          const u = userById.get(r.campaign.userId.toString())
          return u ? { id: Number(u.id), name: u.name } : null
        })()
      : null,
    group: r.group ? { id: Number(r.group.id), name: r.group.name, fromEmail: r.group.fromEmail } : null,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaign?.name ?? null,
  }))

  const enriched = [...quickShaped, ...campShaped]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice((page - 1) * limit, page * limit)

  return c.json({ data: enriched, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) })
})

// GET /communication/sent/export — CSV of everything matching the current
// search + source filter. Same shape as the /sent endpoint's paged rows, only
// flattened for spreadsheets. Capped at 50k rows so a stray export can't OOM
// the process; the response headers report if the cut kicked in.
communicationRoutes.get('/sent/export', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const search = (c.req.query('search') || '').trim()
  const sourceParam = c.req.query('source')
  const wantDirect = sourceParam !== 'campaign'
  const wantCampaign = sourceParam !== 'direct'
  const HARD_CAP = 50_000

  const quickWhere: Record<string, unknown> = {}
  const campWhere: Record<string, unknown> = {}
  if (!isAdmin) {
    quickWhere.userId = BigInt(userId)
    campWhere.campaign = { userId: BigInt(userId) }
  }
  if (search) {
    quickWhere.OR = [
      { toEmail: { contains: search, mode: 'insensitive' } },
      { subject: { contains: search, mode: 'insensitive' } },
    ]
    campWhere.OR = [
      { toEmail: { contains: search, mode: 'insensitive' } },
      { toName: { contains: search, mode: 'insensitive' } },
      { campaign: { name: { contains: search, mode: 'insensitive' } } },
      { campaign: { subject: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [quickRows, campRows] = await Promise.all([
    wantDirect ? prisma.sentMail.findMany({
      where: quickWhere,
      orderBy: { createdAt: 'desc' },
      take: HARD_CAP,
      select: {
        id: true, toEmail: true, subject: true, status: true, openedAt: true,
        errorMessage: true, createdAt: true, leadId: true, groupId: true,
        user: { select: { name: true } },
      },
    }) : Promise.resolve([] as never[]),
    wantCampaign ? prisma.emailCampaignRecipient.findMany({
      where: campWhere,
      orderBy: { createdAt: 'desc' },
      take: HARD_CAP,
      select: {
        id: true, toEmail: true, toName: true, status: true, sentAt: true,
        openedAt: true, repliedAt: true, errorMessage: true, createdAt: true,
        leadId: true, campaignId: true,
        campaign: { select: { name: true, subject: true, userId: true } },
        group: { select: { name: true, fromEmail: true } },
      },
    }) : Promise.resolve([] as never[]),
  ])

  const groupIds = [...new Set(quickRows.map((m) => m.groupId).filter((g): g is bigint => g !== null))]
  const groups = groupIds.length ? await prisma.campaignGroup.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, fromEmail: true, name: true },
  }) : []
  const groupById = new Map(groups.map((g) => [g.id.toString(), g]))
  const campUserIds = [...new Set(campRows.map((r) => r.campaign?.userId).filter((u): u is bigint => u != null))]
  const campUsers = campUserIds.length ? await prisma.user.findMany({
    where: { id: { in: campUserIds } },
    select: { id: true, name: true },
  }) : []
  const userById = new Map(campUsers.map((u) => [u.id.toString(), u]))

  const iso = (d: Date | null) => d ? d.toISOString() : ''

  interface CsvRow {
    Source: string
    Subject: string
    Recipient: string
    RecipientName: string
    Status: string
    Sender: string
    Account: string
    Campaign: string
    LeadId: string
    SentAt: string
    OpenedAt: string
    RepliedAt: string
    Error: string
  }

  const rows: CsvRow[] = []
  for (const m of quickRows) {
    const g = m.groupId ? groupById.get(m.groupId.toString()) : null
    rows.push({
      Source: 'DIRECT',
      Subject: m.subject,
      Recipient: m.toEmail,
      RecipientName: '',
      Status: m.status ?? 'sent',
      Sender: m.user?.name ?? '',
      Account: g?.fromEmail ?? '',
      Campaign: '',
      LeadId: m.leadId ? String(m.leadId) : '',
      SentAt: m.status === 'sent' ? iso(m.createdAt) : '',
      OpenedAt: iso(m.openedAt),
      RepliedAt: '',
      Error: m.errorMessage ?? '',
    })
  }
  for (const r of campRows) {
    const u = r.campaign?.userId ? userById.get(r.campaign.userId.toString()) : null
    rows.push({
      Source: 'CAMPAIGN',
      Subject: r.campaign?.subject ?? '',
      Recipient: r.toEmail,
      RecipientName: r.toName ?? '',
      Status: r.status,
      Sender: u?.name ?? '',
      Account: r.group?.fromEmail ?? '',
      Campaign: r.campaign?.name ?? '',
      LeadId: r.leadId ? String(r.leadId) : '',
      SentAt: iso(r.sentAt),
      OpenedAt: iso(r.openedAt),
      RepliedAt: iso(r.repliedAt),
      Error: r.errorMessage ?? '',
    })
  }
  rows.sort((a, b) => (b.SentAt || '').localeCompare(a.SentAt || ''))

  const csv = csvStringify(rows, {
    header: true,
    columns: [
      'Source', 'Subject', 'Recipient', 'RecipientName', 'Status', 'Sender',
      'Account', 'Campaign', 'LeadId', 'SentAt', 'OpenedAt', 'RepliedAt', 'Error',
    ],
  })
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mail-history-${new Date().toISOString().slice(0, 10)}.csv"`,
      'X-Row-Count': String(rows.length),
      'X-Cap-Reached': String(rows.length >= HARD_CAP * 2),
    },
  })
})

// ─── IMAP Inbox ───────────────────────────────────────────────────────────────
// All inbox routes are best-effort and return 503 if IMAP env vars aren't set.

function imapError(err: unknown) {
  const msg = err instanceof Error ? err.message : 'IMAP error'
  const isConfig = msg.includes('not configured')
  return { status: isConfig ? 503 : 502, error: msg }
}

communicationRoutes.get('/folders', async (c) => {
  try {
    const folders = await imap.listFolders()
    return c.json(folders)
  } catch (err) {
    const e = imapError(err)
    return c.json({ error: e.error }, e.status as 503 | 502)
  }
})

communicationRoutes.get('/inbox', async (c) => {
  const folder = c.req.query('folder') || 'INBOX'
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '25')
  try {
    const result = await imap.listMessages(folder, page, limit)
    return c.json(result)
  } catch (err) {
    const e = imapError(err)
    return c.json({ error: e.error }, e.status as 503 | 502)
  }
})

communicationRoutes.get('/inbox/:uid', async (c) => {
  const folder = c.req.query('folder') || 'INBOX'
  const uid = parseInt(c.req.param('uid'))
  if (!Number.isFinite(uid)) return c.json({ error: 'Invalid uid' }, 400)
  try {
    const msg = await imap.getMessage(folder, uid)
    if (!msg) return c.json({ error: 'Not found' }, 404)
    return c.json(msg)
  } catch (err) {
    const e = imapError(err)
    return c.json({ error: e.error }, e.status as 503 | 502)
  }
})

communicationRoutes.patch('/inbox/:uid/seen', async (c) => {
  const folder = c.req.query('folder') || 'INBOX'
  const uid = parseInt(c.req.param('uid'))
  const { seen } = await c.req.json().catch(() => ({ seen: true }))
  try {
    await imap.markSeen(folder, uid, seen !== false)
    return c.json({ message: 'ok' })
  } catch (err) {
    const e = imapError(err)
    return c.json({ error: e.error }, e.status as 503 | 502)
  }
})

communicationRoutes.delete('/inbox/:uid', async (c) => {
  const folder = c.req.query('folder') || 'INBOX'
  const uid = parseInt(c.req.param('uid'))
  try {
    await imap.deleteMessage(folder, uid)
    return c.json({ message: 'Deleted' })
  } catch (err) {
    const e = imapError(err)
    return c.json({ error: e.error }, e.status as 503 | 502)
  }
})
