import { perTenant } from './tenant-runner'
import { prisma } from '../lib/prisma'
import { loadConfig, computeStage } from './inactivity.service'

const CHECK_INTERVAL_MS = 60_000

let timer: NodeJS.Timeout | null = null

/**
 * Scans counsellors whose lastActivityAt is older than the warning threshold,
 * inserts an InactivityEvent row for any stage they've newly crossed since
 * their last raise, and auto-marks a half-day leave when the halfday threshold
 * is breached. Idempotent — a second pass during the same inactivity window
 * does not re-raise the same kind.
 */
export async function tickInactivityScheduler(): Promise<{ raised: number; halfdays: number }> {
  const cfg = await loadConfig()
  if (!cfg.enabled) return { raised: 0, halfdays: 0 }

  const now = new Date()
  const warningCutoff = new Date(now.getTime() - cfg.warningMinutes * 60_000)
  // Mirror the staleness window used by the read path so a crashed mobile app
  // doesn't keep someone immune from tracking forever.
  const onCallStaleCutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000)

  // Pull active counsellors who've been idle past the warning threshold and
  // have at least one prior activity stamp (no point alerting users who have
  // never logged in).
  const candidates = await prisma.user.findMany({
    where: {
      status: 1,
      lastActivityAt: { lt: warningCutoff, not: null },
      OR: [{ role: 'counsellor' }, { role: 'sales-head' }],
    },
    select: { id: true, lastActivityAt: true, onCallSince: true },
  })

  let raised = 0
  let halfdays = 0

  for (const u of candidates) {
    if (!u.lastActivityAt) continue

    // Phone-call suppression: skip while the call is fresh. A stale marker
    // (>4h) is treated as crashed/abandoned — clear it so future ticks behave
    // normally without forever-immunity.
    if (u.onCallSince) {
      if (u.onCallSince > onCallStaleCutoff) {
        continue
      }
      await prisma.user.update({
        where: { id: u.id },
        data: { onCallSince: null, onCallUpdatedAt: now },
      })
    }

    const inactiveSeconds = Math.floor((now.getTime() - u.lastActivityAt.getTime()) / 1000)
    const stage = computeStage(inactiveSeconds, cfg)
    if (stage === 'ok') continue

    // Has this user already had a row of this kind raised since they last
    // showed activity? If so, skip — we only want one event per kind per
    // inactivity window.
    const existing = await prisma.inactivityEvent.findFirst({
      where: {
        userId: u.id,
        kind: stage,
        raisedAt: { gte: u.lastActivityAt },
      },
      select: { id: true },
    })
    if (existing) continue

    await prisma.inactivityEvent.create({
      data: {
        userId: u.id,
        kind: stage,
        inactiveSeconds,
      },
    })
    raised++

    if (stage === 'halfday') {
      // Record the half-day in the existing leaves table. Auto-approved so it
      // shows up on attendance reports without admin intervention; the reason
      // line makes it obvious it was system-marked.
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const already = await prisma.employeeLeave.findFirst({
        where: {
          userId: u.id,
          fromDate: today,
          toDate: today,
          reason: { contains: 'Auto-marked' },
        },
        select: { id: true },
      })
      if (!already) {
        await prisma.employeeLeave.create({
          data: {
            userId: u.id,
            fromDate: today,
            toDate: today,
            reason: `Auto-marked: inactive for ${Math.floor(inactiveSeconds / 60)} min on web + app`,
            status: 'approved',
            approvalNote: 'System-marked via inactivity tracker',
          },
        })
        halfdays++
      }
    }
  }

  if (raised > 0 || halfdays > 0) {
    console.log(`[inactivity] raised ${raised} event(s), ${halfdays} half-day(s)`)
  }
  return { raised, halfdays }
}

export function startInactivityScheduler(intervalMs = CHECK_INTERVAL_MS) {
  if (timer) return
  // One pass per active customer, each inside its own schema.
  const sweep = perTenant('inactivity', async () => {
    await tickInactivityScheduler()
  })
  // First pass shortly after boot so the dev doesn't have to wait a full minute.
  setTimeout(() => {
    sweep().catch((err) => console.error('[inactivity] initial tick failed', err))
  }, 15_000)
  timer = setInterval(() => {
    sweep().catch((err) => console.error('[inactivity] tick failed', err))
  }, intervalMs)
  console.log('[inactivity] scheduler started (per customer)')
}
