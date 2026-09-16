import { prisma } from '../src/lib/prisma'
import * as fs from 'fs'
const CASCADE = 'COALESCE(ss.move_to, ss.department_id, s.department_id)'
const out = process.argv[2]
async function main() {
  const parts: string[] = ['-- Rollback for lead-workflow repair. Run to restore pre-repair state.', 'BEGIN;']

  const leads: any[] = await prisma.$queryRawUnsafe(`
    SELECT l.id, l.department_id FROM leads l
    JOIN lead_statuses s ON s.id = l.lead_status_id
    LEFT JOIN lead_sub_statuses ss ON ss.id = l.lead_sub_status_id
    LEFT JOIN lead_departments ldept ON ldept.id = l.department_id
    WHERE l.trash = 0 AND l.lead_status_id IS NOT NULL AND ldept.slug <> 'archive'
      AND l.department_id IS DISTINCT FROM ${CASCADE}`)
  for (const r of leads) parts.push(`UPDATE leads SET department_id = ${r.department_id} WHERE id = ${r.id};`)

  const asg: any[] = await prisma.$queryRawUnsafe(`
    SELECT al.id, al.department_id, al.status_lead_type_id
    FROM asigned_leads al JOIN leads l ON l.id = al.std_id
    WHERE al.status = 1 AND l.trash = 0
      AND al.department_id IS DISTINCT FROM l.department_id`)
  for (const r of asg) parts.push(
    `UPDATE asigned_leads SET department_id = ${r.department_id ?? 'NULL'}, status_lead_type_id = ${r.status_lead_type_id ?? 'NULL'} WHERE id = ${r.id};`)

  const lt: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, lead_type FROM leads
    WHERE trash = 0 AND lead_type ~ '^[0-9]+$'
      AND EXISTS (SELECT 1 FROM lead_departments d WHERE d.id::text = leads.lead_type)
      AND NOT EXISTS (SELECT 1 FROM lead_types t WHERE t.id::text = leads.lead_type)`)
  for (const r of lt) parts.push(`UPDATE leads SET lead_type = '${r.lead_type}' WHERE id = ${r.id};`)

  parts.push('COMMIT;')
  fs.writeFileSync(out, parts.join('\n'), 'utf8')
  console.log(`backed up: ${leads.length} lead depts, ${asg.length} assignment rows, ${lt.length} lead_type values`)
  console.log(`rollback file: ${out}`)
  await prisma.$disconnect()
}
main()
