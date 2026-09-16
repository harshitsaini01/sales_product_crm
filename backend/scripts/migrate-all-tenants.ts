/**
 * Apply the tenant migrations to EVERY customer schema.
 *
 * Run this after any change to prisma/schema.prisma, in place of the single
 * `prisma migrate deploy` you would have run before multi-tenancy:
 *
 *   npx prisma migrate dev --name whatever   ← authoring, against your dev schema
 *   npm run tenant:migrate:all               ← rolling it out to every customer
 *
 * Sequential and fail-soft: one customer's failure is reported and the sweep
 * carries on, so a single bad schema does not block everybody else's upgrade.
 *
 * GUARDED. Every schema is checked before it is touched — see
 * services/migration-guard.service.ts. A schema holding data but carrying no
 * _prisma_migrations table is refused rather than migrated, because that is the
 * shape `migrate deploy` mistakes for a brand-new database and replays all 62
 * migrations onto, DROP statements included. Anything with data is dumped first.
 *
 *   --allow-destructive   proceed when a pending migration drops or truncates
 *   --no-backup           skip the pre-migration pg_dump
 */
import 'dotenv/config'
import { platformPrisma } from '../src/lib/platform'
import { runMigrations } from '../src/services/provisioning.service'
import { assertSafeToMigrate } from '../src/services/migration-guard.service'

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
  const allowDestructive = process.argv.includes('--allow-destructive')
  const skipBackup = process.argv.includes('--no-backup')

  const tenants = await platformPrisma.tenant.findMany({
    where: {
      provisioningStatus: 'ready',
      ...(only ? { slug: only } : {}),
    },
    orderBy: [{ isPrimary: 'desc' }, { slug: 'asc' }],
    select: { slug: true, schemaName: true, companyName: true },
  })

  if (!tenants.length) {
    console.log(only ? `No ready customer with slug "${only}".` : 'No customers registered yet.')
    return
  }

  console.log(`Migrating ${tenants.length} customer schema(s)...\n`)

  const failures: string[] = []
  for (const tenant of tenants) {
    process.stdout.write(`  ${tenant.slug.padEnd(20)} (${tenant.schemaName}) ... `)
    try {
      // Before anything is executed. A refusal here is the guard working.
      const { safety, backup } = await assertSafeToMigrate(tenant.schemaName, {
        allowDestructive,
        skipBackup,
      })

      if (!safety.pending.length) {
        console.log('up to date')
        continue
      }

      if (backup) console.log(`
    backed up to ${backup}`)
      process.stdout.write(`    applying ${safety.pending.length} migration(s) ... `)

      await runMigrations(tenant.schemaName)
      console.log('ok')
    } catch (err) {
      console.log('REFUSED')
      console.error(`
${err instanceof Error ? err.message : String(err)}`)
      failures.push(tenant.slug)
    }
  }

  console.log(`\nDone. ${tenants.length - failures.length}/${tenants.length} succeeded.`)
  if (failures.length) {
    console.error(`Failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => platformPrisma.$disconnect())
