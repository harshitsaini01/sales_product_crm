import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'

// ─── LEAD TYPES ───────────────────────────────────────────────────────────────
export async function getLeadTypes(departmentId?: number) {
  const where: Record<string, unknown> = {}
  if (departmentId) where.departmentId = BigInt(departmentId)

  const types = await prisma.leadTypeConfig.findMany({
    where,
    orderBy: { priority: 'asc' },
  })
  return bigintFix(types)
}

export async function createLeadType(data: { title: string; slug: string; departmentId?: number; priority?: number }) {
  const type = await prisma.leadTypeConfig.create({
    data: {
      title: data.title,
      slug: data.slug,
      departmentId: data.departmentId ? BigInt(data.departmentId) : null,
      priority: data.priority || 0,
    },
  })
  return bigintFix(type)
}

export async function updateLeadType(id: bigint, data: Record<string, unknown>) {
  if (data.departmentId) data.departmentId = BigInt(data.departmentId as number)
  const type = await prisma.leadTypeConfig.update({ where: { id }, data })
  return bigintFix(type)
}

export async function deleteLeadType(id: bigint) {
  await prisma.leadTypeConfig.delete({ where: { id } })
}

// ─── LEAD DEPARTMENTS ─────────────────────────────────────────────────────────
export async function getDepartments() {
  const departments = await prisma.leadDepartment.findMany({
    where: { status: 1 },
    orderBy: { priority: 'asc' },
  })
  return bigintFix(departments)
}

export async function createDepartment(data: { name: string; slug: string; priority?: number }) {
  const dept = await prisma.leadDepartment.create({
    data: { name: data.name, slug: data.slug, priority: data.priority || 0 },
  })
  return bigintFix(dept)
}

export async function updateDepartment(id: bigint, data: Record<string, unknown>) {
  const dept = await prisma.leadDepartment.update({ where: { id }, data })
  return bigintFix(dept)
}

export async function deleteDepartment(id: bigint) {
  await prisma.leadDepartment.update({ where: { id }, data: { status: 0 } })
}

// ─── LEAD STATUSES ────────────────────────────────────────────────────────────
export async function getStatuses(departmentId?: number) {
  const where: Record<string, unknown> = {}
  if (departmentId) where.departmentId = BigInt(departmentId)

  const statuses = await prisma.leadStatus.findMany({
    where,
    include: { subStatuses: { orderBy: { id: 'asc' } } },
    orderBy: { priority: 'asc' },
  })
  return bigintFix(statuses)
}

export async function createStatus(data: {
  title: string
  slug: string
  departmentId: number
  priority?: number
  moveTo?: string
}) {
  const status = await prisma.leadStatus.create({
    data: {
      title: data.title,
      slug: data.slug,
      departmentId: BigInt(data.departmentId),
      priority: data.priority || 0,
      moveTo: data.moveTo || null,
    },
  })
  return bigintFix(status)
}

export async function updateStatus(id: bigint, data: Record<string, unknown>) {
  if (data.departmentId) data.departmentId = BigInt(data.departmentId as number)
  const status = await prisma.leadStatus.update({ where: { id }, data })
  return bigintFix(status)
}

export async function deleteStatus(id: bigint) {
  await prisma.leadStatus.delete({ where: { id } })
}

// ─── LEAD SUB-STATUSES ────────────────────────────────────────────────────────
export async function getSubStatuses(statusId?: number, departmentId?: number) {
  const where: Record<string, unknown> = {}
  if (statusId) where.statusId = BigInt(statusId)
  if (departmentId) where.departmentId = BigInt(departmentId)

  const subStatuses = await prisma.leadSubStatus.findMany({
    where,
    include: { status: { select: { id: true, title: true } } },
    orderBy: { id: 'asc' },
  })
  return bigintFix(subStatuses)
}

export async function createSubStatus(data: {
  statusId: number
  subStatus: string
  subStatusSlug: string
  moveTo?: number
  departmentId?: number
  statusLeadTypeId?: number
}) {
  const subStatus = await prisma.leadSubStatus.create({
    data: {
      statusId: BigInt(data.statusId),
      subStatus: data.subStatus,
      subStatusSlug: data.subStatusSlug,
      moveTo: data.moveTo ? BigInt(data.moveTo) : null,
      departmentId: data.departmentId ? BigInt(data.departmentId) : null,
      statusLeadTypeId: data.statusLeadTypeId ? BigInt(data.statusLeadTypeId) : null,
    },
  })
  return bigintFix(subStatus)
}

export async function updateSubStatus(id: bigint, data: Record<string, unknown>) {
  if (data.statusId) data.statusId = BigInt(data.statusId as number)
  if (data.moveTo) data.moveTo = BigInt(data.moveTo as number)
  if (data.departmentId) data.departmentId = BigInt(data.departmentId as number)
  if (data.statusLeadTypeId) data.statusLeadTypeId = BigInt(data.statusLeadTypeId as number)
  const subStatus = await prisma.leadSubStatus.update({ where: { id }, data })
  return bigintFix(subStatus)
}

export async function deleteSubStatus(id: bigint) {
  await prisma.leadSubStatus.delete({ where: { id } })
}

// ─── LEAD FOLLOWUP STATUSES ───────────────────────────────────────────────────
export async function getFollowupStatuses() {
  const statuses = await prisma.leadFollowupStatus.findMany({ orderBy: { id: 'asc' } })
  return bigintFix(statuses)
}

export async function createFollowupStatus(data: { status: string; shortnote?: string }) {
  const fs = await prisma.leadFollowupStatus.create({ data: { status: data.status, shortnote: data.shortnote || null } })
  return bigintFix(fs)
}

export async function updateFollowupStatus(id: bigint, data: Record<string, unknown>) {
  const fs = await prisma.leadFollowupStatus.update({ where: { id }, data })
  return bigintFix(fs)
}

export async function deleteFollowupStatus(id: bigint) {
  await prisma.leadFollowupStatus.delete({ where: { id } })
}
