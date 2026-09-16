import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'

export const remindersRoutes = new Hono()

remindersRoutes.use('*', authenticate)

// GET /api/reminders?leadId=xxx
remindersRoutes.get('/', async (c) => {
  const leadId = c.req.query('leadId')
  const user = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(user.role)

  const where: Record<string, unknown> = {}
  if (leadId) where.leadId = BigInt(leadId)
  if (!isAdmin) where.userId = BigInt(user.userId)

  const reminders = await prisma.reminder.findMany({
    where,
    orderBy: { reminderDate: 'asc' },
    include: { lead: { select: { id: true, name: true, mobile: true } } },
  })

  return c.json(reminders)
})

// GET /api/reminders/upcoming
remindersRoutes.get('/upcoming', async (c) => {
  const user = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(user.role)
  const today = new Date()
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)

  const where: Record<string, unknown> = {
    reminderDate: { gte: today, lte: nextWeek },
    status: 0,
  }
  if (!isAdmin) where.userId = BigInt(user.userId)

  const reminders = await prisma.reminder.findMany({
    where,
    orderBy: { reminderDate: 'asc' },
    include: { lead: { select: { id: true, name: true, mobile: true } } },
  })

  return c.json(reminders)
})

// POST /api/reminders
remindersRoutes.post('/', async (c) => {
  const { leadId, reminderDate, note } = await c.req.json()
  const { userId } = c.get('user')

  const reminder = await prisma.reminder.create({
    data: {
      leadId: BigInt(leadId),
      userId: BigInt(userId),
      reminderDate: new Date(reminderDate),
      note,
    },
    include: { lead: { select: { id: true, name: true } } },
  })

  return c.json(reminder, 201)
})

// DELETE /api/reminders/:id
remindersRoutes.delete('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(user.role)

  const reminder = await prisma.reminder.findUnique({ where: { id } })
  if (!reminder) return c.json({ error: 'Not found' }, 404)

  // Counsellors can only delete their own reminders
  if (!isAdmin && Number(reminder.userId) !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await prisma.reminder.delete({ where: { id } })
  return c.json({ message: 'Reminder deleted' })
})
