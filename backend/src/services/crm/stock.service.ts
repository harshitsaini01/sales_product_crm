// Dual-state inventory: on-hand vs reserved. ATP = on-hand - reserved.
// Every fluctuation writes an immutable StockMovement row.

import { prisma } from '../../lib/prisma'
import { Prisma } from '@prisma/client'

export const MOVEMENT = {
  RESTOCK: 'RESTOCK',
  TRANSFER: 'TRANSFER',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
  DISPATCH: 'DISPATCH',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  SAMPLE: 'SAMPLE',
} as const

export type MovementType = (typeof MOVEMENT)[keyof typeof MOVEMENT]

export function atp(onHand: number, reserved: number): number {
  return Math.round((onHand - reserved) * 1000) / 1000
}

export function stockStatus(onHand: number, reserved: number, minLevel: number): 'in_stock' | 'low_stock' | 'out_of_stock' {
  const available = atp(onHand, reserved)
  if (available <= 0) return 'out_of_stock'
  if (available <= minLevel) return 'low_stock'
  return 'in_stock'
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

export function serializeProduct<T extends {
  stockQuantity?: unknown
  reservedQuantity?: unknown
  minStockLevel?: unknown
  unitPrice?: unknown
  costPrice?: unknown
  minSellingPrice?: unknown
  taxPercent?: unknown
}>(row: T) {
  const onHand = n(row.stockQuantity)
  const reserved = n(row.reservedQuantity)
  const min = n(row.minStockLevel)
  return {
    ...row,
    stockQuantity: onHand,
    reservedQuantity: reserved,
    minStockLevel: min,
    available: atp(onHand, reserved),
    stockStatus: stockStatus(onHand, reserved, min),
    unitPrice: row.unitPrice == null ? null : n(row.unitPrice),
    costPrice: n(row.costPrice),
    minSellingPrice: row.minSellingPrice == null ? null : n(row.minSellingPrice),
    taxPercent: row.taxPercent == null ? null : n(row.taxPercent),
  }
}

interface MoveInput {
  productId: bigint
  quantity: number
  movementType: MovementType
  referenceType?: string | null
  referenceId?: bigint | null
  notes?: string | null
  createdById?: bigint | null
  branchId?: bigint | null
  allowBackorder?: boolean
}

/**
 * Apply one movement. Kits explode to components (reserve/dispatch/release/return
 * hit the children, not the kit's own stock).
 */
export async function move(input: MoveInput): Promise<void> {
  const qty = Math.abs(Number(input.quantity) || 0)
  if (!qty) return

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { kitComponents: true },
  })
  if (!product) throw Object.assign(new Error('Product not found'), { status: 404 })

  if (product.isKit && product.kitComponents.length) {
    for (const part of product.kitComponents) {
      await move({
        ...input,
        productId: part.componentId,
        quantity: qty * n(part.quantity),
      })
    }
    return
  }

  const sign = input.movementType === MOVEMENT.RELEASE || input.movementType === MOVEMENT.RESTOCK || input.movementType === MOVEMENT.RETURN
    ? 1
    : input.movementType === MOVEMENT.RESERVE || input.movementType === MOVEMENT.DISPATCH || input.movementType === MOVEMENT.SAMPLE
      ? -1
      : input.movementType === MOVEMENT.ADJUSTMENT
        ? (input.quantity < 0 ? -1 : 1)
        : 1

  await prisma.$transaction(async (tx) => {
    const row = await tx.product.findUnique({ where: { id: input.productId } })
    if (!row) throw Object.assign(new Error('Product not found'), { status: 404 })

    let onHand = n(row.stockQuantity)
    let reserved = n(row.reservedQuantity)
    const previous = onHand

    switch (input.movementType) {
      case MOVEMENT.RESERVE: {
        const available = atp(onHand, reserved)
        if (available < qty && !row.allowBackorder && !input.allowBackorder) {
          throw Object.assign(
            new Error(`Only ${available} of "${row.name}" available to promise.`),
            { status: 409 },
          )
        }
        reserved += qty
        break
      }
      case MOVEMENT.RELEASE:
        reserved = Math.max(0, reserved - qty)
        break
      case MOVEMENT.DISPATCH:
        reserved = Math.max(0, reserved - qty)
        onHand = Math.max(0, onHand - qty)
        break
      case MOVEMENT.SAMPLE:
        onHand = Math.max(0, onHand - qty)
        break
      case MOVEMENT.RETURN:
      case MOVEMENT.RESTOCK:
        onHand += qty
        break
      case MOVEMENT.TRANSFER:
        onHand = Math.max(0, onHand - qty)
        break
      case MOVEMENT.ADJUSTMENT:
        onHand = Math.max(0, onHand + input.quantity)
        break
      default:
        onHand = Math.max(0, onHand + sign * qty)
    }

    await tx.product.update({
      where: { id: input.productId },
      data: {
        stockQuantity: new Prisma.Decimal(onHand),
        reservedQuantity: new Prisma.Decimal(reserved),
      },
    })

    if (input.branchId) {
      const branchRow = await tx.productBranchStock.findUnique({
        where: { productId_branchId: { productId: input.productId, branchId: input.branchId } },
      })
      let bOn = n(branchRow?.stockQuantity)
      let bRes = n(branchRow?.reservedQuantity)
      switch (input.movementType) {
        case MOVEMENT.RESERVE:
          bRes += qty
          break
        case MOVEMENT.RELEASE:
          bRes = Math.max(0, bRes - qty)
          break
        case MOVEMENT.DISPATCH:
          bRes = Math.max(0, bRes - qty)
          bOn = Math.max(0, bOn - qty)
          break
        case MOVEMENT.SAMPLE:
        case MOVEMENT.TRANSFER:
          bOn = Math.max(0, bOn - qty)
          break
        case MOVEMENT.RETURN:
        case MOVEMENT.RESTOCK:
          bOn += qty
          break
        case MOVEMENT.ADJUSTMENT:
          bOn = Math.max(0, bOn + input.quantity)
          break
        default:
          break
      }
      await tx.productBranchStock.upsert({
        where: { productId_branchId: { productId: input.productId, branchId: input.branchId } },
        create: {
          productId: input.productId,
          branchId: input.branchId,
          stockQuantity: new Prisma.Decimal(bOn),
          reservedQuantity: new Prisma.Decimal(bRes),
        },
        update: {
          stockQuantity: new Prisma.Decimal(bOn),
          reservedQuantity: new Prisma.Decimal(bRes),
        },
      })
    }

    await tx.stockMovement.create({
      data: {
        productId: input.productId,
        branchId: input.branchId ?? null,
        movementType: input.movementType,
        quantity: new Prisma.Decimal(qty),
        previousStock: new Prisma.Decimal(previous),
        newStock: new Prisma.Decimal(onHand),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
      },
    })
  })
}

export async function reserveLines(
  lines: { productId?: bigint | null; quantity: number }[],
  ref: { type: string; id: bigint },
  actorId?: bigint | null,
) {
  for (const line of lines) {
    if (!line.productId) continue
    await move({
      productId: line.productId,
      quantity: line.quantity,
      movementType: MOVEMENT.RESERVE,
      referenceType: ref.type,
      referenceId: ref.id,
      createdById: actorId,
    })
  }
}

export async function releaseLines(
  lines: { productId?: bigint | null; quantity: number }[],
  ref: { type: string; id: bigint },
  actorId?: bigint | null,
) {
  for (const line of lines) {
    if (!line.productId) continue
    await move({
      productId: line.productId,
      quantity: line.quantity,
      movementType: MOVEMENT.RELEASE,
      referenceType: ref.type,
      referenceId: ref.id,
      createdById: actorId,
    })
  }
}

export async function dispatchLines(
  lines: { productId?: bigint | null; quantity: number }[],
  ref: { type: string; id: bigint },
  actorId?: bigint | null,
) {
  for (const line of lines) {
    if (!line.productId) continue
    await move({
      productId: line.productId,
      quantity: line.quantity,
      movementType: MOVEMENT.DISPATCH,
      referenceType: ref.type,
      referenceId: ref.id,
      createdById: actorId,
    })
  }
}

export async function returnLines(
  lines: { productId?: bigint | null; quantity: number }[],
  ref: { type: string; id: bigint },
  actorId?: bigint | null,
) {
  for (const line of lines) {
    if (!line.productId) continue
    await move({
      productId: line.productId,
      quantity: line.quantity,
      movementType: MOVEMENT.RETURN,
      referenceType: ref.type,
      referenceId: ref.id,
      createdById: actorId,
    })
  }
}

export function belowFloor(unitPrice: number, minSellingPrice: number | null | undefined): boolean {
  if (minSellingPrice == null) return false
  return unitPrice + 1e-9 < Number(minSellingPrice)
}
