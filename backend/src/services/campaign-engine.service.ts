import { prisma } from '../lib/prisma'
import { perTenant } from './tenant-runner'
import { sendViaGroup } from './campaign-mailer.service'
import { LETTERHEAD_HTML } from '../routes/communication.routes'
import type { CampaignGroup } from '@prisma/client'

// Scheduler tick — every 30s.
//  - Promotes SCHEDULED campaigns whose startAt has passed → RUNNING.
//  - Picks chunks whose scheduledAt <= now and dispatches their recipients
//    serially with perEmailDelayMs jittered ±25%. Each send stamps the
//    recipient's Message-ID for later reply threading via IMAP.
//  - When all chunks of a campaign are finished, flips it to COMPLETED.
//
// Concurrency: a single in-process flag prevents overlapping ticks. The tick
// can run for many minutes when a chunk is large × delay — that's fine, the
// next interval just no-ops until this one returns. Within a tick, due chunks
// are grouped by mailbox: each mailbox drains its own chunks in order, and all
// mailboxes run concurrently, so a multi-account campaign really does send in
// parallel the way the schedule preview says it will.

const TICK_MS = 30_000
let timer: NodeJS.Timeout | null = null
let running = false

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function jittered(baseMs: number, pct = 0.25): number {
  const delta = baseMs * pct
  return Math.max(0, Math.round(baseMs + (Math.random() * 2 - 1) * delta))
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? '')
}

async function dispatchChunk(chunkId: bigint): Promise<void> {
  const chunk = await prisma.emailCampaignChunk.findUnique({
    where: { id: chunkId },
    include: {
      campaign: true,
      group: true,
      recipients: { where: { status: 'QUEUED' } },
    },
  })
  if (!chunk) return
  if (chunk.startedAt) return // already started by a previous tick

  await prisma.emailCampaignChunk.update({
    where: { id: chunk.id },
    data: { startedAt: new Date() },
  })

  const group: CampaignGroup = chunk.group
  const campaign = chunk.campaign
  let signatureHtml = ''
  if (campaign.signatureId) {
    const sig = await prisma.signature.findUnique({ where: { id: campaign.signatureId } })
    signatureHtml = sig?.content ?? ''
  }
  // Counsellor context = whoever created the campaign. Looked up once per chunk
  // dispatch so {{counsellorName}} / {{counsellorEmail}} resolve consistently
  // across the whole batch even when several counsellors' campaigns are running
  // concurrently. If the creator has been deleted we fall back to empty strings
  // — better than leaking the literal token into the recipient's inbox.
  const creator = await prisma.user.findUnique({
    where: { id: campaign.userId },
    select: { name: true, email: true },
  })
  const counsellorName = (creator?.name || '').trim()
  const counsellorFirst = counsellorName ? counsellorName.split(/\s+/)[0] : ''
  const counsellorEmail = creator?.email || ''

  let sent = 0
  let failed = 0
  let attempted = 0
  let abortedForPauseOrCancel = false

  for (let i = 0; i < chunk.recipients.length; i++) {
    const r = chunk.recipients[i]

    // Check between recipients whether the campaign has been paused or
    // cancelled since the chunk started. Without this, hitting Pause while a
    // 70-recipient chunk was mid-flight kept sending every remaining mail —
    // the tick's `status: RUNNING` filter only gates picking up NEW chunks.
    // Refetch just the status column so this stays cheap.
    if (i > 0 && i % 5 === 0) {
      const state = await prisma.emailCampaign.findUnique({
        where: { id: campaign.id },
        select: { status: true },
      })
      if (state && (state.status === 'PAUSED' || state.status === 'CANCELLED')) {
        abortedForPauseOrCancel = true
        break
      }
    }

    attempted++
    const nameValue = (r.toName ?? r.toEmail.split('@')[0] ?? '').trim() || 'there'
    const vars = {
      name: nameValue,
      firstName: nameValue.split(/\s+/)[0],
      email: r.toEmail,
      counsellorName,
      counsellorFirstName: counsellorFirst,
      counsellorEmail,
    }
    const bodyMerged = renderTemplate(campaign.bodyHtml, vars)
    const subjectMerged = renderTemplate(campaign.subject, vars)
    // Open-tracking pixel. Recipient-scoped so the same campaign can be re-run
    // without collisions, and stamped only once — first fetch wins. Hidden
    // sizing keeps it invisible in every mainstream client while still loading.
    // The base URL falls back to the request-derived host on the scheduler side
    // via APP_URL; leaving it unset means the pixel silently 404s in dev, which
    // is fine — we just won't see opens locally.
    const baseUrl = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
    const pixel = baseUrl
      ? `<img src="${baseUrl}/api/tracking/campaign-open/${r.id}.gif" width="1" height="1" alt="" style="display:none;border:0;height:1px;width:1px;" />`
      : ''
    const html = LETTERHEAD_HTML + bodyMerged + (signatureHtml ? `<br/><br/>${signatureHtml}` : '') + pixel

    try {
      const { messageId } = await sendViaGroup(group, {
        to: r.toEmail,
        toName: r.toName,
        subject: subjectMerged,
        html,
        unsubscribeUrl: `mailto:${group.fromEmail}?subject=Unsubscribe`,
      })
      await prisma.emailCampaignRecipient.update({
        where: { id: r.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: messageId || null,
          groupId: group.id,
        },
      })
      sent++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const bounced = /5\d\d|bounce|reject|unknown user|no such user/i.test(msg)
      await prisma.emailCampaignRecipient.update({
        where: { id: r.id },
        data: {
          status: bounced ? 'BOUNCED' : 'FAILED',
          errorMessage: msg.slice(0, 500),
          groupId: group.id,
        },
      })
      failed++
    }

    // Per-email delay (jittered) — except after the last one.
    if (i < chunk.recipients.length - 1) {
      await sleep(jittered(campaign.perEmailDelayMs))
    }
  }

  if (abortedForPauseOrCancel) {
    // Leave finishedAt null and clear startedAt so a Resume re-picks this
    // chunk on the next tick. The QUEUED recipients we didn't touch stay
    // QUEUED, so the resumed run only fires the remainder — no duplicates.
    await prisma.emailCampaignChunk.update({
      where: { id: chunk.id },
      data: { startedAt: null, attempted, sent, failed },
    })
  } else {
    await prisma.emailCampaignChunk.update({
      where: { id: chunk.id },
      data: {
        finishedAt: new Date(),
        attempted,
        sent,
        failed,
      },
    })
  }
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = new Date()

    // 1. Promote SCHEDULED → RUNNING when their startAt has passed.
    await prisma.emailCampaign.updateMany({
      where: { status: 'SCHEDULED', startAt: { lte: now } },
      data: { status: 'RUNNING' },
    })

    // 2. Find due chunks across all RUNNING campaigns. Limit to a reasonable
    // number per tick so a flood of campaigns doesn't starve the loop.
    const dueChunks = await prisma.emailCampaignChunk.findMany({
      where: {
        startedAt: null,
        scheduledAt: { lte: now },
        campaign: { status: 'RUNNING' },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
      select: { id: true, groupId: true },
    })

    // Dispatch one mailbox's chunks strictly in order, but run every mailbox
    // in PARALLEL. Two chunks on the same account must never overlap (that
    // would double the effective send rate on one address and is exactly what
    // gets a mailbox blocked), while different accounts have no reason to wait
    // on each other. The old code awaited every chunk in one serial loop, so
    // three accounts scheduled for the same hour actually sent one after
    // another — hour 1 took three hours and the plan the admin previewed never
    // matched what went out.
    const byGroup = new Map<string, bigint[]>()
    for (const c of dueChunks) {
      const key = String(c.groupId)
      const list = byGroup.get(key)
      if (list) list.push(c.id)
      else byGroup.set(key, [c.id])
    }
    await Promise.all(
      [...byGroup.values()].map(async (chunkIds) => {
        for (const id of chunkIds) {
          try {
            await dispatchChunk(id)
          } catch (e) {
            // Per-chunk failures shouldn't kill the loop. Log and continue.
            console.error('[campaign-engine] chunk dispatch failed', id, e)
          }
        }
      }),
    )

    // 3. Flip campaigns whose every chunk has finished → COMPLETED.
    const runningCampaigns = await prisma.emailCampaign.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, _count: { select: { chunks: true } } },
    })
    for (const c of runningCampaigns) {
      const pending = await prisma.emailCampaignChunk.count({
        where: { campaignId: c.id, finishedAt: null },
      })
      if (pending === 0 && c._count.chunks > 0) {
        await prisma.emailCampaign.update({
          where: { id: c.id },
          data: { status: 'COMPLETED', finishedAt: new Date() },
        })
      }
    }
  } catch (e) {
    console.error('[campaign-engine] tick error', e)
  } finally {
    running = false
  }
}

export function startCampaignEngine(): void {
  if (timer) return
  // One pass per active customer, each inside its own schema — see
  // services/tenant-runner.ts.
  const sweep = perTenant('campaign-engine', tick)
  // Small initial delay so DB connection is ready, then steady ticks.
  setTimeout(() => void sweep(), 5_000)
  timer = setInterval(() => void sweep(), TICK_MS)
  console.log('[campaign-engine] started (tick every 30s, per customer)')
}
