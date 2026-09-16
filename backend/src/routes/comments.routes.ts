import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

import { recordLeadEntry } from '../services/crm/lead-activity.service'

export const commentsRoutes = new Hono()

commentsRoutes.use('*', authenticate)

// GET /api/comments?leadId=xxx — full comment thread (oldest-first for chat feel)
commentsRoutes.get('/', async (c) => {
  const leadId = c.req.query('leadId')
  if (!leadId) return c.json({ error: 'leadId required' }, 400)

  const comments = await prisma.leadComment.findMany({
    where: { leadId: BigInt(leadId) },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, role: true } } },
  })

  return c.json(comments)
})

// GET /api/comments/last?leadId=xxx — most recent comment (for lead-list preview)
commentsRoutes.get('/last', async (c) => {
  const leadId = c.req.query('leadId')
  if (!leadId) return c.json({ error: 'leadId required' }, 400)

  const last = await prisma.leadComment.findFirst({
    where: { leadId: BigInt(leadId) },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  })

  return c.json(last)
})

// POST /api/comments — add a comment
commentsRoutes.post('/', async (c) => {
  const { leadId, comment } = await c.req.json()
  const { userId } = c.get('user')

  if (!leadId || !comment?.trim()) {
    return c.json({ error: 'leadId and comment required' }, 400)
  }

  const created = await prisma.leadComment.create({
    data: {
      leadId: BigInt(leadId),
      userId: BigInt(userId),
      comment: comment.trim(),
    },
    include: { user: { select: { id: true, name: true, role: true } } },
  })

  // Onto the timeline of this lead, and of the account it became. Without this
  // a converted lead's whole conversation is invisible from the company page.
  await recordLeadEntry({
    kind: 'comment',
    leadId: created.leadId,
    entryId: created.id,
    body: created.comment,
    actorId: userId,
    occurredAt: created.createdAt,
  })

  return c.json(created, 201)
})

// POST /api/comments/bulk — add the same comment to many leads (legacy ajaxAddBulkComment)
commentsRoutes.post('/bulk', async (c) => {
  const { leadIds, comment } = await c.req.json()
  const { userId } = c.get('user')

  if (!Array.isArray(leadIds) || !leadIds.length || !comment?.trim()) {
    return c.json({ error: 'leadIds[] and comment required' }, 400)
  }

  // Taken before the insert so the read-back below cannot pick up somebody
  // else's comment that landed a moment earlier.
  const startedAt = new Date()

  const result = await prisma.leadComment.createMany({
    data: leadIds.map((id: string | number) => ({
      leadId: BigInt(id),
      userId: BigInt(userId),
      comment: comment.trim(),
    })),
  })

  // createMany returns a count, not rows, and the timeline needs each id. Read
  // them back rather than skipping the mirror — a comment added in bulk is
  // still a comment, and leaving those off the timeline would make it lie by
  // omission for exactly the leads somebody touched in a batch.
  const created = await prisma.leadComment.findMany({
    where: {
      leadId: { in: leadIds.map((id: string | number) => BigInt(id)) },
      userId: BigInt(userId),
      comment: comment.trim(),
      createdAt: { gte: startedAt },
    },
    select: { id: true, leadId: true, comment: true, createdAt: true },
  })

  for (const row of created) {
    await recordLeadEntry({
      kind: 'comment',
      leadId: row.leadId,
      entryId: row.id,
      body: row.comment,
      actorId: userId,
      occurredAt: row.createdAt,
    })
  }

  return c.json({ created: result.count })
})

// DELETE /api/comments/:id — admin only (matches legacy deleteComment)
commentsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadComment.delete({ where: { id } })
  return c.json({ message: 'Comment deleted' })
})
