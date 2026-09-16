/**
 * DESTRUCTIVE — wipes ALL data in every table while keeping the Prisma schema.
 *
 * Use case: you want to re-import fresh data from a new SQL dump.
 * After running this, run your data import (pgloader / SQL import / seed scripts).
 *
 *   npx tsx wipe-db.ts --confirm
 *
 * Safety: refuses to run unless --confirm is passed AND the env var
 *         `WIPE_OK=yes` is set. Both are required to prevent accidents.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const confirmed = process.argv.includes('--confirm')
  if (!confirmed || process.env.WIPE_OK !== 'yes') {
    console.error(
      'Refusing to run.\n' +
        'Set environment variable WIPE_OK=yes AND pass --confirm flag.\n' +
        '  PowerShell:  $env:WIPE_OK="yes"; npx tsx wipe-db.ts --confirm\n' +
        '  bash:        WIPE_OK=yes npx tsx wipe-db.ts --confirm'
    )
    process.exit(1)
  }

  console.log('Connecting...')
  // Get every public-schema user table that isn't a Prisma migration record.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_prisma_migrations')
    ORDER BY tablename
  `

  if (!tables.length) {
    console.log('No user tables found.')
    return
  }

  console.log(`Truncating ${tables.length} tables...`)
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')

  // TRUNCATE ... CASCADE handles FK deps; RESTART IDENTITY resets sequences.
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${list} RESTART IDENTITY CASCADE`
  )

  console.log('Done. All data wiped, schema preserved.')
}

main()
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
