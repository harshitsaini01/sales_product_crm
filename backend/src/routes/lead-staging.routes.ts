import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bigintFix(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(bigintFix)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = bigintFix(obj[k])
    return out
  }
  return obj
}

export const leadStagingRoutes = new Hono()

// Authenticate everyone; per-route guards below decide admin-only vs scoped
// counsellor access. Counsellors can see/verify/seed batches that have been
// assigned to them; admins can do everything.
leadStagingRoutes.use('*', authenticate)

// Admins (incl. sub-admin) get the full list; counsellors get only the
// batches that have been assigned to them.
function isAdminUser(user: { role?: string; roles?: string[] }) {
  return (
    user.role === 'admin' ||
    user.role === 'sub-admin' ||
    !!user.roles?.some((r) => r === 'admin' || r === 'sub-admin')
  )
}

// ─── List batches (admin: all, counsellor: only their assigned ones) ───────
// Query: ?trash=1 → return soft-deleted batches instead of active ones.
// Trash is admin-only — counsellors never see deleted batches even via the flag.
leadStagingRoutes.get('/', async (c) => {
  const user = c.get('user')
  const admin = isAdminUser(user)
  const trash = c.req.query('trash') === '1'

  if (trash && !admin) return c.json({ error: 'Forbidden' }, 403)

  const deletedFilter = trash
    ? { deletedAt: { not: null } }
    : { deletedAt: null }

  const batches = await prisma.leadStagingBatch.findMany({
    where: admin
      ? deletedFilter
      : { ...deletedFilter, assignees: { some: { userId: BigInt(user.userId) } } },
    include: {
      assignees: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
    orderBy: trash ? { deletedAt: 'desc' } : { createdAt: 'desc' },
    take: 200,
  })

  const out = batches.map((b) => ({
    ...b,
    assignees: b.assignees.map((a) => ({
      id: Number(a.user.id),
      name: a.user.name,
    })),
  }))
  return c.json(bigintFix(out))
})

// ─── Replace the assignee list for a batch (admin only) ────────────────────
// Body: { userIds: number[] }  — pass [] to clear all assignments.
// The full set is replaced atomically: any counsellor not in the new list is
// dropped, any new id is added, existing ids stay.
leadStagingRoutes.patch('/:id/assign', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json<{ userIds?: number[] | null }>()
  const userIds = Array.isArray(body.userIds) ? body.userIds : []

  // Dedupe + coerce + drop falsy values so the join writes are clean.
  const unique = Array.from(
    new Set(userIds.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)),
  )

  const batch = await prisma.leadStagingBatch.findUnique({ where: { id } })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)

  if (unique.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: unique.map((n) => BigInt(n)) } },
      select: { id: true },
    })
    if (found.length !== unique.length) {
      return c.json({ error: 'One or more counsellors not found' }, 404)
    }
  }

  // Replace the full list in one transaction.
  await prisma.$transaction([
    prisma.leadStagingBatchAssignee.deleteMany({ where: { batchId: id } }),
    ...(unique.length > 0
      ? [
          prisma.leadStagingBatchAssignee.createMany({
            data: unique.map((uid) => ({ batchId: id, userId: BigInt(uid) })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ])

  const updated = await prisma.leadStagingBatch.findUnique({
    where: { id },
    include: {
      assignees: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  })
  const out = updated
    ? {
        ...updated,
        assignees: updated.assignees.map((a) => ({
          id: Number(a.user.id),
          name: a.user.name,
        })),
      }
    : null
  return c.json(bigintFix(out))
})

// ─── Create batch (with items) ─────────────────────────────────────────────
// Body: { name, fileName?, items: LeadStagingUploadRow[] }
// Each row supports the full Lead profile so the seeded Lead row gets
// populated in one pass instead of only Name/Email/Phone.
type UploadRow = {
  name?: string
  email?: string
  phone?: string
  father?: string
  mother?: string
  email2?: string
  email3?: string
  mobile2?: string
  mobile3?: string
  fatherMobile?: string
  motherMobile?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  dob?: string
  gender?: string
  nationality?: string
  intrestedCourse?: string
  intrestedUniversity?: string
  event?: string
  source?: string
  leadType?: string
  leadComment?: string
}

const trimOrNull = (v: unknown) => {
  const s = v == null ? '' : String(v).trim()
  return s ? s : null
}

leadStagingRoutes.post('/', adminOnly, async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{
    name?: string
    fileName?: string
    items?: UploadRow[]
  }>()

  const batchName = (body.name || '').trim()
  if (!batchName) return c.json({ error: 'Batch name is required' }, 400)
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'At least one row is required' }, 400)
  }

  // Normalise + filter blank rows. A row is kept if it has at least one of
  // name / email / phone / mobile-variants — any other field alone isn't
  // enough to make a usable lead.
  const cleanItems = body.items
    .map((r) => ({
      name: trimOrNull(r.name),
      email: trimOrNull(r.email),
      phone: trimOrNull(r.phone),
      father: trimOrNull(r.father),
      mother: trimOrNull(r.mother),
      email2: trimOrNull(r.email2),
      email3: trimOrNull(r.email3),
      mobile2: trimOrNull(r.mobile2),
      mobile3: trimOrNull(r.mobile3),
      fatherMobile: trimOrNull(r.fatherMobile),
      motherMobile: trimOrNull(r.motherMobile),
      city: trimOrNull(r.city),
      state: trimOrNull(r.state),
      country: trimOrNull(r.country),
      pincode: trimOrNull(r.pincode),
      dob: trimOrNull(r.dob),
      gender: trimOrNull(r.gender),
      nationality: trimOrNull(r.nationality),
      intrestedCourse: trimOrNull(r.intrestedCourse),
      intrestedUniversity: trimOrNull(r.intrestedUniversity),
      event: trimOrNull(r.event),
      source: trimOrNull(r.source),
      leadType: trimOrNull(r.leadType),
      leadComment: trimOrNull(r.leadComment),
    }))
    .filter((r) =>
      r.name || r.email || r.phone || r.email2 || r.email3 ||
      r.mobile2 || r.mobile3 || r.fatherMobile || r.motherMobile,
    )
    .map((r) => ({ ...r, name: r.name || '(no name)' }))

  if (cleanItems.length === 0) {
    return c.json({ error: 'No valid rows in upload' }, 400)
  }

  const batch = await prisma.leadStagingBatch.create({
    data: {
      name: batchName,
      fileName: body.fileName ?? null,
      uploadedById: BigInt(user.userId),
      totalCount: cleanItems.length,
      items: { create: cleanItems },
    },
    include: { items: false },
  })

  return c.json(bigintFix({ ...batch, assignees: [] }), 201)
})

// ─── Append more items to an existing batch (admin only) ──────────────────
// Body: { items: UploadRow[] }
// New rows are appended (auto-increment id keeps them after existing ones);
// totalCount is bumped so the dashboard stays accurate. Verified/rejected
// counts are untouched because new items start as pending.
leadStagingRoutes.post('/:id/items', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json<{ items?: UploadRow[] }>()

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'At least one row is required' }, 400)
  }

  const batch = await prisma.leadStagingBatch.findUnique({ where: { id } })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  if (batch.deletedAt) {
    return c.json({ error: 'Restore the batch from trash before adding more leads' }, 400)
  }

  const cleanItems = body.items
    .map((r) => ({
      name: trimOrNull(r.name),
      email: trimOrNull(r.email),
      phone: trimOrNull(r.phone),
      father: trimOrNull(r.father),
      mother: trimOrNull(r.mother),
      email2: trimOrNull(r.email2),
      email3: trimOrNull(r.email3),
      mobile2: trimOrNull(r.mobile2),
      mobile3: trimOrNull(r.mobile3),
      fatherMobile: trimOrNull(r.fatherMobile),
      motherMobile: trimOrNull(r.motherMobile),
      city: trimOrNull(r.city),
      state: trimOrNull(r.state),
      country: trimOrNull(r.country),
      pincode: trimOrNull(r.pincode),
      dob: trimOrNull(r.dob),
      gender: trimOrNull(r.gender),
      nationality: trimOrNull(r.nationality),
      intrestedCourse: trimOrNull(r.intrestedCourse),
      intrestedUniversity: trimOrNull(r.intrestedUniversity),
      event: trimOrNull(r.event),
      source: trimOrNull(r.source),
      leadType: trimOrNull(r.leadType),
      leadComment: trimOrNull(r.leadComment),
    }))
    .filter((r) =>
      r.name || r.email || r.phone || r.email2 || r.email3 ||
      r.mobile2 || r.mobile3 || r.fatherMobile || r.motherMobile,
    )
    .map((r) => ({ ...r, name: r.name || '(no name)', batchId: id }))

  if (cleanItems.length === 0) {
    return c.json({ error: 'No valid rows in upload' }, 400)
  }

  await prisma.leadStagingItem.createMany({ data: cleanItems })
  const updated = await prisma.leadStagingBatch.update({
    where: { id },
    data: { totalCount: { increment: cleanItems.length } },
  })

  return c.json(bigintFix({ added: cleanItems.length, batch: updated }), 201)
})

// ─── Batch detail (with items) ─────────────────────────────────────────────
// Counsellors may only open a batch they are one of the assignees of.
leadStagingRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))
  const batch = await prisma.leadStagingBatch.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: 'asc' } },
      assignees: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  if (!isAdminUser(user)) {
    const meId = BigInt(user.userId)
    const isAssigned = batch.assignees.some((a) => a.userId === meId)
    if (!isAssigned) return c.json({ error: 'Forbidden: batch not assigned to you' }, 403)
  }

  // commentedById / verifiedById are plain BigInt columns (no Prisma relation
  // declared) so do a single bulk lookup and stitch the names onto each item.
  const userIds = new Set<bigint>()
  for (const it of batch.items) {
    if (it.commentedById) userIds.add(it.commentedById)
    if (it.verifiedById) userIds.add(it.verifiedById)
  }
  const userMap = new Map<string, { id: number; name: string }>()
  if (userIds.size > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, name: true },
    })
    for (const u of users) userMap.set(u.id.toString(), { id: Number(u.id), name: u.name })
  }

  const items = batch.items.map((it) => ({
    ...it,
    commentedBy: it.commentedById ? userMap.get(it.commentedById.toString()) ?? null : null,
    verifiedBy: it.verifiedById ? userMap.get(it.verifiedById.toString()) ?? null : null,
  }))

  const out = {
    ...batch,
    items,
    assignees: batch.assignees.map((a) => ({
      id: Number(a.user.id),
      name: a.user.name,
    })),
  }
  return c.json(bigintFix(out))
})

// ─── Update an item (verify / reject / comments) ───────────────────────────
// Body: { verified?: boolean | null, comments?: string }
// Counsellors may only update items inside batches they're assigned to.
leadStagingRoutes.patch('/items/:itemId', async (c) => {
  const user = c.get('user')
  const itemId = BigInt(c.req.param('itemId'))
  const body = await c.req.json<{
    verified?: boolean | null
    callNotAnswered?: boolean
    comments?: string
  }>()

  const existing = await prisma.leadStagingItem.findUnique({
    where: { id: itemId },
    include: {
      batch: {
        select: {
          id: true,
          assignees: { select: { userId: true } },
        },
      },
    },
  })
  if (!existing) return c.json({ error: 'Item not found' }, 404)
  if (!isAdminUser(user)) {
    const meId = BigInt(user.userId)
    const isAssigned = existing.batch.assignees.some((a) => a.userId === meId)
    if (!isAssigned) return c.json({ error: 'Forbidden: batch not assigned to you' }, 403)
  }
  if (existing.seeded) {
    return c.json({ error: 'Cannot modify a seeded item' }, 400)
  }

  // `verified` and `callNotAnswered` are three mutually-exclusive review
  // states (plus pending). Setting one clears the other so the item never
  // ends up in two buckets at once — that would corrupt the counters and
  // the filter tabs.
  const data: {
    verified?: boolean | null
    callNotAnswered?: boolean
    comments?: string
    verifiedById?: bigint | null
    commentedById?: bigint | null
  } = {}
  const meId = BigInt(user.userId)
  if ('callNotAnswered' in body) {
    data.callNotAnswered = !!body.callNotAnswered
    if (data.callNotAnswered) {
      data.verified = null
      data.verifiedById = meId
    }
  }
  if ('verified' in body) {
    data.verified = body.verified ?? null
    if (data.verified !== null) {
      data.callNotAnswered = false
      data.verifiedById = meId
    }
  }
  if ('comments' in body) {
    const next = body.comments ?? ''
    data.comments = next
    // Only stamp the comment author when there's actual text — clearing the
    // comment shouldn't pin authorship to whoever blanked it.
    data.commentedById = next.trim() ? meId : null
  }

  const updated = await prisma.leadStagingItem.update({
    where: { id: itemId },
    data,
  })

  // Stitch commenter / verifier names onto the response so the UI can show
  // attribution without a second round-trip.
  const ids = new Set<bigint>()
  if (updated.commentedById) ids.add(updated.commentedById)
  if (updated.verifiedById) ids.add(updated.verifiedById)
  const userMap = new Map<string, { id: number; name: string }>()
  if (ids.size > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, name: true },
    })
    for (const u of users) userMap.set(u.id.toString(), { id: Number(u.id), name: u.name })
  }
  const enriched = {
    ...updated,
    commentedBy: updated.commentedById ? userMap.get(updated.commentedById.toString()) ?? null : null,
    verifiedBy: updated.verifiedById ? userMap.get(updated.verifiedById.toString()) ?? null : null,
  }

  // Recompute batch counters across all three review states.
  const [verifiedAgg, callAgg] = await Promise.all([
    prisma.leadStagingItem.groupBy({
      by: ['verified'],
      where: { batchId: existing.batchId },
      _count: { _all: true },
    }),
    prisma.leadStagingItem.count({
      where: { batchId: existing.batchId, callNotAnswered: true },
    }),
  ])
  let verifiedCount = 0
  let rejectedCount = 0
  for (const row of verifiedAgg) {
    if (row.verified === true) verifiedCount = row._count._all
    else if (row.verified === false) rejectedCount = row._count._all
  }
  await prisma.leadStagingBatch.update({
    where: { id: existing.batchId },
    data: { verifiedCount, rejectedCount, callNotAnsweredCount: callAgg },
  })

  return c.json(bigintFix(enriched))
})

// ─── Seed verified items into the real leads table ─────────────────────────
// All items marked verified=true (and not yet seeded) become Lead rows with
// source = batch.name, leadType = "new". Rejected/pending items stay put.
// If the batch has assignees, each verified lead is duplicated into every
// assignee's "My Leads" (one AsignedLead row per counsellor per lead).
leadStagingRoutes.post('/:id/seed', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))
  const batch = await prisma.leadStagingBatch.findUnique({
    where: { id },
    include: { assignees: { select: { userId: true } } },
  })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  if (batch.deletedAt) {
    return c.json({ error: 'Restore the batch from trash before seeding' }, 400)
  }
  if (!isAdminUser(user)) {
    const meId = BigInt(user.userId)
    const isAssigned = batch.assignees.some((a) => a.userId === meId)
    if (!isAssigned) return c.json({ error: 'Forbidden: batch not assigned to you' }, 403)
  }

  const toSeed = await prisma.leadStagingItem.findMany({
    where: { batchId: id, verified: true, seeded: false },
  })

  if (toSeed.length === 0) {
    return c.json({ error: 'No verified items to seed' }, 400)
  }

  const seederId = BigInt(user.userId)
  let seeded = 0
  for (const item of toSeed) {
    // Attribution rule: the commenter owns the lead. A folder is parked with
    // many counsellors so each can call rows; the one who actually spoke to
    // (and wrote about) this contact is the rightful owner once seeded. Fall
    // back to the verifier if no comment was logged, and finally to the
    // seeder for legacy items that pre-date author tracking.
    const ownerId = item.commentedById ?? item.verifiedById ?? seederId

    const lead = await prisma.lead.create({
      data: {
        name: item.name,
        email: item.email ?? null,
        mobile: item.phone ?? null,
        father: item.father ?? null,
        mother: item.mother ?? null,
        email2: item.email2 ?? null,
        email3: item.email3 ?? null,
        mobile2: item.mobile2 ?? null,
        mobile3: item.mobile3 ?? null,
        fatherMobile: item.fatherMobile ?? null,
        motherMobile: item.motherMobile ?? null,
        city: item.city ?? null,
        state: item.state ?? null,
        country: item.country ?? null,
        pincode: item.pincode ?? null,
        dob: item.dob ?? null,
        gender: item.gender ?? null,
        nationality: item.nationality ?? null,
        intrestedCourse: item.intrestedCourse ?? null,
        intrestedUniversity: item.intrestedUniversity ?? null,
        comment: item.leadComment ?? null,
        // Excel-supplied source/event/leadType override the batch defaults so
        // a single batch can carry leads from multiple sources if needed.
        source: item.source ?? batch.name,
        event: item.event ?? batch.name,
        leadType: item.leadType || 'new',
        leadStatus: 'Fresh',
        website: 'Filter lead',
        userId: ownerId,
      },
    })

    // Carry the verification note (typed in the staging review UI) over as a
    // LeadComment so it shows up in the seeded lead's comment thread. The
    // Excel "Comment" column already lives in lead.comment above — this is
    // the additional note the counsellor/admin wrote while verifying.
    const verificationNote = item.comments?.trim()
    if (verificationNote) {
      await prisma.leadComment.create({
        data: {
          leadId: lead.id,
          userId: ownerId,
          comment: verificationNote,
        },
      })
    }

    // Assign the seeded lead ONLY to the counsellor who commented on it. A
    // batch can be parked with multiple counsellors so each can pick rows to
    // call; the row belongs to whoever wrote about it (and verified it, as a
    // fallback). Legacy items with no author recorded fall back to fanning out
    // to every batch assignee so we don't regress old data.
    const assignToIds = item.commentedById
      ? [item.commentedById]
      : item.verifiedById
      ? [item.verifiedById]
      : batch.assignees.map((a) => a.userId)
    if (assignToIds.length > 0) {
      await prisma.asignedLead.createMany({
        data: assignToIds.map((uid) => ({
          clrId: uid,
          stdId: lead.id,
          leadType: 'new',
          status: 1,
        })),
        skipDuplicates: true,
      })
    }

    await prisma.leadStagingItem.update({
      where: { id: item.id },
      data: { seeded: true, leadId: lead.id },
    })
    seeded++
  }

  const updatedBatch = await prisma.leadStagingBatch.update({
    where: { id },
    data: { seededCount: { increment: seeded } },
  })

  return c.json({ seeded, batch: bigintFix(updatedBatch) })
})

// ─── Soft-delete a batch (admin only — moves it to the Trash tab) ─────────
// The batch + its items stay in the DB; only deletedAt is set. Counsellors
// stop seeing it on their list (they only ever see deletedAt=null). Admin
// can restore from the Trash tab or wipe it permanently with /:id/permanent.
leadStagingRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const batch = await prisma.leadStagingBatch.findUnique({ where: { id } })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  if (batch.deletedAt) {
    return c.json({ error: 'Batch is already in trash' }, 400)
  }
  await prisma.leadStagingBatch.update({
    where: { id },
    data: { deletedAt: new Date() },
  })
  return c.json({ ok: true, trashed: true })
})

// ─── Restore a trashed batch (admin only) ──────────────────────────────────
leadStagingRoutes.post('/:id/restore', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const batch = await prisma.leadStagingBatch.findUnique({ where: { id } })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  if (!batch.deletedAt) return c.json({ error: 'Batch is not in trash' }, 400)
  await prisma.leadStagingBatch.update({
    where: { id },
    data: { deletedAt: null },
  })
  return c.json({ ok: true, restored: true })
})

// ─── Permanently delete a batch (admin only — cascades to items + assignees)
// Only callable on already-trashed batches so it can't be triggered by mistake
// from the active list.
leadStagingRoutes.delete('/:id/permanent', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const batch = await prisma.leadStagingBatch.findUnique({ where: { id } })
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  if (!batch.deletedAt) {
    return c.json({ error: 'Move the batch to trash before deleting permanently' }, 400)
  }
  await prisma.leadStagingBatch.delete({ where: { id } })
  return c.json({ ok: true, purged: true })
})
