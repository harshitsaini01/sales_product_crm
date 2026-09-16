// ─────────────────────────────────────────────────────────────────────────────
// The shared B2B surface: everything that hangs off an entity rather than
// being one.
//
//   /crm/timeline/:entityType/:entityId   the activity feed
//   /crm/notes/:entityType/:entityId      polymorphic notes
//   /crm/tags                             the tag vocabulary + links
//   /crm/account-types  /crm/industries   the config tables
//   /crm/search                           one box across every entity
//   /crm/convert/lead/:id                 lead → account + contact
//
// Every write validates entityType against config/crm-entities.ts. Nothing at
// the database level does it — a polymorphic owner has no foreign key — so a
// typo would otherwise write a row that no query ever reads again.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { hasFeature } from '../lib/tenant-context'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import {
  isLiveEntityType,
  entityExists,
  ENTITY_LABELS,
  type EntityType,
} from '../config/crm-entities'
import * as activity from '../services/crm/activity.service'
import { timelineScopes } from '../services/crm/lead-activity.service'
import { serializeAccount, serializeContact, bigintFix } from '../services/crm/serialize'

export const crmRoutes = new Hono()

crmRoutes.use('*', authenticate)

/**
 * Resolve and verify the (entityType, entityId) pair in a URL.
 *
 * Returns a ready-made error response rather than throwing, so each handler can
 * decide in one line. Checking the row EXISTS matters as much as checking the
 * type: without a foreign key, attaching notes to account 999999 would succeed
 * silently forever.
 */
async function resolveEntity(
  entityType: string,
  entityId: string,
): Promise<{ ok: true; type: EntityType; id: bigint } | { ok: false; status: 400 | 404; error: string }> {
  if (!isLiveEntityType(entityType)) {
    return { ok: false, status: 400, error: `Unknown entity type "${entityType}".` }
  }
  let id: bigint
  try {
    id = BigInt(entityId)
  } catch {
    return { ok: false, status: 400, error: 'Invalid id.' }
  }
  if (!(await entityExists(entityType, id))) {
    return { ok: false, status: 404, error: `${ENTITY_LABELS[entityType]} not found.` }
  }
  return { ok: true, type: entityType, id }
}

// ─── TIMELINE ─────────────────────────────────────────────────────────────────

// GET /api/crm/timeline/:entityType/:entityId
crmRoutes.get('/timeline/:entityType/:entityId', async (c) => {
  const e = await resolveEntity(c.req.param('entityType'), c.req.param('entityId'))
  if (!e.ok) return c.json({ error: e.error }, e.status)

  const q = c.req.query()
  const kinds = q.kinds
    ? (q.kinds.split(',').map((k) => k.trim()).filter(Boolean) as activity.ActivityKind[])
    : undefined

  const page = await activity.timeline({
    // The lead and the account it became read as one story, not two.
    scopes: await timelineScopes(e.type, e.id),
    kinds,
    limit: q.limit ? Number(q.limit) : undefined,
    before: q.before ? BigInt(q.before) : undefined,
  })

  return c.json(bigintFix(page))
})

// POST /api/crm/timeline/:entityType/:entityId — log something by hand: a call
// that happened off-system, a meeting, a WhatsApp exchange.
crmRoutes.post(
  '/timeline/:entityType/:entityId',
  zValidator(
    'json',
    z.object({
      kind: z.enum(['call', 'email', 'whatsapp', 'meeting', 'note', 'comment', 'system']),
      subject: z.string().max(255).nullish(),
      body: z.string().nullish(),
      occurredAt: z.string().datetime().optional(),
      meta: z.record(z.unknown()).nullish(),
    }),
  ),
  async (c) => {
    const e = await resolveEntity(c.req.param('entityType'), c.req.param('entityId'))
    if (!e.ok) return c.json({ error: e.error }, e.status)

    const user = c.get('user')
    const body = c.req.valid('json')

    const row = await activity.record({
      entityType: e.type,
      entityId: e.id,
      kind: body.kind,
      subject: body.subject ?? null,
      body: body.body ?? null,
      actorId: user.userId,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      meta: body.meta ?? null,
    })

    return c.json(bigintFix(row), 201)
  },
)

// ─── NOTES ────────────────────────────────────────────────────────────────────

// GET /api/crm/notes/:entityType/:entityId
crmRoutes.get('/notes/:entityType/:entityId', async (c) => {
  const e = await resolveEntity(c.req.param('entityType'), c.req.param('entityId'))
  if (!e.ok) return c.json({ error: e.error }, e.status)

  const rows = await prisma.crmNote.findMany({
    where: { entityType: e.type, entityId: e.id },
    // Pinned first: a note somebody pinned is the one they wanted read before
    // the sixty that came after it.
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    include: { user: { select: { id: true, name: true } } },
  })
  return c.json(bigintFix(rows))
})

// POST /api/crm/notes/:entityType/:entityId
crmRoutes.post(
  '/notes/:entityType/:entityId',
  zValidator(
    'json',
    z.object({
      body: z.string().min(1),
      kind: z.enum(['general', 'sales', 'meeting', 'financial', 'internal']).optional(),
      pinned: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const e = await resolveEntity(c.req.param('entityType'), c.req.param('entityId'))
    if (!e.ok) return c.json({ error: e.error }, e.status)

    const user = c.get('user')
    const body = c.req.valid('json')

    const note = await prisma.crmNote.create({
      data: {
        entityType: e.type,
        entityId: e.id,
        userId: BigInt(user.userId),
        body: body.body,
        kind: body.kind ?? 'general',
        pinned: body.pinned ?? false,
      },
      include: { user: { select: { id: true, name: true } } },
    })

    // A note is an event as much as a record — it belongs in the history the
    // sales rep scrolls, not in a separate list they have to remember to open.
    await activity.recordSafe({
      entityType: e.type,
      entityId: e.id,
      kind: 'note',
      subject: body.kind && body.kind !== 'general' ? `${body.kind} note` : 'Note',
      body: body.body.slice(0, 2000),
      actorId: user.userId,
      sourceType: 'crm_note',
      sourceId: note.id,
    })

    return c.json(bigintFix(note), 201)
  },
)

// PATCH /api/crm/notes/:id — edit or pin.
crmRoutes.patch(
  '/notes/:id',
  zValidator('json', z.object({ body: z.string().min(1).optional(), pinned: z.boolean().optional() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const patch = c.req.valid('json')
    const note = await prisma.crmNote.update({
      where: { id },
      data: patch,
      include: { user: { select: { id: true, name: true } } },
    })

    if (patch.body) {
      // Keep the timeline copy in step. The unique (sourceType, sourceId) makes
      // this an update rather than a second entry.
      await activity.recordSafe({
        entityType: note.entityType as EntityType,
        entityId: note.entityId,
        kind: 'note',
        subject: 'Note',
        body: patch.body.slice(0, 2000),
        actorId: Number(note.userId),
        occurredAt: note.createdAt,
        sourceType: 'crm_note',
        sourceId: note.id,
      })
    }

    return c.json(bigintFix(note))
  },
)

// DELETE /api/crm/notes/:id
crmRoutes.delete('/notes/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.crmNote.delete({ where: { id } })
  // The timeline entry goes with it: leaving the text behind under a deleted
  // note would make "delete" a lie.
  await prisma.activity
    .deleteMany({ where: { sourceType: 'crm_note', sourceId: id } })
    .catch(() => undefined)
  return c.json({ success: true })
})

// ─── TAGS ─────────────────────────────────────────────────────────────────────

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// GET /api/crm/tags — the vocabulary, with how often each is used.
crmRoutes.get('/tags', async (c) => {
  const rows = await prisma.crmTag.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { links: true } } },
  })
  return c.json(
    rows.map((t) => ({
      id: Number(t.id),
      name: t.name,
      slug: t.slug,
      color: t.color,
      usageCount: t._count.links,
    })),
  )
})

// POST /api/crm/tags
crmRoutes.post(
  '/tags',
  zValidator('json', z.object({ name: z.string().min(1).max(60), color: z.string().max(20).nullish() })),
  async (c) => {
    const { name, color } = c.req.valid('json')
    const slug = slugify(name)
    if (!slug) return c.json({ error: 'That tag name has no usable characters.' }, 400)

    // Upsert rather than create: two reps typing "Hot Lead" a second apart must
    // land on one tag, or filtering by it silently misses half the records.
    const tag = await prisma.crmTag.upsert({
      where: { slug },
      create: { name: name.trim(), slug, color: color ?? null },
      update: {},
    })
    return c.json({ id: Number(tag.id), name: tag.name, slug: tag.slug, color: tag.color }, 201)
  },
)

// GET /api/crm/tags/:entityType/:entityId — what is on one record.
crmRoutes.get('/tags/:entityType/:entityId', async (c) => {
  const e = await resolveEntity(c.req.param('entityType'), c.req.param('entityId'))
  if (!e.ok) return c.json({ error: e.error }, e.status)

  const links = await prisma.crmTagLink.findMany({
    where: { entityType: e.type, entityId: e.id },
    include: { tag: true },
  })
  return c.json(
    links.map((l) => ({ id: Number(l.tag.id), name: l.tag.name, slug: l.tag.slug, color: l.tag.color })),
  )
})

// PUT /api/crm/tags/:entityType/:entityId — set the whole set at once.
//
// A replace, not a patch, because the UI is a multi-select: what the user sees
// when they hit save is what the record should have, including the ones they
// removed.
crmRoutes.put(
  '/tags/:entityType/:entityId',
  zValidator('json', z.object({ tagIds: z.array(z.number()) })),
  async (c) => {
    const e = await resolveEntity(c.req.param('entityType'), c.req.param('entityId'))
    if (!e.ok) return c.json({ error: e.error }, e.status)

    const { tagIds } = c.req.valid('json')
    const ids = [...new Set(tagIds)].map((n) => BigInt(n))

    await prisma.crmTagLink.deleteMany({
      where: { entityType: e.type, entityId: e.id, tagId: { notIn: ids.length ? ids : [BigInt(0)] } },
    })
    if (ids.length) {
      await prisma.crmTagLink.createMany({
        data: ids.map((tagId) => ({ tagId, entityType: e.type, entityId: e.id })),
        skipDuplicates: true,
      })
    }

    return c.json({ success: true, count: ids.length })
  },
)

// ─── CONFIG TABLES ───────────────────────────────────────────────────────────
//
// Account types and industries are ROWS, not enums, so "Cloud Kitchen" is an
// insert an admin makes rather than a migration against every database.

crmRoutes.get('/account-types', async (c) => {
  const rows = await prisma.accountType.findMany({
    where: c.req.query('all') === '1' ? {} : { active: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  })
  return c.json(bigintFix(rows))
})

crmRoutes.post(
  '/account-types',
  adminOnly,
  zValidator('json', z.object({ name: z.string().min(1).max(80), priority: z.number().optional() })),
  async (c) => {
    const { name, priority } = c.req.valid('json')
    const row = await prisma.accountType.upsert({
      where: { slug: slugify(name) },
      create: { name: name.trim(), slug: slugify(name), priority: priority ?? 0 },
      update: { active: true },
    })
    return c.json(bigintFix(row), 201)
  },
)

crmRoutes.patch('/account-types/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const row = await prisma.accountType.update({
    where: { id },
    data: {
      ...(body.name ? { name: String(body.name).slice(0, 80) } : {}),
      ...(body.priority != null ? { priority: Number(body.priority) } : {}),
      ...(body.active != null ? { active: Boolean(body.active) } : {}),
    },
  })
  return c.json(bigintFix(row))
})

crmRoutes.get('/industries', async (c) => {
  const rows = await prisma.industry.findMany({
    where: c.req.query('all') === '1' ? {} : { active: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  })
  return c.json(bigintFix(rows))
})

crmRoutes.post(
  '/industries',
  adminOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100),
      parentId: z.number().nullish(),
      priority: z.number().optional(),
    }),
  ),
  async (c) => {
    const { name, parentId, priority } = c.req.valid('json')
    const row = await prisma.industry.upsert({
      where: { slug: slugify(name) },
      create: {
        name: name.trim(),
        slug: slugify(name),
        parentId: parentId ? BigInt(parentId) : null,
        priority: priority ?? 0,
      },
      update: { active: true },
    })
    return c.json(bigintFix(row), 201)
  },
)

// ─── GLOBAL SEARCH ───────────────────────────────────────────────────────────

// GET /api/crm/search?q=taj
//
// One box over the identifiers people actually remember: a company name, a
// person, a phone number, a GST. Capped tight per entity — this feeds a
// dropdown, not a report.
crmRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ accounts: [], contacts: [], leads: [] })

  const like = { contains: q, mode: 'insensitive' as const }
  const take = 8

  const [accounts, contacts, leads] = await Promise.all([
    prisma.account.findMany({
      where: {
        trash: 0,
        OR: [{ name: like }, { legalName: like }, { gstin: like }, { website: like }, { phone: { contains: q } }],
      },
      take,
      select: { id: true, name: true, accountNumber: true, phone: true, status: true },
    }),
    prisma.contact.findMany({
      where: {
        trash: 0,
        OR: [{ firstName: like }, { lastName: like }, { email: like }, { mobile: { contains: q } }],
      },
      take,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        mobile: true,
        account: { select: { id: true, name: true } },
      },
    }),
    // Leads stay in the results even for a B2B customer: the raw inbound inbox
    // is still where a company first shows up.
    prisma.lead.findMany({
      where: {
        trash: 0,
        OR: [{ name: like }, { email: like }, { mobile: { contains: q } }],
      },
      take,
      select: { id: true, name: true, email: true, mobile: true, leadStatus: true },
    }),
  ])

  // Documents by number, and projects by number or title — only for the
  // customers whose plan has them, so nobody else's schema is asked.
  const upper = q.toUpperCase()
  const docs = hasFeature('sales_docs')
    ? await Promise.all([
        prisma.quote.findMany({ where: { quoteNumber: { contains: upper } }, take, select: { id: true, quoteNumber: true, status: true, total: true } }),
        prisma.order.findMany({ where: { orderNumber: { contains: upper } }, take, select: { id: true, orderNumber: true, status: true, total: true } }),
        prisma.crmInvoice.findMany({ where: { invoiceNumber: { contains: upper } }, take, select: { id: true, invoiceNumber: true, status: true, total: true } }),
        prisma.contract.findMany({ where: { OR: [{ contractNumber: { contains: upper } }, { title: like }] }, take, select: { id: true, contractNumber: true, title: true, status: true } }),
      ])
    : [[], [], [], []]
  const deals = hasFeature('deals')
    ? await prisma.deal.findMany({ where: { trash: 0, OR: [{ name: like }, { dealNumber: { contains: upper } }] }, take, select: { id: true, name: true, dealNumber: true, value: true, stage: { select: { name: true } } } })
    : []
  const projects = hasFeature('projects')
    ? await prisma.crmProject.findMany({ where: { trash: 0, OR: [{ title: like }, { projectNumber: { contains: upper } }, { clientName: like }] }, take, select: { id: true, projectNumber: true, title: true, status: true } })
    : []

  const fix = <T extends { id: bigint }>(rows: T[]) => rows.map((r) => ({ ...r, id: Number(r.id) }))
  return c.json({
    accounts: accounts.map((a) => ({ ...a, id: Number(a.id) })),
    contacts: contacts.map(serializeContact),
    leads: leads.map((l) => ({ ...l, id: Number(l.id) })),
    deals: deals.map((d) => ({ id: Number(d.id), name: d.name, dealNumber: d.dealNumber, value: d.value != null ? Number(d.value) : null, stage: d.stage.name })),
    quotes: fix(docs[0]).map((r) => ({ ...r, total: Number(r.total) })),
    orders: fix(docs[1]).map((r) => ({ ...r, total: Number(r.total) })),
    invoices: fix(docs[2]).map((r) => ({ ...r, total: Number(r.total) })),
    contracts: fix(docs[3]),
    projects: fix(projects),
  })
})

// ─── LEAD → ACCOUNT CONVERSION ───────────────────────────────────────────────

// POST /api/crm/convert/lead/:id
//
// The seam between the two cores. The lead keeps everything it has — the raw
// inbound record, its UTM attribution, its own timeline — and an Account plus a
// Contact are created from it, carrying the history across so the account does
// not open on the day it was created with nothing behind it.
crmRoutes.post(
  '/convert/lead/:id',
  zValidator(
    'json',
    z.object({
      accountName: z.string().min(1).max(180).optional(),
      accountTypeId: z.number().nullish(),
      industryId: z.number().nullish(),
      /** Attach to an account that already exists instead of making a new one. */
      existingAccountId: z.number().nullish(),
    }),
  ),
  async (c) => {
    const leadId = BigInt(c.req.param('id'))
    const user = c.get('user')
    const body = c.req.valid('json')

    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) return c.json({ error: 'Lead not found' }, 404)

    // Converting twice would silently create a duplicate company — the exact
    // mess the whole account model exists to avoid.
    // Now a real check against the link rather than a string match on an
    // activity subject, which broke the moment anybody reworded it.
    const already = await prisma.leadBusiness.findFirst({
      where: { leadId, accountId: { not: null } },
      select: { accountId: true },
    })
    if (already) {
      return c.json(
        {
          error: 'This lead has already been converted.',
          accountId: Number(already.accountId),
        },
        409,
      )
    }

    // A company name typed on the lead beats the person's name — on a B2B lead
    // "Nimbus Retail" is the account, not "Priya Raghavan".
    const existingBusiness = await prisma.leadBusiness.findUnique({ where: { leadId } })

    const account = body.existingAccountId
      ? await prisma.account.findUnique({ where: { id: BigInt(body.existingAccountId) } })
      : await prisma.account.create({
          data: {
            // Falls back to the lead's own name: a one-person enquiry is a
            // perfectly valid account, it is just an account of one.
            name: body.accountName?.trim() || existingBusiness?.companyName?.trim() || lead.name,
            accountTypeId: body.accountTypeId ? BigInt(body.accountTypeId) : null,
            industryId: body.industryId ? BigInt(body.industryId) : null,
            status: 'prospect',
            email: lead.email,
            phone: lead.mobile,
            ownerId: lead.userId,
            createdById: BigInt(user.userId),
          },
        })

    if (!account) return c.json({ error: 'That account no longer exists.' }, 404)

    if (!account.accountNumber) {
      await prisma.account.update({
        where: { id: account.id },
        data: { accountNumber: `ACC-${String(account.id).padStart(6, '0')}` },
      })
    }

    // The lead's address becomes the account's head office. Skipped entirely
    // when the lead carried none, rather than creating an empty location that
    // somebody has to notice and delete.
    const hasAddress = Boolean(lead.homeAddress || lead.city || lead.state || lead.pincode)
    if (hasAddress && !body.existingAccountId) {
      await prisma.crmLocation.create({
        data: {
          accountId: account.id,
          name: 'Head Office',
          type: 'head_office',
          address: lead.homeAddress,
          city: lead.city,
          state: lead.state,
          country: lead.country,
          pincode: lead.pincode,
          phone: lead.homeContactNumber,
          isPrimary: true,
        },
      })
    }

    const [firstName, ...rest] = lead.name.trim().split(/\s+/)
    const contact = await prisma.contact.create({
      data: {
        accountId: account.id,
        firstName: firstName || lead.name,
        lastName: rest.join(' ') || null,
        email: lead.email,
        mobile: lead.mobile,
        role: 'unknown',
        ownerId: lead.userId,
      },
    })

    // Nothing to copy: the account's timeline reads the lead's rows through
    // timelineScopes(), so it already opens with the full history behind it.

    // The link itself. Without this the answer to "which account did this lead
    // become?" lives only in an activity's meta JSON — readable by a human,
    // useless to a query.
    await prisma.leadBusiness.upsert({
      where: { leadId },
      create: {
        leadId,
        companyName: account.name,
        accountId: account.id,
        contactId: contact.id,
        convertedAt: new Date(),
      },
      update: {
        companyName: existingBusiness?.companyName || account.name,
        accountId: account.id,
        contactId: contact.id,
        convertedAt: new Date(),
      },
    })

    // One row, not one per side. The lead and the account share a timeline now,
    // so writing "Converted to account X" and "Created from lead #N" would say
    // the same thing twice, a line apart, in the same feed.
    await activity.recordSafe({
      entityType: 'lead',
      entityId: leadId,
      kind: 'system',
      subject: `Converted to account ${account.name}`,
      actorId: user.userId,
      meta: { accountId: Number(account.id), contactId: Number(contact.id) },
    })

    return c.json({ account: serializeAccount(account), contact: serializeContact(contact) }, 201)
  },
)
