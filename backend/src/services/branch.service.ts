import { prisma } from '../lib/prisma'
import { bigintFix } from '../utils/bigint-fix'

// ─── BRANCHES ─────────────────────────────────────────────────────────────────
export async function getAll() {
  const branches = await prisma.branch.findMany({
    where: { status: 1 },
    include: { users: { select: { id: true, name: true, role: true } } },
    orderBy: { name: 'asc' },
  })
  return bigintFix(branches)
}

export async function create(data: { name: string; city?: string; state?: string; country?: string }) {
  const branch = await prisma.branch.create({ data: { ...data, status: 1 } })
  return bigintFix(branch)
}

export async function update(id: bigint, data: Record<string, unknown>) {
  const branch = await prisma.branch.update({ where: { id }, data })
  return bigintFix(branch)
}

export async function deleteBranch(id: bigint) {
  await prisma.branch.update({ where: { id }, data: { status: 0 } })
}
