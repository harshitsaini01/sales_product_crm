// ─────────────────────────────────────────────────────────────────────────────
// The Super Admin API — everything behind /super in the frontend.
//
// Mounted FIRST in routes/index.ts, deliberately outside tenantMiddleware: this
// is the control plane and must never inherit a customer's schema. Its guard
// uses JWT_PLATFORM_SECRET, so a customer's token cannot reach any of it.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { compare, hash } from 'bcryptjs'
import { randomUUID, randomBytes } from 'crypto'
import { sign, type SignOptions } from 'jsonwebtoken'

import { platformPrisma } from '../lib/platform'
import { getTenantClient } from '../lib/prisma'
import { runWithTenant } from '../lib/tenant-context'
import { authenticatePlatform, rootPlatformOnly } from '../middleware/platform-auth'
import { hashApiKey } from '../middleware/tenant'
import { FEATURES, sanitizeFeatureMap, resolveFeatures, defaultFeatureMap } from '../config/features'
import { resolveLeadFields, sanitizeLeadFieldConfig } from '../config/lead-fields'
import { TERMS, resolveTerms, sanitizeLabelMap } from '../config/terminology'
import { VERTICALS, getVertical, isVerticalKey } from '../config/verticals'
import {
  getTenantById,
  invalidateTenantCache,
  listActiveTenantContexts,
} from '../services/tenant.service'
import {
  createTenant,
  deleteTenant,
  inspectDrift,
  reconcileSchema,
  runMigrations,
  validateSlug,
} from '../services/provisioning.service'
import {
  computeTenantUsage,
  compareToLimits,
  latestSnapshots,
  captureUsageSnapshots,
} from '../services/tenant-usage.service'
import { resyncTenantDirectory } from '../lib/tenant-directory'
import { connectedSchemas } from '../lib/prisma'
import { emailService } from '../services/email.service'
import { metricsRoutes } from './metrics.routes'

export const platformRoutes = new Hono()

// API usage metrics. Brings its own authenticatePlatform guard and pins itself
// to the primary schema, where the api_usage_* tables live.
platformRoutes.route('/metrics', metricsRoutes)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(serialize)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = serialize(obj[k])
    return out
  }
  return obj
}

// ─── Audit ────────────────────────────────────────────────────────────────────

async function audit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  action: string,
  summary: string,
  opts: { tenantId?: number; detail?: unknown } = {},
): Promise<void> {
  const actor = c.get('platformUser')
  await platformPrisma.platformAuditLog
    .create({
      data: {
        platformUserId: actor ? BigInt(actor.platformUserId) : null,
        actorName: actor?.name ?? 'system',
        tenantId: opts.tenantId ?? null,
        action,
        summary: summary.slice(0, 300),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detail: (opts.detail ?? null) as any,
        ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null,
      },
    })
    .catch((err: unknown) => console.error('[platform-audit] write failed:', err))
}

// Everything below requires a super admin token.
platformRoutes.use('*', authenticatePlatform)

// ─── Session ──────────────────────────────────────────────────────────────────

platformRoutes.get('/me', async (c) => {
  const actor = c.get('platformUser')
  const row = await platformPrisma.platformUser.findUnique({
    where: { id: BigInt(actor.platformUserId) },
    select: { id: true, name: true, email: true, isRoot: true, lastLoginAt: true },
  })
  return c.json(serialize(row))
})

platformRoutes.post('/logout', async (c) => {
  const actor = c.get('platformUser')
  await platformPrisma.platformUser.update({
    where: { id: BigInt(actor.platformUserId) },
    data: { activeSessionId: null },
  })
  return c.json({ message: 'Signed out' })
})

// ─── Catalogue ────────────────────────────────────────────────────────────────

platformRoutes.get('/features', (c) =>
  c.json(
    FEATURES.map((f) => ({
      key: f.key,
      label: f.label,
      group: f.group,
      description: f.description,
      defaultEnabled: f.defaultEnabled,
    })),
  ),
)

// The Lead Information field catalogue, for the toggle grid.
platformRoutes.get('/lead-fields', (c) => c.json(resolveLeadFields({})))

// ─── Overview ─────────────────────────────────────────────────────────────────

platformRoutes.get('/overview', async (c) => {
  const now = new Date()
  const in30Days = new Date(now.getTime() + 30 * 24 * 3600_000)

  const [tenants, snapshots, recentAudit] = await Promise.all([
    platformPrisma.tenant.findMany({ orderBy: { createdAt: 'desc' } }),
    latestSnapshots(),
    platformPrisma.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { tenant: { select: { slug: true, companyName: true } } },
    }),
  ])

  const active = tenants.filter((t) => t.status === 'active')
  const expiringSoon = active.filter(
    (t) => t.planExpiresAt && t.planExpiresAt > now && t.planExpiresAt <= in30Days,
  )

  let totalUsers = 0
  let totalLeads = 0
  for (const snap of snapshots.values()) {
    totalUsers += snap.users
    totalLeads += snap.leads
  }

  // "Nearing limits" is read off the stored snapshots so this page does not
  // fan a COUNT(*) out across every customer schema on every load.
  const nearingLimits: { slug: string; companyName: string; label: string; used: number; limit: number; pct: number }[] = []
  for (const tenant of tenants) {
    const snap = snapshots.get(tenant.id)
    if (!snap) continue
    const checks: [string, number, number | null][] = [
      ['Team members', snap.users, tenant.maxUsers],
      ['Leads', snap.leads, tenant.maxLeads],
      ['Storage', snap.storageMb, tenant.maxStorageMb],
    ]
    for (const [label, used, limit] of checks) {
      if (limit == null || limit <= 0) continue
      const pct = Math.round((used / limit) * 100)
      if (pct >= 80) {
        nearingLimits.push({ slug: tenant.slug, companyName: tenant.companyName, label, used, limit, pct })
      }
    }
  }
  nearingLimits.sort((a, b) => b.pct - a.pct)

  return c.json(
    serialize({
      metrics: {
        totalCustomers: tenants.length,
        activeCustomers: active.length,
        suspendedCustomers: tenants.filter((t) => t.status === 'suspended').length,
        expiredCustomers: tenants.filter(
          (t) => t.status === 'expired' || (t.planExpiresAt && t.planExpiresAt < now),
        ).length,
        expiringSoon: expiringSoon.length,
        provisioning: tenants.filter(
          (t) => t.provisioningStatus !== 'ready' && t.provisioningStatus !== 'failed',
        ).length,
        failedProvisioning: tenants.filter((t) => t.provisioningStatus === 'failed').length,
        totalUsers,
        totalLeads,
      },
      expiringSoon: expiringSoon.map((t) => ({
        id: t.id,
        slug: t.slug,
        companyName: t.companyName,
        planExpiresAt: t.planExpiresAt,
      })),
      nearingLimits: nearingLimits.slice(0, 10),
      provisioningJobs: tenants
        .filter((t) => t.provisioningStatus !== 'ready')
        .map((t) => ({
          id: t.id,
          slug: t.slug,
          companyName: t.companyName,
          status: t.provisioningStatus,
          step: t.provisioningStep,
          error: t.provisioningError,
        })),
      recentActivity: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        summary: a.summary,
        actorName: a.actorName,
        at: a.createdAt,
        tenant: a.tenant ? { slug: a.tenant.slug, name: a.tenant.companyName } : null,
      })),
    }),
  )
})

// ─── Customers ────────────────────────────────────────────────────────────────

platformRoutes.get('/tenants', async (c) => {
  const [tenants, snapshots] = await Promise.all([
    platformPrisma.tenant.findMany({ orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }] }),
    latestSnapshots(),
  ])

  return c.json(
    serialize(
      tenants.map((t) => ({
        ...t,
        features: resolveFeatures(t.features),
        usage: snapshots.get(t.id) ?? null,
      })),
    ),
  )
})

const limitsSchema = z.object({
  maxUsers: z.number().int().min(0).nullable().optional(),
  maxCounsellors: z.number().int().min(0).nullable().optional(),
  maxSubAdmins: z.number().int().min(0).nullable().optional(),
  maxBranches: z.number().int().min(0).nullable().optional(),
  maxLeads: z.number().int().min(0).nullable().optional(),
  maxLeadsPerMonth: z.number().int().min(0).nullable().optional(),
  maxStorageMb: z.number().int().min(0).nullable().optional(),
})

const createTenantSchema = z.object({
  slug: z.string().min(3).max(31),
  companyName: z.string().min(2).max(150),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
  planName: z.string().max(50).optional(),
  planExpiresAt: z.string().datetime().nullable().optional(),
  limits: limitsSchema.optional(),
  /** Which preset to build from. Omitted means education — see config/verticals.ts. */
  vertical: z.string().optional(),
  features: z.record(z.boolean()).optional(),
  admin: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    loginid: z.string().min(3).max(100),
    password: z.string().min(8),
    mobile: z.string().max(30).optional(),
  }),
  sendWelcomeEmail: z.boolean().optional(),
})

platformRoutes.post('/tenants', zValidator('json', createTenantSchema), async (c) => {
  const body = c.req.valid('json')

  const slugError = validateSlug(body.slug)
  if (slugError) return c.json({ error: slugError }, 400)

  let tenant
  try {
    if (body.vertical && !isVerticalKey(body.vertical)) {
      return c.json({ error: `Unknown vertical "${body.vertical}".` }, 400)
    }
    tenant = await createTenant({
      ...body,
      vertical: isVerticalKey(body.vertical) ? body.vertical : undefined,
      planExpiresAt: body.planExpiresAt ? new Date(body.planExpiresAt) : null,
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not create customer' }, 400)
  }

  await audit(c, 'tenant.create', `Created customer ${body.companyName} (${body.slug})`, {
    tenantId: tenant.id,
    detail: { plan: body.planName, limits: body.limits, vertical: body.vertical ?? 'education' },
  })

  if (body.sendWelcomeEmail !== false && body.admin.email) {
    // Fire-and-forget: provisioning is already running in the background, and a
    // mail failure must not look like a provisioning failure.
    void emailService
      .send({
        to: body.admin.email,
        subject: `Your ${body.companyName} CRM account is ready`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#111;">Welcome to your CRM</h2>
            <p>Hi ${body.admin.name},</p>
            <p>Your admin account for <strong>${body.companyName}</strong> has been created.</p>
            <table style="margin:16px 0;font-size:14px;">
              <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Login ID</td><td><strong>${body.admin.loginid}</strong></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Password</td><td><strong>${body.admin.password}</strong></td></tr>
            </table>
            <p style="color:#6b7280;font-size:13px;">Please change your password after your first sign-in.</p>
          </div>
        `,
      })
      .catch((err) => console.error('[platform] welcome email failed:', err))
  }

  return c.json(serialize(tenant), 201)
})

async function loadTenantOr404(id: number) {
  return platformPrisma.tenant.findUnique({ where: { id } })
}

platformRoutes.get('/tenants/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  // Live counts here (not the nightly snapshot) — this is the detail page, and
  // it is one customer, not N.
  let usage = null
  if (tenant.provisioningStatus === 'ready') {
    const ctx = await getTenantById(id)
    if (ctx) {
      try {
        usage = compareToLimits(await computeTenantUsage(ctx), ctx.limits)
      } catch (err) {
        console.error(`[platform] usage failed for ${tenant.slug}:`, err)
      }
    }
  }

  return c.json(serialize({ ...tenant, features: resolveFeatures(tenant.features), usage }))
})

const updateTenantSchema = z.object({
  companyName: z.string().min(2).max(150).optional(),
  contactName: z.string().max(100).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  planName: z.string().max(50).optional(),
  planExpiresAt: z.string().datetime().nullable().optional(),
})

platformRoutes.patch('/tenants/:id', zValidator('json', updateTenantSchema), async (c) => {
  const id = Number(c.req.param('id'))
  const body = c.req.valid('json')
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  const updated = await platformPrisma.tenant.update({
    where: { id },
    data: {
      ...body,
      planExpiresAt:
        body.planExpiresAt === undefined
          ? undefined
          : body.planExpiresAt === null
            ? null
            : new Date(body.planExpiresAt),
      // Editing a plan that had lapsed reactivates the account.
      status: body.planExpiresAt && tenant.status === 'expired' ? 'active' : undefined,
    },
  })
  invalidateTenantCache(id)

  await audit(c, 'tenant.update', `Updated ${tenant.companyName}`, { tenantId: id, detail: body })
  return c.json(serialize(updated))
})

platformRoutes.patch('/tenants/:id/limits', zValidator('json', limitsSchema), async (c) => {
  const id = Number(c.req.param('id'))
  const body = c.req.valid('json')
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  const updated = await platformPrisma.tenant.update({ where: { id }, data: body })
  invalidateTenantCache(id)

  await audit(c, 'tenant.limits', `Changed limits for ${tenant.companyName}`, {
    tenantId: id,
    detail: body,
  })
  return c.json(serialize(updated))
})

platformRoutes.patch(
  '/tenants/:id/features',
  zValidator('json', z.object({ features: z.record(z.boolean()) })),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { features } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    const merged = { ...resolveFeatures(tenant.features), ...sanitizeFeatureMap(features) }
    const updated = await platformPrisma.tenant.update({ where: { id }, data: { features: merged } })
    invalidateTenantCache(id)

    const changed = Object.keys(sanitizeFeatureMap(features))
    await audit(c, 'tenant.features', `Changed modules for ${tenant.companyName}`, {
      tenantId: id,
      detail: { changed, features: merged },
    })
    return c.json(serialize({ ...updated, features: merged }))
  },
)

platformRoutes.patch(
  '/tenants/:id/lead-fields',
  zValidator(
    'json',
    z.object({
      hiddenGroups: z.array(z.string()).optional(),
      hiddenFields: z.array(z.string()).optional(),
      labels: z.record(z.string()).optional(),
      groupLabels: z.record(z.string()).optional(),
    }),
  ),
  async (c) => {
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    // Sanitising drops unknown keys and anything locked, so a hand-crafted
    // payload cannot hide the name field or the pipeline settings.
    const config = sanitizeLeadFieldConfig(body)
    const updated = await platformPrisma.tenant.update({
      where: { id },
      // Prisma's Json input type wants an index signature; the sanitised
      // config is a fixed shape, so spread it into a plain object.
      data: { leadFields: { ...config } },
    })
    invalidateTenantCache(id)

    const hidden = config.hiddenGroups.length + config.hiddenFields.length
    await audit(c, 'tenant.lead_fields', `Changed lead fields for ${tenant.companyName}`, {
      tenantId: id,
      detail: config,
    })
    return c.json(
      serialize({ ...updated, leadFields: config, hiddenCount: hidden, fields: resolveLeadFields(config) }),
    )
  },
)

// ─── Verticals & terminology ──────────────────────────────────────────────────

// GET /api/platform/verticals — the preset catalogue, for the wizard's picker.
platformRoutes.get('/verticals', (c) =>
  c.json(
    VERTICALS.map((v) => ({
      key: v.key,
      label: v.label,
      description: v.description,
      hiddenGroupCount: v.leadFields.hiddenGroups.length,
      disabledFeatureCount: Object.values(v.features).filter((on) => on === false).length,
      // The actual deviation maps, so the wizard can show the module grid and
      // the lead-field list ALREADY set the way the preset would set them. The
      // person then sees exactly what they are about to create, and any change
      // they make on top is theirs rather than something the server silently
      // overrides afterwards.
      features: v.features,
      leadFields: v.leadFields,
    })),
  ),
)

// GET /api/platform/terms — the terminology catalogue plus this customer's
// overrides, so the editing screen can show both what a term says now and what
// "reset" would put back.
platformRoutes.get('/tenants/:id/terms', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  const resolved = resolveTerms(tenant.labels)
  return c.json(
    TERMS.map((term) => ({
      key: term.key,
      description: term.description,
      singular: resolved[term.key].singular,
      plural: resolved[term.key].plural,
      defaultSingular: term.singular,
      defaultPlural: term.plural,
    })),
  )
})

platformRoutes.patch(
  '/tenants/:id/terms',
  zValidator(
    'json',
    z.object({
      labels: z.record(z.object({ singular: z.string().optional(), plural: z.string().optional() })),
    }),
  ),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { labels } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    // A whole-map replace, not a merge: the editing screen sends every term it
    // knows about, so a term the person cleared must actually be cleared rather
    // than surviving because it was absent from the payload.
    const config = sanitizeLabelMap(labels)
    const updated = await platformPrisma.tenant.update({
      where: { id },
      data: { labels: { ...config } },
    })
    invalidateTenantCache(id)

    await audit(c, 'tenant.terms', `Changed terminology for ${tenant.companyName}`, {
      tenantId: id,
      detail: config,
    })
    return c.json(serialize({ ...updated, labels: config, terms: resolveTerms(config) }))
  },
)

// POST /api/platform/tenants/:id/vertical — switch a customer to another preset.
//
// DESTRUCTIVE, and deliberately not folded into the general PATCH. Re-applying
// overwrites features, lead fields and terminology with the preset's values,
// discarding every manual tweak made since. The UI must confirm; the response
// reports what actually changed so the person can see it.
//
// It does NOT touch the seeded pipeline. Statuses already carry live leads, and
// silently rewriting them would strand every lead on a stage that no longer
// exists — renaming stages is a job for the Lead Workflow screen inside the
// customer's own panel.
platformRoutes.post(
  '/tenants/:id/vertical',
  zValidator('json', z.object({ vertical: z.string(), applyPreset: z.boolean().default(true) })),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { vertical, applyPreset } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    if (!isVerticalKey(vertical)) {
      return c.json({ error: `Unknown vertical "${vertical}".` }, 400)
    }
    const preset = getVertical(vertical)

    const data: Record<string, unknown> = { vertical: preset.key }

    if (applyPreset) {
      data.features = {
        ...defaultFeatureMap(),
        ...sanitizeFeatureMap(preset.features),
      }
      data.leadFields = { ...sanitizeLeadFieldConfig(preset.leadFields) }
      // The customer keeps their own name as the brand across a switch — the
      // preset has no idea what the company is called.
      data.labels = {
        ...sanitizeLabelMap({ ...preset.labels, brand: { singular: tenant.companyName } }),
      }
    }

    const updated = await platformPrisma.tenant.update({ where: { id }, data })
    invalidateTenantCache(id)

    await audit(
      c,
      'tenant.vertical',
      `Switched ${tenant.companyName} to ${preset.label}${applyPreset ? ' and re-applied the preset' : ''}`,
      { tenantId: id, detail: { vertical: preset.key, applyPreset } },
    )
    return c.json(serialize(updated))
  },
)

platformRoutes.post(
  '/tenants/:id/suspend',
  zValidator('json', z.object({ reason: z.string().max(255).optional() })),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { reason } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)
    if (tenant.isPrimary) return c.json({ error: 'The primary installation cannot be suspended.' }, 400)

    await platformPrisma.tenant.update({
      where: { id },
      data: { status: 'suspended', suspendedReason: reason ?? null },
    })
    // Takes effect on the customer's very next request, not a minute later.
    invalidateTenantCache(id)

    await audit(c, 'tenant.suspend', `Suspended ${tenant.companyName}`, { tenantId: id, detail: { reason } })
    return c.json({ message: 'Customer suspended' })
  },
)

platformRoutes.post('/tenants/:id/resume', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  await platformPrisma.tenant.update({
    where: { id },
    data: { status: 'active', suspendedReason: null },
  })
  invalidateTenantCache(id)

  await audit(c, 'tenant.resume', `Reactivated ${tenant.companyName}`, { tenantId: id })
  return c.json({ message: 'Customer reactivated' })
})

platformRoutes.post(
  '/tenants/:id/extend',
  zValidator('json', z.object({ months: z.number().int().min(1).max(60) })),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { months } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    // Extend from the existing expiry when it is still in the future, otherwise
    // from today — so renewing late does not silently lose the paid months.
    const from =
      tenant.planExpiresAt && tenant.planExpiresAt > new Date() ? tenant.planExpiresAt : new Date()
    const next = new Date(from)
    next.setMonth(next.getMonth() + months)

    await platformPrisma.tenant.update({
      where: { id },
      data: {
        planExpiresAt: next,
        status: tenant.status === 'expired' ? 'active' : tenant.status,
      },
    })
    invalidateTenantCache(id)

    await audit(c, 'tenant.extend', `Extended ${tenant.companyName} by ${months} month(s)`, {
      tenantId: id,
      detail: { months, until: next },
    })
    return c.json({ message: `Extended to ${next.toDateString()}`, planExpiresAt: next })
  },
)

platformRoutes.delete(
  '/tenants/:id',
  zValidator('json', z.object({ confirm: z.string() })),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { confirm } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    // Typing the slug is the only thing standing between a click and dropping
    // a schema full of somebody's live data.
    if (confirm !== tenant.slug) {
      return c.json({ error: `Type "${tenant.slug}" to confirm deletion.` }, 400)
    }

    try {
      await deleteTenant(id)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Delete failed' }, 400)
    }

    await audit(c, 'tenant.delete', `DELETED customer ${tenant.companyName} (${tenant.slug})`, {
      detail: { slug: tenant.slug, schemaName: tenant.schemaName },
    })
    return c.json({ message: 'Customer deleted' })
  },
)

platformRoutes.post('/tenants/:id/migrate', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  try {
    await runMigrations(tenant.schemaName)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Migration failed' }, 500)
  }

  await audit(c, 'tenant.migrate', `Ran migrations for ${tenant.companyName}`, { tenantId: id })
  return c.json({ message: 'Migrations applied' })
})

// GET .../drift — read-only. Does this schema still match prisma/schema.prisma?
platformRoutes.get('/tenants/:id/drift', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  try {
    const report = await inspectDrift(tenant.schemaName)
    return c.json(report)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Drift check failed' }, 500)
  }
})

// POST .../reconcile — bring the schema in line with prisma/schema.prisma.
//
// Never allows destructive statements: the diff is computed against the schema
// file, so a table present in the database but absent from the file comes back
// as a DROP. Harmless on a schema created seconds ago, catastrophic on a
// customer's live one — so those are reported and refused, not applied.
platformRoutes.post('/tenants/:id/reconcile', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = await loadTenantOr404(id)
  if (!tenant) return c.json({ error: 'Customer not found' }, 404)

  try {
    const result = await reconcileSchema(tenant.schemaName, { allowDestructive: false })
    if (!result.applied) return c.json({ message: 'Already up to date — no drift found.', applied: false })

    await audit(c, 'tenant.reconcile', `Reconciled schema drift for ${tenant.companyName}`, {
      tenantId: id,
      detail: { sql: result.sql.slice(0, 4000) },
    })
    return c.json({ message: 'Schema brought in line with prisma/schema.prisma.', applied: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Reconcile failed' }, 400)
  }
})

// ─── A customer's staff ───────────────────────────────────────────────────────

platformRoutes.get('/tenants/:id/users', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await platformPrisma.tenantUserDirectory.findMany({
    where: { tenantId: id },
    orderBy: [{ status: 'desc' }, { name: 'asc' }],
    take: 500,
  })
  return c.json(serialize(rows))
})

platformRoutes.post('/tenants/:id/users/:userId/reset-password', async (c) => {
  const id = Number(c.req.param('id'))
  const userId = c.req.param('userId')
  const ctx = await getTenantById(id)
  if (!ctx) return c.json({ error: 'Customer not found' }, 404)

  // Readable but not guessable — this is handed to a human over the phone.
  const password = `Tmp-${randomBytes(4).toString('hex')}`
  const db = getTenantClient(ctx.schemaName)

  const user = await runWithTenant(ctx, async () =>
    db.user.update({
      where: { id: BigInt(userId) },
      data: {
        password: await hash(password, 10),
        passwordCopy: password,
        // Force a re-login: whatever session they had is now stale.
        activeWebSessionId: randomUUID(),
        activeMobileSessionId: randomUUID(),
      },
      select: { id: true, name: true, email: true },
    }),
  )

  await audit(c, 'tenant.user.reset_password', `Reset password for ${user.name} at ${ctx.companyName}`, {
    tenantId: id,
    detail: { userId: Number(user.id) },
  })

  return c.json({ message: 'Password reset', password, user: serialize(user) })
})

platformRoutes.post('/tenants/:id/directory/rebuild', async (c) => {
  const id = Number(c.req.param('id'))
  const ctx = await getTenantById(id)
  if (!ctx) return c.json({ error: 'Customer not found' }, 404)

  const count = await resyncTenantDirectory(getTenantClient(ctx.schemaName), id)
  await audit(c, 'tenant.directory.rebuild', `Rebuilt login directory for ${ctx.companyName}`, {
    tenantId: id,
    detail: { count },
  })
  return c.json({ message: `Synced ${count} users` })
})

// ─── Impersonation ────────────────────────────────────────────────────────────

platformRoutes.post('/tenants/:id/impersonate', async (c) => {
  const id = Number(c.req.param('id'))
  const actor = c.get('platformUser')
  const ctx = await getTenantById(id)
  if (!ctx) return c.json({ error: 'Customer not found' }, 404)

  const db = getTenantClient(ctx.schemaName)
  const admin = await runWithTenant(ctx, () =>
    db.user.findFirst({
      where: { status: 1, role: 'admin' },
      orderBy: { id: 'asc' },
      include: { roles: true },
    }),
  )
  if (!admin) return c.json({ error: 'That customer has no active admin to sign in as.' }, 404)

  // Short-lived on purpose, and it does NOT rotate the real admin's session id
  // — see checkSessionValidity in middleware/auth.ts, which skips the session
  // match for impersonation tokens precisely so nobody gets signed out.
  const options: SignOptions = { expiresIn: '15m' }
  const token = sign(
    {
      userId: Number(admin.id),
      role: admin.role,
      roles: admin.roles.map((r) => r.role),
      name: admin.name,
      email: admin.email,
      sid: randomUUID(),
      kind: 'web',
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
      impersonatedBy: { id: actor.platformUserId, name: actor.name },
    },
    process.env.JWT_SECRET!,
    options,
  )

  await audit(c, 'tenant.impersonate', `Signed in as ${admin.name} at ${ctx.companyName}`, {
    tenantId: id,
    detail: { userId: Number(admin.id) },
  })

  return c.json(
    serialize({
      token,
      expiresInMinutes: 15,
      tenant: { id: ctx.tenantId, slug: ctx.slug, name: ctx.companyName },
      user: {
        id: Number(admin.id),
        name: admin.name,
        email: admin.email,
        role: admin.role,
        roles: admin.roles.map((r) => r.role),
        branchId: admin.branchId ? Number(admin.branchId) : null,
      },
    }),
  )
})

// ─── Per-customer API keys ────────────────────────────────────────────────────

platformRoutes.get('/tenants/:id/api-keys', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await platformPrisma.tenantApiKey.findMany({
    where: { tenantId: id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, keyPrefix: true, status: true, lastUsedAt: true, createdAt: true },
  })
  return c.json(serialize(rows))
})

platformRoutes.post(
  '/tenants/:id/api-keys',
  zValidator('json', z.object({ name: z.string().min(2).max(100) })),
  async (c) => {
    const id = Number(c.req.param('id'))
    const { name } = c.req.valid('json')
    const tenant = await loadTenantOr404(id)
    if (!tenant) return c.json({ error: 'Customer not found' }, 404)

    const key = `tk_${tenant.slug}_${randomBytes(24).toString('hex')}`
    await platformPrisma.tenantApiKey.create({
      data: { tenantId: id, name, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 12) },
    })

    await audit(c, 'tenant.apikey.create', `Issued API key "${name}" for ${tenant.companyName}`, {
      tenantId: id,
    })
    // Shown exactly once — only the hash is stored.
    return c.json({ key, message: 'Copy this key now. It will not be shown again.' }, 201)
  },
)

platformRoutes.delete('/tenants/:tenantId/api-keys/:keyId', async (c) => {
  const tenantId = Number(c.req.param('tenantId'))
  const keyId = c.req.param('keyId')
  await platformPrisma.tenantApiKey.deleteMany({ where: { id: BigInt(keyId), tenantId } })
  await audit(c, 'tenant.apikey.revoke', `Revoked an API key`, { tenantId })
  return c.json({ message: 'Key revoked' })
})

// ─── Super admin accounts ─────────────────────────────────────────────────────

platformRoutes.get('/users', async (c) => {
  const rows = await platformPrisma.platformUser.findMany({
    orderBy: [{ isRoot: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, email: true, status: true, isRoot: true, lastLoginAt: true, createdAt: true },
  })
  return c.json(serialize(rows))
})

platformRoutes.post(
  '/users',
  rootPlatformOnly,
  zValidator(
    'json',
    z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(10),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json')
    const existing = await platformPrisma.platformUser.findUnique({ where: { email: body.email } })
    if (existing) return c.json({ error: 'That email already has a super admin account.' }, 400)

    const created = await platformPrisma.platformUser.create({
      data: { name: body.name, email: body.email, password: await hash(body.password, 10) },
      select: { id: true, name: true, email: true },
    })

    await audit(c, 'platform.user.create', `Created super admin ${body.name}`)
    return c.json(serialize(created), 201)
  },
)

platformRoutes.patch(
  '/users/:id',
  rootPlatformOnly,
  zValidator('json', z.object({ status: z.number().int().min(0).max(1).optional(), name: z.string().min(2).max(100).optional() })),
  async (c) => {
    const id = BigInt(c.req.param('id'))
    const body = c.req.valid('json')

    const target = await platformPrisma.platformUser.findUnique({ where: { id } })
    if (!target) return c.json({ error: 'Not found' }, 404)
    if (target.isRoot && body.status === 0) {
      return c.json({ error: 'The root super admin cannot be disabled.' }, 400)
    }

    const updated = await platformPrisma.platformUser.update({
      where: { id },
      data: { ...body, ...(body.status === 0 ? { activeSessionId: null } : {}) },
      select: { id: true, name: true, email: true, status: true },
    })

    await audit(c, 'platform.user.update', `Updated super admin ${target.name}`)
    return c.json(serialize(updated))
  },
)

platformRoutes.post(
  '/change-password',
  zValidator('json', z.object({ currentPassword: z.string(), newPassword: z.string().min(10) })),
  async (c) => {
    const actor = c.get('platformUser')
    const { currentPassword, newPassword } = c.req.valid('json')

    const me = await platformPrisma.platformUser.findUnique({ where: { id: BigInt(actor.platformUserId) } })
    if (!me) return c.json({ error: 'Not found' }, 404)
    if (!(await compare(currentPassword, me.password))) {
      return c.json({ error: 'Current password is incorrect' }, 400)
    }

    await platformPrisma.platformUser.update({
      where: { id: me.id },
      data: { password: await hash(newPassword, 10) },
    })
    await audit(c, 'platform.user.password', 'Changed own password')
    return c.json({ message: 'Password updated' })
  },
)

// ─── Audit log ────────────────────────────────────────────────────────────────

platformRoutes.get('/audit', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') || 1))
  const limit = Math.min(100, Number(c.req.query('limit') || 50))
  const tenantId = c.req.query('tenantId')
  const action = c.req.query('action')

  const where = {
    ...(tenantId ? { tenantId: Number(tenantId) } : {}),
    ...(action ? { action } : {}),
  }

  const [rows, total] = await Promise.all([
    platformPrisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { tenant: { select: { slug: true, companyName: true } } },
    }),
    platformPrisma.platformAuditLog.count({ where }),
  ])

  return c.json(
    serialize({
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }),
  )
})

// ─── System health ────────────────────────────────────────────────────────────

platformRoutes.get('/health', async (c) => {
  const tenants = await platformPrisma.tenant.findMany({
    orderBy: [{ isPrimary: 'desc' }, { slug: 'asc' }],
    select: { id: true, slug: true, companyName: true, schemaName: true, provisioningStatus: true },
  })

  // Schema sizes come from Postgres itself rather than from counting rows.
  const sizes = await platformPrisma.$queryRawUnsafe<{ schema_name: string; bytes: bigint }[]>(`
    SELECT n.nspname AS schema_name,
           COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','m')
     GROUP BY n.nspname
  `)
  const sizeBy = new Map(sizes.map((s) => [s.schema_name, Number(s.bytes)]))

  const pools = connectedSchemas()
  const poolBy = new Map(pools.map((p) => [p.schema, p.idleMs]))

  return c.json(
    serialize({
      tenants: tenants.map((t) => ({
        ...t,
        sizeMb: Math.round((sizeBy.get(t.schemaName) ?? 0) / (1024 * 1024)),
        poolOpen: poolBy.has(t.schemaName),
        poolIdleMs: poolBy.get(t.schemaName) ?? null,
      })),
      openConnections: pools.length,
    }),
  )
})

platformRoutes.post('/health/migrate-all', async (c) => {
  const tenants = await platformPrisma.tenant.findMany({
    where: { provisioningStatus: 'ready' },
    select: { id: true, slug: true, schemaName: true },
  })

  const results: { slug: string; ok: boolean; error?: string }[] = []
  for (const t of tenants) {
    try {
      await runMigrations(t.schemaName)
      results.push({ slug: t.slug, ok: true })
    } catch (err) {
      results.push({ slug: t.slug, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  await audit(c, 'platform.migrate_all', `Ran migrations across ${tenants.length} customers`, {
    detail: results,
  })
  return c.json({ results })
})

platformRoutes.post('/health/snapshot-usage', async (c) => {
  const written = await captureUsageSnapshots()
  await audit(c, 'platform.usage_snapshot', `Captured usage for ${written} customers`)
  return c.json({ message: `Captured ${written} snapshots` })
})

// Kept for parity with the tenant side — lets the panel show which customers
// the worker sweep will actually touch.
platformRoutes.get('/active-tenants', async (c) => {
  const list = await listActiveTenantContexts()
  return c.json(serialize(list.map((t) => ({ id: t.tenantId, slug: t.slug, name: t.companyName }))))
})
