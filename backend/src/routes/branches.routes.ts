import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

export const branchesRoutes = new Hono()

branchesRoutes.use('*', authenticate)

// GET /api/branches
branchesRoutes.get('/', async (c) => {
  const branches = await prisma.branch.findMany({
    where: { status: 1 },
    orderBy: { name: 'asc' },
  })
  return c.json(branches)
})

// POST /api/branches (admin only)
branchesRoutes.post('/', adminOnly, async (c) => {
  const { name, city, state, country } = await c.req.json()
  const branch = await prisma.branch.create({
    data: { name, city, state, country },
  })
  return c.json(branch, 201)
})

// PATCH /api/branches/:id (admin only)
branchesRoutes.patch('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  delete body.id
  const branch = await prisma.branch.update({ where: { id }, data: body })
  return c.json(branch)
})

// DELETE /api/branches/:id (admin only)
branchesRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.branch.update({ where: { id }, data: { status: 0 } })
  return c.json({ message: 'Branch deactivated' })
})
