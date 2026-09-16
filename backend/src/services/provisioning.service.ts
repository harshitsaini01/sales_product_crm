// ─────────────────────────────────────────────────────────────────────────────
// Standing up a new customer.
//
//   CREATE SCHEMA → prisma migrate deploy → seed baseline config → first admin
//
// Migrating 50+ migrations takes long enough that doing it inside the HTTP
// request would time out, so provisioning runs as a background job and the
// wizard polls Tenant.provisioningStatus. Any failure drops the half-built
// schema so a retry starts clean.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { platformPrisma } from '../lib/platform'
import { getTenantClient, disconnectTenant } from '../lib/prisma'
import { runWithTenant } from '../lib/tenant-context'
import { invalidateTenantCache, getTenantById } from './tenant.service'
import { resyncTenantDirectory } from '../lib/tenant-directory'
import { seedTenantSchema, type SeedAdmin } from './tenant-seed.service'
import { allFeaturesOn, sanitizeFeatureMap, defaultFeatureMap } from '../config/features'
import { sanitizeLeadFieldConfig } from '../config/lead-fields'
import { sanitizeLabelMap } from '../config/terminology'
import { getVertical, type VerticalKey } from '../config/verticals'

const SCHEMA_PREFIX = 'tenant_'

/** Names Postgres reserves, plus ours. */
const RESERVED_SLUGS = new Set([
  'public', 'platform', 'information_schema', 'pg_catalog', 'pg_toast',
  'admin', 'api', 'app', 'www', 'super', 'tenant',
])

export function schemaNameFor(slug: string): string {
  return `${SCHEMA_PREFIX}${slug}`
}

export function validateSlug(slug: string): string | null {
  if (!/^[a-z][a-z0-9_]{2,30}$/.test(slug)) {
    return 'Use 3–31 characters: lowercase letters, numbers and underscores, starting with a letter.'
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved. Please pick another.`
  if (slug.startsWith('pg_')) return 'Slugs cannot start with "pg_".'
  return null
}

export interface CreateTenantInput {
  slug: string
  companyName: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  planName?: string
  planExpiresAt?: Date | null
  limits?: Partial<{
    maxUsers: number | null
    maxCounsellors: number | null
    maxSubAdmins: number | null
    maxBranches: number | null
    maxLeads: number | null
    maxLeadsPerMonth: number | null
    maxStorageMb: number | null
  }>
  /**
   * Which preset to build this customer from. Omitted means education, which is
   * what every customer created before verticals existed effectively was.
   */
  vertical?: VerticalKey
  /**
   * Explicit per-module overrides, applied ON TOP of the vertical's preset — so
   * the wizard can pick "B2B / IT Sales" and still switch one module back on
   * without having to restate the other sixteen.
   */
  features?: Record<string, boolean>
  admin: SeedAdmin
}

/**
 * Create the tenant row and kick off provisioning. Returns immediately; the
 * caller polls GET /api/platform/tenants/:id for progress.
 */
export async function createTenant(input: CreateTenantInput) {
  const slugError = validateSlug(input.slug)
  if (slugError) throw new Error(slugError)

  const preset = getVertical(input.vertical)

  const existing = await platformPrisma.tenant.findFirst({
    where: { OR: [{ slug: input.slug }, { schemaName: schemaNameFor(input.slug) }] },
    select: { id: true },
  })
  if (existing) throw new Error(`A customer with the slug "${input.slug}" already exists.`)

  // A login identifier may only belong to one customer. The directory extension
  // enforces this at insert time too, but by then we would already have built
  // the schema and run 50 migrations — so check before any of that happens and
  // give the person filling in the wizard a straight answer.
  const identifiers = [input.admin.loginid, input.admin.email].filter(Boolean)
  const clash = await platformPrisma.tenantUserDirectory.findFirst({
    where: {
      OR: [
        { loginid: { in: identifiers, mode: 'insensitive' } },
        { email: { in: identifiers, mode: 'insensitive' } },
      ],
    },
    select: { tenant: { select: { companyName: true } } },
  })
  if (clash) {
    throw new Error(
      `That login ID or email is already in use by ${clash.tenant.companyName}. ` +
        'Every login on the platform must be unique — please use a different address.',
    )
  }

  const tenant = await platformPrisma.tenant.create({
    data: {
      slug: input.slug,
      schemaName: schemaNameFor(input.slug),
      companyName: input.companyName,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      planName: input.planName || 'starter',
      planStartsAt: new Date(),
      planExpiresAt: input.planExpiresAt ?? null,
      status: 'active',
      provisioningStatus: 'pending',
      provisioningStep: 'Queued',
      vertical: preset.key,
      // Three layers, narrowest last: the catalogue default, then what the
      // vertical says, then whatever the wizard explicitly ticked.
      features: {
        ...defaultFeatureMap(),
        ...sanitizeFeatureMap(preset.features),
        ...sanitizeFeatureMap(input.features ?? {}),
      },
      // The preset is COPIED here, not referenced. From now on these columns are
      // authoritative and the super admin edits them directly; nothing reads the
      // preset again unless somebody explicitly re-applies it. Education's preset
      // is empty, which is "show every field" — the original install's behaviour.
      leadFields: { ...sanitizeLeadFieldConfig(preset.leadFields) },
      // The customer's own name is written in as the brand, so a new customer
      // never opens their panel to somebody else's company in the header.
      labels: {
        ...sanitizeLabelMap({ ...preset.labels, brand: { singular: input.companyName } }),
      },
      ...input.limits,
    },
  })

  // Deliberately not awaited — the wizard watches provisioningStatus instead.
  void runProvisioning(tenant.id, input.admin, input.companyName, preset.key).catch((err) =>
    console.error(`[provisioning] tenant ${tenant.id} failed:`, err),
  )

  return tenant
}

async function step(tenantId: number, status: string, label: string) {
  await platformPrisma.tenant.update({
    where: { id: tenantId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { provisioningStatus: status as any, provisioningStep: label },
  })
  invalidateTenantCache(tenantId)
  console.log(`[provisioning] tenant ${tenantId}: ${label}`)
}

async function runProvisioning(
  tenantId: number,
  admin: SeedAdmin,
  companyName: string,
  vertical: VerticalKey,
) {
  const tenant = await platformPrisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return

  try {
    await step(tenantId, 'creating_schema', 'Creating database schema')
    await createSchema(tenant.schemaName)

    await step(tenantId, 'migrating', 'Applying database migrations')
    await runMigrations(tenant.schemaName)

    // The migration history does not fully reproduce prisma/schema.prisma —
    // some columns (users.show_full_phone among them) were added to the live
    // database without a migration ever being written. Replaying migrations
    // alone therefore builds an out-of-date schema, and seeding then fails on
    // the missing column.
    //
    // Diffing the schema we just built against the schema file closes that gap,
    // whatever the gap happens to be. Destructive statements are allowed here
    // and only here: this schema is seconds old and holds nothing.
    await step(tenantId, 'migrating', 'Reconciling schema')
    const drift = await reconcileSchema(tenant.schemaName, { allowDestructive: true })
    if (drift.applied) {
      console.log(
        `[provisioning] tenant ${tenantId}: migration history was behind prisma/schema.prisma — ` +
          `applied the difference. Run "npm run tenant:drift" to see what is missing a migration.`,
      )
    }

    await step(tenantId, 'seeding', 'Setting up lead pipeline and first admin')
    const db = getTenantClient(tenant.schemaName)
    const ctx = await getTenantById(tenantId)
    if (!ctx) throw new Error('Tenant vanished mid-provisioning')

    // Inside the tenant context so the directory extension mirrors the new
    // admin into platform.tenant_user_directory — without which they could not
    // be found by the shared login page.
    await runWithTenant(ctx, async () => {
      await seedTenantSchema(db, { companyName, admin, vertical })
    })

    await resyncTenantDirectory(db, tenantId)

    await platformPrisma.tenant.update({
      where: { id: tenantId },
      data: { provisioningStatus: 'ready', provisioningStep: 'Ready', provisioningError: null },
    })
    invalidateTenantCache(tenantId)
    console.log(`[provisioning] tenant ${tenantId} (${tenant.slug}) is ready`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[provisioning] tenant ${tenantId} failed:`, err)

    // Leave nothing half-built: a retry with the same slug must start clean.
    await disconnectTenant(tenant.schemaName).catch(() => undefined)
    await dropSchema(tenant.schemaName).catch((dropErr) =>
      console.error('[provisioning] rollback failed:', dropErr),
    )

    await platformPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        provisioningStatus: 'failed',
        provisioningStep: 'Failed',
        provisioningError: message.slice(0, 2000),
      },
    })
    invalidateTenantCache(tenantId)
  }
}

function assertSafeSchemaName(schemaName: string): void {
  // Belt and braces: these values reach raw DDL, and the slug validator alone
  // is not where that guarantee should live.
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error(`Unsafe schema name: ${schemaName}`)
  }
}

export async function createSchema(schemaName: string): Promise<void> {
  assertSafeSchemaName(schemaName)
  await platformPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
}

export async function dropSchema(schemaName: string): Promise<void> {
  assertSafeSchemaName(schemaName)
  if (schemaName === 'public' || schemaName === 'platform') {
    throw new Error(`Refusing to drop the "${schemaName}" schema.`)
  }
  await platformPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
}

/**
 * Run the Prisma CLI against one schema, via the same wrapper the npm scripts
 * use. Spawned rather than called in-process because the migration engine is a
 * separate binary that wants its own DATABASE_URL.
 */
function runPrismaCli(
  schemaName: string,
  args: string[],
  timeoutMs = 10 * 60_000,
): Promise<{ stdout: string; stderr: string }> {
  assertSafeSchemaName(schemaName)

  return new Promise((resolve, reject) => {
    const script = path.resolve(__dirname, '../../scripts/prisma-schema-cli.js')
    const child = spawn(process.execPath, [script, `--schema=${schemaName}`, ...args], {
      cwd: path.resolve(__dirname, '../..'),
      env: process.env,
      // The wrapper inherits these, so its prisma child writes straight into
      // our pipes — which is how `migrate diff --script` output gets captured.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`prisma ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve({ stdout, stderr })
      reject(
        new Error(`prisma ${args.join(' ')} exited with ${code}\n${stderr || stdout}`.slice(0, 4000)),
      )
    })
  })
}

/** Apply the tenant migrations to one schema. */
export async function runMigrations(schemaName: string, timeoutMs = 10 * 60_000): Promise<void> {
  await runPrismaCli(schemaName, ['migrate', 'deploy'], timeoutMs)
}

const EMPTY_SCRIPT = /^\s*(--.*\s*)*$/

/** A statement that removes data, as opposed to adding to the schema. */
function isDestructive(sql: string): boolean {
  return /\b(DROP\s+(TABLE|COLUMN|SCHEMA)|TRUNCATE)\b/i.test(sql)
}

export interface DriftReport {
  schemaName: string
  /** SQL that would bring the schema in line with prisma/schema.prisma. */
  sql: string
  hasDrift: boolean
  /** True when closing the drift would drop a table or column. */
  destructive: boolean
}

/**
 * Compare a schema against prisma/schema.prisma and return the SQL that would
 * close the gap. Read-only — it never touches the database.
 *
 * This exists because the migration history and the schema file have drifted:
 * `users.show_full_phone` is in prisma/schema.prisma but in none of the 54
 * migrations, so it was added straight to the live database at some point
 * without a migration being written. The original install has the column
 * because it was applied there by hand; a schema built purely by replaying
 * migrations does not — which is what broke provisioning.
 */
export async function inspectDrift(schemaName: string): Promise<DriftReport> {
  const { stdout } = await runPrismaCli(schemaName, [
    'migrate',
    'diff',
    // "from" is the live schema, so no shadow database is needed.
    '--from-schema-datasource',
    'prisma/schema.prisma',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--script',
  ])

  const sql = stdout.trim()
  const hasDrift = !EMPTY_SCRIPT.test(sql)

  return { schemaName, sql, hasDrift, destructive: hasDrift && isDestructive(sql) }
}

/**
 * Bring a schema in line with prisma/schema.prisma.
 *
 * `allowDestructive` MUST stay false for any schema holding real data: the diff
 * is computed against the schema file, so a table that exists in the database
 * but is absent from the file comes back as a DROP. That is correct for a
 * schema created seconds ago and catastrophic for a customer's live one.
 */
export async function reconcileSchema(
  schemaName: string,
  opts: { allowDestructive?: boolean } = {},
): Promise<DriftReport & { applied: boolean }> {
  const report = await inspectDrift(schemaName)
  if (!report.hasDrift) return { ...report, applied: false }

  if (report.destructive && !opts.allowDestructive) {
    throw new Error(
      `Closing the drift on "${schemaName}" would drop a table or column. ` +
        `Refusing to do that automatically — review the SQL and apply it by hand.`,
    )
  }

  const file = path.join(
    os.tmpdir(),
    `reconcile-${schemaName}-${process.pid}-${report.sql.length}.sql`,
  )
  await fs.writeFile(file, report.sql, 'utf8')

  try {
    await runPrismaCli(schemaName, ['db', 'execute', '--file', file, '--schema', 'prisma/schema.prisma'])
  } finally {
    await fs.unlink(file).catch(() => undefined)
  }

  console.log(`[provisioning] reconciled drift on "${schemaName}" (${report.sql.length} bytes of SQL)`)
  return { ...report, applied: true }
}

/** Permanently remove a customer. The caller is responsible for the warning. */
export async function deleteTenant(tenantId: number): Promise<void> {
  const tenant = await platformPrisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new Error('Customer not found')
  if (tenant.isPrimary) throw new Error('The primary installation cannot be deleted.')

  await disconnectTenant(tenant.schemaName).catch(() => undefined)
  await dropSchema(tenant.schemaName)
  await platformPrisma.tenant.delete({ where: { id: tenantId } })
  invalidateTenantCache(tenantId)
}

/**
 * Register the existing installation as customer #1. Idempotent — running it
 * twice is a no-op. Called by scripts/bootstrap-platform.ts.
 */
export async function ensurePrimaryTenant(companyName = 'Sales CRM') {
  const schemaName = process.env.PRIMARY_TENANT_SCHEMA || 'public'

  const existing = await platformPrisma.tenant.findFirst({ where: { isPrimary: true } })
  if (existing) return existing

  return platformPrisma.tenant.create({
    data: {
      slug: 'primary',
      schemaName,
      companyName,
      status: 'active',
      planName: 'owner',
      provisioningStatus: 'ready',
      provisioningStep: 'Ready',
      isPrimary: true,
      // The original install predates feature flags and must keep everything
      // it already had, with no limits applied to it.
      features: allFeaturesOn(),
    },
  })
}
