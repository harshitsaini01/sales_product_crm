import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

export const chatRoutes = new Hono()

chatRoutes.use('*', authenticate)

// GET /api/chat/users - teammates list for the chat sidebar (any authenticated staff)
// Returns each teammate with unread count + last message timestamp, sorted
// so the most recent conversation is on top (WhatsApp-style).
chatRoutes.get('/users', async (c) => {
  const { userId } = c.get('user')
  const myId = BigInt(userId)

  const [users, unreadCounts, lastFrom, lastTo] = await Promise.all([
    prisma.user.findMany({
      where: { id: { not: myId }, status: 1 },
      select: { id: true, name: true, designation: true },
    }),
    prisma.chatMessage.groupBy({
      by: ['fromId'],
      where: { toId: myId, seen: 0 },
      _count: { id: true },
    }),
    prisma.chatMessage.groupBy({
      by: ['fromId'],
      where: { toId: myId },
      _max: { createdAt: true },
    }),
    prisma.chatMessage.groupBy({
      by: ['toId'],
      where: { fromId: myId },
      _max: { createdAt: true },
    }),
  ])

  const unreadMap = new Map(unreadCounts.map((u) => [Number(u.fromId), u._count.id]))

  const lastMessageMap = new Map<number, Date>()
  for (const r of lastFrom) {
    if (r._max.createdAt) lastMessageMap.set(Number(r.fromId), r._max.createdAt)
  }
  for (const r of lastTo) {
    if (!r._max.createdAt) continue
    const otherId = Number(r.toId)
    const existing = lastMessageMap.get(otherId)
    if (!existing || r._max.createdAt > existing) {
      lastMessageMap.set(otherId, r._max.createdAt)
    }
  }

  const result = users.map((u) => {
    const id = Number(u.id)
    const last = lastMessageMap.get(id)
    return {
      id,
      name: u.name,
      designation: u.designation,
      unread: unreadMap.get(id) || 0,
      lastMessageAt: last ? last.toISOString() : null,
    }
  })

  result.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt)
    if (a.lastMessageAt) return -1
    if (b.lastMessageAt) return 1
    return a.name.localeCompare(b.name)
  })

  return c.json(result)
})

// GET /api/chat/messages?withUserId=xxx
chatRoutes.get('/messages', async (c) => {
  const { userId } = c.get('user')
  const withUserId = c.req.query('withUserId')
  if (!withUserId) return c.json({ error: 'withUserId required' }, 400)

  const myId = BigInt(userId)
  const otherId = BigInt(withUserId)

  const messages = await prisma.chatMessage.findMany({
    where: {
      OR: [
        { fromId: myId, toId: otherId },
        { fromId: otherId, toId: myId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  // Mark messages from other user as seen
  await prisma.chatMessage.updateMany({
    where: { fromId: otherId, toId: myId, seen: 0 },
    data: { seen: 1 },
  })

  return c.json(
    messages.map((m) => ({
      ...m,
      id: Number(m.id),
      fromId: Number(m.fromId),
      toId: Number(m.toId),
    })),
  )
})

// POST /api/chat/messages
chatRoutes.post('/messages', async (c) => {
  const { userId } = c.get('user')
  const { toId, message } = await c.req.json()

  const msg = await prisma.chatMessage.create({
    data: {
      fromId: BigInt(userId),
      toId: BigInt(toId),
      message,
    },
  })

  return c.json(
    { ...msg, id: Number(msg.id), fromId: Number(msg.fromId), toId: Number(msg.toId) },
    201,
  )
})

// PATCH /api/chat/messages/seen
chatRoutes.patch('/messages/seen', async (c) => {
  const { userId } = c.get('user')
  const { fromId } = await c.req.json()

  await prisma.chatMessage.updateMany({
    where: { fromId: BigInt(fromId), toId: BigInt(userId), seen: 0 },
    data: { seen: 1 },
  })

  return c.json({ message: 'Marked as seen' })
})

// GET /api/chat/unread-count
chatRoutes.get('/unread-count', async (c) => {
  const { userId } = c.get('user')

  const count = await prisma.chatMessage.count({
    where: { toId: BigInt(userId), seen: 0 },
  })

  return c.json({ count })
})

// PATCH /api/chat/messages/:id/lock (admin only)
chatRoutes.patch('/messages/:id/lock', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const msg = await prisma.chatMessage.findUnique({ where: { id }, select: { locked: true } })
  if (!msg) return c.json({ error: 'Not found' }, 404)

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { locked: msg.locked === 1 ? 0 : 1 },
  })

  return c.json({ id: Number(updated.id), locked: updated.locked })
})
