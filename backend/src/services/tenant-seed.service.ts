// ─────────────────────────────────────────────────────────────────────────────
// Baseline configuration for a brand-new customer.
//
// A freshly migrated schema has all the tables but no lead departments, no
// statuses and no branch — the app would render empty dropdowns everywhere and
// leads could not be created at all. This gives every new customer a working
// pipeline on day one, which they are then free to rename or replace.
//
// Idempotent: safe to re-run against a half-seeded schema.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import { getVertical, type VerticalKey } from '../config/verticals'
import { seedProductCatalog } from '../config/product-catalog-seed'

// The pipeline used to be four hardcoded arrays here. It now comes from the
// customer's vertical preset (config/verticals.ts), so an IT-sales customer is
// seeded with "Demo Scheduled → Proposal Sent → Negotiation" instead of an
// admissions funnel. The education preset holds exactly the arrays that used to
// live here, so a customer provisioned without a vertical is seeded identically
// to before.

export interface SeedAdmin {
  name: string
  email: string
  loginid: string
  password: string
  mobile?: string
}

export interface SeedResult {
  departments: number
  statuses: number
  leadTypes: number
  followupStatuses: number
  accountTypes: number
  industries: number
  pipelines: number
  lostReasons: number
  teams: number
  products: number
  branchId: number | null
  adminUserId: number | null
}

/**
 * Seed one tenant schema. `db` must be a client already pointed at it.
 */
export async function seedTenantSchema(
  db: PrismaClient,
  opts: { companyName: string; admin?: SeedAdmin; vertical?: VerticalKey },
): Promise<SeedResult> {
  const {
    departments: DEPARTMENTS,
    lifecycle: LIFECYCLE,
    leadTypes: LEAD_TYPES,
    followupStatuses: FOLLOWUP_STATUSES,
    accountTypes: ACCOUNT_TYPES,
    industries: INDUSTRIES,
    pipelines: PIPELINES,
    lostReasons: LOST_REASONS,
    teams: TEAMS,
  } = getVertical(opts.vertical).seed

  const result: SeedResult = {
    departments: 0,
    statuses: 0,
    leadTypes: 0,
    followupStatuses: 0,
    accountTypes: 0,
    industries: 0,
    pipelines: 0,
    lostReasons: 0,
    teams: 0,
    products: 0,
    branchId: null,
    adminUserId: null,
  }

  // ── Departments
  const departmentIds: bigint[] = []
  for (const dept of DEPARTMENTS) {
    let row = await db.leadDepartment.findFirst({ where: { slug: dept.slug }, select: { id: true } })
    if (!row) {
      row = await db.leadDepartment.create({ data: dept, select: { id: true } })
      result.departments++
    }
    departmentIds.push(row.id)
  }

  // ── Lifecycle statuses, per department
  for (const departmentId of departmentIds) {
    for (const stage of LIFECYCLE) {
      const existing = await db.leadStatus.findFirst({
        where: { departmentId, slug: stage.slug },
        select: { id: true },
      })
      if (existing) {
        await db.leadStatus.update({
          where: { id: existing.id },
          data: { title: stage.title, priority: stage.priority, status: 1 },
        })
        continue
      }
      await db.leadStatus.create({ data: { ...stage, departmentId } })
      result.statuses++
    }
  }

  if ((opts.vertical ?? 'product_sales') === 'product_sales') {
    const keepSlugs = LIFECYCLE.map((s) => s.slug)
    const keepDeptSlugs = DEPARTMENTS.map((d) => d.slug)
    await db.leadStatus.updateMany({
      where: { slug: { notIn: keepSlugs } },
      data: { status: 0 },
    })
    await db.leadDepartment.updateMany({
      where: { slug: { notIn: keepDeptSlugs } },
      data: { status: 0 },
    })
    const sales = await db.leadDepartment.findFirst({
      where: { slug: 'sales' },
      select: { id: true },
    })
    if (sales) {
      await db.lead.updateMany({
        where: { OR: [{ departmentId: { not: sales.id } }, { departmentId: null }] },
        data: { departmentId: sales.id },
      })
    }
  }

  // ── Lead types
  for (const type of LEAD_TYPES) {
    const existing = await db.leadTypeConfig.findFirst({ where: { slug: type.slug }, select: { id: true } })
    if (existing) continue
    await db.leadTypeConfig.create({ data: { ...type, departmentId: departmentIds[0] } })
    result.leadTypes++
  }

  // ── Followup outcomes
  for (const fs of FOLLOWUP_STATUSES) {
    const existing = await db.leadFollowupStatus.findFirst({ where: { status: fs.status }, select: { id: true } })
    if (existing) continue
    await db.leadFollowupStatus.create({ data: fs })
    result.followupStatuses++
  }

  // ── B2B config tables. Only the verticals that carry them (today: b2b_sales)
  //    seed anything here — an education customer's accounts module is off, so
  //    the tables stay empty, which costs nothing.
  //
  //    Slugified the same way the API's create endpoints do, so a name typed by
  //    an admin later lands on the same row rather than a near-duplicate.
  const slugify = (v: string) =>
    v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

  for (const t of ACCOUNT_TYPES ?? []) {
    const slug = slugify(t.name)
    const existing = await db.accountType.findFirst({ where: { slug }, select: { id: true } })
    if (existing) continue
    await db.accountType.create({ data: { name: t.name, slug, priority: t.priority } })
    result.accountTypes++
  }

  for (const i of INDUSTRIES ?? []) {
    const slug = slugify(i.name)
    const existing = await db.industry.findFirst({ where: { slug }, select: { id: true } })
    if (existing) continue
    await db.industry.create({ data: { name: i.name, slug, priority: i.priority } })
    result.industries++
  }

  // ── The sales pipeline and its stages. The FIRST seeded pipeline is the
  //    default, so a deal created before anybody configures anything still has
  //    somewhere to go.
  for (const [index, pl] of (PIPELINES ?? []).entries()) {
    const slug = slugify(pl.name)
    const existing = await db.pipeline.findFirst({ where: { slug }, select: { id: true } })
    if (existing) continue

    const created = await db.pipeline.create({
      data: { name: pl.name, slug, isDefault: index === 0, priority: index * 10 },
      select: { id: true },
    })
    result.pipelines++

    for (const [i, stage] of pl.stages.entries()) {
      await db.pipelineStage.create({
        data: {
          pipelineId: created.id,
          name: stage.name,
          slug: slugify(stage.name),
          probability: stage.probability,
          sortOrder: i * 10,
          isWon: stage.isWon ?? false,
          isLost: stage.isLost ?? false,
        },
      })
    }
  }

  if ((opts.vertical ?? 'product_sales') === 'product_sales') {
    const pipeline = await db.pipeline.findFirst({
      where: { slug: 'product-sales' },
      select: { id: true },
    })
    if (pipeline) {
      const rename = async (fromSlugs: string[], name: string, extra: { isWon?: boolean; isLost?: boolean } = {}) => {
        const row = await db.pipelineStage.findFirst({
          where: { pipelineId: pipeline.id, slug: { in: fromSlugs } },
          select: { id: true },
        })
        if (!row) return
        await db.pipelineStage.update({
          where: { id: row.id },
          data: { name, slug: slugify(name), ...extra },
        })
      }
      await rename(['new', 'enquiry'], 'Enquiry')
      await rename(['negotiation', 'follow-up'], 'Follow-up')
      await rename(['won', 'confirmed'], 'Confirmed', { isWon: true, isLost: false })
      await rename(['lost', 'dropped'], 'Dropped', { isWon: false, isLost: true })
    }
  }

  for (const [i, reason] of (LOST_REASONS ?? []).entries()) {
    const slug = slugify(reason)
    const existing = await db.lostReason.findFirst({ where: { slug }, select: { id: true } })
    if (existing) continue
    await db.lostReason.create({ data: { name: reason, slug, priority: i * 10 } })
    result.lostReasons++
  }

  // ── Teams a project can be handed to (IT, Digital Marketing…). Members are
  //    left for the admin: seeding cannot know who works where.
  for (const team of TEAMS ?? []) {
    const slug = slugify(team.name)
    const existing = await db.crmTeam.findFirst({ where: { slug }, select: { id: true } })
    if (existing) continue
    await db.crmTeam.create({
      data: { name: team.name, slug, priority: team.priority, color: team.color ?? null },
    })
    result.teams++
  }

  // ── A head-office branch, so users have somewhere to belong
  let branch = await db.branch.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
  if (!branch) {
    branch = await db.branch.create({
      data: { name: 'Head Office', status: 1 },
      select: { id: true },
    })
  }
  result.branchId = Number(branch.id)

  if ((opts.vertical ?? 'product_sales') === 'product_sales') {
    const catalog = await seedProductCatalog(db)
    result.products = catalog.created
  }

  // ── System settings
  await db.systemSetting.upsert({
    where: { key: 'company_name' },
    create: { key: 'company_name', value: opts.companyName },
    update: {},
  })

  // ── The customer's first admin
  if (opts.admin) {
    const existing = await db.user.findFirst({
      where: { OR: [{ loginid: opts.admin.loginid }, { email: opts.admin.email }] },
      select: { id: true },
    })

    if (existing) {
      result.adminUserId = Number(existing.id)
    } else {
      const created = await db.user.create({
        data: {
          name: opts.admin.name,
          email: opts.admin.email,
          loginid: opts.admin.loginid,
          username: opts.admin.loginid,
          mobile: opts.admin.mobile || '',
          password: await hash(opts.admin.password, 10),
          role: 'admin',
          status: 1,
          branchId: branch.id,
          showFullPhone: 1,
          designation: 'Administrator',
        },
        select: { id: true },
      })
      // The role table mirrors User.role — the app reads both.
      await db.userRole_.create({ data: { userId: created.id, role: 'admin' } })
      result.adminUserId = Number(created.id)
    }
  }

  return result
}
