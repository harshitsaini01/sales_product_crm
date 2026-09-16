// One-off backfill: recompute Lead.leadScore from historical activity rows.
//
// The scoring hooks (see calls.routes.ts, notes.routes.ts,
// lead-followup.service.ts, status-history.service.ts) started incrementing
// leadScore only from a certain deploy forward. Every lead that had activity
// BEFORE that deploy has a stale score. This script recomputes each lead's
// score from scratch using the same weights the live hooks use, then writes
// the total back to leads.lead_score.
//
// Weights (must stay in sync with the live hooks):
//   +1  per LeadNote                                        (notes.routes.ts:41)
//   +1  per CallLog with outcome='answered'                 (leads.routes.ts:2633)
//   +1  per MobileCall with status='ANSWERED' + leadId set  (calls.routes.ts:378)
//   +2  per LeadFollowup with a non-empty comment           (lead-followup.service.ts:207)
//   +3  per LeadStatusHistory where fromStatus <> toStatus  (status-history.service.ts:39)
//
// Usage:
//   npx tsx scripts/backfill-lead-scores.ts           # dry-run: print deltas
//   npx tsx scripts/backfill-lead-scores.ts --apply   # actually write
import { prisma } from '../src/lib/prisma'

const APPLY = process.argv.includes('--apply')

type Counts = { notes: number; callLogAns: number; mobileAns: number; followups: number; statusChanges: number }

async function main() {
  console.log(`\n=== Lead score backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`)

  const per: Map<string, Counts> = new Map()
  const bump = (leadId: bigint, key: keyof Counts, n = 1) => {
    const k = leadId.toString()
    const c = per.get(k) ?? { notes: 0, callLogAns: 0, mobileAns: 0, followups: 0, statusChanges: 0 }
    c[key] += n
    per.set(k, c)
  }

  // +1 per note
  const notes = await prisma.leadNote.groupBy({ by: ['leadId'], _count: { _all: true } })
  for (const r of notes) bump(r.leadId, 'notes', r._count._all)

  // +1 per answered CallLog
  const callLogs = await prisma.callLog.groupBy({
    by: ['leadId'],
    where: { outcome: 'answered' },
    _count: { _all: true },
  })
  for (const r of callLogs) bump(r.leadId, 'callLogAns', r._count._all)

  // +1 per answered MobileCall (only rows linked to a lead)
  const mobileCalls = await prisma.mobileCall.groupBy({
    by: ['leadId'],
    where: { status: 'ANSWERED', leadId: { not: null } },
    _count: { _all: true },
  })
  for (const r of mobileCalls) if (r.leadId) bump(r.leadId, 'mobileAns', r._count._all)

  // +2 per followup with a non-empty comment
  const followups = await prisma.$queryRaw<Array<{ std_id: bigint; c: bigint }>>`
    SELECT std_id, COUNT(*)::bigint AS c
    FROM lead_followups
    WHERE comment IS NOT NULL AND btrim(comment) <> ''
    GROUP BY std_id
  `
  for (const r of followups) bump(r.std_id, 'followups', Number(r.c))

  // +3 per status-history row where the main status actually changed.
  // Treat NULL from_status as a change (same rule as recordStatusChange).
  const statusChanges = await prisma.$queryRaw<Array<{ lead_id: bigint; c: bigint }>>`
    SELECT lead_id, COUNT(*)::bigint AS c
    FROM lead_status_history
    WHERE COALESCE(from_status, '') <> COALESCE(to_status, '')
    GROUP BY lead_id
  `
  for (const r of statusChanges) bump(r.lead_id, 'statusChanges', Number(r.c))

  console.log(`Leads with any scored activity: ${per.size}`)

  // Pull current scores for the affected leads
  const affectedIds = [...per.keys()].map((s) => BigInt(s))
  const current = await prisma.lead.findMany({
    where: { id: { in: affectedIds } },
    select: { id: true, leadScore: true },
  })
  const currentMap = new Map(current.map((l) => [l.id.toString(), l.leadScore ?? 0]))

  let unchanged = 0
  let increases = 0
  let decreases = 0
  let totalDelta = 0
  const preview: Array<{ id: string; from: number; to: number }> = []

  for (const [k, c] of per) {
    const computed = c.notes + c.callLogAns + c.mobileAns + 2 * c.followups + 3 * c.statusChanges
    const before = currentMap.get(k) ?? 0
    const delta = computed - before
    if (delta === 0) { unchanged++; continue }
    if (delta > 0) increases++; else decreases++
    totalDelta += delta
    if (preview.length < 10) preview.push({ id: k, from: before, to: computed })
  }

  console.log(`  unchanged: ${unchanged}`)
  console.log(`  increases: ${increases}`)
  console.log(`  decreases: ${decreases}   (leads whose current score is HIGHER than the recomputed value — usually means the row was scored under an older rule set)`)
  console.log(`  net delta: ${totalDelta >= 0 ? '+' : ''}${totalDelta}\n`)

  if (preview.length) {
    console.log('Sample changes (first 10):')
    for (const p of preview) console.log(`  lead ${p.id}: ${p.from} → ${p.to}`)
    console.log()
  }

  if (!APPLY) {
    console.log('Dry-run complete. Re-run with --apply to write.')
    return
  }

  console.log('Applying updates...')
  let written = 0
  for (const [k, c] of per) {
    const computed = c.notes + c.callLogAns + c.mobileAns + 2 * c.followups + 3 * c.statusChanges
    const before = currentMap.get(k) ?? 0
    if (computed === before) continue
    await prisma.lead.update({ where: { id: BigInt(k) }, data: { leadScore: computed } })
    written++
    if (written % 500 === 0) console.log(`  ...${written} updated`)
  }
  console.log(`Done. ${written} leads updated.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
