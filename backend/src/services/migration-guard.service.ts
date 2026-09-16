// ─────────────────────────────────────────────────────────────────────────────
// Refuse to run a migration that could destroy a customer's data.
//
// THE INCIDENT THIS EXISTS FOR
//
// `prisma migrate deploy` against a schema with no `_prisma_migrations` table
// does not stop and ask. It sees no history, concludes the database is new, and
// replays every migration from the beginning — onto live data. This repo's
// history includes `drop_universities`, `drop_brochures`, `drop_program_fees`,
// `drop_landing_pages`, `drop_app_tracking` and `drop_dead_lookup_tables`.
// Replaying those onto a populated schema drops real tables.
//
// The trap is specifically a schema that arrived with DATA rather than being
// built from schema.prisma — a pgloader import, a restored dump, a schema
// copied between servers. Those have tables and rows but no migration history,
// which is the exact shape Prisma reads as "brand new".
//
// So: baseline BEFORE deploy, never after. That ordering is the whole incident
// in one line, and `assertSafeToMigrate` is that ordering made mechanical.
//
// WHAT IT CHECKS, in order of how badly it ends
//
//   1. Has this schema a `_prisma_migrations` table?  No → refuse, say baseline.
//   2. Does the schema hold data?                     Yes → require a backup.
//   3. Do the PENDING migrations contain DROP/TRUNCATE? Yes → refuse by default.
//
// Every refusal names the command that resolves it. A guard that blocks without
// saying what to do next just gets bypassed with --force.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { platformPrisma } from '../lib/platform'

const BACKEND = path.resolve(__dirname, '../..')
const MIGRATIONS_DIR = path.join(BACKEND, 'prisma', 'migrations')

/** Statements that remove data or the things holding it. */
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE)\b/i

export interface MigrationSafety {
  schemaName: string
  hasHistory: boolean
  /** Rows across the tables most worth protecting. 0 means an empty shell. */
  rowCount: number
  applied: string[]
  pending: string[]
  /** Pending migrations that would drop or truncate something. */
  destructive: { migration: string; statements: string[] }[]
}

function assertSafeSchemaName(schema: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Refusing to work with an unsafe schema name: ${schema}`)
  }
}

/** Point the connection URL at one schema, leaving the rest of it alone. */
export function urlForSchema(schema: string): string {
  const base = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set.')
  const u = new URL(base)
  u.searchParams.set('schema', schema)
  return u.toString()
}

/** Every migration on disk, in the order Prisma applies them. */
export function migrationsOnDisk(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(MIGRATIONS_DIR, e.name, 'migration.sql')))
    .map((e) => e.name)
    .sort()
}

/**
 * Inspect a schema without changing anything.
 *
 * Queries `_prisma_migrations` directly rather than asking the Prisma CLI,
 * because the CLI's answer to "what is applied here" is the very thing that is
 * unreliable when the table is missing.
 */
export async function inspect(schemaName: string): Promise<MigrationSafety> {
  assertSafeSchemaName(schemaName)

  const hasHistory = await tableExists(schemaName, '_prisma_migrations')

  const applied = hasHistory
    ? (
        await platformPrisma.$queryRawUnsafe<{ migration_name: string }[]>(
          `SELECT migration_name FROM "${schemaName}"."_prisma_migrations"
           WHERE finished_at IS NOT NULL ORDER BY migration_name`,
        )
      ).map((r) => r.migration_name)
    : []

  const appliedSet = new Set(applied)
  const pending = migrationsOnDisk().filter((m) => !appliedSet.has(m))

  return {
    schemaName,
    hasHistory,
    rowCount: await countRows(schemaName),
    applied,
    pending,
    destructive: pending
      .map((m) => ({ migration: m, statements: destructiveStatements(m) }))
      .filter((d) => d.statements.length > 0),
  }
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const rows = await platformPrisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2`,
    schema,
    table,
  )
  return rows[0].n > 0
}

/**
 * Roughly how much there is to lose.
 *
 * Deliberately a handful of tables rather than all of them: the question is
 * "is this a live customer or an empty shell", and leads/users answers it
 * without counting a hundred tables on every deploy.
 */
async function countRows(schema: string): Promise<number> {
  let total = 0
  for (const table of ['leads', 'users', 'lead_followups', 'lead_comments']) {
    if (!(await tableExists(schema, table))) continue
    try {
      const r = await platformPrisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${schema}"."${table}"`,
      )
      total += r[0].n
    } catch {
      // Unreadable is not the same as empty. Treat it as "has data" so the
      // guard errs toward protecting rather than waving through.
      total += 1
    }
  }
  return total
}

/** The DROP/TRUNCATE lines in one migration, for showing a human. */
export function destructiveStatements(migration: string): string[] {
  const file = path.join(MIGRATIONS_DIR, migration, 'migration.sql')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--') && DESTRUCTIVE.test(s))
}

export interface GuardOptions {
  /** Proceed even though pending migrations drop things. */
  allowDestructive?: boolean
  /** Skip the pre-migration dump. Only for a schema you can afford to lose. */
  skipBackup?: boolean
  /** Where dumps go. */
  backupDir?: string
}

/**
 * Throw unless it is safe to run `migrate deploy` against this schema.
 *
 * Returns the path of the backup it took, when it took one.
 */
export async function assertSafeToMigrate(
  schemaName: string,
  opts: GuardOptions = {},
): Promise<{ safety: MigrationSafety; backup: string | null }> {
  const safety = await inspect(schemaName)

  // ── 1. No history + data = the incident. Refuse, loudly and specifically.
  if (!safety.hasHistory) {
    if (safety.rowCount > 0) {
      throw new Error(
        `"${schemaName}" holds data (${safety.rowCount} rows across leads/users/followups/comments) ` +
          `but has no _prisma_migrations table.\n\n` +
          `  Running migrate deploy here would replay all ${migrationsOnDisk().length} migrations ` +
          `onto live data, including the ones that DROP tables.\n\n` +
          `  Baseline it FIRST, then deploy:\n` +
          `    npm run tenant:baseline -- --all --schema=${schemaName}\n`,
      )
    }
    // Empty and historyless is a legitimately new schema. Prisma's own P3005
    // still applies if it has tables, and that is its call to make, not ours.
  }

  // ── 2. Pending migrations that destroy things.
  if (safety.destructive.length && !opts.allowDestructive) {
    const detail = safety.destructive
      .map((d) => `    ${d.migration}\n${d.statements.map((s) => `      ${s.split('\n')[0]}`).join('\n')}`)
      .join('\n')
    throw new Error(
      `"${schemaName}" has ${safety.destructive.length} pending migration(s) that drop or truncate:\n\n` +
        `${detail}\n\n` +
        `  If that is genuinely intended, re-run with --allow-destructive.\n` +
        `  If it is not, the schema is probably missing history — see tenant:baseline.\n`,
    )
  }

  // ── 3. Anything with data gets a dump before it is touched.
  let backup: string | null = null
  if (safety.pending.length && safety.rowCount > 0 && !opts.skipBackup) {
    backup = backupSchema(schemaName, opts.backupDir)
  }

  return { safety, backup }
}

/**
 * pg_dump one schema to a file.
 *
 * Scoped with -n so a restore can never reach across into another customer.
 * Throws if the dump fails: a failed backup before a migration is a reason to
 * stop, not a warning to scroll past.
 */
export function backupSchema(schemaName: string, dir?: string): string {
  assertSafeSchemaName(schemaName)

  const target = dir ?? path.join(BACKEND, 'backups')
  fs.mkdirSync(target, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(target, `${schemaName}-${stamp}.sql`)

  const res = spawnSync('pg_dump', ['--schema', schemaName, '--no-owner', '--file', file, urlForSchema(schemaName)], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (res.status !== 0) {
    throw new Error(
      `Could not back up "${schemaName}" before migrating.\n` +
        `  ${(res.stderr || res.error?.message || 'pg_dump failed').trim().split('\n')[0]}\n\n` +
        `  Fix pg_dump, or pass --no-backup if this schema is genuinely disposable.`,
    )
  }

  return file
}
