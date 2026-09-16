import { prisma } from '../src/lib/prisma'

async function main() {
  console.log('Creating whatsapp_templates and whatsapp_template_files tables...')

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'greeting',
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS whatsapp_templates_user_id_idx ON whatsapp_templates(user_id);
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS whatsapp_templates_category_idx ON whatsapp_templates(category);
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whatsapp_template_files (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES whatsapp_templates(id) ON DELETE CASCADE,
      file_path VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(100),
      file_size BIGINT,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS whatsapp_template_files_template_id_idx ON whatsapp_template_files(template_id);
  `)

  console.log('Tables created successfully!')

  // Find an admin user to associate seeded templates with
  const adminUser = await prisma.user.findFirst({
    where: { status: 1 },
    select: { id: true },
  })

  if (!adminUser) {
    console.error('No active user found in database to associate templates with.')
    return
  }

  console.log(`Seeding WhatsApp templates for user ID: ${adminUser.id}...`)

  const sampleTemplates = [
    {
      title: 'Welcome Greeting Template',
      description: 'Hello {{name}}, welcome to Tutelage Study! We are thrilled to guide you on your journey to foreign university admissions. Let us know how we can assist you today.',
      category: 'greeting',
      userId: adminUser.id,
    },
    {
      title: 'University Admission & Course Info',
      description: 'Dear {{name}}, thank you for expressing interest in foreign medical and engineering programs! Please review the attached details and feel free to reach back with any questions.',
      category: 'greeting',
      userId: adminUser.id,
    },
    {
      title: 'Follow-up Consultation Reminder',
      description: 'Hi {{name}}, this is a quick follow-up regarding your study abroad counseling session with Tutelage Study. Please let us know if you are free for a brief call today!',
      category: 'followup',
      userId: adminUser.id,
    },
    {
      title: 'Exclusive Admission Scholarship Offer',
      description: 'Exciting News {{name}}! Early bird scholarships and application fee waivers are currently open for upcoming intakes. Connect with your counselor today to apply!',
      category: 'promotion',
      userId: adminUser.id,
    },
  ]

  for (const tpl of sampleTemplates) {
    // Check if template with same title already exists
    const existing = await prisma.whatsappTemplate.findFirst({
      where: { title: tpl.title },
    })

    if (!existing) {
      await prisma.whatsappTemplate.create({
        data: tpl,
      })
      console.log(`Created sample template: "${tpl.title}"`)
    } else {
      console.log(`Template "${tpl.title}" already exists, skipping.`)
    }
  }

  console.log('WhatsApp templates initialized and seeded successfully!')
}

main()
  .catch((err) => {
    console.error('Error initializing WhatsApp tables:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
