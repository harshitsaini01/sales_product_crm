/**
 * Tenancy safety checks that need no database.
 *
 *   npm run tenant:verify
 *
 * These assert the properties that keep one customer's data away from another's:
 * that a query without tenant context fails loudly rather than silently reading
 * the primary customer, that upload paths cannot be crossed or traversed, and
 * that a slug can never reach raw DDL as something dangerous.
 *
 * Run it after touching lib/prisma.ts, lib/tenant-context.ts, utils/tenant-paths.ts
 * or the provisioning slug rules.
 */
import 'dotenv/config'
import assert from 'assert'
import { prisma, urlForSchema, PRIMARY_SCHEMA } from '../src/lib/prisma'
import {
  NoTenantContextError,
  runWithTenant,
  currentTenant,
  type TenantContext,
  type TenantLimits,
} from '../src/lib/tenant-context'
import { canAccessUploadPath, uploadsPrefixFor } from '../src/utils/tenant-paths'
import { resolveFeatures, allFeaturesOn, sanitizeFeatureMap } from '../src/config/features'
import { validateSlug, schemaNameFor } from '../src/services/provisioning.service'

let passed = 0
let failed = 0

function check(label: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${label}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${label}`)
    console.error(`      ${err instanceof Error ? err.message : String(err)}`)
  }
}

const NO_LIMITS: TenantLimits = {
  maxUsers: null, maxCounsellors: null, maxSubAdmins: null, maxBranches: null,
  maxLeads: null, maxLeadsPerMonth: null, maxStorageMb: null,
}

const acme: TenantContext = {
  tenantId: 2, slug: 'acme', schemaName: 'tenant_acme', companyName: 'Acme',
  status: 'active', planName: 'starter', planExpiresAt: null, isPrimary: false,
  vertical: 'education', features: { whatsapp: false, students: true },
  // Empty is what every real customer stores, and what this test wants: the
  // fixture should be the ordinary case, not a configured one.
  leadFields: {}, labels: {}, limits: NO_LIMITS,
}

const primary: TenantContext = {
  ...acme, tenantId: 1, slug: 'primary', schemaName: PRIMARY_SCHEMA,
  companyName: 'Tutelage Study', isPrimary: true,
}

async function main() {
  console.log('\nTenant isolation')
  check('a query with no tenant context throws instead of hitting the primary schema', () => {
    try {
      void (prisma as unknown as Record<string, unknown>).user
      throw new Error('expected NoTenantContextError, but the access succeeded')
    } catch (err) {
      assert(err instanceof NoTenantContextError, `wrong error: ${err}`)
    }
  })

  await runWithTenant(acme, async () => {
    await new Promise((r) => setTimeout(r, 1))
    check('context survives an await boundary', () => {
      assert.equal(currentTenant()?.slug, 'acme')
    })
  })

  check('context is gone again once runWithTenant returns', () => {
    assert.equal(currentTenant(), undefined)
  })

  console.log('\nConnection pooling')
  check('the primary keeps whatever pool DATABASE_URL configures', () => {
    const url = new URL(urlForSchema(PRIMARY_SCHEMA))
    assert.equal(url.searchParams.get('schema'), PRIMARY_SCHEMA)
  })
  check('other customers get the smaller per-tenant pool', () => {
    const url = new URL(urlForSchema('tenant_acme'))
    assert.equal(url.searchParams.get('schema'), 'tenant_acme')
    assert.equal(url.searchParams.get('connection_limit'), process.env.TENANT_CONNECTION_LIMIT || '5')
  })

  console.log('\nUpload isolation')
  check('the primary writes to uploads/ root, everyone else to uploads/t/<slug>', () => {
    assert.equal(uploadsPrefixFor(primary), '')
    assert.equal(uploadsPrefixFor(acme), 't/acme')
  })
  check('a customer can read their own files', () => {
    assert.equal(canAccessUploadPath(acme, 't/acme/doc.pdf'), true)
    assert.equal(canAccessUploadPath(primary, 'legacy-photo.png'), true)
  })
  check('a customer CANNOT read another customer’s files', () => {
    assert.equal(canAccessUploadPath(acme, 't/globe/doc.pdf'), false)
    assert.equal(canAccessUploadPath(primary, 't/acme/doc.pdf'), false)
    assert.equal(canAccessUploadPath(acme, 'legacy-photo.png'), false)
  })
  check('path traversal is refused', () => {
    assert.equal(canAccessUploadPath(acme, 't/acme/../globe/doc.pdf'), false)
    assert.equal(canAccessUploadPath(acme, 't\\acme\\..\\globe\\doc.pdf'), false)
  })

  console.log('\nFeature resolution')
  check('a partial stored map resolves against catalogue defaults', () => {
    const r = resolveFeatures({ whatsapp: true })
    assert.equal(r.whatsapp, true)
    assert.equal(r.students, true, 'core modules default on')
    assert.equal(r.auto_dialer, false, 'paid modules default off')
  })
  check('unknown keys never survive into the resolved map', () => {
    const r = resolveFeatures({ bogus_key: true }) as Record<string, unknown>
    assert.equal(r.bogus_key, undefined)
  })
  check('non-boolean values are rejected', () => {
    assert.deepEqual(sanitizeFeatureMap({ whatsapp: 'yes', students: false }), { students: false })
  })
  check('the original install gets every module', () => {
    assert(Object.values(allFeaturesOn()).every(Boolean))
  })

  console.log('\nLead field catalogue')
  // The super admin toggle grid is built from backend/src/config/lead-fields.ts;
  // the customer's form is rendered from INFO_SECTIONS in LeadDetailPage.tsx.
  // They are two lists that MUST agree — a group id that exists in one but not
  // the other means a toggle that silently does nothing, and a field missing
  // from the backend can never be hidden. Nothing but this check couples them.
  {
    const fs = require('fs') as typeof import('fs')
    const pathMod = require('path') as typeof import('path')

    const read = (rel: string) =>
      fs
        .readFileSync(pathMod.resolve(__dirname, '..', rel), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//')) // drop commented-out entries
        .join('\n')

    const slice = (src: string, from: string, to: string) =>
      src.slice(src.indexOf(from), src.indexOf(to))

    const fieldKeys = (body: string) => [...body.matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1])
    const groupIds = (body: string) =>
      [...body.matchAll(/id: '([a-z]+)',\s*\n\s*title:/g)].map((m) => m[1])

    const backend = slice(read('src/config/lead-fields.ts'), 'LEAD_FIELD_GROUPS', 'ALWAYS_ON_FIELDS')
    const frontend = slice(
      read('../frontend/src/pages/admin/LeadDetailPage.tsx'),
      'const INFO_SECTIONS = [',
      'function InfoTab',
    )

    check('group ids match between the catalogue and the form', () => {
      assert.deepEqual(groupIds(backend), groupIds(frontend))
    })

    check('every field exists on both sides', () => {
      const be = fieldKeys(backend)
      const fe = fieldKeys(frontend)
      assert.deepEqual(
        be.filter((k) => !fe.includes(k)),
        [],
        'in the catalogue but not the form',
      )
      assert.deepEqual(
        fe.filter((k) => !be.includes(k)),
        [],
        'in the form but not the catalogue — it could never be hidden',
      )
    })
  }

  console.log('\nLead field visibility')
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lf = require('../src/config/lead-fields') as typeof import('../src/config/lead-fields')
    const ALL = lf.LEAD_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key))

    // THE regression to guard. Every existing customer has an empty config, and
    // an empty config must mean "show everything" — anything else silently
    // changes the CRM for people who never asked for it.
    check('an empty config hides nothing', () => {
      for (const stored of [{}, null, undefined]) {
        for (const key of ALL) {
          assert.ok(lf.isLeadFieldVisible(stored, key), `${key} should be visible`)
        }
      }
    })

    check('hiding a group hides its fields and nothing else', () => {
      assert.equal(lf.isLeadFieldVisible({ hiddenGroups: ['dmat'] }, 'dmatVScore'), false)
      assert.ok(lf.isLeadFieldVisible({ hiddenGroups: ['dmat'] }, 'city'))
    })

    check('the lead name can never be hidden', () => {
      assert.ok(lf.isLeadFieldVisible({ hiddenFields: ['name'] }, 'name'))
      assert.ok(lf.isLeadFieldVisible({ hiddenGroups: ['personal'], hiddenFields: ['name'] }, 'name'))
    })

    check('locked groups and junk keys are refused', () => {
      // "other" carries lead type / source / website, which the pipeline runs on.
      assert.deepEqual(lf.sanitizeLeadFieldConfig({ hiddenGroups: ['other', 'dmat'] }).hiddenGroups, ['dmat'])
      assert.deepEqual(
        lf.sanitizeLeadFieldConfig({ hiddenGroups: ['nope'], hiddenFields: ['not_a_field', 123] }),
        { hiddenGroups: [], hiddenFields: [] },
      )
    })

    check('nothing is hidden for anyone by default', () => {
      // A NEW customer gets an empty config too — same as the original install.
      // Which fields a customer keeps is a decision for whoever onboards them,
      // never a default baked in here.
      for (const key of ALL) {
        assert.ok(lf.isLeadFieldVisible({}, key), `${key} must be on out of the box`)
      }
      // The measurements are recorded but must stay inert.
      assert.deepEqual([...lf.MEASURED_EMPTY_GROUPS], ['dmat', 'sat', 'ucat', 'english', 'education'])
    })
  }

  console.log('\nPrisma CLI arguments')
  // Regression guard. `migrate diff` is the one subcommand that rejects
  // --schema, and appending it unconditionally broke provisioning with
  // "unknown or unexpected option: --schema" — after the schema had been
  // created, so every attempt rolled back and looked like a seeding failure.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildArgs } = require('./prisma-schema-cli.js') as {
    buildArgs: (forwarded: string[], schemaPath: string) => string[]
  }
  const SCHEMA = 'prisma/schema.prisma'
  const schemaFlags = (args: string[]) =>
    buildArgs(args, SCHEMA).filter((a) => a === '--schema' || a.startsWith('--schema=')).length

  check('migrate diff is NOT given --schema', () => {
    assert.equal(
      schemaFlags(['migrate', 'diff', '--from-schema-datasource', SCHEMA, '--to-schema-datamodel', SCHEMA, '--script']),
      0,
    )
  })
  check('every other subcommand still gets --schema exactly once', () => {
    assert.equal(schemaFlags(['migrate', 'deploy']), 1)
    assert.equal(schemaFlags(['generate']), 1)
    assert.equal(schemaFlags(['migrate', 'resolve', '--applied', 'x']), 1)
  })
  check('an explicitly supplied --schema is never duplicated', () => {
    assert.equal(schemaFlags(['db', 'execute', '--file', '/tmp/x.sql', '--schema', SCHEMA]), 1)
  })

  console.log('\nSlug safety (these values reach raw DDL)')
  check('a normal slug is accepted and namespaced', () => {
    assert.equal(validateSlug('acme_overseas'), null)
    assert.equal(schemaNameFor('acme'), 'tenant_acme')
  })
  check('reserved, malformed and injection-shaped slugs are refused', () => {
    for (const bad of [
      'public', 'platform', 'information_schema', 'pg_toast',
      'ab', 'Acme', '1acme', 'a-b', 'a b', 'x"; DROP SCHEMA public; --',
    ]) {
      assert(validateSlug(bad) !== null, `"${bad}" should have been rejected`)
    }
  })

  console.log(`\n${passed} passed, ${failed} failed.\n`)
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
