/**
 * One-time setup for the Super Admin control plane.
 *
 *   npm run platform:migrate      ← creates the `platform` schema + its tables
 *   npm run platform:bootstrap    ← this script
 *
 * It is idempotent — running it twice changes nothing — and it does three
 * things:
 *
 *   1. Registers the EXISTING installation as customer #1. No data moves; the
 *      `public` schema simply gains an entry in the tenant registry.
 *   2. Mirrors that customer's users into the login directory, so the shared
 *      login page can resolve them.
 *   3. Creates the root super admin account you sign in with.
 *
 * Credentials for step 3 come from the environment, or from arguments:
 *
 *   npx tsx scripts/bootstrap-platform.ts \
 *     --email you@example.com --password "a-long-password" --name "Your Name"
 */
import 'dotenv/config'
import { hash } from 'bcryptjs'
import { platformPrisma } from '../src/lib/platform'
import { getTenantClient } from '../src/lib/prisma'
import { ensurePrimaryTenant } from '../src/services/provisioning.service'
import { resyncTenantDirectory } from '../src/lib/tenant-directory'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

async function main() {
  const companyName = arg('company') || process.env.PRIMARY_COMPANY_NAME || 'Tutelage Study'

  // ── 1. The existing install becomes customer #1
  const primary = await ensurePrimaryTenant(companyName)
  console.log(`✔ Primary customer: #${primary.id} "${primary.companyName}" → schema "${primary.schemaName}"`)

  // ── 2. Mirror its users into the login directory
  const db = getTenantClient(primary.schemaName)
  const synced = await resyncTenantDirectory(db, primary.id)
  console.log(`✔ Login directory: ${synced} users mirrored from "${primary.schemaName}".`)

  // ── 3. The root super admin
  const email = arg('email') || process.env.PLATFORM_ROOT_EMAIL
  const password = arg('password') || process.env.PLATFORM_ROOT_PASSWORD
  const name = arg('name') || process.env.PLATFORM_ROOT_NAME || 'Super Admin'

  const existingRoot = await platformPrisma.platformUser.findFirst({ where: { isRoot: true } })
  if (existingRoot) {
    console.log(`✔ Root super admin already exists: ${existingRoot.email}`)
  } else if (!email || !password) {
    console.log(
      '\n⚠ No root super admin created — pass credentials to make one:\n' +
        '   npx tsx scripts/bootstrap-platform.ts --email you@example.com --password "a-long-password"\n',
    )
  } else if (password.length < 10) {
    console.error('✖ The root password must be at least 10 characters.')
    process.exitCode = 1
  } else {
    const created = await platformPrisma.platformUser.create({
      data: { name, email, password: await hash(password, 10), isRoot: true, status: 1 },
    })
    console.log(`✔ Root super admin created: ${created.email}`)
    console.log('  Sign in at the normal login page — it will take you to /super.')
  }

  // ── Sanity check: the login directory is what makes the shared login page
  //    work, so an empty one is worth shouting about.
  if (synced === 0) {
    console.warn(
      '\n⚠ The login directory is empty. Existing staff will still be able to sign in\n' +
        '  (login falls back to the primary customer), but check that\n' +
        `  "${primary.schemaName}".users actually has rows.`,
    )
  }
}

main()
  .catch((err) => {
    console.error('\n✖ Bootstrap failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await platformPrisma.$disconnect()
  })
