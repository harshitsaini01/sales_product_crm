// ─────────────────────────────────────────────────────────────────────────────
// Custom field definitions and values.
//
// Defining fields is an admin act — a definition changes every record of that
// type — so the write endpoints are adminOnly. Reading them is not: every form
// in the app needs the definitions to render.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { isLiveEntityType, entityExists, type EntityType } from '../config/crm-entities'
import * as cf from '../services/crm/custom-fields.service'
import { bigintFix } from '../services/crm/serialize'
import { uploadSingle } from '../middleware/upload'
import path from 'path'

export const customFieldsRoutes = new Hono()

customFieldsRoutes.use('*', authenticate)

customFieldsRoutes.post('/upload', uploadSingle('file'), async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as any)?.incoming as any)?.file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No file' }, 400)
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || c.req.header('host') || new URL(c.req.url).host
  const protocol = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(c.req.url).protocol.replace(':', '')
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || `${protocol}://${host}`).replace(/\/$/, '')
  return c.json({ url: `${base}/api/uploads/${path.basename(file.filename)}` })
})

const defBody = z.object({
  entityType: z.string(),
  key: z.string().min(1).max(60).optional(),
  label: z.string().min(1).max(120),
  type: z.string(),
  options: z.array(z.string()).nullish(),
  required: z.boolean().optional(),
  appliesWhen: z.record(z.array(z.string())).nullish(),
  section: z.string().max(60).nullish(),
  helpText: z.string().max(255).nullish(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
  fileConfig: z.record(z.unknown()).nullish(),
  showInTable: z.boolean().optional(),
  showInQuick: z.boolean().optional(),
  readOnly: z.boolean().optional(),
})

// GET /api/custom-fields?entityType=account
customFieldsRoutes.get('/', async (c) => {
  const entityType = c.req.query('entityType')
  if (!isLiveEntityType(entityType)) return c.json({ error: 'Unknown entity type.' }, 400)

  const rows = await cf.definitions(entityType, c.req.query('all') === '1')
  return c.json(bigintFix(rows))
})

// GET /api/custom-fields/types — what a definition may be, for the type picker.
customFieldsRoutes.get('/types', (c) => c.json(cf.FIELD_TYPES))

const COMMERCIAL_LEAD_FIELDS: Array<{
  key: string; label: string; type: string; section: string; required?: boolean; showInTable?: boolean; showInQuick?: boolean
}> = [
  { key: 'company_name', label: 'Company name', type: 'text', section: 'Commercial', required: true, showInTable: true, showInQuick: true },
  { key: 'gstin', label: 'GSTIN', type: 'text', section: 'Commercial', showInTable: true },
  { key: 'designation', label: 'Designation', type: 'text', section: 'Commercial', showInQuick: true },
  { key: 'billing_address', label: 'Billing address', type: 'longtext', section: 'Shipping' },
  { key: 'shipping_address', label: 'Shipping address', type: 'longtext', section: 'Shipping' },
  { key: 'delivery_date', label: 'Required delivery date', type: 'date', section: 'Shipping', showInQuick: true },
  { key: 'po_number', label: 'PO number', type: 'text', section: 'Commercial', showInTable: true },
  { key: 'customer_po', label: 'Purchase order', type: 'file', section: 'Documents' },
  { key: 'gst_certificate', label: 'GST certificate', type: 'file', section: 'Documents' },
  { key: 'delivery_slip', label: 'Delivery slip', type: 'file', section: 'Documents' },
]

customFieldsRoutes.post('/seed-commercial', adminOnly, async (c) => {
  const created: string[] = []
  for (const [i, f] of COMMERCIAL_LEAD_FIELDS.entries()) {
    const clash = await prisma.customFieldDef.findFirst({ where: { entityType: 'lead', key: f.key } })
    if (clash) continue
    await prisma.customFieldDef.create({
      data: {
        entityType: 'lead',
        key: f.key,
        label: f.label,
        type: f.type,
        section: f.section,
        required: f.required ?? false,
        showInTable: f.showInTable ?? false,
        showInQuick: f.showInQuick ?? false,
        sortOrder: i * 10,
        fileConfig: f.type === 'file' ? ({ allowedExtensions: ['.pdf', '.jpg', '.png'], maxSizeBytes: 10485760 } as never) : undefined,
      },
    })
    created.push(f.key)
  }
  return c.json({ created })
})

// POST /api/custom-fields
customFieldsRoutes.post('/', adminOnly, zValidator('json', defBody), async (c) => {
  const body = c.req.valid('json')
  if (!isLiveEntityType(body.entityType)) return c.json({ error: 'Unknown entity type.' }, 400)
  if (!cf.isFieldType(body.type)) return c.json({ error: `Unknown field type "${body.type}".` }, 400)

  const key = cf.normalizeKey(body.key || body.label)
  if (!key) return c.json({ error: 'That name has no usable characters for a field key.' }, 400)

  const clash = await prisma.customFieldDef.findFirst({ where: { entityType: body.entityType, key } })
  if (clash) {
    return c.json({ error: `A field with the key "${key}" already exists on ${body.entityType}.` }, 409)
  }

  if ((body.type === 'select' || body.type === 'multiselect') && !body.options?.length) {
    return c.json({ error: 'A select field needs at least one option.' }, 400)
  }

  const row = await prisma.customFieldDef.create({
    data: {
      entityType: body.entityType,
      key,
      label: body.label,
      type: body.type,
      options: (body.options ?? undefined) as never,
      required: body.required ?? false,
      appliesWhen: (body.appliesWhen ?? undefined) as never,
      section: body.section ?? null,
      helpText: body.helpText ?? null,
      sortOrder: body.sortOrder ?? 0,
      fileConfig: (body.fileConfig ?? undefined) as never,
      showInTable: body.showInTable ?? false,
      showInQuick: body.showInQuick ?? false,
      readOnly: body.readOnly ?? false,
    },
  })

  return c.json(bigintFix(row), 201)
})

// PATCH /api/custom-fields/:id
//
// `key` and `entityType` are deliberately NOT editable. Every stored value is
// joined on the key, so changing it would orphan every value already collected
// — silently, because nothing would error. Retire the field and make a new one.
customFieldsRoutes.patch(
  '/:id',
  adminOnly,
  zValidator('json', defBody.partial().omit({ entityType: true, key: true })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')

    if (body.type && !cf.isFieldType(body.type)) {
      return c.json({ error: `Unknown field type "${body.type}".` }, 400)
    }

    // Changing the type would leave existing values in the wrong column, where
    // they would read back as null — data that is still in the table but
    // invisible. Refused rather than silently migrated.
    if (body.type) {
      const existing = await prisma.customFieldDef.findUnique({ where: { id } })
      if (existing && existing.type !== body.type) {
        const used = await prisma.customFieldValue.count({ where: { defId: id } })
        if (used > 0) {
          return c.json(
            {
              error:
                `This field already holds ${used} value${used === 1 ? '' : 's'}, so its type cannot ` +
                'change. Retire it and add a new field instead — the values stay either way.',
            },
            409,
          )
        }
      }
    }

    const row = await prisma.customFieldDef.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.options !== undefined ? { options: (body.options ?? undefined) as never } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
        ...(body.appliesWhen !== undefined
          ? { appliesWhen: (body.appliesWhen ?? undefined) as never }
          : {}),
        ...(body.section !== undefined ? { section: body.section } : {}),
        ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    })

    return c.json(bigintFix(row))
  },
)

// DELETE /api/custom-fields/:id
//
// The only genuinely destructive endpoint here: ON DELETE CASCADE takes every
// collected value with it. Retiring (active: false) is what people almost
// always want, so the count of what would be lost is returned on refusal
// unless they pass ?force=1.
customFieldsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const used = await prisma.customFieldValue.count({ where: { defId: id } })

  if (used > 0 && c.req.query('force') !== '1') {
    return c.json(
      {
        error:
          `This field holds ${used} value${used === 1 ? '' : 's'} that would be permanently deleted. ` +
          'Retire it instead to hide it and keep the data, or repeat with ?force=1.',
        valueCount: used,
      },
      409,
    )
  }

  await prisma.customFieldDef.delete({ where: { id } })
  return c.json({ success: true, deletedValues: used })
})

// ─── VALUES ───────────────────────────────────────────────────────────────────

// GET /api/custom-fields/values/:entityType/:entityId
customFieldsRoutes.get('/values/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType')
  if (!isLiveEntityType(entityType)) return c.json({ error: 'Unknown entity type.' }, 400)

  const entityId = BigInt(c.req.param('entityId'))
  if (!(await entityExists(entityType as EntityType, entityId))) {
    return c.json({ error: 'Record not found.' }, 404)
  }

  const values = await cf.valuesFor(entityType as EntityType, entityId)
  return c.json(bigintFix(values))
})

// PATCH /api/custom-fields/values/:entityType/:entityId
//
// A PATCH, never a replace: a form that renders a subset of fields — because
// appliesWhen hid the rest — must not blank the ones it never showed.
customFieldsRoutes.patch(
  '/values/:entityType/:entityId',
  zValidator('json', z.record(z.unknown())),
  async (c) => {
    const entityType = c.req.param('entityType')
    if (!isLiveEntityType(entityType)) return c.json({ error: 'Unknown entity type.' }, 400)

    const entityId = BigInt(c.req.param('entityId'))
    if (!(await entityExists(entityType as EntityType, entityId))) {
      return c.json({ error: 'Record not found.' }, 404)
    }

    const result = await cf.saveValues(entityType as EntityType, entityId, c.req.valid('json'))
    return c.json(result)
  },
)
