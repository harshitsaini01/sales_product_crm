/**
 * Mark a migration as already applied, without running it.
 *
 *   npm run tenant:baseline                          # the catch-up migration
 *   npm run tenant:baseline -- --migration=<name>
 *   npm run tenant:baseline -- --all                 # every migration (P3005)
 *   npm run tenant:baseline -- --all --schema=public
 *   npm run tenant:baseline -- --dry-run
 *
 * WHY
 *
 * The live database already has the tables and columns the catch-up migration
 * creates — they were added by hand, which is exactly why no migration exists
 * for them. Running it there would fail on the first `CREATE TABLE`.
 *
 * What the live schemas need is for Prisma to stop thinking the migration is
 * pending. `prisma migrate resolve --applied` records it in _prisma_migrations
 * and runs none of the SQL. After this, `migrate deploy` is a no-op on existing
 * schemas and applies normally on new ones.
 *
 * Only ever run this after `npm run tenant:drift -- --live` reports that the
 * schemas genuinely match prisma/schema.prisma. Baselining a migration whose
 * changes are NOT actually present would hide real drift.
 *
 * ── --all, and the P3005 it exists for ──────────────────────────────────────
 *
 *   migrate deploy on `public` fails with:
 *     P3005  The database schema is not empty.
 *
 * That schema came from the original pgloader import, not from Prisma, so it
 * has no _prisma_migrations table at all. Prisma cannot tell which of the 60-odd
 * migrations are already reflected there, and refuses to guess — correctly,
 * because replaying them would hit CREATE TABLE on tables that already exist.
 *
 * --all records EVERY migration as applied, in filename order, executing none
 * of them. That is the standard baseline for an existing production database,
 * and afterwards `migrate deploy` behaves normally: pending migrations apply,
 * old ones do not.
 *
 * It is a claim that the database ALREADY contains everything those migrations
 * would have done. Run `npm run tenant:drift -- --live` first and close any gap
 * it reports, or --all will bury that gap under a clean-looking history.
 */
import 'dotenv/config'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const BACKEND = path.resolve(__dirname, '..')
const DEFAULT_MIGRATION = '20260827130000_sync_schema_drift'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function withSchema(schema: string): string {
  const base = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set (looked in backend/.env).')
  const url = new URL(base)
  url.searchParams.set('schema', schema)
  return url.toString()
}

/** Every migration folder, in the order Prisma applies them. */
function allMigrations(): string[] {
  const root = path.join(BACKEND, 'prisma', 'migrations')
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'migration.sql')))
    .map((e) => e.name)
    .sort()
}

async function main() {
  const all = process.argv.includes('--all')
  const dryRun = process.argv.includes('--dry-run')
  const onlySchema = arg('schema')

  const migrations = all ? allMigrations() : [arg('migration') || DEFAULT_MIGRATION]

  if (!all) {
    const dir = path.join(BACKEND, 'prisma', 'migrations', migrations[0])
    if (!fs.existsSync(dir)) {
      console.error(`✖ No such migration: prisma/migrations/${migrations[0]}`)
      console.error('  Run `npm run tenant:drift -- --write` first.')
      process.exit(1)
    }
  } else if (!migrations.length) {
    console.error('✖ No migrations found in prisma/migrations.')
    process.exit(1)
  }

  const base = process.env.DIRECT_URL || process.env.DATABASE_URL
  const db = new PrismaClient({ datasources: { db: { url: base } } })

  const schemas: string[] = [process.env.PRIMARY_TENANT_SCHEMA || 'public']
  try {
    const rows = await db
      .$queryRawUnsafe<{ schema_name: string }[]>(
        `SELECT schema_name FROM "platform"."tenants" WHERE provisioning_status = 'ready' ORDER BY id`,
      )
      .catch(() => [])
    for (const r of rows) if (!schemas.includes(r.schema_name)) schemas.push(r.schema_name)
  } finally {
    await db.$disconnect()
  }

  // --schema= narrows to one, because the schema that needs baselining is
  // usually the one that just failed, and the others are already healthy.
  const targets = onlySchema ? schemas.filter((s) => s === onlySchema) : schemas
  if (!targets.length) {
    console.error(`✖ No ready schema named "${onlySchema}". Known: ${schemas.join(', ')}`)
    process.exit(1)
  }

  console.log(
    all
      ? `Marking all ${migrations.length} migrations as applied on ${targets.length} schema(s).`
      : `Marking "${migrations[0]}" as applied on ${targets.length} schema(s).`,
  )
  console.log('No SQL from any migration is executed.\n')

  if (dryRun) {
    for (const s of targets) console.log(`  would baseline  ${s}  (${migrations.length} migration(s))`)
    return
  }

  const entry = require.resolve('prisma/build/index.js', { paths: [BACKEND] })
  let failed = 0

  for (const schema of targets) {
    let done = 0
    let already = 0
    process.stdout.write(`  ${schema.padEnd(24)} ... `)

    for (const migration of migrations) {
      const res = spawnSync(
        process.execPath,
        [entry, 'migrate', 'resolve', '--applied', migration, '--schema', 'prisma/schema.prisma'],
        {
          cwd: BACKEND,
          env: {
            ...process.env,
            DATABASE_URL: withSchema(schema),
            DIRECT_URL: withSchema(schema),
            PRISMA_HIDE_UPDATE_MESSAGE: '1',
          },
          encoding: 'utf8',
        },
      )

      if (res.status === 0) {
        done++
        continue
      }

      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
      // Already recorded is the desired end state, not a failure.
      if (/already recorded as applied/i.test(out)) {
        already++
        continue
      }

      console.log('FAILED')
      console.error(`      on ${migration}:`)
      console.error('      ' + out.trim().split('\n').slice(0, 4).join('\n      '))
      failed++
      break
    }

    if (done || already) {
      console.log(
        [done && `${done} baselined`, already && `${already} already applied`]
          .filter(Boolean)
          .join(', '),
      )
    }
  }

  console.log()
  if (failed) {
    console.error(`${failed} schema(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('Done. Verify with:')
    console.log('    npm run tenant:drift            # should report no drift')
    console.log('    npm run tenant:drift -- --live  # should still be clean')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
