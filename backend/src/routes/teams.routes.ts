// ─────────────────────────────────────────────────────────────────────────────
// Teams — the departments a project can be handed to (IT, Digital Marketing,
// Design…) and who is in each.
//
// Anybody with the module can READ them: the assignment picker on a project
// needs the list. Only an admin changes them.
//
// Not `lead_departments`. Those decide which statuses a lead may be in; these
// decide who does the work. See the header of the CrmTeam model.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { bigintFix } from '../services/crm/serialize'
import { teamMembers } from '../services/crm/projects.service'

export const teamsRoutes = new Hono()

teamsRoutes.use('*', authenticate)

const slugify = (v: string) =>
  v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)

const MEMBER = { select: { id: true, name: true, email: true, imgpath: true, designation: true, status: true } } as const

function serializeTeam(t: {
  id: bigint
  name: string
  slug: string
  description: string | null
  color: string | null
  priority: number
  active: boolean
  members?: { role: string; user: { id: bigint; name: string; email: string; imgpath: string | null; designation: string | null; status: number } }[]
  _count?: { projects: number }
}) {
  return {
    ...bigintFix({ ...t, members: undefined, _count: undefined }),
    members: (t.members ?? []).map((m) => ({ ...bigintFix(m.user), active: m.user.status === 1, memberRole: m.role })),
    projectCount: t._count?.projects ?? 0,
  }
}

// GET /api/teams?includeInactive=1
teamsRoutes.get('/', async (c) => {
  const includeInactive = c.req.query('includeInactive') === '1'
  const teams = await prisma.crmTeam.findMany({
    where: includeInactive ? {} : { active: true },
    include: {
      members: { include: { user: MEMBER }, orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }] },
      _count: { select: { projects: { where: { trash: 0 } } } },
    },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  })
  return c.json(teams.map(serializeTeam))
})

// GET /api/teams/:id/members — active members only: the assignment picker.
teamsRoutes.get('/:id/members', async (c) => {
  const id = BigInt(c.req.param('id'))
  return c.json(await teamMembers(id))
})

// GET /api/teams/mine — the teams the caller sits in.
teamsRoutes.get('/mine', async (c) => {
  const { userId } = c.get('user')
  const rows = await prisma.crmTeamMember.findMany({
    where: { userId: BigInt(userId) },
    include: { team: { select: { id: true, name: true, slug: true, color: true } } },
  })
  return c.json(rows.map((r) => ({ ...bigintFix(r.team), memberRole: r.role })))
})

const teamBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(255).nullish(),
  color: z.string().max(20).nullish(),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
})

// POST /api/teams
teamsRoutes.post('/', adminOnly, zValidator('json', teamBody), async (c) => {
  const body = c.req.valid('json')
  const slug = slugify(body.name)
  if (!slug) return c.json({ error: 'A team needs a name.' }, 400)

  const clash = await prisma.crmTeam.findUnique({ where: { slug } })
  if (clash) return c.json({ error: `A team called "${clash.name}" already exists.` }, 409)

  const row = await prisma.crmTeam.create({
    data: {
      name: body.name.trim(),
      slug,
      description: body.description ?? null,
      color: body.color ?? null,
      priority: body.priority ?? 0,
      active: body.active ?? true,
    },
    include: { members: { include: { user: MEMBER } }, _count: { select: { projects: true } } },
  })
  return c.json(serializeTeam(row), 201)
})

// PATCH /api/teams/:id
teamsRoutes.patch('/:id', adminOnly, zValidator('json', teamBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = c.req.valid('json')
  const existing = await prisma.crmTeam.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'Team not found' }, 404)

  const row = await prisma.crmTeam.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
    include: { members: { include: { user: MEMBER } }, _count: { select: { projects: true } } },
  })
  return c.json(serializeTeam(row))
})

// DELETE /api/teams/:id — deactivate. Projects keep their history.
teamsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.crmTeam.update({ where: { id }, data: { active: false } })
  return c.json({ ok: true })
})

// PUT /api/teams/:id/members — replace the whole membership.
teamsRoutes.put(
  '/:id/members',
  adminOnly,
  zValidator('json', z.object({ members: z.array(z.object({ userId: z.number().int(), role: z.enum(['lead', 'member']).optional() })) })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const { members } = c.req.valid('json')
    const team = await prisma.crmTeam.findUnique({ where: { id } })
    if (!team) return c.json({ error: 'Team not found' }, 404)

    const wanted = new Map(members.map((m) => [BigInt(m.userId), m.role ?? 'member']))
    const valid = await prisma.user.findMany({ where: { id: { in: [...wanted.keys()] } }, select: { id: true } })
    const validIds = new Set(valid.map((u) => u.id))

    await prisma.$transaction([
      prisma.crmTeamMember.deleteMany({ where: { teamId: id, userId: { notIn: [...validIds] } } }),
      ...[...wanted.entries()]
        .filter(([userId]) => validIds.has(userId))
        .map(([userId, role]) =>
          prisma.crmTeamMember.upsert({
            where: { teamId_userId: { teamId: id, userId } },
            create: { teamId: id, userId, role },
            update: { role },
          }),
        ),
    ])

    return c.json(await teamMembers(id))
  },
)

// POST /api/teams/:id/members — add one.
teamsRoutes.post(
  '/:id/members',
  adminOnly,
  zValidator('json', z.object({ userId: z.number().int(), role: z.enum(['lead', 'member']).optional() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const { userId, role } = c.req.valid('json')
    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) }, select: { id: true } })
    if (!user) return c.json({ error: 'User not found' }, 404)
    await prisma.crmTeamMember.upsert({
      where: { teamId_userId: { teamId: id, userId: BigInt(userId) } },
      create: { teamId: id, userId: BigInt(userId), role: role ?? 'member' },
      update: { role: role ?? 'member' },
    })
    return c.json(await teamMembers(id))
  },
)

// DELETE /api/teams/:id/members/:userId
teamsRoutes.delete('/:id/members/:userId', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const userId = BigInt(c.req.param('userId'))
  await prisma.crmTeamMember.deleteMany({ where: { teamId: id, userId } })
  return c.json(await teamMembers(id))
})
