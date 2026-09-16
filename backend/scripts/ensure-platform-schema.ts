/**
 * Create the `platform` schema if it is not there yet.
 *
 * Runs immediately before `prisma migrate deploy` on the control plane. The
 * migration engine will normally create a missing schema itself, but this makes
 * a first deploy deterministic rather than reliant on that behaviour — and it
 * costs one statement.
 *
 * Safe to run on every deploy: CREATE SCHEMA IF NOT EXISTS is a no-op once the
 * schema is there, and it never touches any customer's data.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

async function main() {
  const schema = process.env.PLATFORM_SCHEMA || 'platform'

  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`PLATFORM_SCHEMA="${schema}" is not a valid Postgres schema name.`)
  }

  const base = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set (looked in backend/.env).')

  // Connect through the tenant client rather than the platform one: the platform
  // client's tables do not exist yet on a first run, and all we need here is a
  // connection to the database itself.
  const prisma = new PrismaClient({ datasources: { db: { url: base } } })

  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    console.log(`✔ Schema "${schema}" is present.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('✖ Could not create the platform schema:', err instanceof Error ? err.message : err)
  process.exit(1)
})
