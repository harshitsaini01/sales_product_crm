import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Check if already seeded
  const existing = await prisma.appRelease.findFirst({ where: { versionCode: 1 } })
  if (existing) {
    console.log('App release v1.0.0 already exists, skipping.')
    return
  }

  const release = await prisma.appRelease.create({
    data: {
      versionCode: 1,
      versionName: '1.0.0',
      fileUrl: 'uploads/app-releases/tutelage-counsellor-1.0.0.apk',
      sha256: '8cbd399808cffdd31286ffb454c00e4e3847cc50c46823f75ad568beb434482f',
      sizeBytes: 23223115,
      releaseNotes: 'Initial release of Tutelage CRM Counsellor App.\n\n• Lead management & follow-ups\n• Call logging & recording\n• Push notifications\n• Dashboard overview',
      isMandatory: false,
      uploadedBy: BigInt(1), // admin user
    },
  })

  console.log('✅ App release seeded:', {
    id: Number(release.id),
    versionCode: release.versionCode,
    versionName: release.versionName,
  })
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
