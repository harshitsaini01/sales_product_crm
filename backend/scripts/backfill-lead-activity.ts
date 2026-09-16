// ─────────────────────────────────────────────────────────────────────────────
// Project existing lead comments and notes onto the timeline.
//
//   npm run backfill:activity -- --tenant=britannica_bots
//   npm run backfill:activity -- --tenant=britannica_bots --limit=20000
//
// `lead_comments` and `lead_notes` both predate the timeline and never wrote to
// it, so a converted lead's account showed "Created from lead #2" and nothing
// else while months of conversation sat two screens away. New comments write to
// the timeline as they are made; this catches up everything already there.
//
// It also clears the `acct:` and `copy:` rows left by the write-time mirror
// this replaced. An account now reads its lead's rows directly, so those copies
// would render every comment twice.
//
// SAFE TO RE-RUN. Every projected row carries a unique (sourceType, sourceId),
// so a second pass updates rather than duplicates.
//
// Refuses the primary tenant by default: Tutelage has 63,000 leads and years of
// comments, and projecting all of it is a big write they have not asked for.
// Pass --allow-primary if that is genuinely what you want.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
import { getTenantBySlug } from '../src/services/tenant.service'
import { runWithTenant } from '../src/lib/tenant-context'
import { backfillLeadEntries } from '../src/services/crm/lead-activity.service'
import { pruneOrphans } from '../src/services/crm/activity.service'

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]

async function main() {
  const slug = arg('tenant')
  const limit = Number(arg('limit') || 5000)

  if (!slug) {
    console.error('Usage: npm run backfill:activity -- --tenant=<slug> [--limit=N]')
    process.exit(1)
  }

  const ctx = await getTenantBySlug(slug)
  if (!ctx) {
    console.error(`No customer with the slug "${slug}".`)
    process.exit(1)
  }

  if (ctx.isPrimary && !process.argv.includes('--allow-primary')) {
    console.error(
      `"${slug}" is the primary installation, with far more history than this is meant for.\n` +
        'Re-run with --allow-primary only if you really intend to project all of it.',
    )
    process.exit(1)
  }

  console.log(`\nProjecting comments and notes for ${ctx.companyName} (limit ${limit} each)\n`)

  const result = await runWithTenant(ctx, () => backfillLeadEntries({ limit }))
  const pruned = await runWithTenant(ctx, () => pruneOrphans())
  const prunedTotal = Object.values(pruned).reduce((a, b) => a + b, 0)

  console.log(`  comments found    : ${result.comments}`)
  console.log(`  notes found       : ${result.notes}`)
  console.log(`  onto the timeline : ${result.projected}`)
  console.log(`  stale copies gone : ${result.removed}`)
  console.log(`  orphan rows gone  : ${prunedTotal}${prunedTotal ? ' ' + JSON.stringify(pruned) : ''}`)
  console.log('')
  console.log('Done. Safe to run again; it updates rather than duplicates.')
  console.log('An account reads its lead rows directly, so nothing is copied.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => process.exit(0))
