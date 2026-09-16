import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import { prisma, getTenantClient } from '../lib/prisma'
import { requireTenant } from '../lib/tenant-context'
import { assertHeadroom } from '../lib/tenant-quota'

interface CsvLead {
  name: string
  email?: string
  mobile?: string
  mobile2?: string
  city?: string
  state?: string
  country?: string
  intrestedCourse?: string
  source?: string
  website?: string
  neetscore?: string
  comment?: string
}

export async function importLeadsFromCsv(csvContent: string, userId: number): Promise<{
  imported: number
  skipped: number
  errors: string[]
}> {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvLead[]

  // Pre-flight against the plan's lead cap. The quota extension would stop the
  // insert anyway, but only once the import was already part-way through —
  // this way the customer is told up front, with the number of slots left.
  await assertHeadroom(getTenantClient(requireTenant().schemaName), 'maxLeads', records.length)

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  // Process in chunks of 100
  const chunkSize = 100
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)

    for (const row of chunk) {
      try {
        if (!row.name) { skipped++; continue }

        // Check duplicate by email or mobile
        if (row.email || row.mobile) {
          const exists = await prisma.lead.findFirst({
            where: {
              OR: [
                ...(row.email ? [{ email: row.email }] : []),
                ...(row.mobile ? [{ mobile: row.mobile }] : []),
              ],
              trash: 0,
            },
          })
          if (exists) { skipped++; continue }
        }

        await prisma.lead.create({
          data: {
            name: row.name,
            email: row.email || null,
            mobile: row.mobile || null,
            mobile2: row.mobile2 || null,
            city: row.city || null,
            state: row.state || null,
            country: row.country || null,
            intrestedCourse: row.intrestedCourse || null,
            source: row.source || null,
            website: row.website || 'other',
            neetscore: row.neetscore || null,
            comment: row.comment || null,
            userId: BigInt(userId),
            departmentId: BigInt(2),
            leadType: 'new',
          },
        })

        imported++
      } catch (err) {
        errors.push(`Row ${i + 1}: ${(err as Error).message}`)
      }
    }
  }

  return { imported, skipped, errors }
}

export function exportLeadsToCsv(leads: Record<string, unknown>[]): string {
  if (leads.length === 0) return ''

  return stringify(leads, {
    header: true,
    columns: Object.keys(leads[0]),
  })
}
