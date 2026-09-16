import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const admins = await prisma.user.findMany({
    where: {
      OR: [
        { role: 'admin' },
        { roles: { some: { role: 'admin' } } }
      ]
    },
    select: {
      id: true,
      name: true,
      email: true,
      loginid: true,
      role: true,
      roles: true
    }
  })

  console.log('Current Admins:', JSON.stringify(admins, (key, value) =>
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
