import nodemailer, { type Transporter } from 'nodemailer'
import type { CampaignGroup } from '@prisma/client'

// Cache one transporter per group so we don't reconnect on every send. Keyed by
// the SMTP tuple — if any of those fields change in CRUD, the next call gets a
// fresh transport (cache miss because the key changes).
const transports = new Map<string, Transporter>()

function transportKey(g: CampaignGroup): string {
  return `${g.id}:${g.smtpHost}:${g.smtpPort}:${g.smtpUser}:${g.smtpSecure}`
}

function transportFor(group: CampaignGroup): Transporter {
  const key = transportKey(group)
  let t = transports.get(key)
  if (!t) {
    t = nodemailer.createTransport({
      host: group.smtpHost,
      port: group.smtpPort,
      secure: group.smtpSecure,
      auth: { user: group.smtpUser, pass: group.smtpPass },
      tls: { rejectUnauthorized: false },
    })
    transports.set(key, t)
  }
  return t
}

export async function verifyGroup(group: CampaignGroup): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = transportFor(group)
    await t.verify()
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export interface SendOpts {
  to: string
  toName?: string | null
  subject: string
  html: string
  // Helpful threading + unsubscribe headers — set on every campaign mail.
  unsubscribeUrl?: string
  inReplyTo?: string
  references?: string[]
  cc?: string[]
  replyTo?: string
  /** `path` reads from disk; `content` is an in-memory buffer. */
  attachments?: Array<{ filename: string; path?: string; content?: Buffer | string; contentType?: string }>
}

export async function sendViaGroup(group: CampaignGroup, opts: SendOpts): Promise<{ messageId: string }> {
  const t = transportFor(group)
  const headers: Record<string, string> = {}
  if (opts.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  const info = await t.sendMail({
    from: `"${group.fromName}" <${group.fromEmail}>`,
    to: opts.toName ? `"${opts.toName.replace(/"/g, '')}" <${opts.to}>` : opts.to,
    cc: opts.cc?.length ? opts.cc.join(', ') : undefined,
    replyTo: opts.replyTo || group.fromEmail,
    subject: opts.subject,
    html: opts.html,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
    attachments: opts.attachments,
    headers,
  })
  return { messageId: String(info.messageId || '') }
}

// Invalidate transporter cache when a group is edited/deleted.
export function evictTransport(groupId: bigint | number): void {
  for (const [k] of transports) {
    if (k.startsWith(`${groupId}:`)) transports.delete(k)
  }
}
