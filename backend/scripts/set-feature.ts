/**
 * Switch one module on or off for one customer, from the command line.
 *
 *   npm run tenant:feature -- --tenant=britannica_bots --feature=projects --on
 *   npm run tenant:feature -- --tenant=britannica_bots --feature=projects --off
 *   npm run tenant:feature -- --tenant=britannica_bots            (just show)
 *
 * The same write the super admin panel's toggle grid makes, without needing a
 * browser. Exists because a NEW feature key defaults to off for every customer
 * already live — their stored map predates it — so shipping a module means
 * turning it on for whoever asked for it, and that should be one command with
 * an audit line, not a hand-edited JSON column.
 */
import 'dotenv/config'
import { platformPrisma } from '../src/lib/platform'
import { getFeature, resolveFeatures, sanitizeFeatureMap, FEATURE_KEYS } from '../src/config/features'

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

async function main() {
  const slug = arg('tenant')
  const key = arg('feature')
  const on = process.argv.includes('--on')
  const off = process.argv.includes('--off')

  if (!slug) {
    console.error('Usage: npm run tenant:feature -- --tenant=<slug> [--feature=<key> --on|--off]')
    console.error(`Features: ${FEATURE_KEYS.join(', ')}`)
    process.exit(1)
  }

  const tenant = await platformPrisma.tenant.findUnique({ where: { slug } })
  if (!tenant) {
    console.error(`No customer with the slug "${slug}".`)
    process.exit(1)
  }

  const current = resolveFeatures(tenant.features)
  console.log(`\n${tenant.companyName} (${tenant.schemaName}) · vertical ${tenant.vertical}`)

  if (!key) {
    for (const k of FEATURE_KEYS) console.log(`  ${current[k] ? 'ON ' : 'off'}  ${k}`)
    return
  }

  const def = getFeature(key)
  if (!def) {
    console.error(`Unknown feature "${key}". Known: ${FEATURE_KEYS.join(', ')}`)
    process.exit(1)
  }
  if (on === off) {
    console.log(`  ${key}: ${current[key] ? 'ON' : 'off'}  (pass --on or --off to change)`)
    return
  }

  const next = sanitizeFeatureMap({ ...current, [key]: on })
  await platformPrisma.tenant.update({ where: { id: tenant.id }, data: { features: next } })
  await platformPrisma.platformAuditLog
    .create({
      data: {
        actorName: `cli:${process.env.USERNAME || process.env.USER || 'unknown'}`,
        action: 'tenant.feature',
        summary: `${on ? 'Enabled' : 'Disabled'} "${def.label}" for ${tenant.companyName} via scripts/set-feature.ts`,
        tenantId: tenant.id,
        detail: { feature: key, enabled: on, via: 'scripts/set-feature.ts' },
      },
    })
    .catch(() => undefined)

  console.log(`  ${key}: ${current[key] ? 'ON' : 'off'} → ${on ? 'ON' : 'off'}  (${def.label})`)
  console.log('  Users see it on their next sign-in or /auth/me refresh.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => platformPrisma.$disconnect())
