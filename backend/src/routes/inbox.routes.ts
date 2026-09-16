import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { sendViaGroup } from '../services/campaign-mailer.service'

// Serve-time repair for messages stored before the poller learned to decode
// Content-Transfer-Encoding. If the body reads like a base64 blob (no HTML
// tags, only base64-safe chars, long enough that it isn't just random text)
// try to decode it once at read time so users don't have to wait for a
// re-poll. Same treatment for quoted-printable bodies where "=E2=80=93"-style
// escapes are the dominant character shape.
function looksLikeBase64(s: string): boolean {
  const trimmed = s.replace(/\s+/g, '')
  if (trimmed.length < 100) return false
  if (/<[a-z][^>]*>/i.test(s)) return false // already contains tags
  return /^[A-Za-z0-9+/=]+$/.test(trimmed)
}
function looksLikeQuotedPrintable(s: string): boolean {
  if (/<[a-z][^>]*>/i.test(s)) return false
  const escapes = (s.match(/=[0-9A-Fa-f]{2}/g) || []).length
  return escapes > 5 && escapes / Math.max(1, s.length) > 0.02
}
function tryDecodeStoredBody(body: string | null): string | null {
  if (!body) return body
  if (looksLikeBase64(body)) {
    try {
      const decoded = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf-8')
      if (/<[a-z][^>]*>|[\p{L}\p{N}]/u.test(decoded)) return decoded
    } catch {
      // fall through
    }
  }
  if (looksLikeQuotedPrintable(body)) {
    try {
      const stripped = body.replace(/=\r?\n/g, '')
      const bytes: number[] = []
      for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i]
        if (ch === '=' && i + 2 < stripped.length && /^[0-9A-Fa-f]{2}$/.test(stripped.substr(i + 1, 2))) {
          bytes.push(parseInt(stripped.substr(i + 1, 2), 16))
          i += 2
        } else {
          bytes.push(ch.charCodeAt(0) & 0xff)
        }
      }
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
    } catch {
      // fall through
    }
  }
  return body
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repairInbound<T extends Record<string, any>>(row: T): T {
  if (row && typeof row === 'object') {
    if ('bodyHtml' in row) (row as Record<string, unknown>).bodyHtml = tryDecodeStoredBody(row.bodyHtml as string | null)
    if ('bodyText' in row) (row as Record<string, unknown>).bodyText = tryDecodeStoredBody(row.bodyText as string | null)
  }
  return row
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bigintFix(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(bigintFix)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = bigintFix(obj[k])
    return out
  }
  return obj
}

export const inboxRoutes = new Hono()
inboxRoutes.use('*', authenticate)

// GET /api/inbox?leadId=&campaignId=&groupId=&unreadOnly=&page=&limit=
inboxRoutes.get('/', async (c) => {
  const leadId = c.req.query('leadId')
  const campaignId = c.req.query('campaignId')
  const groupId = c.req.query('groupId')
  const unreadOnly = c.req.query('unreadOnly') === '1'
  const page = Math.max(1, Number(c.req.query('page') || 1))
  const limit = Math.min(100, Number(c.req.query('limit') || 25))

  const where: Prisma.InboundMailWhereInput = {}
  if (leadId) where.leadId = BigInt(leadId)
  // Filter by which email account the message landed in — surfaces "just the
  // support@ inbox" cleanly when several accounts feed the same tab.
  if (groupId) where.groupId = BigInt(groupId)
  if (unreadOnly) where.isRead = false
  if (campaignId) {
    where.recipient = { campaignId: BigInt(campaignId) }
  }

  const [data, total] = await Promise.all([
    prisma.inboundMail.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        group: { select: { id: true, name: true, fromEmail: true } },
        lead: { select: { id: true, name: true } },
        recipient: {
          select: {
            id: true, campaignId: true,
            campaign: { select: { id: true, name: true, subject: true } },
          },
        },
      },
    }),
    prisma.inboundMail.count({ where }),
  ])

  return c.json(bigintFix({
    data: data.map(repairInbound),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }))
})

inboxRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const mail = await prisma.inboundMail.findUnique({
    where: { id },
    include: {
      group: { select: { id: true, name: true, fromEmail: true } },
      lead: { select: { id: true, name: true } },
      recipient: {
        select: {
          id: true, campaignId: true,
          campaign: { select: { id: true, name: true, subject: true } },
        },
      },
    },
  })
  if (!mail) return c.json({ error: 'Not found' }, 404)
  // Auto-mark read on detail open.
  if (!mail.isRead) {
    await prisma.inboundMail.update({ where: { id }, data: { isRead: true } })
  }
  return c.json(bigintFix(repairInbound(mail)))
})

inboxRoutes.post('/:id/read', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.inboundMail.update({ where: { id }, data: { isRead: true } })
  return c.json({ ok: true })
})

inboxRoutes.delete('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.inboundMail.delete({ where: { id } })
  return c.json({ ok: true })
})

// GET /api/inbox/counts/unread — for sidebar/header badge
inboxRoutes.get('/counts/unread', async (c) => {
  const total = await prisma.inboundMail.count({ where: { isRead: false } })
  return c.json({ unread: total })
})

// POST /api/inbox/:id/reply
// Replies to an inbound mail using the account that ORIGINALLY received it, so
// the sender and threading headers line up with the client's mail app (Gmail /
// Outlook / etc. group it under the same conversation). Records the send in
// SentMail so it shows up in Sent History and Reports with open-tracking.
const replySchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  signatureId: z.number().int().optional().nullable(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
})
inboxRoutes.post('/:id/reply', zValidator('json', replySchema), async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user') as { userId: number; name?: string; email?: string }
  const { subject, body, signatureId, cc, bcc } = c.req.valid('json')

  const inbound = await prisma.inboundMail.findUnique({
    where: { id },
    include: { group: true, lead: { select: { id: true, name: true } } },
  })
  if (!inbound) return c.json({ error: 'Reply target not found' }, 404)
  if (!inbound.group) return c.json({ error: 'Original account not configured — cannot reply' }, 400)

  // Signature (optional) — same lookup the /communication/send route uses so
  // both flows produce visually identical mails.
  let signatureHtml = ''
  if (signatureId) {
    const sig = await prisma.signature.findUnique({ where: { id: BigInt(signatureId) } })
    signatureHtml = sig?.content || ''
  }

  // Insert the SentMail row first so we own an id for the open-tracking pixel.
  // Status starts 'pending' and flips to 'sent'/'failed' below — mirrors the
  // sendOneAndRecord() shape in communication.routes.ts so Sent History and
  // Reports render replies the same as any other quick send.
  const row = await prisma.sentMail.create({
    data: {
      toEmail: inbound.fromEmail,
      subject,
      body,
      userId: BigInt(user.userId),
      leadId: inbound.leadId ?? null,
      groupId: inbound.groupId,
      status: 'pending',
    },
  })

  const baseUrl = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const pixel = baseUrl
    ? `<img src="${baseUrl}/api/tracking/quick-open/${row.id}.gif" width="1" height="1" alt="" style="display:none;border:0;height:1px;width:1px;" />`
    : ''
  const html = body + (signatureHtml ? `<br><br>${signatureHtml}` : '') + pixel

  // Threading headers — In-Reply-To is the message we're replying to, and
  // References chains everything the original had plus that same id. This is
  // what tells the recipient's mail client to file the reply under the same
  // conversation instead of starting a new one.
  const references: string[] = []
  if (inbound.inReplyTo) references.push(inbound.inReplyTo)
  if (inbound.messageId) references.push(inbound.messageId)

  try {
    const { messageId } = await sendViaGroup(inbound.group, {
      to: inbound.fromEmail,
      toName: inbound.fromName,
      subject,
      html,
      inReplyTo: inbound.messageId || undefined,
      references: references.length ? references : undefined,
    })
    await prisma.sentMail.update({
      where: { id: row.id },
      data: { status: 'sent', messageId: messageId || null },
    })
    // Also stamp the inbound as read on reply — a mail you've replied to is
    // definitionally read, and it removes an extra click for the counsellor.
    if (!inbound.isRead) {
      await prisma.inboundMail.update({ where: { id }, data: { isRead: true } })
    }
    // NOTE: `cc` / `bcc` are accepted by the schema for parity with the compose
    // form, but sendViaGroup doesn't currently forward them to nodemailer — a
    // follow-up wiring change if/when replies need CC support.
    return c.json({ ok: true, sentMailId: Number(row.id) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.sentMail.update({
      where: { id: row.id },
      data: { status: 'failed', errorMessage: msg.slice(0, 500) },
    })
    return c.json({ error: msg }, 502)
  }
})
