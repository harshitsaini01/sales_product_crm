// ─────────────────────────────────────────────────────────────────────────────
// Admin-defined fields.
//
// This is the piece that stops the CRM growing a column every time a new kind
// of customer arrives. "Rooms" for a hotel, "Beds" for a hospital, "Campuses"
// for a school — same Account table, same forms, different definitions.
//
// WHY VALUES LIVE IN TYPED COLUMNS, NOT ONE JSON BLOB
//
// Because "every hotel with more than 100 rooms" has to be an indexed query. A
// JSONB blob makes that a sequential scan over every account, and a CRM whose
// filters get slower as it fills up is a CRM people stop filtering in.
//
// RETIRING IS NOT DELETING
//
// Setting a definition inactive hides it and keeps every value, matching how
// lead-field visibility already works. Turn it back on and the data is there.
// Deleting a definition is the only destructive act here, and it takes its
// values with it via ON DELETE CASCADE — so the route behind it must confirm.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import type { EntityType } from '../../config/crm-entities'

export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'select',
  'multiselect',
  'boolean',
  'email',
  'phone',
  'url',
  'file',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

const TYPE_SET = new Set<string>(FIELD_TYPES)

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === 'string' && TYPE_SET.has(v)
}

/** Which value column a type is stored in. */
function columnFor(type: FieldType): 'valueText' | 'valueNum' | 'valueDate' | 'valueBool' | 'valueJson' {
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'valueNum'
    case 'date':
    case 'datetime':
      return 'valueDate'
    case 'boolean':
      return 'valueBool'
    case 'multiselect':
      return 'valueJson'
    case 'file':
      return 'valueText'
    default:
      return 'valueText'
  }
}

/**
 * Turn a key into the canonical snake_case form.
 *
 * Done once, at definition time. The key is what every stored value is joined
 * on, so it must never change afterwards — which is why the update route
 * refuses to touch it.
 */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

export interface FieldValueInput {
  [key: string]: unknown
}

/**
 * Coerce one incoming value to the shape its column expects.
 *
 * Returns `undefined` for "no usable value", which the caller stores as a
 * cleared field rather than rejecting. A half-filled form should save the parts
 * that are filled; refusing the whole record because one optional number was
 * typed as "n/a" is worse for the person using it.
 */
function coerce(type: FieldType, raw: unknown): Record<string, unknown> | undefined {
  const col = columnFor(type)
  const empty = raw === null || raw === undefined || raw === ''

  const blank = { valueText: null, valueNum: null, valueDate: null, valueBool: null, valueJson: null }
  if (empty) return blank

  switch (col) {
    case 'valueNum': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
      if (!Number.isFinite(n)) return undefined
      return { ...blank, valueNum: n }
    }
    case 'valueDate': {
      const d = raw instanceof Date ? raw : new Date(String(raw))
      if (Number.isNaN(d.getTime())) return undefined
      return { ...blank, valueDate: d }
    }
    case 'valueBool': {
      if (typeof raw === 'boolean') return { ...blank, valueBool: raw }
      const s = String(raw).toLowerCase()
      if (['true', '1', 'yes', 'y'].includes(s)) return { ...blank, valueBool: true }
      if (['false', '0', 'no', 'n'].includes(s)) return { ...blank, valueBool: false }
      return undefined
    }
    case 'valueJson': {
      const arr = Array.isArray(raw) ? raw : [raw]
      const clean = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      return { ...blank, valueJson: clean as never }
    }
    default:
      return { ...blank, valueText: String(raw).slice(0, 5000) }
  }
}

/** Read one value back out of whichever column holds it. */
function extract(type: FieldType, row: { valueText: unknown; valueNum: unknown; valueDate: unknown; valueBool: unknown; valueJson: unknown }): unknown {
  switch (columnFor(type)) {
    case 'valueNum':
      return row.valueNum === null ? null : Number(row.valueNum)
    case 'valueDate':
      return row.valueDate
    case 'valueBool':
      return row.valueBool
    case 'valueJson':
      return row.valueJson ?? []
    default:
      return row.valueText
  }
}

/**
 * Should this field show, given the record it is on?
 *
 * `appliesWhen` is `{ "accountType": ["hotel", "hospital"] }` — every named
 * property must match one of its listed values. Absent means always. This is
 * what keeps a hotel's fields off a hospital's form without making them
 * separate entity types.
 */
export function applies(appliesWhen: unknown, context: Record<string, unknown>): boolean {
  if (!appliesWhen || typeof appliesWhen !== 'object') return true
  const rules = appliesWhen as Record<string, unknown>

  for (const [prop, allowed] of Object.entries(rules)) {
    const list = Array.isArray(allowed) ? allowed.map(String) : [String(allowed)]
    if (!list.includes(String(context[prop] ?? ''))) return false
  }
  return true
}

/** Active definitions for an entity type, in display order. */
export async function definitions(entityType: EntityType, includeInactive = false) {
  return prisma.customFieldDef.findMany({
    where: { entityType, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
}

/**
 * Every custom field for one record: its definition plus its current value.
 *
 * Returned even when the value is null, because a form has to render an empty
 * box for a field nobody has filled in yet.
 */
export async function valuesFor(
  entityType: EntityType,
  entityId: bigint,
  context: Record<string, unknown> = {},
) {
  const defs = await definitions(entityType)
  if (!defs.length) return []

  const rows = await prisma.customFieldValue.findMany({
    where: { entityType, entityId, defId: { in: defs.map((d) => d.id) } },
  })
  const byDef = new Map(rows.map((r) => [String(r.defId), r]))

  return defs
    .filter((d) => applies(d.appliesWhen, context))
    .map((d) => {
      const row = byDef.get(String(d.id))
      return {
        id: Number(d.id),
        key: d.key,
        label: d.label,
        type: d.type as FieldType,
        options: d.options ?? null,
        required: d.required,
        section: d.section,
        helpText: d.helpText,
        sortOrder: d.sortOrder,
        value: row ? extract(d.type as FieldType, row) : null,
      }
    })
}

/**
 * Save a `{ key: value }` patch for one record.
 *
 * A PATCH, not a replace: only the keys present are touched, so a form that
 * renders a subset of fields — because `appliesWhen` hid the rest — cannot
 * blank the ones it never showed. That failure mode is silent and permanent,
 * which is exactly why this is not a whole-object write.
 *
 * Returns the keys it could not parse, so the caller can tell the user which
 * boxes were ignored rather than failing the whole save.
 */
export async function saveValues(
  entityType: EntityType,
  entityId: bigint,
  patch: FieldValueInput,
): Promise<{ saved: string[]; skipped: string[] }> {
  const keys = Object.keys(patch)
  if (!keys.length) return { saved: [], skipped: [] }

  const defs = await prisma.customFieldDef.findMany({
    where: { entityType, key: { in: keys }, active: true },
  })

  const saved: string[] = []
  const skipped: string[] = []

  for (const def of defs) {
    const coerced = coerce(def.type as FieldType, patch[def.key])
    if (!coerced) {
      skipped.push(def.key)
      continue
    }

    await prisma.customFieldValue.upsert({
      where: { defId_entityType_entityId: { defId: def.id, entityType, entityId } },
      create: { defId: def.id, entityType, entityId, ...coerced },
      update: coerced,
    })
    saved.push(def.key)
  }

  // A key with no definition is not an error worth failing a save over — it is
  // usually a field that was retired between the form loading and being saved.
  const known = new Set(defs.map((d) => d.key))
  for (const k of keys) if (!known.has(k)) skipped.push(k)

  return { saved, skipped }
}

/** Drop every custom value attached to a record. Called when the record dies. */
export async function deleteValuesFor(entityType: EntityType, entityId: bigint): Promise<number> {
  const { count } = await prisma.customFieldValue.deleteMany({ where: { entityType, entityId } })
  return count
}
