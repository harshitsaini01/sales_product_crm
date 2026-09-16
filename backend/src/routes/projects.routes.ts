// ─────────────────────────────────────────────────────────────────────────────
// Projects & proposals — the API.
//
// Mounted under the `projects` module (config/features.ts), which is on for
// the B2B vertical and off for everybody else, so an education customer's
// requests here 403 before a handler runs and their schema is never asked for
// the crm_project tables.
//
// Multipart endpoints (messages with attachments, file uploads) read text
// fields off `incoming.body`, which multer fills in alongside `files` — the
// same shape whatsapp-templates.routes.ts already relies on.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { uploadMedia, MEDIA_MAX_BYTES } from '../middleware/upload'
import { parsePagination } from '../utils/pagination'
import * as projects from '../services/crm/projects.service'
import { PROJECT_STATUSES, PROJECT_PRIORITIES } from '../services/crm/projects.service'

export const projectsRoutes = new Hono()

projectsRoutes.use('*', authenticate)

/** One place to turn a service error into a response. */
function fail(c: { json: (b: unknown, s?: number) => Response }, err: unknown): Response {
  if (err instanceof projects.NotFound) return c.json({ error: err.message }, 404)
  if (err instanceof projects.Invalid) return c.json({ error: err.message }, 400)
  if (err instanceof projects.SendFailed) return c.json({ error: `Could not send: ${err.message}` }, 502)
  throw err
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function multipart(c: any): { body: Record<string, string>; files: projects.UploadedFile[] } {
  const incoming = c.env?.incoming ?? {}
  const files = ((incoming.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
    path: f.path,
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
  }))
  return { body: (incoming.body ?? {}) as Record<string, string>, files }
}

/** 404 rather than 403 for a project outside the caller's scope. */
async function guard(c: { get: (k: 'user') => projects.ActingUser }, id: bigint): Promise<boolean> {
  return projects.canAccess(c.get('user'), id)
}

// ─── Reference data ───────────────────────────────────────────────────────────

// GET /api/projects/meta — statuses, priorities, mailboxes, upload limit.
projectsRoutes.get('/meta', async (c) => {
  return c.json({
    statuses: PROJECT_STATUSES,
    priorities: PROJECT_PRIORITIES,
    mailboxes: await projects.mailboxes(),
    maxUploadBytes: MEDIA_MAX_BYTES,
  })
})

// GET /api/projects/summary
projectsRoutes.get('/summary', async (c) => c.json(await projects.summary(c.get('user'))))

// GET /api/projects/waiting — the ones with my name on them.
projectsRoutes.get('/waiting', async (c) => {
  const rows = await projects.waitingOn(c.get('user').userId)
  return c.json(rows.map((r) => ({ ...r, id: Number(r.id) })))
})

// ─── List / create ────────────────────────────────────────────────────────────

// GET /api/projects
projectsRoutes.get('/', async (c) => {
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)
  return c.json(
    await projects.listProjects(
      {
        status: q.status,
        teamId: q.teamId,
        assigneeId: q.assigneeId,
        ownerId: q.ownerId,
        leadId: q.leadId,
        accountId: q.accountId,
        dealId: q.dealId,
        search: q.search,
        mine: q.mine,
        priority: q.priority,
        page,
        limit,
        skip,
      },
      c.get('user'),
    ),
  )
})

const createBody = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(500).nullish(),
  description: z.string().nullish(),
  leadId: z.number().int().nullish(),
  accountId: z.number().int().nullish(),
  contactId: z.number().int().nullish(),
  dealId: z.number().int().nullish(),
  teamId: z.number().int().nullish(),
  assigneeId: z.number().int().nullish(),
  ownerId: z.number().int().nullish(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  budget: z.number().nullish(),
  currency: z.string().max(10).optional(),
  dueDate: z.string().nullish(),
  clientName: z.string().max(160).nullish(),
  clientEmail: z.string().max(200).nullish(),
  clientCc: z.string().max(500).nullish(),
  mailGroupId: z.number().int().nullish(),
  note: z.string().nullish(),
})

// POST /api/projects
projectsRoutes.post('/', zValidator('json', createBody), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  if (body.assigneeId && body.teamId) {
    const member = await prisma.crmTeamMember.count({
      where: { teamId: BigInt(body.teamId), userId: BigInt(body.assigneeId), user: { status: 1 } },
    })
    if (!member) return c.json({ error: 'That person is not an active member of the chosen team.' }, 400)
  }

  try {
    return c.json(await projects.createProject(body, user), 201)
  } catch (err) {
    return fail(c, err)
  }
})

// ─── One project ──────────────────────────────────────────────────────────────

// GET /api/projects/:id
projectsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
  const p = await projects.getProject(id)
  if (!p) return c.json({ error: 'Project not found' }, 404)
  return c.json(p)
})

const updateBody = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(500).nullish(),
  description: z.string().nullish(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  budget: z.number().nullish(),
  currency: z.string().max(10).optional(),
  dueDate: z.string().nullish(),
  clientName: z.string().max(160).nullish(),
  clientEmail: z.string().max(200).nullish(),
  clientCc: z.string().max(500).nullish(),
  mailGroupId: z.number().int().nullish(),
  ownerId: z.number().int().nullish(),
  contactId: z.number().int().nullish(),
  dealId: z.number().int().nullish(),
})

// PATCH /api/projects/:id
projectsRoutes.patch('/:id', zValidator('json', updateBody), async (c) => {
  const id = BigInt(c.req.param('id'))
  if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
  try {
    return c.json(await projects.updateProject(id, c.req.valid('json')))
  } catch (err) {
    return fail(c, err)
  }
})

// DELETE /api/projects/:id — soft. Owner or a manager.
projectsRoutes.delete('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  const p = await prisma.crmProject.findFirst({ where: { id, trash: 0 }, select: { ownerId: true, createdById: true } })
  if (!p) return c.json({ error: 'Project not found' }, 404)
  const me = BigInt(user.userId)
  if (!projects.isPrivileged(user) && p.ownerId !== me && p.createdById !== me) {
    return c.json({ error: 'Only the project owner or a manager can delete it.' }, 403)
  }
  await projects.softDelete(id)
  return c.json({ ok: true })
})

// ─── Assignment & status ──────────────────────────────────────────────────────

// POST /api/projects/:id/assign
projectsRoutes.post(
  '/:id/assign',
  zValidator('json', z.object({ teamId: z.number().int().nullish(), assigneeId: z.number().int(), note: z.string().nullish() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
    try {
      return c.json(await projects.assignProject(id, c.req.valid('json'), c.get('user')))
    } catch (err) {
      return fail(c, err)
    }
  },
)

// POST /api/projects/:id/status
projectsRoutes.post(
  '/:id/status',
  zValidator('json', z.object({ status: z.enum(PROJECT_STATUSES), note: z.string().nullish() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
    const { status, note } = c.req.valid('json')
    try {
      return c.json(await projects.setStatus(id, status, note ?? null, c.get('user')))
    } catch (err) {
      return fail(c, err)
    }
  },
)

// POST /api/projects/:id/deal — the approved project becomes a deal.
projectsRoutes.post('/:id/deal', async (c) => {
  const id = BigInt(c.req.param('id'))
  if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
  try {
    return c.json(await projects.convertToDeal(id, c.get('user')), 201)
  } catch (err) {
    return fail(c, err)
  }
})

// ─── The thread ───────────────────────────────────────────────────────────────

// POST /api/projects/:id/messages  (multipart: channel, body, subject?, to?,
// cc?, kind?, attachFileIds?, mailGroupId?, files[])
//
// One endpoint for both channels, because the composer is one box with a
// toggle — the difference is whether it leaves the building.
projectsRoutes.post('/:id/messages', uploadMedia('files', 10), async (c) => {
  const id = BigInt(c.req.param('id'))
  if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)

  const { body, files } = multipart(c)
  const channel = body.channel === 'external' ? 'external' : 'internal'
  const text = (body.body ?? '').trim()
  if (!text && !files.length) return c.json({ error: 'Write something, or attach a file.' }, 400)

  try {
    if (channel === 'internal') {
      const message = await projects.postInternal(
        id,
        { body: text || '(attachment)', kind: body.kind === 'proposal' ? 'proposal' : 'message', files },
        c.get('user'),
      )
      return c.json(message, 201)
    }

    const attachFileIds = (body.attachFileIds ?? '')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)

    const project = await projects.sendExternal(
      id,
      {
        subject: body.subject,
        body: text || '(see attachments)',
        to: body.to,
        cc: body.cc,
        files,
        attachFileIds,
        mailGroupId: body.mailGroupId ? Number(body.mailGroupId) : null,
      },
      c.get('user'),
    )
    return c.json(project, 201)
  } catch (err) {
    return fail(c, err)
  }
})

// ─── Files ────────────────────────────────────────────────────────────────────

// POST /api/projects/:id/files  (multipart files[])
projectsRoutes.post('/:id/files', uploadMedia('files', 10), async (c) => {
  const id = BigInt(c.req.param('id'))
  if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
  const { files } = multipart(c)
  if (!files.length) return c.json({ error: 'No files uploaded' }, 400)
  try {
    return c.json(await projects.addProjectFiles(id, files, c.get('user')), 201)
  } catch (err) {
    return fail(c, err)
  }
})

// DELETE /api/projects/:id/files/:fileId
projectsRoutes.delete('/:id/files/:fileId', async (c) => {
  const id = BigInt(c.req.param('id'))
  if (!(await guard(c, id))) return c.json({ error: 'Project not found' }, 404)
  try {
    await projects.removeProjectFile(id, BigInt(c.req.param('fileId')), c.get('user'))
    return c.json({ ok: true })
  } catch (err) {
    return fail(c, err)
  }
})

// ─── Admin: reassign owner in bulk when a rep leaves (small, but asked for
//     every time somebody does) ─────────────────────────────────────────────
projectsRoutes.post(
  '/reassign-owner',
  adminOnly,
  zValidator('json', z.object({ fromUserId: z.number().int(), toUserId: z.number().int() })),
  async (c) => {
    const { fromUserId, toUserId } = c.req.valid('json')
    const { count } = await prisma.crmProject.updateMany({
      where: { ownerId: BigInt(fromUserId), trash: 0 },
      data: { ownerId: BigInt(toUserId) },
    })
    return c.json({ moved: count })
  },
)
