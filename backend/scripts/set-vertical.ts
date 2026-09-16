// ─────────────────────────────────────────────────────────────────────────────
// Switch a customer to a vertical from the command line.
//
//   npm run tenant:vertical -- --tenant=<slug> --vertical=b2b_sales --confirm
//   npm run tenant:vertical -- --tenant=<slug>            (show current)
//
// Add --seed-config to also install the new vertical's baseline configuration
// (its pipeline, lost reasons, account types and industries). A customer
// provisioned under the old vertical has none of them, and a B2B panel with no
// deal stages has no board to draw.
//
// The CLI equivalent of Super Admin → Customer → Vertical & Wording. It exists
// because a customer provisioned before verticals shipped has vertical
// 'education' and none of the B2B modules on, and you need to be able to fix
// that before the super admin panel is deployed anywhere.
//
// Reuses the SAME preset and sanitisers as the HTTP endpoint, so the two cannot
// drift apart.
//
// DESTRUCTIVE, like the endpoint: applying a preset overwrites features, lead
// fields and terminology, discarding manual tweaks. It prints what it is about
// to change and requires --confirm.
//
// It does NOT touch the seeded pipeline. Lead statuses already carry live leads
// and rewriting them would strand every lead on a stage that no longer exists.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
import { platformPrisma } from '../src/lib/platform'
import { defaultFeatureMap, sanitizeFeatureMap, resolveFeatures } from '../src/config/features'
import { sanitizeLeadFieldConfig } from '../src/config/lead-fields'
import { sanitizeLabelMap } from '../src/config/terminology'
import { getVertical, isVerticalKey, VERTICALS } from '../src/config/verticals'
import { getTenantClient } from '../src/lib/prisma'
import { runWithTenant } from '../src/lib/tenant-context'
import { getTenantBySlug } from '../src/services/tenant.service'
import { seedTenantSchema } from '../src/services/tenant-seed.service'

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

async function main() {
  const slug = arg('tenant')
  const wanted = arg('vertical')
  const confirm = process.argv.includes('--confirm')

  if (!slug) {
    console.error('Usage: npm run tenant:vertical -- --tenant=<slug> [--vertical=<key>] [--confirm]')
    console.error(`Verticals: ${VERTICALS.map((v) => v.key).join(', ')}`)
    process.exit(1)
  }

  const tenant = await platformPrisma.tenant.findUnique({ where: { slug } })
  if (!tenant) {
    console.error(`No customer with the slug "${slug}".`)
    process.exit(1)
  }

  const current = resolveFeatures(tenant.features)
  const on = Object.entries(current).filter(([, v]) => v).map(([k]) => k)

  console.log(`\n${tenant.companyName} (${tenant.schemaName})`)
  console.log(`  vertical: ${tenant.vertical}`)
  console.log(`  modules on: ${on.join(', ') || '(none)'}\n`)

  if (!wanted) return

  if (!isVerticalKey(wanted)) {
    console.error(`Unknown vertical "${wanted}". Known: ${VERTICALS.map((v) => v.key).join(', ')}`)
    process.exit(1)
  }

  const preset = getVertical(wanted)
  const nextFeatures = { ...defaultFeatureMap(), ...sanitizeFeatureMap(preset.features) }
  const nextLeadFields = sanitizeLeadFieldConfig(preset.leadFields)

  const turningOn = Object.keys(nextFeatures).filter((k) => nextFeatures[k] && !current[k])
  const turningOff = Object.keys(nextFeatures).filter((k) => !nextFeatures[k] && current[k])

  console.log(`Applying the "${preset.label}" preset would:`)
  console.log(`  turn ON : ${turningOn.join(', ') || '(nothing)'}`)
  console.log(`  turn OFF: ${turningOff.join(', ') || '(nothing)'}`)
  console.log(`  hide ${nextLeadFields.hiddenGroups.length} lead-field groups and ` +
    `${nextLeadFields.hiddenFields.length} individual fields`)
  console.log(`  rename ${Object.keys(preset.labels).length} terms\n`)

  if (!confirm) {
    console.log('Nothing changed. Re-run with --confirm to apply.')
    return
  }

  await platformPrisma.tenant.update({
    where: { id: tenant.id },
    data: {
      vertical: preset.key,
      features: nextFeatures,
      leadFields: { ...nextLeadFields },
      // The customer keeps their own name as the brand across a switch — the
      // preset has no idea what the company is called.
      labels: { ...sanitizeLabelMap({ ...preset.labels, brand: { singular: tenant.companyName } }) },
    },
  })

  console.log(`Applied. ${tenant.companyName} is now "${preset.label}".`)

  // A customer switched from another vertical has none of this vertical's
  // config rows. Seeding is additive and idempotent: it never removes what is
  // already there, so the statuses their existing leads sit on survive.
  if (process.argv.includes('--seed-config')) {
    const ctx = await getTenantBySlug(slug)
    if (!ctx) throw new Error('tenant vanished between update and seed')

    // Re-read so the freshly written vertical is what the seeder uses.
    const fresh = { ...ctx, vertical: preset.key }
    const db = getTenantClient(tenant.schemaName)

    const result = await runWithTenant(fresh, () =>
      seedTenantSchema(db, { companyName: tenant.companyName, vertical: preset.key }),
    )

    console.log(
      `\nSeeded ${preset.label} config: ` +
        `${result.departments} departments, ${result.statuses} statuses, ` +
        `${result.leadTypes} lead types, ${result.followupStatuses} follow-up outcomes, ` +
        `${result.pipelines} pipelines, ${result.lostReasons} lost reasons, ` +
        `${result.accountTypes} account types, ${result.industries} industries.`,
    )
    console.log('(Zeros mean it was already there — this is idempotent.)')
  }

  console.log('\nStaff see the change on their next page load (the tenant cache is per-process).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => process.exit(0))
