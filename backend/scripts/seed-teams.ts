/**
 * Seed the starting departments (IT / Software, Digital Marketing, Design…)
 * into ONE customer's schema, from their vertical's preset.
 *
 *   npm run seed:teams -- --tenant=britannica_bots
 *
 * For a customer who existed before the Projects module: provisioning seeds
 * these for new customers, but nobody re-runs provisioning on a live schema.
 * Additive and idempotent — a team that already exists (by slug) is left
 * alone, and members are never touched, so it is safe to run twice.
 *
 * Refuses the primary customer: the education install has no projects module.
 */
import 'dotenv/config'
import { getTenantBySlug } from '../src/services/tenant.service'
import { runWithTenant } from '../src/lib/tenant-context'
import { prisma } from '../src/lib/prisma'
import { getVertical, isVerticalKey } from '../src/config/verticals'

const slugify = (v: string) =>
  v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)

async function main() {
  const slug = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1]
  if (!slug) {
    console.error('Usage: npm run seed:teams -- --tenant=<slug>')
    process.exit(1)
  }

  const ctx = await getTenantBySlug(slug)
  if (!ctx) {
    console.error(`No customer with the slug "${slug}".`)
    process.exit(1)
  }
  if (ctx.isPrimary) {
    console.error('Refusing: the primary customer does not run the Projects module.')
    process.exit(1)
  }

  const vertical = isVerticalKey(ctx.vertical) ? ctx.vertical : undefined
  const teams = getVertical(vertical).seed.teams ?? []
  if (!teams.length) {
    console.log(`The "${ctx.vertical}" vertical seeds no teams. Add them under Administration → Teams.`)
    return
  }

  await runWithTenant(ctx, async () => {
    let created = 0
    for (const t of teams) {
      const s = slugify(t.name)
      const existing = await prisma.crmTeam.findFirst({ where: { slug: s }, select: { id: true } })
      if (existing) {
        console.log(`  exists   ${t.name}`)
        continue
      }
      await prisma.crmTeam.create({ data: { name: t.name, slug: s, priority: t.priority, color: t.color ?? null } })
      console.log(`  created  ${t.name}`)
      created++
    }
    console.log(`\n${created} team(s) created in ${ctx.schemaName}. Members are added under Administration → Teams.`)
  })
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => process.exit(0))
