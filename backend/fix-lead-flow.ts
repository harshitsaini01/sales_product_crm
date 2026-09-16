/**
 * Fix lead-flow seed:
 *  1. Removes the 40 lead_statuses rows wrongly added by seed-lead-flow.ts
 *     (they were placed in the wrong table — your "flow" actually lives in
 *     lead_types, not lead_statuses).
 *  2. Additively seeds lead_types with the exact spec, matching the OLD CRM's
 *     `lead_department_leadtypes` table + a "Default" entry per department.
 *  3. Idempotent (upsert by departmentId + slug). Safe to re-run.
 *  4. Never deletes legacy lead_types rows — they may be referenced by leads.
 *
 *   npx tsx fix-lead-flow.ts
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
  console.log('--- Fix lead-flow ---\n')

  await prisma.$transaction(
    async (tx) => {
      // STEP 1 — undo the wrong rows in lead_statuses (ids ≥ 38).
      const wrong = await tx.leadStatus.findMany({
        where: { id: { gte: 38 } },
        select: { id: true },
      })
      if (wrong.length) {
        const ids = wrong.map((r) => r.id)
        // Defensive: confirm zero references before deleting.
        const refLeads = await tx.lead.count({ where: { leadStatusId: { in: ids } } })
        const refAssign = await tx.asignedLead.count({
          where: { leadStatusId: { in: ids } },
        })
        const refFup = await tx.leadFollowup.count({
          where: { leadStatusId: { in: ids } },
        })
        if (refLeads + refAssign + refFup > 0) {
          throw new Error(
            `ABORT: legacy refs found (leads=${refLeads}, asigned=${refAssign}, fup=${refFup})`
          )
        }
        await tx.leadSubStatus.deleteMany({ where: { statusId: { in: ids } } })
        const del = await tx.leadStatus.deleteMany({ where: { id: { in: ids } } })
        console.log(`Step 1: removed ${del.count} wrong lead_statuses rows.\n`)
      } else {
        console.log('Step 1: no wrong rows to remove.\n')
      }

      // STEP 2 — seed lead_types per user spec, additive.
      console.log('Step 2: seeding lead_types ...\n')
      let created = 0,
        updated = 0
      for (const [deptSlug, titles] of Object.entries(FLOW)) {
        const dept = await tx.leadDepartment.findFirst({ where: { slug: deptSlug } })
        if (!dept) {
          console.log(`! Missing dept: ${deptSlug}`)
          continue
        }
        console.log(`[${dept.name}]`)
        for (let i = 0; i < titles.length; i++) {
          const title = titles[i]
          const slug = slugify(title)
          const existing = await tx.leadTypeConfig.findFirst({
            where: { departmentId: dept.id, slug },
          })
          if (existing) {
            await tx.leadTypeConfig.update({
              where: { id: existing.id },
              data: { title, priority: i },
            })
            updated++
            console.log(
              `   - [kept]    #${Number(existing.id).toString().padStart(3)}  ${title}`
            )
          } else {
            const c = await tx.leadTypeConfig.create({
              data: { title, slug, departmentId: dept.id, priority: i },
            })
            created++
            console.log(
              `   - [created] #${Number(c.id).toString().padStart(3)}  ${title}`
            )
          }
        }
        console.log('')
      }
      console.log(`Step 2 done: ${created} created, ${updated} kept/updated.`)
    },
    { timeout: 60_000 }
  )

  console.log('\nAll changes committed. Done.\n')
}

main()
  .catch((e) => {
    console.error('FAILED — transaction rolled back:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
