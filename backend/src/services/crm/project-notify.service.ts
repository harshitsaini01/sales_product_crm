// ─────────────────────────────────────────────────────────────────────────────
// Telling people a project needs them.
//
// The bell already knows (ballWithUserId). But a team member who is not
// staring at the CRM finds out about a brief handed to them when they open it
// tomorrow, which is a day lost. So: an email, and a push to any phone they
// have the app on. Both best-effort — a notification that fails must never
// fail the assignment it describes.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import { currentTenant } from '../../lib/tenant-context'
import { emailService } from '../email.service'
import { sendDataMessage } from '../fcm.service'

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function projectUrl(projectId: bigint | number): string | null {
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  return base ? `${base}/app/projects/${projectId}` : null
}

export type NotifyReason = 'assigned' | 'reply' | 'client_reply' | 'proposal_ready'

const SUBJECT: Record<NotifyReason, (n: string, t: string) => string> = {
  assigned: (n, t) => `[${n}] Assigned to you: ${t}`,
  reply: (n, t) => `[${n}] New message on: ${t}`,
  client_reply: (n, t) => `[${n}] The client replied: ${t}`,
  proposal_ready: (n, t) => `[${n}] Proposal ready to send: ${t}`,
}

const LEAD_LINE: Record<NotifyReason, string> = {
  assigned: 'has been handed to you.',
  reply: 'has a new message waiting for you.',
  client_reply: 'has a reply from the client.',
  proposal_ready: 'has a proposal marked ready — it is yours to send.',
}

/**
 * Notify one person about one project. Email if they have an address, push
 * to every device they have registered. Never throws.
 */
export async function notifyUser(
  userId: bigint | number | null | undefined,
  reason: NotifyReason,
  project: { id: bigint; projectNumber: string | null; title: string; clientName?: string | null },
  detail: { by?: string | null; excerpt?: string | null } = {},
): Promise<void> {
  if (!userId) return
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { id: true, name: true, email: true, status: true, deviceTokens: { select: { fcmToken: true } } },
    })
    if (!user || user.status !== 1) return

    const number = project.projectNumber ?? `#${project.id}`
    const url = projectUrl(project.id)
    const company = currentTenant()?.companyName ?? 'CRM'
    const excerpt = detail.excerpt?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)

    if (user.email && /\S+@\S+/.test(user.email)) {
      const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:600px">
        <p>Hi ${esc(user.name.split(' ')[0])},</p>
        <p><strong>${esc(number)} — ${esc(project.title)}</strong>${project.clientName ? ` for ${esc(project.clientName)}` : ''} ${LEAD_LINE[reason]}${detail.by ? ` (from ${esc(detail.by)})` : ''}</p>
        ${excerpt ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #c7d2fe;background:#f8fafc;color:#334155;white-space:pre-wrap">${esc(excerpt)}</blockquote>` : ''}
        ${url ? `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open the project</a></p>` : ''}
        <p style="color:#94a3b8;font-size:12px;margin-top:24px">${esc(company)} · this is an internal notification, do not reply to the client from here.</p>
      </div>`
      await emailService.send({ to: user.email, subject: SUBJECT[reason](number, project.title), html }).catch((err) => {
        console.error('[projects] notify email failed for user', Number(user.id), err instanceof Error ? err.message : err)
      })
    }

    if (user.deviceTokens.length) {
      const data = {
        type: 'project',
        reason,
        projectId: String(project.id),
        projectNumber: number,
        title: SUBJECT[reason](number, project.title),
        body: (excerpt || LEAD_LINE[reason]).slice(0, 200),
      }
      await Promise.all(user.deviceTokens.map((t) => sendDataMessage(t.fcmToken, data)))
    }
  } catch (err) {
    console.error('[projects] notify failed', err)
  }
}
