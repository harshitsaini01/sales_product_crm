// Resolve a unit price: account price list (qty break) → catalog.

import { prisma } from '../../lib/prisma'
import { belowFloor } from './stock.service'

const n = (v: unknown) => (v == null ? 0 : Number(v))

export interface ResolvedPrice {
  unitPrice: number
  minSellingPrice: number | null
  source: 'price_list' | 'catalog'
  priceListId: number | null
  minQty: number
  belowFloor: boolean
}

export async function resolvePrice(
  productId: bigint,
  quantity: number,
  accountId?: bigint | null,
): Promise<ResolvedPrice> {
  const qty = Math.max(n(quantity) || 1, 0.001)
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { unitPrice: true, minSellingPrice: true },
  })
  const catalog = n(product?.unitPrice)
  const catalogFloor = product?.minSellingPrice == null ? null : n(product.minSellingPrice)

  let priceListId: bigint | null = null
  if (accountId) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { priceListId: true },
    })
    priceListId = account?.priceListId ?? null
  }

  if (priceListId) {
    const breaks = await prisma.priceListItem.findMany({
      where: { priceListId, productId, minQty: { lte: qty } },
      orderBy: { minQty: 'desc' },
      take: 1,
    })
    const hit = breaks[0]
    if (hit) {
      const unitPrice = n(hit.unitPrice)
      const floor = hit.minSellingPrice != null ? n(hit.minSellingPrice) : catalogFloor
      return {
        unitPrice,
        minSellingPrice: floor,
        source: 'price_list',
        priceListId: Number(priceListId),
        minQty: n(hit.minQty),
        belowFloor: belowFloor(unitPrice, floor),
      }
    }
  }

  return {
    unitPrice: catalog,
    minSellingPrice: catalogFloor,
    source: 'catalog',
    priceListId: priceListId ? Number(priceListId) : null,
    minQty: 1,
    belowFloor: belowFloor(catalog, catalogFloor),
  }
}

/**
 * SKUs frequently bought with this account's history that they have not
 * ordered recently — "next best" for the 360 and a replenish call.
 */
export async function nextBestSkus(accountId: bigint, take = 5) {
  const lines = await prisma.orderItem.findMany({
    where: { order: { accountId, status: { not: 'cancelled' } }, productId: { not: null } },
    select: { productId: true, name: true, sku: true, quantity: true, orderId: true },
  })
  const bought = new Set(lines.map((l) => String(l.productId)))
  const orderIds = [...new Set(lines.map((l) => String(l.orderId)))].map((id) => BigInt(id))
  if (!orderIds.length) {
    const popular = await prisma.product.findMany({
      where: { active: true, unitPrice: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, name: true, sku: true, unitPrice: true, imageUrl: true },
    })
    return popular.map((p) => ({
      productId: Number(p.id),
      name: p.name,
      sku: p.sku,
      unitPrice: n(p.unitPrice),
      imageUrl: p.imageUrl,
      reason: 'catalog',
    }))
  }

  const companions = await prisma.orderItem.findMany({
    where: { orderId: { in: orderIds }, productId: { not: null } },
    select: { productId: true, name: true, sku: true },
  })
  const score = new Map<string, { productId: bigint; name: string; sku: string | null; n: number }>()
  for (const row of companions) {
    if (!row.productId || bought.has(String(row.productId))) continue
    const key = String(row.productId)
    const cur = score.get(key) || { productId: row.productId, name: row.name, sku: row.sku, n: 0 }
    cur.n += 1
    score.set(key, cur)
  }

  const ranked = [...score.values()].sort((a, b) => b.n - a.n).slice(0, take)
  if (!ranked.length) {
    const extras = await prisma.product.findMany({
      where: { active: true, id: { notIn: [...bought].map((id) => BigInt(id)) } },
      take,
      select: { id: true, name: true, sku: true, unitPrice: true, imageUrl: true },
    })
    return extras.map((p) => ({
      productId: Number(p.id),
      name: p.name,
      sku: p.sku,
      unitPrice: n(p.unitPrice),
      imageUrl: p.imageUrl,
      reason: 'catalog',
    }))
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ranked.map((r) => r.productId) } },
    select: { id: true, unitPrice: true, imageUrl: true, active: true },
  })
  const byId = new Map(products.map((p) => [String(p.id), p]))
  return ranked
    .filter((r) => byId.get(String(r.productId))?.active !== false)
    .map((r) => {
      const p = byId.get(String(r.productId))
      return {
        productId: Number(r.productId),
        name: r.name,
        sku: r.sku,
        unitPrice: n(p?.unitPrice),
        imageUrl: p?.imageUrl ?? null,
        reason: 'bought_together',
      }
    })
}
