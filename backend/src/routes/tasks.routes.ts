import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { bigintFix } from '../utils/bigint-fix'

export const tasksRoutes = new Hono()

tasksRoutes.use('*', authenticate)

// GET /api/tasks
tasksRoutes.get('/', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)

  const tasks = await prisma.task.findMany({
    where: isAdmin
      ? {}
      : {
          OR: [
            { assignedToId: BigInt(userId) },
            { assignedById: BigInt(userId) },
          ],
        },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  })

  return c.json(bigintFix(tasks))
})

// POST /api/tasks
// Admin can assign to anyone; counsellor can only self-assign.
tasksRoutes.post('/', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const body = await c.req.json()

  const assignedToId = isAdmin ? Number(body.assignedToId) : userId
  if (!assignedToId) return c.json({ error: 'assignedToId required' }, 400)
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400)

  const task = await prisma.task.create({
    data: {
      title: body.title,
      description: body.description,
      assignedById: BigInt(userId),
      assignedToId: BigInt(assignedToId),
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      priority: body.priority || 'medium',
    },
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  })

  return c.json(bigintFix(task), 201)
})

// PATCH /api/tasks/:id
// Assignee can toggle status; creator (or admin) can edit all fields.
tasksRoutes.patch('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const body = await c.req.json()

  const task = await prisma.task.findUnique({ where: { id } })
  if (!task) return c.json({ error: 'Not found' }, 404)

  const isAssignee = Number(task.assignedToId) === userId
  const isCreator = Number(task.assignedById) === userId
  if (!isAdmin && !isAssignee && !isCreator) return c.json({ error: 'Forbidden' }, 403)

  const canEditAll = isAdmin || isCreator

  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(canEditAll
        ? {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.dueDate !== undefined
              ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
              : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(isAdmin && body.assignedToId !== undefined
              ? { assignedToId: BigInt(body.assignedToId) }
              : {}),
          }
        : {}),
    },
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  })

  return c.json(bigintFix(updated))
})

// DELETE /api/tasks/:id (admin or creator)
tasksRoutes.delete('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)

  const task = await prisma.task.findUnique({ where: { id } })
  if (!task) return c.json({ error: 'Not found' }, 404)
  if (!isAdmin && Number(task.assignedById) !== userId)
    return c.json({ error: 'Forbidden' }, 403)

  await prisma.task.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})
