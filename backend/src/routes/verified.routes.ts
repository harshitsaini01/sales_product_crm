import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { applyFieldUpdate } from '../services/leads/field-update.service'

export const verifiedRoutes = new Hono()

verifiedRoutes.use('*', authenticate)

// Fields that can be verified. Must match the lead columns and the whitelist
// used by /leads/field-update.
const VERIFIABLE_FIELDS = [
  'city', 'state', 'country', 'nationality',
  'source', 'event', 'website', 'intrestedCourse', 'intrestedUniversity',
] as const
type VerifiableField = typeof VERIFIABLE_FIELDS[number]

function isVerifiableField(f: string): f is VerifiableField {
  return (VERIFIABLE_FIELDS as readonly string[]).includes(f)
}

// Cities roll up into states, states into countries. Used by /candidates to
// report which parent value the leads already carry for each value.
const PARENT_OF: Partial<Record<VerifiableField, VerifiableField>> = {
  city: 'state',
  state: 'country',
}

// GET /verified?field=state — list verified values for one field.
//
// Readable by any signed-in staff member, not just admins. The Bucket page
// renders green ticks against city/state for everyone who can open it (the
// route only requires `showBucket`, not admin), so an adminOnly guard here
// meant two guaranteed 403s per Bucket load for every counsellor. There was
// nothing to protect either: /verified/all-fields already hands the same
// values to any authenticated user. Writes below stay admin-only.
verifiedRoutes.get('/', async (c) => {
  const field = c.req.query('field')
  if (!field || !isVerifiableField(field)) return c.json({ error: 'Invalid field' }, 400)

  const rows = await prisma.verifiedFieldValue.findMany({
    where: { field },
    orderBy: { value: 'asc' },
  })

  const actorIds = Array.from(new Set(rows.map((r) => r.verifiedBy)))
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : []
  const actorMap = new Map(actors.map((a) => [String(a.id), a.name]))

  return c.json(rows.map((r) => ({
    id: Number(r.id),
    field: r.field,
    value: r.value,
    parent: r.parent,
    verifiedBy: Number(r.verifiedBy),
    verifiedByName: actorMap.get(String(r.verifiedBy)) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })))
})

// GET /verified/all-fields — bulk fetch grouped by field. Cached client-side to
// render green ticks anywhere in the UI.
verifiedRoutes.get('/all-fields', async (c) => {
  const rows = await prisma.verifiedFieldValue.findMany({
    select: { field: true, value: true, parent: true },
  })
  const out: Record<string, Array<{ value: string; parent: string | null }>> = {}
  for (const r of rows) {
    if (!out[r.field]) out[r.field] = []
    out[r.field].push({ value: r.value, parent: r.parent })
  }
  return c.json(out)
})

// GET /verified/candidates?field=state — every distinct value from leads
// with counts, plus a `verified` flag and (when verified) the parent + id.
// This drives the unified manage list — one place to see all values, verify
// unverified ones, and unverify verified ones.
verifiedRoutes.get('/candidates', adminOnly, async (c) => {
  const field = c.req.query('field')
  if (!field || !isVerifiableField(field)) return c.json({ error: 'Invalid field' }, 400)

  const parentField = PARENT_OF[field]

  // Grouped by (value, parent) so we can tell, per value, which parent the
  // leads already carry — e.g. which state each city is already assigned to.
  // Rows with a NULL lead_parent are the ones a cascade would actually fill.
  const raw = await prisma.$queryRawUnsafe<Array<{ value: string | null; lead_parent: string | null; count: bigint }>>(
    `SELECT "${field}" AS value,
            ${parentField ? `NULLIF(TRIM("${parentField}"), '')` : 'NULL::text'} AS lead_parent,
            COUNT(*)::bigint AS count
     FROM leads
     WHERE trash = 0 AND "${field}" IS NOT NULL AND "${field}" <> ''
     GROUP BY 1, 2`
  )

  // Collapse the (value, parent) groups back to one row per value: total lead
  // count, how many of those leads have no parent yet, and the parent spread.
  const agg = new Map<string, { count: number; blank: number; parents: Map<string, number> }>()
  for (const r of raw) {
    if (r.value == null) continue
    let entry = agg.get(r.value)
    if (!entry) { entry = { count: 0, blank: 0, parents: new Map() }; agg.set(r.value, entry) }
    const n = Number(r.count)
    entry.count += n
    if (r.lead_parent) entry.parents.set(r.lead_parent, (entry.parents.get(r.lead_parent) ?? 0) + n)
    else entry.blank += n
  }

  const verified = await prisma.verifiedFieldValue.findMany({
    where: { field },
    select: { id: true, value: true, parent: true },
  })
  const verifiedMap = new Map(verified.map((v) => [v.value, v]))

  // Keeps the payload sane on fields with thousands of values — the tail of a
  // parent spread is junk anyway, and the UI only renders a short list.
  const MAX_PARENTS = 8

  // Values that exist in leads
  const rows = Array.from(agg.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([value, entry]) => {
      const v = verifiedMap.get(value)
      const byFreq = Array.from(entry.parents.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([pv, pc]) => ({ value: pv, count: pc }))
      return {
        value,
        count: entry.count,
        verified: !!v,
        verifiedId: v ? Number(v.id) : null,
        parent: v?.parent ?? null,
        leadParent: (byFreq[0]?.value ?? null) as string | null,
        leadParentOthers: Math.max(0, byFreq.length - 1),
        leadParentBlank: parentField ? entry.blank : 0,
        leadParents: byFreq.slice(0, MAX_PARENTS),
      }
    })

  // Values that are verified but no longer present in leads (stale but keep visible)
  for (const v of verified) {
    if (!agg.has(v.value)) {
      rows.push({
        value: v.value, count: 0, verified: true, verifiedId: Number(v.id),
        parent: v.parent ?? null, leadParent: null, leadParentOthers: 0,
        leadParentBlank: 0, leadParents: [],
      })
    }
  }

  return c.json(rows)
})

// POST /verified — add one
verifiedRoutes.post('/', adminOnly, async (c) => {
  const user = c.get('user')
  const { field, value, parent } = await c.req.json() as {
    field: string; value: string; parent?: string | null
  }
  if (!field || !isVerifiableField(field)) return c.json({ error: 'Invalid field' }, 400)
  if (!value?.trim()) return c.json({ error: 'Value required' }, 400)

  const row = await prisma.verifiedFieldValue.upsert({
    where: { field_value: { field, value: value.trim() } },
    create: {
      field,
      value: value.trim(),
      parent: parent?.trim() || null,
      verifiedBy: BigInt(user.userId),
    },
    update: {
      parent: parent?.trim() || null,
      verifiedBy: BigInt(user.userId),
    },
  })

  return c.json({
    id: Number(row.id), field: row.field, value: row.value, parent: row.parent,
  })
})

// POST /verified/bulk — mark many at once
verifiedRoutes.post('/bulk', adminOnly, async (c) => {
  const user = c.get('user')
  const { field, values } = await c.req.json() as {
    field: string
    values: Array<{ value: string; parent?: string | null }>
  }
  if (!field || !isVerifiableField(field)) return c.json({ error: 'Invalid field' }, 400)
  if (!Array.isArray(values) || !values.length) return c.json({ error: 'values required' }, 400)

  let added = 0
  for (const v of values) {
    const trimmed = v.value?.trim()
    if (!trimmed) continue
    await prisma.verifiedFieldValue.upsert({
      where: { field_value: { field, value: trimmed } },
      create: {
        field, value: trimmed,
        parent: v.parent?.trim() || null,
        verifiedBy: BigInt(user.userId),
      },
      update: {
        parent: v.parent?.trim() || null,
        verifiedBy: BigInt(user.userId),
      },
    })
    added++
  }
  return c.json({ added })
})

// DELETE /verified/:id
verifiedRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.verifiedFieldValue.delete({ where: { id } })
  return c.json({ ok: true })
})

// POST /verified/cascade-fill
// Pick verified values from sourceField -> set targetField = targetValue on all
// leads matching. E.g. sourceField='city', sourceValues=['Bangalore','Mysore'],
// targetField='state', targetValue='Karnataka'.
verifiedRoutes.post('/cascade-fill', adminOnly, async (c) => {
  const user = c.get('user')
  const body = await c.req.json() as {
    sourceField: string
    sourceValues: string[]
    targetField: string
    targetValue: string
    approvedLeadIds?: number[]
  }
  const { sourceField, sourceValues, targetField, targetValue, approvedLeadIds } = body

  if (!isVerifiableField(sourceField)) return c.json({ error: 'Invalid sourceField' }, 400)
  if (!isVerifiableField(targetField)) return c.json({ error: 'Invalid targetField' }, 400)
  if (sourceField === targetField) return c.json({ error: 'sourceField and targetField must differ' }, 400)
  if (!Array.isArray(sourceValues) || !sourceValues.length) return c.json({ error: 'sourceValues required' }, 400)
  if (!targetValue?.trim()) return c.json({ error: 'targetValue required' }, 400)

  const result = await applyFieldUpdate({
    filterField: sourceField,
    filterValues: sourceValues,
    writeField: targetField,
    writeValue: targetValue.trim(),
    approvedLeadIds,
    actorId: BigInt(user.userId),
    kindLabel: `cascade:${sourceField}->${targetField}`,
  })

  return c.json(result)
})
