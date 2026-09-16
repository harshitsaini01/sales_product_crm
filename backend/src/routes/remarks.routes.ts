import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'

export const remarksRoutes = new Hono()

remarksRoutes.use('*', authenticate)

// GET /api/remarks?counsellorId=123&callId=456&hourContext=...
remarksRoutes.get('/', async (c) => {
  const user = c.get('user')
  const counsellorIdParam = c.req.query('counsellorId')
  const callIdParam = c.req.query('callId')
  const hourContextParam = c.req.query('hourContext')

  let targetCounsellorId: bigint | undefined
  if (counsellorIdParam) {
    targetCounsellorId = BigInt(counsellorIdParam)
  } else if (user.role === 'counsellor') {
    targetCounsellorId = BigInt(user.userId)
  }

  const whereClause: Record<string, unknown> = {}
  if (targetCounsellorId) whereClause.counsellorId = targetCounsellorId
  if (callIdParam) whereClause.callId = BigInt(callIdParam)
  if (hourContextParam) whereClause.hourContext = hourContextParam

  const remarks = await prisma.counsellorRemark.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: {
        select: { id: true, name: true, role: true, email: true },
      },
      counsellor: {
        select: { id: true, name: true, role: true, email: true },
      },
      call: {
        select: {
          id: true,
          phoneNumber: true,
          direction: true,
          status: true,
          startedAt: true,
          durationSec: true,
          lead: {
            select: { id: true, name: true, mobile: true },
          },
        },
      },
    },
  })

  return c.json(
    remarks.map((r) => ({
      ...r,
      id: Number(r.id),
      counsellorId: Number(r.counsellorId),
      createdById: Number(r.createdById),
      callId: r.callId ? Number(r.callId) : null,
      hourContext: r.hourContext || null,
      createdBy: r.createdBy ? { ...r.createdBy, id: Number(r.createdBy.id) } : null,
      counsellor: r.counsellor ? { ...r.counsellor, id: Number(r.counsellor.id) } : null,
      call: r.call
        ? {
            ...r.call,
            id: Number(r.call.id),
            lead: r.call.lead ? { ...r.call.lead, id: Number(r.call.lead.id) } : null,
          }
        : null,
    }))
  )
})

// POST /api/remarks
remarksRoutes.post('/', async (c) => {
  const user = c.get('user')
  const { counsellorId: rawCounsellorId, counsellorIds: rawCounsellorIds, remark, callId, hourContext } = await c.req.json()

  if (!remark || typeof remark !== 'string' || !remark.trim()) {
    return c.json({ error: 'A non-empty remark string is required' }, 400)
  }

  // Admin / sub-admin permissions check
  const isAdmin =
    user.role === 'admin' ||
    (user.role as string) === 'sub-admin' ||
    (user.role as string) === 'sub_admin' ||
    (Array.isArray(user.roles) &&
      user.roles.some(
        (r: string) => r === 'admin' || r === 'sub-admin' || r === 'sub_admin'
      ))

  if (!isAdmin) {
    return c.json({ error: 'Only admins can add remarks' }, 403)
  }

  // Handle multiple counsellor IDs if provided
  let targetIds: number[] = []

  if (Array.isArray(rawCounsellorIds) && rawCounsellorIds.length > 0) {
    targetIds = rawCounsellorIds.map(Number).filter(Boolean)
  } else if (rawCounsellorId) {
    targetIds = [Number(rawCounsellorId)]
  } else if (callId) {
    const callRow = await prisma.mobileCall.findUnique({
      where: { id: BigInt(callId) },
      select: { userId: true },
    })
    if (callRow?.userId) {
      targetIds = [Number(callRow.userId)]
    }
  }

  if (targetIds.length === 0) {
    return c.json({ error: 'At least one counsellorId or valid callId is required' }, 400)
  }

  const createdRemarks = []

  for (const cid of targetIds) {
    const created = await prisma.counsellorRemark.create({
      data: {
        counsellorId: BigInt(cid),
        createdById: BigInt(user.userId),
        remark: remark.trim(),
        callId: callId ? BigInt(callId) : null,
        hourContext: hourContext ? String(hourContext).trim() : null,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, role: true, email: true },
        },
        counsellor: {
          select: { id: true, name: true, role: true, email: true },
        },
        call: {
          select: {
            id: true,
            phoneNumber: true,
            direction: true,
            status: true,
            startedAt: true,
            durationSec: true,
            lead: {
              select: { id: true, name: true, mobile: true },
            },
          },
        },
      },
    })

    createdRemarks.push({
      ...created,
      id: Number(created.id),
      counsellorId: Number(created.counsellorId),
      createdById: Number(created.createdById),
      callId: created.callId ? Number(created.callId) : null,
      hourContext: created.hourContext || null,
      createdBy: created.createdBy ? { ...created.createdBy, id: Number(created.createdBy.id) } : null,
      counsellor: created.counsellor ? { ...created.counsellor, id: Number(created.counsellor.id) } : null,
      call: created.call
        ? {
            ...created.call,
            id: Number(created.call.id),
            lead: created.call.lead ? { ...created.call.lead, id: Number(created.call.lead.id) } : null,
          }
        : null,
    })
  }

  return c.json(
    createdRemarks.length === 1 ? createdRemarks[0] : { message: `${createdRemarks.length} remarks added`, remarks: createdRemarks },
    201
  )
})

// DELETE /api/remarks/:id
remarksRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))

  const existing = await prisma.counsellorRemark.findUnique({
    where: { id },
  })

  if (!existing) {
    return c.json({ error: 'Remark not found' }, 404)
  }

  const isAdmin =
    user.role === 'admin' ||
    (user.role as string) === 'sub-admin' ||
    (user.role as string) === 'sub_admin' ||
    (Array.isArray(user.roles) &&
      user.roles.some(
        (r: string) => r === 'admin' || r === 'sub-admin' || r === 'sub_admin'
      ))
  const isAuthor = Number(existing.createdById) === Number(user.userId)

  if (!isAdmin && !isAuthor) {
    return c.json({ error: 'Not authorized to delete this remark' }, 403)
  }

  await prisma.counsellorRemark.delete({ where: { id } })
  return c.json({ message: 'Remark deleted' })
})
