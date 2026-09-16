/**
 * Idempotent seed for canonical lead lifecycle statuses.
 *
 * Run with:  npx tsx prisma/seed-lifecycle.ts
 *
 * Seeds the 6 canonical stages (New / Contacted / Follow-up /
 * Not Interested / Converted / Closed) into every active lead_department.
 * Existing rows with the same (department_id, slug) are left untouched
 * so counts and historical assignments are never disturbed.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LIFECYCLE = [
  { slug: 'new',            title: 'New',            priority: 10 },
  { slug: 'contacted',      title: 'Contacted',      priority: 20 },
  { slug: 'follow-up',      title: 'Follow-up',      priority: 30 },
  { slug: 'not-interested', title: 'Not Interested', priority: 80 },
  { slug: 'converted',      title: 'Converted',      priority: 90 },
  { slug: 'closed',         title: 'Closed',         priority: 99 },
]

async function main() {
  const departments = await prisma.leadDepartment.findMany({
    where: { status: 1 },
    select: { id: true, name: true },
  })

  if (!departments.length) {
    console.warn('[seed-lifecycle] No active lead_departments found — nothing to seed.')
    return
  }

  let createdTotal = 0
  let skippedTotal = 0

  for (const dept of departments) {
    for (const stage of LIFECYCLE) {
      const existing = await prisma.leadStatus.findFirst({
        where: { departmentId: dept.id, slug: stage.slug },
        select: { id: true },
      })
      if (existing) {
        skippedTotal++
        continue
      }
      await prisma.leadStatus.create({
        data: {
          title: stage.title,
          slug: stage.slug,
          priority: stage.priority,
          departmentId: dept.id,
        },
      })
      createdTotal++
      console.log(`[seed-lifecycle] + ${dept.name} / ${stage.title}`)
    }
  }

  console.log(`\n[seed-lifecycle] Done. created=${createdTotal} skipped=${skippedTotal}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
