/**
 * Find where prisma/migrations/ no longer reproduces prisma/schema.prisma.
 *
 *   npm run tenant:drift             # what the migration history is missing
 *   npm run tenant:drift -- --live   # what the LIVE schemas are missing
 *   npm run tenant:drift -- --write  # write a catch-up migration
 *
 * WHY THIS EXISTS
 *
 * Five tables (university_application_mails, counsellor_remarks,
 * webmail_accounts, whatsapp_templates, whatsapp_template_files) and at least
 * one column (users.show_full_phone) were created on the live database directly
 * — with `prisma db push` or by hand — and never captured in a migration.
 * `prisma db pull` then wrote them into prisma/schema.prisma.
 *
 * The result: the live database is correct, but a schema built by REPLAYING the
 * migrations is missing all of it. That is what broke customer provisioning.
 *
 * TWO DIFFERENT QUESTIONS
 *
 *   default   migrations  → schema.prisma   "what is the history missing?"
 *   --live    live schema → schema.prisma   "is this database actually correct?"
 *
 * The first is a code-hygiene problem. The second is a data problem. They have
 * very different answers, so they are separate flags.
 */
import 'dotenv/config'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const BACKEND = path.resolve(__dirname, '..')
const SHADOW_SCHEMA = '_prisma_drift_shadow'
const MIGRATION_NAME = '20260827130000_sync_schema_drift'

function baseUrl(): string {
  const base = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set (looked in backend/.env).')
  return base
}

function withSchema(schema: string): string {
  const url = new URL(baseUrl())
  url.searchParams.set('schema', schema)
  return url.toString()
}

function prisma(args: string[], env: Record<string, string> = {}) {
  const entry = require.resolve('prisma/build/index.js', { paths: [BACKEND] })
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: BACKEND,
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', ...env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status ?? 1 }
}

const isEmptyScript = (sql: string) => /^\s*(--.*\s*)*$/.test(sql)

function summarise(sql: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of sql.matchAll(/^-- (\w+)/gm)) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1
  }
  return counts
}

// ─── --live: are the actual databases correct? ───────────────────────────────

async function checkLive() {
  const db = new PrismaClient({ datasources: { db: { url: baseUrl() } } })
  const schemas: string[] = [process.env.PRIMARY_TENANT_SCHEMA || 'public']

  try {
    // Pick up customer schemas too, if the control plane is set up yet.
    const rows = await db.$queryRawUnsafe<{ schema_name: string }[]>(
      `SELECT schema_name FROM "platform"."tenants" WHERE provisioning_status = 'ready' ORDER BY id`,
    ).catch(() => [])
    for (const r of rows) if (!schemas.includes(r.schema_name)) schemas.push(r.schema_name)
  } finally {
    await db.$disconnect()
  }

  console.log(`Checking ${schemas.length} live schema(s) against prisma/schema.prisma...\n`)
  let anyDrift = false

  for (const schema of schemas) {
    const res = prisma(
      [
        'migrate', 'diff',
        '--from-schema-datasource', 'prisma/schema.prisma',
        '--to-schema-datamodel', 'prisma/schema.prisma',
        '--script',
      ],
      { DATABASE_URL: withSchema(schema), DIRECT_URL: withSchema(schema) },
    )

    if (res.code !== 0) {
      console.log(`  ✗ ${schema.padEnd(24)} check failed`)
      console.error('      ' + (res.stderr || res.stdout).trim().split('\n')[0])
      anyDrift = true
      continue
    }

    const sql = res.stdout.trim()
    if (isEmptyScript(sql)) {
      console.log(`  ✔ ${schema.padEnd(24)} matches prisma/schema.prisma`)
    } else {
      anyDrift = true
      console.log(`  ⚠ ${schema.padEnd(24)} OUT OF DATE`)
      console.log(sql.replace(/^/gm, '        '))
    }
  }

  if (!anyDrift) {
    console.log('\nEvery live schema is correct. Only the migration history is behind —')
    console.log('run `npm run tenant:drift` (without --live) to see that.')
  }
}

// ─── default: what is the migration history missing? ─────────────────────────

async function checkMigrations(write: boolean) {
  const db = new PrismaClient({ datasources: { db: { url: baseUrl() } } })
  console.log(`Replaying migrations into a scratch schema ("${SHADOW_SCHEMA}")...\n`)

  try {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SHADOW_SCHEMA}" CASCADE`)
    await db.$executeRawUnsafe(`CREATE SCHEMA "${SHADOW_SCHEMA}"`)

    const res = prisma([
      'migrate', 'diff',
      '--from-migrations', 'prisma/migrations',
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--shadow-database-url', withSchema(SHADOW_SCHEMA),
      '--script',
    ])

    if (res.code !== 0) {
      console.error('Could not compute the diff:\n' + (res.stderr || res.stdout))
      process.exitCode = 1
      return
    }

    const sql = res.stdout.trim()
    if (isEmptyScript(sql)) {
      console.log('✔ No drift. The migrations reproduce prisma/schema.prisma exactly.')
      return
    }

    const counts = summarise(sql)
    console.log('⚠ The migration history does not reproduce prisma/schema.prisma:\n')
    for (const [kind, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)} × ${kind}`)
    }
    console.log()

    if (!write) {
      console.log(sql.replace(/^/gm, '    '))
      console.log('\nRun with --write to turn this into a catch-up migration:')
      console.log('    npm run tenant:drift -- --write\n')
      return
    }

    const dir = path.join(BACKEND, 'prisma', 'migrations', MIGRATION_NAME)
    fs.mkdirSync(dir, { recursive: true })

    // Written VERBATIM, on purpose.
    //
    // An earlier version of this script tried to bolt IF NOT EXISTS onto every
    // statement so the migration could simply be run everywhere. That does not
    // work: Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, and there are ten of
    // those here, plus three ALTER INDEX ... RENAME which fail once the old name
    // is gone. A "mostly idempotent" migration is worse than an honest one —
    // it fails half way through and leaves the schema in between two states.
    //
    // So: this migration is for schemas that do NOT already have these objects
    // (every new customer). Schemas that DO — the live install — are marked as
    // having it applied instead, without running it. That is Prisma's baseline
    // workflow, and `npm run tenant:baseline` does it.
    const header = [
      '-- Catch-up migration.',
      '--',
      '-- Five tables and one column were created on the live database directly,',
      '-- without a migration ever being written:',
      '--   university_application_mails, counsellor_remarks, webmail_accounts,',
      '--   whatsapp_templates, whatsapp_template_files, users.show_full_phone',
      '--',
      '-- This closes the gap for any schema built by replaying migrations.',
      '--',
      '-- ⚠ NOT idempotent. Do NOT run it against a database that already has',
      '--   these objects — mark it as applied instead:',
      '--       npm run tenant:baseline',
      '',
    ].join('\n')

    fs.writeFileSync(path.join(dir, 'migration.sql'), header + sql + '\n', 'utf8')
    console.log(`✔ Written: prisma/migrations/${MIGRATION_NAME}/migration.sql\n`)

    console.log('NEXT — in this order:\n')
    console.log('  1. Confirm the live database is already correct:')
    console.log('         npm run tenant:drift -- --live')
    console.log('     Every schema must say "matches prisma/schema.prisma".\n')
    console.log('  2. Mark this migration as applied on those schemas (does NOT run it):')
    console.log('         npm run tenant:baseline\n')
    console.log('  3. Commit prisma/migrations/' + MIGRATION_NAME + '/\n')
    console.log('  New customers get it applied normally — they need it.')
  } finally {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SHADOW_SCHEMA}" CASCADE`).catch(() => undefined)
    await db.$disconnect()
  }
}

async function main() {
  if (process.argv.includes('--live')) return checkLive()
  return checkMigrations(process.argv.includes('--write'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
