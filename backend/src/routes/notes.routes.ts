import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

import { recordLeadEntry } from '../services/crm/lead-activity.service'

export const notesRoutes = new Hono()

notesRoutes.use('*', authenticate)

// GET /api/notes?leadId=xxx
notesRoutes.get('/', async (c) => {
  const leadId = c.req.query('leadId')
  if (!leadId) return c.json({ error: 'leadId required' }, 400)

  const notes = await prisma.leadNote.findMany({
    where: { leadId: BigInt(leadId) },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  })

  return c.json(notes)
})

// POST /api/notes
notesRoutes.post('/', async (c) => {
  const { leadId, note } = await c.req.json()
  const { userId } = c.get('user')

  const created = await prisma.leadNote.create({
    data: {
      leadId: BigInt(leadId),
      userId: BigInt(userId),
      note,
    },
    include: { user: { select: { id: true, name: true } } },
  })

  await recordLeadEntry({
    kind: 'note',
    leadId: created.leadId,
    entryId: created.id,
    body: created.note,
    actorId: userId,
    occurredAt: created.createdAt,
  })

  // Lead score: +1 per note added.
  await prisma.lead.update({
    where: { id: BigInt(leadId) },
    data: { leadScore: { increment: 1 } },
  })

  return c.json(created, 201)
})

// DELETE /api/notes/:id (admin only)
notesRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadNote.delete({ where: { id } })
  return c.json({ message: 'Note deleted' })
})
