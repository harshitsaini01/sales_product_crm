import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly, counsellorAndAbove } from '../middleware/rbac'

export const announcementsRoutes = new Hono()

announcementsRoutes.use('*', authenticate)

// GET /api/announcements — includes per-user readByMe / readAt so the popup
// and dashboard widget can mark items "Read" without a second round-trip.
announcementsRoutes.get('/', async (c) => {
  const { userId } = c.get('user')
  const me = BigInt(userId)
  const announcements = await prisma.announcement.findMany({
    where: { status: 1 },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      reads: { where: { userId: me }, select: { readAt: true } },
    },
  })
  return c.json(
    announcements.map(({ reads, ...a }) => ({
      ...a,
      readByMe: reads.length > 0,
      readAt: reads[0]?.readAt ?? null,
    })),
  )
})

// POST /api/announcements — admin, sub-admin, sales-head, counsellor.
// Edit/Delete stay admin-only so counsellors can post but can't alter
// announcements after the fact (their own or anyone else's).
announcementsRoutes.post('/', counsellorAndAbove, async (c) => {
  const { userId } = c.get('user')
  const { title, description } = await c.req.json()

  const ann = await prisma.announcement.create({
    data: { title, description, userId: BigInt(userId) },
  })
  return c.json(ann, 201)
})

// POST /api/announcements/:id/read — current user acknowledges the announcement.
// Idempotent via the (announcement_id, user_id) unique index.
announcementsRoutes.post('/:id/read', async (c) => {
  const { userId } = c.get('user')
  const announcementId = BigInt(c.req.param('id'))
  const me = BigInt(userId)

  const row = await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId: me } },
    create: { announcementId, userId: me },
    update: {},
  })
  return c.json({ readAt: row.readAt })
})

// PATCH /api/announcements/:id (admin only)
announcementsRoutes.patch('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const ann = await prisma.announcement.update({
    where: { id },
    data: { title: body.title, description: body.description },
  })
  return c.json(ann)
})

// DELETE /api/announcements/:id (admin only)
announcementsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.announcement.update({ where: { id }, data: { status: 0 } })
  return c.json({ message: 'Deleted' })
})
