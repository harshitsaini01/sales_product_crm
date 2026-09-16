// Bulk routes — the admin-facing surface for the new bulk engine.
//
// Surface map:
//   POST /bulk/select-ids        resolve a filter to a sorted id list (cap 100k)
//   POST /bulk/resolve-import    paste of ids or mobiles → matched + missing
//   POST /bulk/apply             execute a recipe (dry-run or live) on filter|ids
//   GET  /bulk/operations        list past operations (paginated)
//   GET  /bulk/operations/:id    one operation (with snapshot metadata stripped)
//   POST /bulk/operations/:id/undo  replay snapshot
//   GET  /bulk/presets           list current admin's saved presets
//   POST /bulk/presets           create a preset
//   PATCH /bulk/presets/:id      rename / replace
//   DELETE /bulk/presets/:id     delete a preset
//   POST /bulk/export            stream a CSV of leads matching filter|ids
//   POST /bulk/dedupe-merge      thin wrapper around the existing /leads/merge,
//                                writes a BulkOperation row for the audit trail
//
// Everything is admin-only — only the top-level admin / sub-admin should ever
// be doing bulk writes against tens of thousands of leads.

import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import { stringify } from 'csv-stringify/sync'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { buildLeadWhere } from './leads.routes'
import {
  runBulkOperation,
  undoOperation,
  type BulkStep,
} from '../services/bulk/bulk-engine'

export const bulkRoutes = new Hono()

bulkRoutes.use('*', authenticate)
bulkRoutes.use('*', adminOnly)

// ─── JSON helper ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonSafe(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(jsonSafe)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = jsonSafe(obj[k])
    return out
  }
  return obj
}

const HARD_ID_CAP = 100_000

async function resolveFilterIds(
  filter: Record<string, string | undefined>,
  userId: number,
  role: string,
): Promise<bigint[]> {
  const where = await buildLeadWhere(filter, userId, role) as Prisma.LeadWhereInput
  const rows = await prisma.lead.findMany({
    where,
    select: { id: true },
    take: HARD_ID_CAP,
    orderBy: { id: 'desc' },
  })
  return rows.map((r) => r.id)
}

// ─── Select-ids ──────────────────────────────────────────────────────────────
// Powers the "Select all 12,345 matching" affordance. Bounded at 100k —
// anything larger should use a filter+apply payload instead of materialising
// ids client-side.
bulkRoutes.post('/select-ids', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as { filter?: Record<string, string> }
  const filter = body.filter ?? {}
  const ids = await resolveFilterIds(filter, user.userId, user.role)
  return c.json({ total: ids.length, ids: ids.map((v) => Number(v)) })
})

// ─── Resolve-import ──────────────────────────────────────────────────────────
// User pastes a column of lead IDs or 10-digit mobile numbers; we resolve them
// to matched lead ids and report what couldn't be matched. Mixed lists are
// allowed — any token longer than 9 digits is treated as a mobile.
bulkRoutes.post('/resolve-import', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { tokens?: string[] }
  const tokens = (Array.isArray(body.tokens) ? body.tokens : [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
  if (!tokens.length) return c.json({ matched: [], missing: [] })

  // Partition: numeric ≤9 digits → lead id, ≥10 digits → mobile
  const idCandidates: bigint[] = []
  const mobileCandidates: string[] = []
  for (const t of tokens) {
    const digits = t.replace(/[^0-9]/g, '')
    if (!digits) continue
    if (digits.length <= 9) {
      try { idCandidates.push(BigInt(digits)) } catch { /* ignore */ }
    } else {
      // last 10 digits for normalisation, e.g. +919999999999 → 9999999999
      mobileCandidates.push(digits.slice(-10))
    }
  }

  const [byId, byMobile] = await Promise.all([
    idCandidates.length
      ? prisma.lead.findMany({
          where: { id: { in: idCandidates } },
          select: { id: true, name: true, mobile: true, email: true, trash: true },
        })
      : Promise.resolve([] as Array<{ id: bigint; name: string; mobile: string | null; email: string | null; trash: number }>),
    mobileCandidates.length
      ? prisma.$queryRaw<Array<{ id: bigint; name: string; mobile: string | null; email: string | null; trash: number }>>`
          SELECT id, name, mobile, email, trash
          FROM leads
          WHERE RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) = ANY(${mobileCandidates}::text[])
        `
      : Promise.resolve([]),
  ])

  const matchedIds = new Set<string>()
  const matched: Array<{ id: number; name: string; mobile: string | null; email: string | null; trash: number }> = []
  for (const r of [...byId, ...byMobile]) {
    const key = r.id.toString()
    if (matchedIds.has(key)) continue
    matchedIds.add(key)
    matched.push({ id: Number(r.id), name: r.name, mobile: r.mobile, email: r.email, trash: r.trash })
  }

  // Missing = original tokens whose digits weren't matched
  const matchedIdStrings = new Set(matched.map((m) => String(m.id)))
  const matchedMobileLast10 = new Set(
    matched
      .map((m) => (m.mobile ?? '').replace(/[^0-9]/g, ''))
      .filter((d) => d.length >= 10)
      .map((d) => d.slice(-10)),
  )
  const missing: string[] = []
  for (const t of tokens) {
    const digits = t.replace(/[^0-9]/g, '')
    if (!digits) { missing.push(t); continue }
    if (digits.length <= 9) {
      if (!matchedIdStrings.has(digits)) missing.push(t)
    } else {
      if (!matchedMobileLast10.has(digits.slice(-10))) missing.push(t)
    }
  }

  return c.json({ matched, missing })
})

// ─── Apply (the centerpiece) ─────────────────────────────────────────────────
// Body shape:
//   {
//     filter?: { ... },           // any lead-list filter; resolved server-side
//     leadIds?: number[],         // explicit ids — takes precedence if provided
//     recipe: BulkStep[],         // 1+ steps; executed in order
//     dryRun?: boolean,           // preview only — returns sample, writes nothing
//   }
bulkRoutes.post('/apply', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as {
    filter?: Record<string, string>
    leadIds?: Array<number | string>
    recipe?: BulkStep[]
    dryRun?: boolean
  }

  const recipe = Array.isArray(body.recipe) ? body.recipe : []
  if (!recipe.length) return c.json({ error: 'recipe required (1+ steps)' }, 400)

  // Convert provided ids → bigints. If none, resolveIds will run filter later.
  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds
        .map((v) => { try { return BigInt(v) } catch { return null } })
        .filter((v): v is bigint => v !== null)
    : undefined

  const kind = recipe.length === 1 ? recipe[0].type : 'apply'

  const result = await runBulkOperation({
    actorId: BigInt(user.userId),
    kind,
    leadIds,
    filter: body.filter,
    resolveIds: leadIds && leadIds.length
      ? undefined
      : () => resolveFilterIds(body.filter ?? {}, user.userId, user.role),
    recipe,
    dryRun: !!body.dryRun,
    source: 'web',
  })

  return c.json(jsonSafe(result))
})

// ─── Operations log ──────────────────────────────────────────────────────────
bulkRoutes.get('/operations', async (c) => {
  const q = c.req.query()
  const page = Math.max(1, Number(q.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25))
  const skip = (page - 1) * limit
  const where: Prisma.BulkOperationWhereInput = {}
  if (q.kind) where.kind = q.kind
  if (q.status) where.status = q.status
  if (q.actorId) where.actorId = BigInt(q.actorId)

  const [total, rows] = await Promise.all([
    prisma.bulkOperation.count({ where }),
    prisma.bulkOperation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, actorId: true, kind: true, status: true, source: true, dryRun: true,
        filter: true, recipe: true, total: true, processed: true, succeeded: true,
        failed: true, message: true, undoneAt: true, startedAt: true, finishedAt: true,
        createdAt: true,
        actor: { select: { id: true, name: true } },
      },
    }),
  ])

  return c.json(jsonSafe({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) }))
})

bulkRoutes.get('/operations/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const op = await prisma.bulkOperation.findUnique({
    where: { id },
    include: { actor: { select: { id: true, name: true } } },
  })
  if (!op) return c.json({ error: 'Not found' }, 404)
  // Snapshot bodies can be large — only ship metadata in the response.
  const snap = op.snapshot as { leads?: Array<unknown>; assignments?: Array<unknown> } | null
  return c.json(jsonSafe({
    ...op,
    snapshot: undefined,
    snapshotMeta: snap
      ? { leadCount: snap.leads?.length ?? 0, assignmentCount: snap.assignments?.length ?? 0 }
      : null,
  }))
})

bulkRoutes.post('/operations/:id/undo', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))
  try {
    const out = await undoOperation(id, BigInt(user.userId))
    return c.json(out)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'undo failed'
    return c.json({ error: msg }, 400)
  }
})

// ─── Presets ─────────────────────────────────────────────────────────────────
bulkRoutes.get('/presets', async (c) => {
  const user = c.get('user')
  const presets = await prisma.bulkPreset.findMany({
    where: { ownerId: BigInt(user.userId) },
    orderBy: { updatedAt: 'desc' },
  })
  return c.json(jsonSafe(presets))
})

bulkRoutes.post('/presets', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as { name?: string; filter?: unknown; recipe?: BulkStep[] }
  if (!body.name || !Array.isArray(body.recipe) || body.recipe.length === 0) {
    return c.json({ error: 'name and a non-empty recipe are required' }, 400)
  }
  const created = await prisma.bulkPreset.create({
    data: {
      ownerId: BigInt(user.userId),
      name: body.name,
      filter: (body.filter ?? {}) as Prisma.InputJsonValue,
      recipe: body.recipe as unknown as Prisma.InputJsonValue,
    },
  })
  return c.json(jsonSafe(created))
})

bulkRoutes.patch('/presets/:id', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json().catch(() => ({})) as { name?: string; filter?: unknown; recipe?: BulkStep[] }
  // Ownership check — admins still can't edit another admin's preset.
  const existing = await prisma.bulkPreset.findUnique({ where: { id } })
  if (!existing || existing.ownerId !== BigInt(user.userId)) {
    return c.json({ error: 'Not found' }, 404)
  }
  const data: Prisma.BulkPresetUpdateInput = {}
  if (body.name !== undefined) data.name = body.name
  if (body.filter !== undefined) data.filter = body.filter as Prisma.InputJsonValue
  if (body.recipe !== undefined) data.recipe = body.recipe as unknown as Prisma.InputJsonValue
  const updated = await prisma.bulkPreset.update({ where: { id }, data })
  return c.json(jsonSafe(updated))
})

bulkRoutes.delete('/presets/:id', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))
  const existing = await prisma.bulkPreset.findUnique({ where: { id } })
  if (!existing || existing.ownerId !== BigInt(user.userId)) {
    return c.json({ error: 'Not found' }, 404)
  }
  await prisma.bulkPreset.delete({ where: { id } })
  return c.json({ ok: true })
})

// ─── Export CSV ──────────────────────────────────────────────────────────────
// Streams a CSV of leads matching either an explicit id list or a filter.
// Caps at HARD_ID_CAP rows; admins doing bigger exports should slice the
// filter (by date range usually).
bulkRoutes.post('/export', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as {
    filter?: Record<string, string>
    leadIds?: Array<number | string>
    columns?: string[]
  }

  let ids: bigint[]
  if (Array.isArray(body.leadIds) && body.leadIds.length) {
    ids = body.leadIds
      .map((v) => { try { return BigInt(v) } catch { return null } })
      .filter((v): v is bigint => v !== null)
  } else {
    ids = await resolveFilterIds(body.filter ?? {}, user.userId, user.role)
  }

  if (!ids.length) return c.text('No leads to export', 404)

  const defaultColumns = [
    'id', 'name', 'father', 'email', 'mobile', 'mobile2', 'city', 'state',
    'country', 'leadStatus', 'leadSubStatus', 'leadType', 'intrestedCourse',
    'intrestedUniversity', 'source', 'event', 'website', 'called', 'wapp',
    'followupDate', 'createdAt',
  ]
  const cols = Array.isArray(body.columns) && body.columns.length ? body.columns : defaultColumns

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: Object.fromEntries(cols.map((c) => [c, true])) as Prisma.LeadSelect,
  })

  const rows = leads.map((l) => {
    const out: Record<string, unknown> = {}
    for (const c of cols) {
      const v = (l as Record<string, unknown>)[c]
      out[c] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v
    }
    return out
  })

  const csv = stringify(rows, { header: true, columns: cols })
  const filename = `leads-export-${Date.now()}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

// ─── Dedupe merge wrapper ────────────────────────────────────────────────────
// Same effect as POST /leads/merge but writes a BulkOperation row so the
// merge shows up in the operations log alongside other bulk actions.
bulkRoutes.post('/dedupe-merge', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as { keepId?: number; mergeIds?: number[] }
  if (!body.keepId || !Array.isArray(body.mergeIds) || !body.mergeIds.length) {
    return c.json({ error: 'keepId and mergeIds[] required' }, 400)
  }
  const op = await prisma.bulkOperation.create({
    data: {
      actorId: BigInt(user.userId),
      kind: 'merge',
      status: 'running',
      source: 'web',
      filter: Prisma.JsonNull,
      recipe: ([{ type: 'merge', keepId: body.keepId, mergeIds: body.mergeIds }] as unknown) as Prisma.InputJsonValue,
      total: body.mergeIds.length,
      startedAt: new Date(),
    },
  })

  try {
    const keepBig = BigInt(body.keepId)
    const mergeBigs = body.mergeIds.map(BigInt)

    await prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.leadFollowup.updateMany({ where: { stdId: { in: mergeBigs } }, data: { stdId: keepBig } }),
        tx.leadNote.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
        tx.reminder.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
        tx.studentDocument.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
        tx.callLog.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
        tx.asignedLead.deleteMany({ where: { stdId: { in: mergeBigs } } }),
        tx.leadStatusHistory.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
      ])
      await tx.lead.updateMany({
        where: { id: { in: mergeBigs } },
        data: { trash: 1, updatedAt: new Date() },
      })
    })

    await prisma.bulkOperation.update({
      where: { id: op.id },
      data: {
        status: 'completed',
        processed: body.mergeIds.length,
        succeeded: body.mergeIds.length,
        finishedAt: new Date(),
        message: `Merged ${body.mergeIds.length} lead(s) into #${body.keepId}`,
      },
    })

    return c.json({ message: `Merged ${body.mergeIds.length} lead(s) into #${body.keepId}`, operationId: Number(op.id) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'merge failed'
    await prisma.bulkOperation.update({
      where: { id: op.id },
      data: { status: 'failed', message: msg, finishedAt: new Date() },
    })
    return c.json({ error: msg }, 500)
  }
})

// ─── Re-run a past operation ─────────────────────────────────────────────────
// Clones the original recipe + filter, evaluates the filter fresh (so the id
// set reflects the current state), then runs.
bulkRoutes.post('/operations/:id/rerun', async (c) => {
  const user = c.get('user')
  const id = BigInt(c.req.param('id'))
  const op = await prisma.bulkOperation.findUnique({ where: { id } })
  if (!op) return c.json({ error: 'Not found' }, 404)

  const recipe = (op.recipe as unknown as BulkStep[]) ?? []
  const filter = (op.filter as Record<string, string> | null) ?? {}
  const result = await runBulkOperation({
    actorId: BigInt(user.userId),
    kind: recipe.length === 1 ? recipe[0].type : 'apply',
    filter,
    resolveIds: () => resolveFilterIds(filter, user.userId, user.role),
    recipe,
    dryRun: false,
    source: 'web',
  })
  return c.json(jsonSafe(result))
})
