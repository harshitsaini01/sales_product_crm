/**
 * Seed the starter product catalog (24 SKUs, 10 free Unsplash photos).
 *
 *   npx tsx scripts/seed-products.ts
 *   npx tsx scripts/seed-products.ts --tenant=acme
 *
 * Without --tenant this writes to the primary schema (public). Idempotent by SKU.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { getTenantBySlug } from '../src/services/tenant.service'
import { runWithTenant } from '../src/lib/tenant-context'
import { prisma } from '../src/lib/prisma'
import { seedProductCatalog, CATALOG_PRODUCTS } from '../src/config/product-catalog-seed'

const slug = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1]

async function main() {
  console.log(`Seeding ${CATALOG_PRODUCTS.length} catalog products (10 shared photos)…`)

  if (slug) {
    const ctx = await getTenantBySlug(slug)
    if (!ctx) {
      console.error(`No customer with the slug "${slug}".`)
      process.exit(1)
    }
    await runWithTenant(ctx, async () => {
      const result = await seedProductCatalog(prisma)
      console.log(`Done in ${ctx.schemaName}: created=${result.created} skipped=${result.skipped}`)
    })
    return
  }

  const db = new PrismaClient()
  try {
    const result = await seedProductCatalog(db)
    console.log(`Done: created=${result.created} skipped=${result.skipped}`)
  } finally {
    await db.$disconnect()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
