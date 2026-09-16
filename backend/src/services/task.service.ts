import { prisma } from '../lib/prisma'
import { bigintFix } from '../utils/bigint-fix'

// ─── GET ALL TASKS ────────────────────────────────────────────────────────────
export async function getAll(userId: number, role: string) {
  const where: Record<string, unknown> = {}
  if (!['admin', 'sub_admin', 'sub-admin'].includes(role)) {
    where.OR = [
      { assignedById: BigInt(userId) },
      { assignedToId: BigInt(userId) },
    ]
  }

  const tasks = await prisma.task.findMany({
    where,
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return bigintFix(tasks)
}

// ─── CREATE TASK ──────────────────────────────────────────────────────────────
export async function create(data: {
  title: string
  description?: string
  assignedById: number
  assignedToId: number
  dueDate?: string
  priority?: string
}) {
  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description || null,
      assignedById: BigInt(data.assignedById),
      assignedToId: BigInt(data.assignedToId),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      priority: data.priority || 'medium',
      status: 0,
    },
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  })
  return bigintFix(task)
}

// ─── COMPLETE TASK ────────────────────────────────────────────────────────────
export async function complete(id: bigint) {
  const task = await prisma.task.update({ where: { id }, data: { status: 1 } })
  return bigintFix(task)
}

// ─── DELETE TASK ──────────────────────────────────────────────────────────────
export async function deleteTask(id: bigint) {
  await prisma.task.delete({ where: { id } })
}

// ─── UPDATE TASK ──────────────────────────────────────────────────────────────
export async function update(id: bigint, data: Record<string, unknown>) {
  const cleaned = { ...data }
  if (cleaned.assignedToId) cleaned.assignedToId = BigInt(cleaned.assignedToId as number)
  if (cleaned.dueDate) cleaned.dueDate = new Date(cleaned.dueDate as string)
  const task = await prisma.task.update({ where: { id }, data: cleaned })
  return bigintFix(task)
}
