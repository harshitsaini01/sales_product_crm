/**
 * Rebuild the shared-login directory from the customer schemas.
 *
 *   npm run tenant:directory:rebuild            ← every customer
 *   npm run tenant:directory:rebuild -- --only=acme
 *
 * The directory (platform.tenant_user_directory) is a cache that maps a login
 * identifier to the customer it belongs to. It is kept current automatically by
 * the Prisma extension in src/lib/tenant-directory.ts; this script is the
 * repair tool for when something has drifted — after a manual SQL edit, a
 * restore from backup, or a period where the extension errored.
 */
import 'dotenv/config'
import { platformPrisma } from '../src/lib/platform'
import { getTenantClient } from '../src/lib/prisma'
import { resyncTenantDirectory } from '../src/lib/tenant-directory'

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)

  const tenants = await platformPrisma.tenant.findMany({
    where: { provisioningStatus: 'ready', ...(only ? { slug: only } : {}) },
    orderBy: [{ isPrimary: 'desc' }, { slug: 'asc' }],
    select: { id: true, slug: true, schemaName: true, companyName: true },
  })

  if (!tenants.length) {
    console.log('Nothing to rebuild.')
    return
  }

  let total = 0
  for (const tenant of tenants) {
    process.stdout.write(`  ${tenant.slug.padEnd(20)} ... `)
    try {
      const count = await resyncTenantDirectory(getTenantClient(tenant.schemaName), tenant.id)
      total += count
      console.log(`${count} users`)
    } catch (err) {
      console.log('FAILED')
      console.error(`    ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // A duplicate identifier across two customers makes the shared login page
  // ambiguous: it has to try the password against each candidate in turn.
  // Not broken, but worth knowing about.
  const dupes = await platformPrisma.$queryRawUnsafe<{ loginid: string; n: bigint }[]>(`
    SELECT lower(loginid) AS loginid, COUNT(DISTINCT tenant_id)::bigint AS n
      FROM "platform".tenant_user_directory
     WHERE status = 1
     GROUP BY lower(loginid)
    HAVING COUNT(DISTINCT tenant_id) > 1
  `)

  console.log(`\nDone. ${total} directory rows across ${tenants.length} customer(s).`)
  if (dupes.length) {
    console.warn(`\n⚠ ${dupes.length} login ID(s) exist at more than one customer:`)
    for (const d of dupes.slice(0, 20)) console.warn(`    ${d.loginid} (${Number(d.n)} customers)`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => platformPrisma.$disconnect())
