#!/usr/bin/env node
/**
 * Runs the Prisma CLI against ONE Postgres schema.
 *
 * Everything multi-tenant here — generating the control-plane client, migrating
 * the control plane, provisioning a new customer, migrating all customers —
 * comes down to "run prisma with DATABASE_URL pointed at a different schema".
 * Doing that with shell env vars is not portable across PowerShell/bash, so it
 * lives here instead.
 *
 *   node scripts/prisma-schema-cli.js --schema=platform --platform generate
 *   node scripts/prisma-schema-cli.js --schema=tenant_acme migrate deploy
 *
 * Flags consumed by this wrapper:
 *   --schema=<name>   Postgres schema to point DATABASE_URL/DIRECT_URL at
 *   --platform        use prisma/platform/schema.prisma instead of the tenant one
 * Everything else is forwarded to `prisma` verbatim.
 */

const { spawnSync } = require('child_process')
const path = require('path')
require('dotenv/config')

/**
 * Build the argument list for the prisma CLI.
 *
 * Most subcommands need `--schema` to know which schema.prisma to read, but
 * `migrate diff` does NOT accept it — it takes its inputs from the `--from-`
 * and `--to-` flags instead, and errors out with
 * "unknown or unexpected option: --schema". Appending it unconditionally broke
 * customer provisioning, which calls `migrate diff` to reconcile a new schema.
 *
 * Exported so scripts/verify-tenancy.ts can test it without a database.
 */
function buildArgs(forwarded, schemaPath) {
  // First two non-flag tokens are the subcommand, e.g. "migrate diff".
  const subcommand = forwarded.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ')

  const REJECTS_SCHEMA_FLAG = ['migrate diff']
  if (REJECTS_SCHEMA_FLAG.includes(subcommand)) return [...forwarded]

  // Never pass it twice — the caller may have supplied its own.
  const alreadyHasSchema = forwarded.some((a) => a === '--schema' || a.startsWith('--schema='))
  if (alreadyHasSchema) return [...forwarded]

  return [...forwarded, `--schema=${schemaPath}`]
}

module.exports = { buildArgs }

// Running as a library (require'd by the tests) — stop before doing any work.
if (require.main !== module) return

const argv = process.argv.slice(2)

let schema = null
let usePlatform = false
const forwarded = []

for (const arg of argv) {
  if (arg.startsWith('--schema=')) schema = arg.slice('--schema='.length)
  else if (arg === '--platform') usePlatform = true
  else forwarded.push(arg)
}

if (!schema) {
  console.error('Usage: node scripts/prisma-schema-cli.js --schema=<name> [--platform] <prisma args...>')
  process.exit(1)
}

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
  console.error(`Refusing to use "${schema}" as a Postgres schema name.`)
  process.exit(1)
}

function withSchema(rawUrl, schemaName) {
  const url = new URL(rawUrl)
  url.searchParams.set('schema', schemaName)
  return url.toString()
}

const base = process.env.DATABASE_URL
if (!base) {
  console.error('DATABASE_URL is not set (looked in backend/.env).')
  process.exit(1)
}

const target = withSchema(base, schema)
// Migrations need a non-pooled connection; fall back to DATABASE_URL when the
// deployment does not configure a separate direct URL.
const direct = withSchema(process.env.DIRECT_URL || base, schema)

const schemaPath = usePlatform
  ? path.join('prisma', 'platform', 'schema.prisma')
  : path.join('prisma', 'schema.prisma')

const env = {
  ...process.env,
  DATABASE_URL: target,
  DIRECT_URL: direct,
  // The platform schema.prisma reads this one.
  PLATFORM_DATABASE_URL: target,
}

const cwd = path.resolve(__dirname, '..')
const args = buildArgs(forwarded, schemaPath)

// Resolve Prisma's own JS entry point and run it with the current node binary.
// Spawning `npx.cmd` would need shell:true on Windows (Node refuses to spawn
// .cmd files directly since the CVE-2024-27980 fix), and shell quoting of
// connection strings containing & and ? is a trap not worth walking into.
let prismaEntry
try {
  prismaEntry = require.resolve('prisma/build/index.js', { paths: [cwd] })
} catch {
  console.error('Could not locate the prisma CLI. Run `npm install` in backend/ first.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [prismaEntry, ...args], {
  stdio: 'inherit',
  env,
  cwd,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status === null ? 1 : result.status)
