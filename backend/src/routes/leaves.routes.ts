import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

export const leavesRoutes = new Hono()

leavesRoutes.use('*', authenticate)

// GET /api/leaves
leavesRoutes.get('/', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)

  const leaves = await prisma.employeeLeave.findMany({
    where: isAdmin ? {} : { userId: BigInt(userId) },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true, designation: true } } },
  })

  return c.json(leaves)
})

// POST /api/leaves (counsellor submits)
leavesRoutes.post('/', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()

  const leave = await prisma.employeeLeave.create({
    data: {
      userId: BigInt(userId),
      fromDate: new Date(body.fromDate),
      toDate: new Date(body.toDate),
      reason: body.reason,
      status: 'pending',
    },
  })

  return c.json(leave, 201)
})

// PATCH /api/leaves/:id (update own pending leave)
leavesRoutes.patch('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  const body = await c.req.json()

  const leave = await prisma.employeeLeave.findUnique({ where: { id } })
  if (!leave) return c.json({ error: 'Not found' }, 404)
  if (Number(leave.userId) !== userId) return c.json({ error: 'Forbidden' }, 403)
  if (leave.status !== 'pending') return c.json({ error: 'Cannot edit a reviewed leave' }, 400)

  const updated = await prisma.employeeLeave.update({
    where: { id },
    data: { fromDate: new Date(body.fromDate), toDate: new Date(body.toDate), reason: body.reason },
  })

  return c.json(updated)
})

// PATCH /api/leaves/:id/review (admin approves/rejects)
leavesRoutes.patch('/:id/review', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  const { status, approvalNote } = await c.req.json()

  if (!['approved', 'rejected'].includes(status)) {
    return c.json({ error: 'Status must be approved or rejected' }, 400)
  }

  const leave = await prisma.employeeLeave.update({
    where: { id },
    data: { status, approvedBy: BigInt(userId), approvalNote },
  })

  return c.json(leave)
})
