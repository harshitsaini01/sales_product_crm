// ─────────────────────────────────────────────────────────────────────────────
// "How much of their plan is this customer actually using?"
//
// Used by the super admin panel (per customer and in aggregate) and by the
// customer's own plan-usage screen. Counting means querying inside each
// customer's schema, so the list view reads yesterday's snapshot rather than
// fanning COUNT(*) out across every schema on page load.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'
import { platformPrisma } from '../lib/platform'
import { getTenantClient } from '../lib/prisma'
import { getTenantById, listActiveTenantContexts } from './tenant.service'
import { runWithTenant, type TenantContext, type TenantLimits } from '../lib/tenant-context'
import { uploadsDirFor } from '../utils/tenant-paths'

export interface TenantUsage {
  users: number
  counsellors: number
  subAdmins: number
  branches: number
  leads: number
  leadsThisMonth: number
  students: number
  storageMb: number
}

export interface UsageAgainstLimits {
  usage: TenantUsage
  limits: TenantLimits
  /** Anything at or past 80% of its cap, for the "nearing limits" panel. */
  warnings: { key: keyof TenantLimits; label: string; used: number; limit: number; pct: number }[]
}

const LABELS: Partial<Record<keyof TenantLimits, string>> = {
  maxUsers: 'Team members',
  maxCounsellors: 'Counsellors',
  maxSubAdmins: 'Sub-admins',
  maxBranches: 'Branches',
  maxLeads: 'Leads',
  maxLeadsPerMonth: 'Leads this month',
  maxStorageMb: 'Storage',
}

function startOfMonth(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function directorySizeMb(dir: string): Promise<number> {
  let bytes = 0
  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return // never provisioned an upload yet
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) bytes += stat.size
      }
    }
  }
  await walk(dir)
  return Math.round(bytes / (1024 * 1024))
}

/** Live counts for one customer. Runs inside their schema. */
export async function computeTenantUsage(ctx: TenantContext): Promise<TenantUsage> {
  const db = getTenantClient(ctx.schemaName)

  const [users, counsellors, subAdmins, branches, leads, leadsThisMonth, students] = await runWithTenant(
    ctx,
    () =>
      Promise.all([
        db.user.count({ where: { status: 1 } }),
        db.user.count({ where: { status: 1, role: 'counsellor' } }),
        db.user.count({ where: { status: 1, role: 'sub-admin' } }),
        db.branch.count({ where: { status: 1 } }),
        db.lead.count({ where: { trash: 0 } }),
        db.lead.count({ where: { trash: 0, createdAt: { gte: startOfMonth() } } }),
        db.lead.count({ where: { enrolled: 1 } }),
      ]),
  )

  const storageMb = await directorySizeMb(uploadsDirFor(ctx))

  return { users, counsellors, subAdmins, branches, leads, leadsThisMonth, students, storageMb }
}

function usedFor(usage: TenantUsage, key: keyof TenantLimits): number {
  switch (key) {
    case 'maxUsers': return usage.users
    case 'maxCounsellors': return usage.counsellors
    case 'maxSubAdmins': return usage.subAdmins
    case 'maxBranches': return usage.branches
    case 'maxLeads': return usage.leads
    case 'maxLeadsPerMonth': return usage.leadsThisMonth
    case 'maxStorageMb': return usage.storageMb
    default: return 0
  }
}

export function compareToLimits(usage: TenantUsage, limits: TenantLimits): UsageAgainstLimits {
  const warnings: UsageAgainstLimits['warnings'] = []

  for (const key of Object.keys(limits) as (keyof TenantLimits)[]) {
    const limit = limits[key]
    if (limit == null || limit <= 0) continue
    const used = usedFor(usage, key)
    const pct = Math.round((used / limit) * 100)
    if (pct >= 80) warnings.push({ key, label: LABELS[key] ?? key, used, limit, pct })
  }

  warnings.sort((a, b) => b.pct - a.pct)
  return { usage, limits, warnings }
}

export async function getTenantUsage(tenantId: number): Promise<UsageAgainstLimits | null> {
  const ctx = await getTenantById(tenantId)
  if (!ctx) return null
  const usage = await computeTenantUsage(ctx)
  return compareToLimits(usage, ctx.limits)
}

/**
 * Write today's usage row for every active customer. Run nightly so the super
 * admin list view renders instantly instead of counting across N schemas.
 */
export async function captureUsageSnapshots(): Promise<number> {
  const tenants = await listActiveTenantContexts()
  const today = new Date()
  const capturedOn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  let written = 0
  for (const ctx of tenants) {
    try {
      const usage = await computeTenantUsage(ctx)
      const data = {
        users: usage.users,
        counsellors: usage.counsellors,
        branches: usage.branches,
        leads: usage.leads,
        leadsThisMonth: usage.leadsThisMonth,
        storageMb: usage.storageMb,
      }
      await platformPrisma.tenantUsageSnapshot.upsert({
        where: { tenantId_capturedOn: { tenantId: ctx.tenantId, capturedOn } },
        create: { tenantId: ctx.tenantId, capturedOn, ...data },
        update: data,
      })
      written++
    } catch (err) {
      console.error(`[usage] snapshot failed for ${ctx.slug}:`, err)
    }
  }
  return written
}

/** The most recent stored snapshot per customer, for list views. */
export async function latestSnapshots(): Promise<Map<number, { users: number; leads: number; storageMb: number; capturedOn: Date }>> {
  const rows = await platformPrisma.tenantUsageSnapshot.findMany({
    orderBy: [{ tenantId: 'asc' }, { capturedOn: 'desc' }],
    select: { tenantId: true, users: true, leads: true, storageMb: true, capturedOn: true },
  })

  const out = new Map<number, { users: number; leads: number; storageMb: number; capturedOn: Date }>()
  for (const row of rows) {
    if (!out.has(row.tenantId)) {
      out.set(row.tenantId, {
        users: row.users,
        leads: row.leads,
        storageMb: row.storageMb,
        capturedOn: row.capturedOn,
      })
    }
  }
  return out
}
