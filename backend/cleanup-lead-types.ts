/**
 * Removes every lead_types row that isn't in the user spec.
 * For each dept:
 *   1. Determine the "keep" set (titles user listed, by slug)
 *   2. Find extras = all rows in dept NOT in keep
 *   3. Remap any leads/asigned_leads/followups/sub_statuses pointing at an extra
 *      to the dept's "Default" (so nothing orphans)
 *   4. Delete the extras
 *
 * Single transaction. Safe to re-run.
 *   npx tsx cleanup-lead-types.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const FLOW: Record<string, string[]> = {
  'tele-calling-dept': [
    'Default',
    'Greetings',
    'Duplicate Leads',
    'Cold Leads',
    'Warm Leads',
    'Hot Leads',
    'Not Interested',
    'Future Leads',
  ],
  'counselling-dept': [
    'Default',
    'India Admission',
    'Admission Drop',
    'Abroad Admission',
    'Pre-Submission Application',
  ],
  'neet-dept': [
    'Default',
    'NEET Appearing',
    'NEET Qualified',
    'NEET Not Qualified',
    'Interested',
    'Not Interested',
    'Reattempting Future',
  ],
  'admission-dept': [
    'Default',
    'Offer Letter Received',
    'Offer Letter Accepted',
    'Offer Letter Rejected',
    'Admission Drop',
    'Applications',
    'Scholarship EIU',
  ],
  'finance-dept': ['Default', 'Partial Paid', 'Fully Paid'],
  'visa-dept': [
    'Default',
    'Visa Processing',
    'Pre Departure',
    'Post Arrival',
    'Admission',
  ],
  'departure-dept': [
    'Default',
    'Forex And Flight',
    'Accommodation',
    'Airport Pickup',
    'Admission Completed',
  ],
  'marketing-dept': ['Default'],
  archive: ['Default', 'old data'],
  consultant: ['Default', 'B2B Interested', 'B2B Not Interested'],
}

async function main() {
  console.log('--- Cleanup lead_types (remove extras, keep exact spec) ---\n')

  await prisma.$transaction(
    async (tx) => {
      let remappedLeads = 0,
        remappedAssign = 0,
        remappedFup = 0,
        remappedSub = 0,
        deleted = 0

      for (const [deptSlug, titles] of Object.entries(FLOW)) {
        const dept = await tx.leadDepartment.findFirst({ where: { slug: deptSlug } })
        if (!dept) continue

        const keepSlugs = new Set(titles.map(slugify))
        const all = await tx.leadTypeConfig.findMany({ where: { departmentId: dept.id } })
        const extras = all.filter((r) => !keepSlugs.has(r.slug))
        if (!extras.length) {
          console.log(`[${dept.name}]  already clean`)
          continue
        }
        const def = all.find((r) => r.slug === 'default')
        if (!def) throw new Error(`[${dept.name}] missing Default — re-run fix-lead-flow.ts`)

        const ids = extras.map((r) => r.id)

        const ul = await tx.lead.updateMany({
          where: { statusLeadTypeId: { in: ids } },
          data: { statusLeadTypeId: def.id },
        })
        const ua = await tx.asignedLead.updateMany({
          where: { statusLeadTypeId: { in: ids } },
          data: { statusLeadTypeId: def.id },
        })
        const uf = await tx.leadFollowup.updateMany({
          where: { statusLeadTypeId: { in: ids } },
          data: { statusLeadTypeId: def.id },
        })
        const us = await tx.leadSubStatus.updateMany({
          where: { statusLeadTypeId: { in: ids } },
          data: { statusLeadTypeId: def.id },
        })
        const del = await tx.leadTypeConfig.deleteMany({ where: { id: { in: ids } } })

        remappedLeads += ul.count
        remappedAssign += ua.count
        remappedFup += uf.count
        remappedSub += us.count
        deleted += del.count

        console.log(
          `[${dept.name}]  removed ${del.count} extras: ${extras
            .map((r) => r.title)
            .join(', ')}`
        )
        if (ul.count + ua.count + uf.count + us.count > 0) {
          console.log(
            `   remapped → Default: leads=${ul.count} asigned=${ua.count} followups=${uf.count} sub=${us.count}`
          )
        }
      }

      console.log('\n--- Summary ---')
      console.log(`Lead-types deleted:   ${deleted}`)
      console.log(`Leads remapped:       ${remappedLeads}`)
      console.log(`Asigned remapped:     ${remappedAssign}`)
      console.log(`Followups remapped:   ${remappedFup}`)
      console.log(`Sub-statuses remapped:${remappedSub}`)
    },
    { timeout: 60_000 }
  )

  console.log('\nCommitted. Done.\n')
}

main()
  .catch((e) => {
    console.error('FAILED — transaction rolled back:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
