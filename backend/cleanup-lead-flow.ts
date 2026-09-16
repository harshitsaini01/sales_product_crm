/**
 * Make Lead Flow EXACTLY match the user-defined spec.
 *
 * For every department:
 *   - Determine the "keep" set (statuses the user listed, by slug)
 *   - All other statuses in that department are "legacy"
 *   - Any leads / asigned_leads / lead_followups pointing to a legacy status
 *     get remapped to the department's "Default" status (so nothing orphans)
 *   - Legacy lead_sub_statuses + lead_statuses are then deleted
 *
 * Wrapped in a single transaction. Run AFTER seed-lead-flow.ts.
 *
 *   npx tsx cleanup-lead-flow.ts
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
  console.log('--- Cleanup: enforcing exact lead-flow spec ---\n')

  let totalRemappedLeads = 0
  let totalRemappedAssign = 0
  let totalRemappedFup = 0
  let totalDeletedSub = 0
  let totalDeletedStatuses = 0

  await prisma.$transaction(
    async (tx) => {
      for (const [deptSlug, keepTitles] of Object.entries(FLOW)) {
        const dept = await tx.leadDepartment.findFirst({ where: { slug: deptSlug } })
        if (!dept) {
          console.log(`! Department not found by slug: ${deptSlug} — skipped`)
          continue
        }

        const allStatuses = await tx.leadStatus.findMany({
          where: { departmentId: dept.id },
        })
        const keepSlugs = new Set(keepTitles.map(slugify))
        const keep = allStatuses.filter((s) => keepSlugs.has(s.slug))
        const legacy = allStatuses.filter((s) => !keepSlugs.has(s.slug))

        const def = keep.find((s) => s.slug === 'default')
        if (!def) {
          throw new Error(
            `[${dept.name}] Default status missing — re-run seed-lead-flow.ts first`
          )
        }

        if (!legacy.length) {
          console.log(`[${dept.name}]  already clean ✓`)
          continue
        }

        const legacyIds = legacy.map((s) => s.id)

        // Remap referencing rows to Default of this dept.
        const updLeads = await tx.lead.updateMany({
          where: { leadStatusId: { in: legacyIds } },
          data: { leadStatusId: def.id, leadSubStatusId: null },
        })
        const updLeadsSubOnly = await tx.lead.updateMany({
          where: {
            leadSubStatusId: { not: null },
            leadStatus: { in: [] }, // no-op filter; sub cleanup happens via subStatus deletion below
          },
          data: {},
        })
        // Also clear any leadSubStatusId pointing to a sub of a legacy status
        const legacySubs = await tx.leadSubStatus.findMany({
          where: { statusId: { in: legacyIds } },
          select: { id: true },
        })
        const legacySubIds = legacySubs.map((s) => s.id)
        if (legacySubIds.length) {
          await tx.lead.updateMany({
            where: { leadSubStatusId: { in: legacySubIds } },
            data: { leadSubStatusId: null },
          })
          await tx.asignedLead.updateMany({
            where: { leadSubStatusId: { in: legacySubIds } },
            data: { leadSubStatusId: null },
          })
          await tx.leadFollowup.updateMany({
            where: { leadSubStatusId: { in: legacySubIds } },
            data: { leadSubStatusId: null },
          })
        }

        const updAssign = await tx.asignedLead.updateMany({
          where: { leadStatusId: { in: legacyIds } },
          data: { leadStatusId: def.id, leadSubStatusId: null },
        })
        const updFup = await tx.leadFollowup.updateMany({
          where: { leadStatusId: { in: legacyIds } },
          data: { leadStatusId: def.id, leadSubStatusId: null },
        })

        // Delete legacy sub-statuses, then legacy statuses.
        const delSub = await tx.leadSubStatus.deleteMany({
          where: { statusId: { in: legacyIds } },
        })
        const delStatus = await tx.leadStatus.deleteMany({
          where: { id: { in: legacyIds } },
        })

        totalRemappedLeads += updLeads.count
        totalRemappedAssign += updAssign.count
        totalRemappedFup += updFup.count
        totalDeletedSub += delSub.count
        totalDeletedStatuses += delStatus.count

        console.log(
          `[${dept.name}]  removed ${legacy.length} legacy statuses ` +
            `(${legacy.map((s) => s.title).join(', ')})`
        )
        console.log(
          `   leads remapped: ${updLeads.count}, asigned_leads: ${updAssign.count}, ` +
            `followups: ${updFup.count}, sub-statuses deleted: ${delSub.count}, ` +
            `statuses deleted: ${delStatus.count}`
        )
        void updLeadsSubOnly
      }
    },
    { timeout: 60_000 }
  )

  console.log('\n--- Summary ---')
  console.log(`Leads remapped:            ${totalRemappedLeads}`)
  console.log(`Asigned-leads remapped:    ${totalRemappedAssign}`)
  console.log(`Followups remapped:        ${totalRemappedFup}`)
  console.log(`Sub-statuses deleted:      ${totalDeletedSub}`)
  console.log(`Lead statuses deleted:     ${totalDeletedStatuses}`)
  console.log('Done.\n')
}

main()
  .catch((e) => {
    console.error('FAILED — transaction rolled back:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
