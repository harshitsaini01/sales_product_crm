import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { superAdminOnly, staffOnly } from '../middleware/rbac'
import { subStatusTargetDepartment } from '../services/leads/status-cascade.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bigintFix(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (Array.isArray(obj)) return obj.map(bigintFix)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = bigintFix(obj[k])
    return out
  }
  return obj
}

export const leadConfigRoutes = new Hono()

leadConfigRoutes.use('*', authenticate)

// ─── TYPES ──────────────────────────────────────────────────────────────────

leadConfigRoutes.get('/types', staffOnly, async (c) => {
  const types = await prisma.leadTypeConfig.findMany({ orderBy: { priority: 'asc' } })
  return c.json(bigintFix(types))
})

leadConfigRoutes.post('/types', superAdminOnly, async (c) => {
  const { title, slug, departmentId, priority } = await c.req.json()
  const created = await prisma.leadTypeConfig.create({
    data: { title, slug, departmentId: departmentId ? BigInt(departmentId) : null, priority: priority ?? 0 },
  })
  return c.json(bigintFix(created), 201)
})

leadConfigRoutes.patch('/types/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const updated = await prisma.leadTypeConfig.update({ where: { id }, data: body })
  return c.json(bigintFix(updated))
})

leadConfigRoutes.delete('/types/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadTypeConfig.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})

// ─── STATUSES ────────────────────────────────────────────────────────────────

leadConfigRoutes.get('/statuses', staffOnly, async (c) => {
  // By default only active statuses are returned (drives leads-page filters and
  // the status picker). The config admin UI passes ?includeInactive=1 so it can
  // still see and re-enable disabled statuses.
  const includeInactive = c.req.query('includeInactive') === '1'
  const statuses = await prisma.leadStatus.findMany({
    where: includeInactive ? {} : { status: 1 },
    orderBy: { priority: 'asc' },
    include: { subStatuses: true },
  })
  return c.json(bigintFix(statuses))
})

leadConfigRoutes.post('/statuses', superAdminOnly, async (c) => {
  const { title, slug, departmentId, moveTo, priority } = await c.req.json()
  const created = await prisma.leadStatus.create({
    data: {
      title, slug,
      departmentId: BigInt(departmentId),
      moveTo: moveTo ?? null,
      priority: priority ?? 0,
    },
  })
  return c.json(bigintFix(created), 201)
})

leadConfigRoutes.patch('/statuses/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const updated = await prisma.leadStatus.update({ where: { id }, data: body })
  return c.json(bigintFix(updated))
})

leadConfigRoutes.delete('/statuses/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadStatus.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})

// ─── SUB-STATUSES ────────────────────────────────────────────────────────────

leadConfigRoutes.get('/sub-statuses', staffOnly, async (c) => {
  const statusId = c.req.query('statusId')
  const where = statusId ? { statusId: BigInt(statusId) } : {}
  const subStatuses = await prisma.leadSubStatus.findMany({ where, orderBy: { id: 'asc' } })
  return c.json(bigintFix(subStatuses))
})

leadConfigRoutes.post('/sub-statuses', superAdminOnly, async (c) => {
  const { statusId, subStatus, subStatusSlug, moveTo, departmentId, statusLeadTypeId } = await c.req.json()
  const created = await prisma.leadSubStatus.create({
    data: {
      statusId: BigInt(statusId),
      subStatus,
      subStatusSlug,
      // moveTo = target Department; statusLeadTypeId = target Lead Type
      moveTo: moveTo ? BigInt(moveTo) : null,
      departmentId: departmentId ? BigInt(departmentId) : null,
      statusLeadTypeId: statusLeadTypeId ? BigInt(statusLeadTypeId) : null,
    },
  })
  return c.json(bigintFix(created), 201)
})

leadConfigRoutes.patch('/sub-statuses/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  // BigInt FK fields arrive as plain numbers from JSON — coerce them, and only
  // set keys that were actually sent so partial updates don't clobber others.
  const data: Record<string, unknown> = {}
  if (body.subStatus !== undefined) data.subStatus = body.subStatus
  if (body.subStatusSlug !== undefined) data.subStatusSlug = body.subStatusSlug
  if (body.statusId !== undefined) data.statusId = BigInt(body.statusId)
  if (body.moveTo !== undefined) data.moveTo = body.moveTo ? BigInt(body.moveTo) : null
  if (body.departmentId !== undefined) data.departmentId = body.departmentId ? BigInt(body.departmentId) : null
  if (body.statusLeadTypeId !== undefined) data.statusLeadTypeId = body.statusLeadTypeId ? BigInt(body.statusLeadTypeId) : null
  const updated = await prisma.leadSubStatus.update({ where: { id }, data })
  return c.json(bigintFix(updated))
})

leadConfigRoutes.delete('/sub-statuses/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadSubStatus.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})

// ─── FOLLOWUP STATUSES ───────────────────────────────────────────────────────

leadConfigRoutes.get('/followup-statuses', staffOnly, async (c) => {
  const statuses = await prisma.leadFollowupStatus.findMany({ orderBy: { id: 'asc' } })
  return c.json(bigintFix(statuses))
})

leadConfigRoutes.post('/followup-statuses', superAdminOnly, async (c) => {
  const { status, shortnote } = await c.req.json()
  const created = await prisma.leadFollowupStatus.create({ data: { status, shortnote } })
  return c.json(bigintFix(created), 201)
})

leadConfigRoutes.patch('/followup-statuses/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const updated = await prisma.leadFollowupStatus.update({ where: { id }, data: body })
  return c.json(bigintFix(updated))
})

// ─── WORKFLOW (single endpoint, full tree) ──────────────────────────────────

leadConfigRoutes.get('/workflow', staffOnly, async (c) => {
  const [departments, types, statuses, followupStatuses] = await Promise.all([
    prisma.leadDepartment.findMany({ orderBy: { priority: 'asc' } }),
    prisma.leadTypeConfig.findMany({ orderBy: { priority: 'asc' } }),
    prisma.leadStatus.findMany({ orderBy: { priority: 'asc' }, include: { subStatuses: { orderBy: { id: 'asc' } } } }),
    prisma.leadFollowupStatus.findMany({ orderBy: { id: 'asc' } }),
  ])

  // Group types by departmentId
  const typesByDept = new Map<number, { id: number; title: string; slug: string; departmentId: number; priority: number }[]>()
  const unlinkedTypes: { id: number; title: string; slug: string; departmentId: null; priority: number }[] = []

  for (const t of types) {
    const item = { id: Number(t.id), title: t.title, slug: t.slug, priority: t.priority }
    if (t.departmentId !== null) {
      const dId = Number(t.departmentId)
      if (!typesByDept.has(dId)) typesByDept.set(dId, [])
      typesByDept.get(dId)!.push({ ...item, departmentId: dId })
    } else {
      unlinkedTypes.push({ ...item, departmentId: null })
    }
  }

  const deptTree = departments.map((d) => ({
    id: Number(d.id),
    name: d.name,
    slug: d.slug,
    priority: d.priority,
    status: d.status,
    leadTypes: typesByDept.get(Number(d.id)) || [],
  }))

  const statusTree = statuses.map((s) => ({
    id: Number(s.id),
    title: s.title,
    slug: s.slug,
    departmentId: Number(s.departmentId),
    moveTo: s.moveTo,
    priority: s.priority,
    status: s.status,
    subStatuses: s.subStatuses.map((ss) => ({
      id: Number(ss.id),
      statusId: Number(ss.statusId),
      subStatus: ss.subStatus,
      subStatusSlug: ss.subStatusSlug,
      departmentId: ss.departmentId ? Number(ss.departmentId) : null,
      statusLeadTypeId: ss.statusLeadTypeId ? Number(ss.statusLeadTypeId) : null,
      moveTo: ss.moveTo ? Number(ss.moveTo) : null,
      // Server-resolved destination, using the same precedence the write path
      // uses (move_to > department_id > parent status's dept). The UI renders
      // THIS instead of re-deriving it — the old client-side copy of the rule
      // drifted from the backend and previewed the wrong department.
      targetDepartmentId: subStatusTargetDepartment(ss, s.departmentId),
    })),
  }))

  return c.json({
    departments: deptTree,
    unlinkedTypes,
    statuses: statusTree,
    followupStatuses: followupStatuses.map((f) => ({
      id: Number(f.id),
      status: f.status,
      shortnote: f.shortnote,
    })),
  })
})

// ─── REORDER ────────────────────────────────────────────────────────────────

leadConfigRoutes.put('/departments/reorder', superAdminOnly, async (c) => {
  const { items } = await c.req.json() as { items: { id: number; priority: number }[] }
  await prisma.$transaction(
    items.map((i) => prisma.leadDepartment.update({ where: { id: BigInt(i.id) }, data: { priority: i.priority } }))
  )
  return c.json({ ok: true })
})

leadConfigRoutes.put('/types/reorder', superAdminOnly, async (c) => {
  const { items } = await c.req.json() as { items: { id: number; priority: number }[] }
  await prisma.$transaction(
    items.map((i) => prisma.leadTypeConfig.update({ where: { id: BigInt(i.id) }, data: { priority: i.priority } }))
  )
  return c.json({ ok: true })
})

leadConfigRoutes.put('/statuses/reorder', superAdminOnly, async (c) => {
  const { items } = await c.req.json() as { items: { id: number; priority: number }[] }
  await prisma.$transaction(
    items.map((i) => prisma.leadStatus.update({ where: { id: BigInt(i.id) }, data: { priority: i.priority } }))
  )
  return c.json({ ok: true })
})

// ─── DEPARTMENTS ─────────────────────────────────────────────────────────────

leadConfigRoutes.get('/departments', staffOnly, async (c) => {
  const departments = await prisma.leadDepartment.findMany({ orderBy: { priority: 'asc' } })
  return c.json(bigintFix(departments))
})

leadConfigRoutes.post('/departments', superAdminOnly, async (c) => {
  const { name, slug, priority } = await c.req.json()
  const created = await prisma.leadDepartment.create({
    data: { name, slug, priority: priority ?? 0 },
  })
  return c.json(bigintFix(created), 201)
})

leadConfigRoutes.patch('/departments/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const updated = await prisma.leadDepartment.update({ where: { id }, data: body })
  return c.json(bigintFix(updated))
})

leadConfigRoutes.delete('/departments/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.leadDepartment.delete({ where: { id } })
  return c.json({ message: 'Deleted' })
})
