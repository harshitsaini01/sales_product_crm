import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'

export const eventsRoutes = new Hono()

eventsRoutes.use('*', authenticate)

eventsRoutes.get('/', async (c) => {
  const { userId, role } = c.get('user')
  const { from, to, counsellorId } = c.req.query()
  
  let targetUserId = BigInt(userId)
  if (counsellorId && (role === 'admin' || role === 'sub-admin')) {
    targetUserId = BigInt(counsellorId)
  }

  const events = await prisma.event.findMany({
    where: {
      userId: targetUserId,
      ...(from ? { startDate: { gte: new Date(from) } } : {}),
      ...(to ? { startDate: { lte: new Date(to) } } : {}),
    },
    orderBy: { startDate: 'asc' },
  })

  return c.json(events)
})

eventsRoutes.post('/', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()

  const event = await prisma.event.create({
    data: { ...body, userId: BigInt(userId), startDate: new Date(body.startDate) },
  })

  return c.json(event, 201)
})

eventsRoutes.delete('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.event.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})
