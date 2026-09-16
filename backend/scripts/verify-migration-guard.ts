// ─────────────────────────────────────────────────────────────────────────────
// Prove the migration guard refuses the thing that destroyed data.
//
//   npm run verify:guard
//
// Builds a throwaway schema in the shape that caused the incident — tables with
// rows, no `_prisma_migrations` — and asserts the guard refuses to migrate it.
// A guard nobody has watched refuse is a guess, and this is the one guess we
// cannot afford to be wrong about.
//
// The temp schema is named guard_check_<pid>, created and dropped by this
// script, and never touches a real customer.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
import { platformPrisma } from '../src/lib/platform'
import { inspect, assertSafeToMigrate, migrationsOnDisk } from '../src/services/migration-guard.service'

const SCHEMA = `guard_check_${process.pid}`

let passed = 0
let failed = 0

function ok(what: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  PASS  ${what}`)
  } else {
    failed++
    console.log(`  FAIL  ${what}`)
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`)
  }
}

async function exec(sql: string) {
  await platformPrisma.$executeRawUnsafe(sql)
}

async function main() {
  console.log(`\nBuilding a schema in the shape that caused the incident (${SCHEMA})\n`)

  await exec(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await exec(`CREATE SCHEMA "${SCHEMA}"`)
  // Tables with rows and NO _prisma_migrations: exactly what a pgloader import
  // or a restored dump looks like, and what migrate deploy reads as "new".
  await exec(`CREATE TABLE "${SCHEMA}".users (id bigserial primary key, name text)`)
  await exec(`CREATE TABLE "${SCHEMA}".leads (id bigserial primary key, name text)`)
  await exec(`INSERT INTO "${SCHEMA}".users (name) VALUES ('A counsellor who would have been dropped')`)
  await exec(`INSERT INTO "${SCHEMA}".leads (name) VALUES ('A lead who would have been dropped')`)

  try {
    const before = await inspect(SCHEMA)
    ok('the guard sees no migration history', before.hasHistory === false)
    ok('and sees the data that is at risk', before.rowCount === 2, before.rowCount)
    ok('and treats every migration as pending', before.pending.length === migrationsOnDisk().length, {
      pending: before.pending.length,
      onDisk: migrationsOnDisk().length,
    })
    ok(
      'and knows some of those pending migrations drop tables',
      before.destructive.length > 0,
      before.destructive.map((d) => d.migration).slice(0, 4),
    )

    let refused = false
    let message = ''
    try {
      await assertSafeToMigrate(SCHEMA, { skipBackup: true })
    } catch (e) {
      refused = true
      message = e instanceof Error ? e.message : String(e)
    }

    ok('IT REFUSES TO MIGRATE A POPULATED SCHEMA WITH NO HISTORY', refused)
    ok('and the refusal names the baseline command', message.includes('tenant:baseline'), message.slice(0, 120))
    ok('and says how much data was at stake', /\d+ rows/.test(message))

    // The same schema, once baselined, is no longer the dangerous shape.
    await exec(`CREATE TABLE "${SCHEMA}"."_prisma_migrations" (
      id varchar(36) primary key, checksum varchar(64) not null,
      finished_at timestamptz, migration_name varchar(255) not null,
      logs text, rolled_back_at timestamptz,
      started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`)
    for (const m of migrationsOnDisk()) {
      await exec(
        `INSERT INTO "${SCHEMA}"."_prisma_migrations" (id, checksum, finished_at, migration_name)
         VALUES (gen_random_uuid()::text, 'x', now(), '${m.replace(/'/g, "''")}')`,
      )
    }

    const after = await inspect(SCHEMA)
    ok('after baselining, the history is there', after.hasHistory === true)
    ok('and nothing is pending', after.pending.length === 0, after.pending.slice(0, 3))

    let secondRefusal = false
    try {
      await assertSafeToMigrate(SCHEMA, { skipBackup: true })
    } catch {
      secondRefusal = true
    }
    ok('so the guard now lets it through', secondRefusal === false)
  } finally {
    await exec(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    console.log(`\n  (dropped ${SCHEMA})`)
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(failed === 0 ? `ALL ${passed} PASSED` : `${passed} passed, ${failed} FAILED`)
  if (failed) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => process.exit(process.exitCode ?? 0))
