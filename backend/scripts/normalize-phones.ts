// One-off cleanup: normalize phone numbers across the CRM database.
//
// Rule (matches src/utils/phone.ts):
//   - Already starts with "+"     → leave it
//   - Digit-count = 10            → leave it (local Indian number, no country code)
//   - Digit-count = 12            → replace with "+" + digits (country code present, just missing the +)
//   - Anything else (empty/odd)   → leave it
//
// Touches:
//   leads.mobile, leads.mobile2, leads.mobile3,
//   leads.father_mobile, leads.mother_mobile, leads.home_contact_number,
//   users.mobile
//
// Usage:
//   npx tsx scripts/normalize-phones.ts          # dry-run (counts only, no changes)
//   npx tsx scripts/normalize-phones.ts --apply  # actually update rows
import { prisma } from '../src/lib/prisma'

const TARGETS: Array<{ table: string; column: string }> = [
  { table: 'leads', column: 'mobile' },
  { table: 'leads', column: 'mobile2' },
  { table: 'leads', column: 'mobile3' },
  { table: 'leads', column: 'father_mobile' },
  { table: 'leads', column: 'mother_mobile' },
  { table: 'leads', column: 'home_contact_number' },
  { table: 'users', column: 'mobile' },
]

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '— APPLY mode (rows will be updated)' : '— DRY RUN (no changes)')
  console.log()

  let grandTotal = 0
  for (const { table, column } of TARGETS) {
    // Count how many rows would be touched: 12-digit (ignoring non-digits) and not already "+"-prefixed.
    // Use $queryRawUnsafe because the table/column come from a static list above.
    const countRows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n
         FROM "${table}"
        WHERE "${column}" IS NOT NULL
          AND "${column}" <> ''
          AND "${column}" NOT LIKE '+%'
          AND length(regexp_replace("${column}", '\\D', '', 'g')) = 12`
    )
    const toFix = Number(countRows[0]?.n ?? 0)
    grandTotal += toFix

    if (toFix === 0) {
      console.log(`  ${table}.${column}: nothing to fix`)
      continue
    }

    if (!APPLY) {
      // Show a handful of sample rows so the operator can sanity-check before applying.
      const samples = await prisma.$queryRawUnsafe<Array<{ id: bigint; v: string }>>(
        `SELECT id, "${column}" AS v
           FROM "${table}"
          WHERE "${column}" IS NOT NULL
            AND "${column}" <> ''
            AND "${column}" NOT LIKE '+%'
            AND length(regexp_replace("${column}", '\\D', '', 'g')) = 12
          LIMIT 5`
      )
      console.log(`  ${table}.${column}: ${toFix} rows would be updated`)
      for (const s of samples) {
        const cleaned = '+' + s.v.replace(/\D/g, '')
        console.log(`    id=${s.id}   "${s.v}"  →  "${cleaned}"`)
      }
      continue
    }

    const result = await prisma.$executeRawUnsafe(
      `UPDATE "${table}"
          SET "${column}" = '+' || regexp_replace("${column}", '\\D', '', 'g')
        WHERE "${column}" IS NOT NULL
          AND "${column}" <> ''
          AND "${column}" NOT LIKE '+%'
          AND length(regexp_replace("${column}", '\\D', '', 'g')) = 12`
    )
    console.log(`  ${table}.${column}: updated ${result} rows`)
  }

  console.log()
  console.log(APPLY
    ? `Done. Total rows updated across all columns: see counts above.`
    : `Total rows that WOULD be updated: ${grandTotal}. Re-run with --apply to commit.`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
