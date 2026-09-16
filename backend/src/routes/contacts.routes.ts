// ─────────────────────────────────────────────────────────────────────────────
// Contacts — the people inside an account.
//
// Its own module rather than a field on the account, because one company
// routinely has dozens: a decision maker, the person who actually uses the
// product, someone in finance, and the gatekeeper between you and all three.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'
import * as activity from '../services/crm/activity.service'
import * as customFields from '../services/crm/custom-fields.service'
import { serializeContact, bigintFix } from '../services/crm/serialize'

export const contactsRoutes = new Hono()

contactsRoutes.use('*', authenticate)

function scopeFor(user: { userId: number; role: string; roles: string[] }) {
  const privileged = ['admin', 'sub-admin', 'sales-head']
  const isPrivileged = privileged.includes(user.role) || user.roles.some((r) => privileged.includes(r))
  return isPrivileged ? {} : { ownerId: BigInt(user.userId) }
}

const contactBody = z.object({
  accountId: z.number().nullish(),
  locationId: z.number().nullish(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).nullish(),
  jobTitle: z.string().max(120).nullish(),
  department: z.string().max(80).nullish(),
  seniority: z.string().max(24).nullish(),
  email: z.string().max(150).nullish(),
  personalEmail: z.string().max(150).nullish(),
  mobile: z.string().max(40).nullish(),
  whatsapp: z.string().max(40).nullish(),
  officePhone: z.string().max(40).nullish(),
  linkedin: z.string().max(255).nullish(),
  preferredChannel: z.string().max(20).nullish(),
  language: z.string().max(40).nullish(),
  role: z.string().max(24).optional(),
  relationshipStrength: z.string().max(16).optional(),
  status: z.string().max(20).optional(),
  ownerId: z.number().nullish(),
  notes: z.string().nullish(),
  customFields: z.record(z.unknown()).optional(),
})

// GET /api/contacts
contactsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)
  const search = q.search?.trim()

  const where = {
    trash: 0,
    ...scopeFor(user),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    ...(q.role ? { role: q.role } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { mobile: { contains: search } },
            { jobTitle: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir === 'asc' ? 'asc' : 'desc' },
      skip,
      take: limit,
      include: {
        account: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    }),
    prisma.contact.count({ where }),
  ])

  return c.json(buildPaginatedResult(rows.map(serializeContact), total, page, limit))
})

// GET /api/contacts/:id
contactsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, accountType: { select: { slug: true } } } },
      owner: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, city: true } },
    },
  })
  if (!contact) return c.json({ error: 'Contact not found' }, 404)

  const fields = await customFields.valuesFor('contact', id, {
    role: contact.role,
    seniority: contact.seniority ?? '',
  })

  return c.json({ ...serializeContact(contact), customFields: bigintFix(fields) })
})

// POST /api/contacts
contactsRoutes.post('/', zValidator('json', contactBody), async (c) => {
  const user = c.get('user')
  const { customFields: cf, ...body } = c.req.valid('json')

  const contact = await prisma.contact.create({
    data: {
      ...body,
      accountId: body.accountId ? BigInt(body.accountId) : null,
      locationId: body.locationId ? BigInt(body.locationId) : null,
      ownerId: BigInt(body.ownerId ?? user.userId),
    },
  })

  if (cf) await customFields.saveValues('contact', contact.id, cf)

  await activity.recordSafe({
    entityType: 'contact',
    entityId: contact.id,
    kind: 'system',
    subject: 'Contact created',
    actorId: user.userId,
  })

  // Also on the account's timeline: "a new person appeared at this company" is
  // something the account owner wants to see without opening every contact.
  if (contact.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: contact.accountId,
      kind: 'system',
      subject: `Contact added: ${[contact.firstName, contact.lastName].filter(Boolean).join(' ')}`,
      actorId: user.userId,
      meta: { contactId: Number(contact.id) },
    })
  }

  return c.json(serializeContact(contact), 201)
})

// PATCH /api/contacts/:id
contactsRoutes.patch('/:id', zValidator('json', contactBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const { customFields: cf, ...body } = c.req.valid('json')

  const contact = await prisma.contact.update({
    where: { id },
    data: {
      ...body,
      ...(body.accountId !== undefined
        ? { accountId: body.accountId ? BigInt(body.accountId) : null }
        : {}),
      ...(body.locationId !== undefined
        ? { locationId: body.locationId ? BigInt(body.locationId) : null }
        : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId ? BigInt(body.ownerId) : null } : {}),
    },
  })

  if (cf) await customFields.saveValues('contact', id, cf)

  return c.json(serializeContact(contact))
})

// DELETE /api/contacts/:id — soft.
contactsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.contact.update({ where: { id }, data: { trash: 1 } })
  return c.json({ success: true })
})
