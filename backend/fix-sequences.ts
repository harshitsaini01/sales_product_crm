import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Fix all sequence counters that might be out of sync
  const tables = [
    'leads',
    'lead_followups',
    'lead_notes',
    'reminders',
    'users',
    'students',
    'asigned_leads',
    'departments',
    'lead_statuses',
    'lead_sub_statuses',
    'call_logs',
    'chat_messages',
    'notifications',
    'app_releases',
    'tbl_todolist',
  ]

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1
        )
      `)
      console.log(`✅ Fixed sequence for: ${table}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // Some tables may not have a serial sequence (e.g. composite PKs)
      console.log(`⏭️  Skipped ${table}: ${msg.slice(0, 80)}`)
    }
  }

  console.log('\n🎉 All sequences synced!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
