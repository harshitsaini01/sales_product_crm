import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import * as dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '.env') })

const prisma = new PrismaClient()

async function main() {
  const name = 'Admin'
  const email = 'admin@crm.com'
  const loginid = 'admin'
  const password = 'admin@123'

  console.log('Seeding new admin user...')
  
  // Hash the password
  const hashedPassword = await hash(password, 10)

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ loginid }, { email }]
      }
    })

    if (existingUser) {
      console.log(`User with loginid "${loginid}" or email "${email}" already exists. Updating credentials...`)
      const updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: { 
          name,
          email,
          loginid,
          username: loginid,
          password: hashedPassword, 
          role: 'admin', 
          status: 1 
        }
      })
      
      // Ensure role exists in user_roles table
      const existingRole = await prisma.userRole_.findFirst({
        where: { userId: updatedUser.id, role: 'admin' }
      })
      
      if (!existingRole) {
        await prisma.userRole_.create({
          data: { userId: updatedUser.id, role: 'admin' }
        })
      }
      
      console.log('Admin user updated successfully.')
    } else {
      // Create new user
      const user = await prisma.user.create({
        data: {
          name,
          email,
          loginid,
          username: loginid,
          mobile: '0000000000',
          password: hashedPassword,
          role: 'admin',
          status: 1,
        }
      })

      // Add to user_roles table
      await prisma.userRole_.create({
        data: {
          userId: user.id,
          role: 'admin'
        }
      })

      console.log('Admin user created successfully.')
    }

    console.log('-----------------------------------')
    console.log('Login Details:')
    console.log(`Username/Email: ${loginid}`)
    console.log(`Password: ${password}`)
    console.log('-----------------------------------')

  } catch (error) {
    console.error('Error seeding admin user:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
