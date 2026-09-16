import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

export const agentsRoutes = new Hono()

agentsRoutes.use('*', authenticate)

// ─── AGENTS ──────────────────────────────────────────────────────────────────

// GET /api/agents
agentsRoutes.get('/', async (c) => {
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return c.json(agents)
})

// POST /api/agents
agentsRoutes.post('/', adminOnly, async (c) => {
  const { name, email, mobile, companyName, address, city, state, country } = await c.req.json()
  const agent = await prisma.agent.create({
    data: { name, email, mobile, companyName, address, city, state, country },
  })
  return c.json(agent, 201)
})

// GET /api/agents/:id
agentsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const agent = await prisma.agent.findUnique({
    where: { id },
  })
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  return c.json(agent)
})

// PATCH /api/agents/:id
agentsRoutes.patch('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const agent = await prisma.agent.update({
    where: { id },
    data: body,
  })
  return c.json(agent)
})

// DELETE /api/agents/:id
agentsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.agent.update({ where: { id }, data: { status: 0 } })
  return c.json({ message: 'Agent deactivated' })
})
