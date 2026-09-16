// ─────────────────────────────────────────────────────────────────────────────
// A structural fingerprint of every tenant schema.
//
//   npm run fingerprint
//   npm run fingerprint -- --save        write it to .fingerprint.json
//   npm run fingerprint -- --compare     diff against the saved one
//
// Run it BEFORE and AFTER any migration. The education install is live — 63,000
// leads and growing daily — and the whole safety argument for migrating a
// shared schema.prisma rests on being able to prove afterwards that `public`
// came out the way it went in. "I only changed a crm_* table" is a claim; this
// is the evidence.
//
// Counts structure and row totals for the tables that matter, not full data:
// the point is to catch a column or a table appearing where it should not, and
// to catch rows disappearing. Both are cheap to check and expensive to miss.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { prisma } from '../src/lib/prisma'
import { runWithTenant } from '../src/lib/tenant-context'
import { listActiveTenantContexts } from '../src/services/tenant.service'

const FILE = '.fingerprint.json'

/** Tables worth counting rows in — the ones a bad migration would damage. */
const COUNTED = ['leads', 'lead_followups', 'lead_comments', 'lead_notes', 'users', 'crm_lead_business']

interface Fingerprint {
  [schema: string]: {
    tables: number
    columns: Record<string, number>
    rows: Record<string, number>
  }
}

async function build(): Promise<Fingerprint> {
  const out: Fingerprint = {}
  const tenants = await listActiveTenantContexts()

  for (const ctx of tenants) {
    const schema = ctx.schemaName
    await runWithTenant(ctx, async () => {
      const tables = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `select count(*)::int as n from information_schema.tables where table_schema = $1`,
        schema,
      )
      const cols = await prisma.$queryRawUnsafe<{ table_name: string; n: number }[]>(
        `select table_name, count(*)::int as n from information_schema.columns
         where table_schema = $1 group by table_name order by table_name`,
        schema,
      )

      const rows: Record<string, number> = {}
      for (const t of COUNTED) {
        try {
          const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
            `select count(*)::int as n from "${schema}"."${t}"`,
          )
          rows[t] = r[0].n
        } catch {
          // A table this tenant does not have is a fact worth recording, not an
          // error — that is exactly the kind of drift this is here to surface.
          rows[t] = -1
        }
      }

      out[schema] = {
        tables: Number(tables[0].n),
        columns: Object.fromEntries(cols.map((c) => [c.table_name, c.n])),
        rows,
      }
    })
  }

  return out
}

function summarise(fp: Fingerprint): void {
  for (const [schema, f] of Object.entries(fp)) {
    console.log(`\n  ${schema}`)
    console.log(`    tables  : ${f.tables}`)
    for (const [t, n] of Object.entries(f.rows)) {
      console.log(`    ${t.padEnd(20)}: ${n === -1 ? '(absent)' : `${n} rows, ${f.columns[t] ?? 0} columns`}`)
    }
  }
}

function compare(before: Fingerprint, after: Fingerprint): number {
  let diffs = 0
  const say = (m: string) => {
    diffs++
    console.log(`  CHANGED  ${m}`)
  }

  for (const schema of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[schema]
    const a = after[schema]
    if (!b) { say(`${schema} is new`); continue }
    if (!a) { say(`${schema} has gone`); continue }

    if (b.tables !== a.tables) say(`${schema}: tables ${b.tables} -> ${a.tables}`)

    for (const t of new Set([...Object.keys(b.columns), ...Object.keys(a.columns)])) {
      const bc = b.columns[t] ?? 0
      const ac = a.columns[t] ?? 0
      if (bc !== ac) say(`${schema}.${t}: columns ${bc} -> ${ac}`)
    }
    for (const t of Object.keys(b.rows)) {
      if (b.rows[t] !== a.rows[t]) say(`${schema}.${t}: rows ${b.rows[t]} -> ${a.rows[t]}`)
    }
  }

  return diffs
}

async function main() {
  const fp = await build()

  if (process.argv.includes('--compare')) {
    if (!existsSync(FILE)) {
      console.error(`No ${FILE} to compare against. Run with --save first.`)
      process.exit(1)
    }
    const before = JSON.parse(readFileSync(FILE, 'utf8')) as Fingerprint
    console.log('\nComparing against the saved fingerprint\n')
    const diffs = compare(before, fp)
    console.log(
      diffs === 0
        ? '\n  No structural change. Every schema is as it was.\n'
        : `\n  ${diffs} difference${diffs === 1 ? '' : 's'} above — check each one is intended.\n`,
    )
    return
  }

  summarise(fp)

  if (process.argv.includes('--save')) {
    writeFileSync(FILE, JSON.stringify(fp, null, 2))
    console.log(`\n  Saved to ${FILE}. Re-run with --compare after migrating.\n`)
  } else {
    console.log('\n  Pass --save to record this, then --compare after migrating.\n')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => process.exit(0))
