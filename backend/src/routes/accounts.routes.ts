// ─────────────────────────────────────────────────────────────────────────────
// Accounts — the B2B core entity.
//
// Mounted only when the `accounts` module is on, which the education vertical
// leaves off, so a Tutelage user can never reach any of this.
//
// SCOPING. A counsellor (sales rep) sees the accounts they own; an admin,
// sub-admin or sales head sees everything. That mirrors how leads already work,
// so one mental model covers both worlds.
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
import { accountStats, accountDetail } from '../services/crm/account-summary.service'
import { serializeAccount, serializeContact, serializeLocation, bigintFix } from '../services/crm/serialize'

export const accountsRoutes = new Hono()

accountsRoutes.use('*', authenticate)

/** Everyone above a rep sees every account; a rep sees their own. */
function scopeFor(user: { userId: number; role: string; roles: string[] }) {
  const privileged = ['admin', 'sub-admin', 'sales-head']
  const isPrivileged = privileged.includes(user.role) || user.roles.some((r) => privileged.includes(r))
  return isPrivileged ? {} : { ownerId: BigInt(user.userId) }
}

const accountBody = z.object({
  name: z.string().min(1).max(180),
  legalName: z.string().max(180).nullish(),
  accountTypeId: z.number().nullish(),
  industryId: z.number().nullish(),
  status: z.string().max(24).optional(),
  businessModel: z.string().max(24).nullish(),
  employeeCount: z.number().int().nullish(),
  annualRevenue: z.number().nullish(),
  foundedYear: z.number().int().nullish(),
  website: z.string().max(255).nullish(),
  linkedin: z.string().max(255).nullish(),
  email: z.string().max(150).nullish(),
  phone: z.string().max(40).nullish(),
  whatsapp: z.string().max(40).nullish(),
  gstin: z.string().max(20).nullish(),
  pan: z.string().max(20).nullish(),
  cin: z.string().max(30).nullish(),
  legalStructure: z.string().max(40).nullish(),
  ownerId: z.number().nullish(),
  branchId: z.number().nullish(),
  billingState: z.string().max(100).nullish(),
  creditLimit: z.number().nullish(),
  creditDays: z.number().int().nullish(),
  priceListId: z.number().nullish(),
  replenishDays: z.number().int().nullish(),
  notes: z.string().nullish(),
  /** `{ rooms: 120 }` — saved through the custom-field engine, not as columns. */
  customFields: z.record(z.unknown()).optional(),
})

// ─── LIST ─────────────────────────────────────────────────────────────────────

// GET /api/accounts
accountsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, limit, skip } = parsePagination(q)

  const search = q.search?.trim()

  const where = {
    trash: 0,
    ...scopeFor(user),
    ...(q.accountTypeId ? { accountTypeId: BigInt(q.accountTypeId) } : {}),
    ...(q.industryId ? { industryId: BigInt(q.industryId) } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.ownerId ? { ownerId: BigInt(q.ownerId) } : {}),
    // One box across the identifiers a sales rep actually remembers a company
    // by — the name, the domain, the phone they dialled, or the GST on the
    // invoice they are chasing.
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { legalName: { contains: search, mode: 'insensitive' as const } },
            { website: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
            { gstin: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir === 'asc' ? 'asc' : 'desc' },
      skip,
      take: limit,
      include: {
        accountType: { select: { id: true, name: true } },
        industry: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        _count: { select: { contacts: true, locations: true } },
      },
    }),
    prisma.account.count({ where }),
  ])

  return c.json(buildPaginatedResult(rows.map(serializeAccount), total, page, limit))
})

// ─── ONE ACCOUNT ──────────────────────────────────────────────────────────────

// GET /api/accounts/:id — the 360 header. Contacts, locations and the timeline
// are separate calls so a big account's page paints before all of it lands.
accountsRoutes.get('/:id', async (c) => {
  const account = await accountDetail(BigInt(c.req.param('id')))
  if (!account) return c.json({ error: 'Account not found' }, 404)
  return c.json(account)
})

// ─── CREATE / UPDATE ──────────────────────────────────────────────────────────

// POST /api/accounts
accountsRoutes.post('/', zValidator('json', accountBody), async (c) => {
  const user = c.get('user')
  const { customFields: cf, accountTypeId, industryId, ownerId, branchId, priceListId, ...body } = c.req.valid('json')

  const account = await prisma.account.create({
    data: {
      ...body,
      accountTypeId: accountTypeId ? BigInt(accountTypeId) : null,
      industryId: industryId ? BigInt(industryId) : null,
      ownerId: BigInt(ownerId ?? user.userId),
      branchId: branchId ? BigInt(branchId) : null,
      priceListId: priceListId ? BigInt(priceListId) : null,
      createdById: BigInt(user.userId),
    },
  })

  // Numbered after insert because the id is the number — a separate counter
  // would drift the moment two people create an account at the same instant.
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { accountNumber: `ACC-${String(account.id).padStart(6, '0')}` },
  })

  if (cf) await customFields.saveValues('account', account.id, cf)

  await activity.recordSafe({
    entityType: 'account',
    entityId: account.id,
    kind: 'system',
    subject: 'Account created',
    actorId: user.userId,
  })

  return c.json(serializeAccount(updated), 201)
})

// PATCH /api/accounts/:id
accountsRoutes.patch('/:id', zValidator('json', accountBody.partial()), async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = c.get('user')
  const { customFields: cf, ...body } = c.req.valid('json')

  const before = await prisma.account.findUnique({ where: { id } })
  if (!before) return c.json({ error: 'Account not found' }, 404)

  const account = await prisma.account.update({
    where: { id },
    data: {
      ...body,
      ...(body.accountTypeId !== undefined
        ? { accountTypeId: body.accountTypeId ? BigInt(body.accountTypeId) : null }
        : {}),
      ...(body.industryId !== undefined
        ? { industryId: body.industryId ? BigInt(body.industryId) : null }
        : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId ? BigInt(body.ownerId) : null } : {}),
      ...(body.branchId !== undefined ? { branchId: body.branchId ? BigInt(body.branchId) : null } : {}),
      ...(body.priceListId !== undefined ? { priceListId: body.priceListId ? BigInt(body.priceListId) : null } : {}),
    },
  })

  if (cf) await customFields.saveValues('account', id, cf)

  // Only status and ownership go on the timeline. Every field edit would drown
  // the calls and meetings that people actually read it for.
  if (body.status && body.status !== before.status) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: id,
      kind: 'stage_change',
      subject: `Status: ${before.status} → ${body.status}`,
      actorId: user.userId,
      meta: { from: before.status, to: body.status },
    })
  }
  if (body.ownerId !== undefined && String(before.ownerId) !== String(account.ownerId)) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: id,
      kind: 'system',
      subject: 'Owner changed',
      actorId: user.userId,
      meta: { from: Number(before.ownerId ?? 0), to: Number(account.ownerId ?? 0) },
    })
  }

  return c.json(serializeAccount(account))
})

// DELETE /api/accounts/:id — soft, like everything else in this CRM. The
// contacts, timeline and custom values stay attached, so restoring is one flag.
accountsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.account.update({ where: { id }, data: { trash: 1 } })
  return c.json({ success: true })
})

// POST /api/accounts/:id/restore
accountsRoutes.post('/:id/restore', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.account.update({ where: { id }, data: { trash: 0 } })
  return c.json({ success: true })
})

// ─── CONTACTS & LOCATIONS UNDER AN ACCOUNT ───────────────────────────────────

// GET /api/accounts/:id/contacts
accountsRoutes.get('/:id/contacts', async (c) => {
  const accountId = BigInt(c.req.param('id'))
  const rows = await prisma.contact.findMany({
    where: { accountId, trash: 0 },
    orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    include: {
      owner: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
  })
  return c.json(rows.map(serializeContact))
})

// GET /api/accounts/:id/locations
accountsRoutes.get('/:id/locations', async (c) => {
  const accountId = BigInt(c.req.param('id'))
  const rows = await prisma.crmLocation.findMany({
    where: { accountId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  })
  return c.json(rows.map(serializeLocation))
})

const locationBody = z.object({
  name: z.string().min(1).max(150),
  type: z.string().max(24).optional(),
  address: z.string().nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(100).nullish(),
  country: z.string().max(100).nullish(),
  pincode: z.string().max(20).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().max(150).nullish(),
  isPrimary: z.boolean().optional(),
})

// POST /api/accounts/:id/locations
accountsRoutes.post('/:id/locations', zValidator('json', locationBody), async (c) => {
  const accountId = BigInt(c.req.param('id'))
  const body = c.req.valid('json')

  // Exactly one primary. Demote the others first, or "primary" stops meaning
  // anything and the invoice address becomes a coin flip.
  if (body.isPrimary) {
    await prisma.crmLocation.updateMany({ where: { accountId }, data: { isPrimary: false } })
  }

  const row = await prisma.crmLocation.create({ data: { ...body, accountId } })
  return c.json(serializeLocation(row), 201)
})

// PATCH /api/accounts/:accountId/locations/:locationId
accountsRoutes.patch(
  '/:accountId/locations/:locationId',
  zValidator('json', locationBody.partial()),
  async (c) => {
    const accountId = BigInt(c.req.param('accountId'))
    const id = BigInt(c.req.param('locationId'))
    const body = c.req.valid('json')

    if (body.isPrimary) {
      await prisma.crmLocation.updateMany({ where: { accountId }, data: { isPrimary: false } })
    }

    const row = await prisma.crmLocation.update({ where: { id }, data: body })
    return c.json(serializeLocation(row))
  },
)

// DELETE /api/accounts/:accountId/locations/:locationId
accountsRoutes.delete('/:accountId/locations/:locationId', async (c) => {
  const id = BigInt(c.req.param('locationId'))
  // Contacts point at a location; null them rather than blocking the delete or
  // cascading a person out of existence along with an address.
  await prisma.contact.updateMany({ where: { locationId: id }, data: { locationId: null } })
  await prisma.crmLocation.delete({ where: { id } })
  return c.json({ success: true })
})
