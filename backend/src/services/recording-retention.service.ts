import { perTenant } from './tenant-runner'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'

/**
 * Delete recording files whose recordingExpiresAt is in the past, then null out
 * the path/size on the row. Calls themselves are kept for analytics.
 *
 * Designed to be invoked from a daily setInterval at boot. Idempotent — safe to
 * run repeatedly; missing files are silently skipped.
 */
export async function purgeExpiredRecordings(): Promise<{ purged: number; errors: number }> {
  const now = new Date()
  let purged = 0
  let errors = 0

  const expired = await prisma.mobileCall.findMany({
    where: {
      recordingPath: { not: null },
      recordingExpiresAt: { lt: now },
    },
    select: { id: true, recordingPath: true },
    take: 1000,
  })

  for (const row of expired) {
    if (!row.recordingPath) continue
    const abs = path.resolve(process.cwd(), row.recordingPath)
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs)
      await prisma.mobileCall.update({
        where: { id: row.id },
        data: { recordingPath: null, recordingSize: null },
      })
      purged++
    } catch (err) {
      console.error('[retention] failed to purge', abs, err)
      errors++
    }
  }

  if (purged > 0 || errors > 0) {
    console.log(`[retention] purged ${purged} recordings (${errors} errors)`)
  }
  return { purged, errors }
}

/**
 * Delete TRIGGERED placeholder rows older than `olderThanMs` (default 1h).
 * These are CRM "Push to phone" intents that never resolved into a real call
 * (counsellor declined, phone offline, FCM never delivered, etc.). The /sync
 * handler will have merged any TRIGGERED row that *did* result in a call into
 * a non-TRIGGERED status, so anything still TRIGGERED past the cutoff is a
 * confirmed orphan.
 */
export async function purgeOrphanTriggeredCalls(
  olderThanMs = 60 * 60 * 1000,
): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const result = await prisma.mobileCall.deleteMany({
    where: { status: 'TRIGGERED', createdAt: { lt: cutoff } },
  })
  if (result.count > 0) {
    console.log(`[retention] purged ${result.count} orphan TRIGGERED call rows`)
  }
  return { purged: result.count }
}

let timer: NodeJS.Timeout | null = null

export function startRetentionCron(intervalMs = 24 * 60 * 60 * 1000) {
  if (timer) return

  // One pass per active customer, each inside its own schema — retention is a
  // per-customer policy, and the recordings live in their own tables.
  const sweep = perTenant('retention', async () => {
    await purgeExpiredRecordings()
    await purgeOrphanTriggeredCalls()
  })

  // Run once shortly after boot, then daily.
  setTimeout(() => {
    sweep().catch((err) => console.error('[retention] initial sweep failed', err))
  }, 60_000)
  timer = setInterval(() => {
    sweep().catch((err) => console.error('[retention] sweep failed', err))
  }, intervalMs)
  console.log('[retention] recording purge + orphan-trigger cron started (per customer)')
}
