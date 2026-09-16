import { prisma } from '../lib/prisma'
import { bigintFix } from '../utils/bigint-fix'

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────
export async function getAll(role?: string) {
  const where: Record<string, unknown> = { status: 1 }
  const announcements = await prisma.announcement.findMany({
    where,
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return bigintFix(announcements)
}

export async function create(data: { title: string; description?: string; userId: number }) {
  const ann = await prisma.announcement.create({
    data: { title: data.title, description: data.description || null, userId: BigInt(data.userId), status: 1 },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  return bigintFix(ann)
}

export async function update(id: bigint, data: Record<string, unknown>) {
  delete data.userId
  const ann = await prisma.announcement.update({ where: { id }, data })
  return bigintFix(ann)
}

export async function deleteAnnouncement(id: bigint) {
  await prisma.announcement.update({ where: { id }, data: { status: 0 } })
}
