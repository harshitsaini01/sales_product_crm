import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(__dirname, '.env') })

const prisma = new PrismaClient()

async function main() {
  console.log('Using URL:', process.env.DATABASE_URL)
  const users = await prisma.user.findMany({
    take: 5,
    select: {
      id: true,
      name: true,
      email: true,
      loginid: true,
      role: true
    }
  })

  console.log('Users:', JSON.stringify(users, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
  , 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
