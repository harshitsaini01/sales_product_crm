import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { currentTenant } from '../lib/tenant-context'
import { getTenantUsage } from '../services/tenant-usage.service'

export const settingsRoutes = new Hono()

settingsRoutes.use('*', authenticate)

// GET /api/settings/plan
//
// What the customer's own admins see about their subscription: which modules
// their plan includes, and how close they are to each limit. This is what lets
// the UI disable "Add user" / "Import" with a reason instead of letting the
// action fail at the last moment.
settingsRoutes.get('/plan', async (c) => {
  const ctx = currentTenant()
  if (!ctx) return c.json({ error: 'No active subscription found' }, 404)

  const usage = await getTenantUsage(ctx.tenantId)

  return c.json({
    tenant: {
      name: ctx.companyName,
      slug: ctx.slug,
      planName: ctx.planName,
      planExpiresAt: ctx.planExpiresAt,
      status: ctx.status,
    },
    features: ctx.features,
    limits: ctx.limits,
    usage: usage?.usage ?? null,
    // Anything at 80%+ of its cap, so the UI can warn before the wall is hit.
    warnings: usage?.warnings ?? [],
  })
})

// GET /api/settings (all settings — admin only)
settingsRoutes.get('/', adminOnly, async (c) => {
  const settings = await prisma.systemSetting.findMany()
  const obj = Object.fromEntries(settings.map((s) => [s.key, s.value]))
  return c.json(obj)
})

// PATCH /api/settings/page-limit (admin only)
settingsRoutes.patch('/page-limit', adminOnly, async (c) => {
  const { limit } = await c.req.json()
  if (!limit || limit < 10 || limit > 500) return c.json({ error: 'Limit must be 10–500' }, 400)

  await prisma.systemSetting.upsert({
    where: { key: 'page_limit' },
    update: { value: String(limit) },
    create: { key: 'page_limit', value: String(limit) },
  })

  return c.json({ message: 'Page limit updated', limit })
})

const LETTERHEAD_KEYS = ['company_name', 'company_email', 'company_phone', 'company_gstin', 'company_address', 'company_state'] as const

settingsRoutes.patch('/', adminOnly, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  for (const key of LETTERHEAD_KEYS) {
    if (typeof body[key] !== 'string') continue
    const value = body[key].trim()
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  }
  const settings = await prisma.systemSetting.findMany({ where: { key: { in: [...LETTERHEAD_KEYS] } } })
  return c.json(Object.fromEntries(settings.map((s) => [s.key, s.value])))
})

