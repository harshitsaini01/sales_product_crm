import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(__dirname, '.env') })

const prisma = new PrismaClient()

async function main() {
  console.log('Fixing users_id_seq...')
  try {
    // Get max ID
    const maxUser = await prisma.user.findFirst({
      select: { id: true },
      orderBy: { id: 'desc' }
    })
    
    const nextId = maxUser ? Number(maxUser.id) + 1 : 1
    console.log(`Setting next ID to: ${nextId}`)

    // Reset sequence - assuming table is mapped to 'users' and field is 'id'
    // In Postgres, the sequence is usually 'users_id_seq'
    await prisma.$executeRawUnsafe(`SELECT setval('users_id_seq', ${nextId}, false)`)
    
    console.log('Sequence reset successfully.')
  } catch (error: any) {
    console.error('Error resetting sequence:', error.message)
    console.log('Trying alternative sequence name...')
    try {
      await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users) + 1, false)`)
      console.log('Sequence reset successfully using alternative method.')
    } catch (err2: any) {
      console.error('Final error:', err2.message)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main()
