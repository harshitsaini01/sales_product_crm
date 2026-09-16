import { perTenant } from './tenant-runner'
import { ImapFlow } from 'imapflow'
import type { CampaignGroup } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { hasFeature } from '../lib/tenant-context'
import { attachInbound, referencesOf } from './crm/projects.service'

// Polls each active CampaignGroup's IMAP every 60s. For every UID newer than
// `imapLastUid`, parses envelope + body, then:
//   1. If In-Reply-To / References matches an EmailCampaignRecipient.messageId,
//      flip that recipient to REPLIED and link the row.
//   2. Try to match the from-address to a Lead.email so the inbound mail
//      shows up on the lead detail.
// Stores the inbound mail in InboundMail (idempotent on (groupId, imapUid)).
//
// The poller is best-effort: per-group failures are logged and skipped, the
// loop continues for the rest of the groups.

const POLL_INTERVAL_MS = 60_000
let timer: NodeJS.Timeout | null = null
let running = false

function pickAddress(addr: { address?: string; name?: string } | undefined): { email: string; name: string | null } | null {
  if (!addr || !addr.address) return null
  return { email: String(addr.address).toLowerCase(), name: addr.name ?? null }
}

// A delivery-status notification (mailer-daemon bounce) still threads via
// In-Reply-To back to our original send, which used to mark the recipient as
// REPLIED — inflating reply counts with bounces. Detect the DSN using the
// combination of markers every mail server uses: sender local-part
// (mailer-daemon / postmaster), Return-Path <>, or subject prefixes. Any one
// match is enough; false positives here just downgrade a "reply" to "bounce",
// never fabricate one.
const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster|noreply|no-reply)@|^bounce/i
const BOUNCE_SUBJECT_RE = /(undelivered|undeliverable|delivery (status|failure|failed|notification)|failure notice|returned mail|mail delivery (failed|subsystem)|couldn't be delivered|permanent failure|delivery has failed)/i
function looksLikeBounce(fromEmail: string, subject: string, raw: string): boolean {
  if (BOUNCE_FROM_RE.test(fromEmail)) return true
  if (BOUNCE_SUBJECT_RE.test(subject)) return true
  // multipart/report; report-type=delivery-status is the RFC 3464 signal for
  // a DSN even when the sender masqueraded as a normal address.
  if (/content-type:\s*multipart\/report[^\n]*report-type\s*=\s*"?delivery-status/i.test(raw)) return true
  return false
}

// Decode a Content-Transfer-Encoding'd body chunk. Mail parts commonly arrive
// as base64 (any 8-bit content — non-Latin HTML, images-inline'd, most modern
// senders) or quoted-printable (mostly ASCII with the occasional non-ASCII
// escaped as =XX). Storing the encoded blob as-is is what made the inbox show
// "CjxodG1sPgo..." instead of a rendered mail.
function decodeQuotedPrintable(input: string, charset: string): string {
  // Soft line breaks: "=\r\n" or "=\n" at the end of a line join it back up.
  const stripped = input.replace(/=\r?\n/g, '')
  // Everything else "=XX" is a byte in hex. Collect bytes, then decode via
  // TextDecoder so multi-byte UTF-8 sequences (=E2=80=93 etc.) come out right.
  const bytes: number[] = []
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch === '=' && i + 2 < stripped.length) {
      const hex = stripped.substr(i + 1, 2)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16))
        i += 2
        continue
      }
    }
    bytes.push(ch.charCodeAt(0) & 0xff)
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
  }
}

// Buffer only knows a handful of encoding names. Everything else (iso-8859-*,
// windows-125*, etc.) goes through TextDecoder which supports the full set.
const BUFFER_ENCODINGS = new Set(['utf-8', 'utf8', 'ascii', 'latin1', 'binary', 'hex'])
function bytesToString(bytes: Buffer, charset: string): string {
  const cs = charset.toLowerCase()
  if (BUFFER_ENCODINGS.has(cs)) return bytes.toString(cs as BufferEncoding)
  try {
    return new TextDecoder(cs).decode(bytes)
  } catch {
    return bytes.toString('utf-8')
  }
}

function decodeBody(raw: string, transferEncoding: string, charset: string): string {
  const enc = transferEncoding.toLowerCase().trim()
  if (enc === 'base64') {
    try {
      return bytesToString(Buffer.from(raw.replace(/\s+/g, ''), 'base64'), charset || 'utf-8')
    } catch {
      return raw
    }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(raw, charset || 'utf-8')
  // 7bit / 8bit / binary / '' — bytes are already usable text.
  return raw
}

// Find the first MIME part whose Content-Type matches `mimeType`, then return
// its decoded body. Walks the raw source once per call — fine at inbox-poll
// volumes; if we ever need speed here, add `mailparser`. Returns null when the
// part isn't present.
function extractPart(raw: string, mimeType: 'text/html' | 'text/plain'): string | null {
  const headerRe = new RegExp(
    `(^|\\r?\\n)(Content-Type:\\s*${mimeType.replace('/', '\\/')}[\\s\\S]*?)(\\r?\\n\\r?\\n)`,
    'i',
  )
  const m = headerRe.exec(raw)
  if (!m) return null
  const headersBlock = m[2]
  const bodyStart = m.index + m[0].length
  // Body runs to the next boundary marker ("\n--…") or the next Content-Type
  // header, whichever comes first. Falls back to EOF.
  const rest = raw.slice(bodyStart)
  const endMatch = rest.match(/\r?\n--|\r?\nContent-Type:/i)
  const body = endMatch ? rest.slice(0, endMatch.index) : rest
  // Pull the encoding + charset off the part's header block.
  const cteMatch = /Content-Transfer-Encoding:\s*([^\r\n;]+)/i.exec(headersBlock)
  const csMatch = /charset\s*=\s*"?([^";\s]+)"?/i.exec(headersBlock)
  const transferEncoding = cteMatch?.[1]?.trim() ?? ''
  const charset = (csMatch?.[1] ?? 'utf-8').toLowerCase()
  const decoded = decodeBody(body, transferEncoding, charset)
  return decoded.trim() || null
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function pollGroup(group: CampaignGroup): Promise<{ added: number; errors: number }> {
  if (!group.imapHost || !group.imapPort || !group.imapUser || !group.imapPass) {
    return { added: 0, errors: 0 } // not configured for inbound
  }

  const client = new ImapFlow({
    host: group.imapHost,
    port: group.imapPort,
    secure: group.imapSecure,
    auth: { user: group.imapUser, pass: group.imapPass },
    logger: false,
  })

  let added = 0
  let errors = 0
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const sinceUid = (group.imapLastUid ?? 0) + 1
      // Find UIDs newer than the last poll. `search` returns [] when nothing
      // matches, which lets us skip the fetch entirely.
      const newUids = await client.search({ uid: `${sinceUid}:*` }, { uid: true })
      if (!newUids || newUids.length === 0) {
        return { added: 0, errors: 0 }
      }

      let maxUidSeen = group.imapLastUid ?? 0
      for await (const msg of client.fetch(
        newUids,
        { uid: true, envelope: true, internalDate: true, flags: true, source: true },
        { uid: true },
      )) {
        try {
          const uid = Number(msg.uid)
          if (uid > maxUidSeen) maxUidSeen = uid

          // Skip if we've already stored this UID for this group.
          const exists = await prisma.inboundMail.findUnique({
            where: { inbound_group_uid_uk: { groupId: group.id, imapUid: uid } },
          })
          if (exists) continue

          const env = msg.envelope
          const fromAddr = pickAddress(env?.from?.[0])
          if (!fromAddr) continue
          const subject = env?.subject ?? '(no subject)'
          const messageId = env?.messageId ?? null
          const inReplyTo = env?.inReplyTo ?? null
          const receivedAt = env?.date ?? msg.internalDate ?? new Date()

          // Body extraction from raw RFC822 source. Reads each MIME part with
          // its Content-Transfer-Encoding + charset and decodes accordingly.
          // Without decode step, base64/quoted-printable senders (very common
          // for HTML mail — MyUrbi, most CRM blasts) landed as raw base64 blobs
          // in the DB and rendered as gibberish in the inbox preview.
          const raw = msg.source ? msg.source.toString('utf-8') : ''
          const bodyHtml = extractPart(raw, 'text/html')
          const bodyText = extractPart(raw, 'text/plain') ?? (bodyHtml ? htmlToPlain(bodyHtml).slice(0, 5000) : null)

          // Reply linking via In-Reply-To → EmailCampaignRecipient.messageId.
          // Bounces (DSNs) also thread back to the original send via In-Reply-
          // To, so a naive "matched a recipient? mark REPLIED" used to count
          // every mailer-daemon return as a reply. Classify the inbound first
          // and route accordingly: real reply → REPLIED + repliedAt, bounce →
          // BOUNCED + errorMessage.
          const isBounce = looksLikeBounce(fromAddr.email, subject, raw)
          let recipientId: bigint | null = null
          if (inReplyTo) {
            const rec = await prisma.emailCampaignRecipient.findFirst({
              where: { messageId: inReplyTo },
              select: { id: true, leadId: true },
            })
            if (rec) {
              recipientId = rec.id
              if (isBounce) {
                // Preserve any existing repliedAt — if a genuine reply already
                // arrived earlier we don't overwrite it with the bounce.
                await prisma.emailCampaignRecipient.update({
                  where: { id: rec.id },
                  data: {
                    status: 'BOUNCED',
                    errorMessage: `Bounce: ${subject.slice(0, 200)}`,
                  },
                })
              } else {
                await prisma.emailCampaignRecipient.update({
                  where: { id: rec.id },
                  data: { status: 'REPLIED', repliedAt: new Date() },
                })
              }
            }
          }

          // Lead match by from-email
          let leadId: bigint | null = null
          const leadByEmail = await prisma.lead.findFirst({
            where: {
              OR: [
                { email: fromAddr.email },
                { email2: fromAddr.email },
                { email3: fromAddr.email },
              ],
              trash: 0,
            },
            select: { id: true },
          })
          if (leadByEmail) leadId = leadByEmail.id

          const stored = await prisma.inboundMail.create({
            data: {
              groupId: group.id,
              imapUid: uid,
              messageId,
              inReplyTo,
              fromEmail: fromAddr.email,
              fromName: fromAddr.name,
              toEmail: pickAddress(env?.to?.[0])?.email ?? group.imapUser ?? '',
              subject,
              bodyHtml,
              bodyText: bodyText?.slice(0, 100_000) ?? null,
              receivedAt: new Date(receivedAt),
              leadId,
              recipientId,
            },
          })
          added++

          // A reply to a proposal goes onto the project's own thread, with
          // its attachments. Only for customers with the module — nobody else
          // has the tables. Its failure must not lose the mail, which is
          // already stored above.
          if (!isBounce && hasFeature('projects')) {
            try {
              const hit = await attachInbound(stored, { references: referencesOf(raw), raw })
              if (hit) console.log(`[inbox-poller] mail ${Number(stored.id)} attached to project ${Number(hit)}`)
            } catch (e) {
              console.error('[inbox-poller] project attach failed for mail', Number(stored.id), e)
            }
          }
        } catch (e) {
          console.error('[inbox-poller] failed to process message in group', Number(group.id), e)
          errors++
        }
      }

      if (maxUidSeen > (group.imapLastUid ?? 0)) {
        await prisma.campaignGroup.update({
          where: { id: group.id },
          data: { imapLastUid: maxUidSeen },
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }

  return { added, errors }
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const groups = await prisma.campaignGroup.findMany({
      where: { isActive: true, imapHost: { not: null } },
    })
    for (const g of groups) {
      try {
        const { added } = await pollGroup(g)
        if (added > 0) {
          console.log(`[inbox-poller] group ${Number(g.id)} (${g.fromEmail}) +${added} mails`)
        }
      } catch (e) {
        console.error(`[inbox-poller] group ${Number(g.id)} polling failed`, e)
      }
    }
  } catch (e) {
    console.error('[inbox-poller] tick failed', e)
  } finally {
    running = false
  }
}

export function startInboxPoller(): void {
  if (timer) return
  // One pass per active customer, each inside its own schema.
  const sweep = perTenant('inbox-poller', tick)
  setTimeout(() => void sweep(), 10_000)
  timer = setInterval(() => void sweep(), POLL_INTERVAL_MS)
  console.log('[inbox-poller] started (poll every 60s, per customer)')
}
