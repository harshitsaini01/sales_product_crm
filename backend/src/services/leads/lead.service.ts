import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'

// ─── PER-ROW DUPLICATE FLAGS ─────────────────────────────────────────────────
// For a page of leads, find which of their emails/mobiles also appear on
// another non-trashed lead in the DB. Returns sets of normalised values that
// are duplicated — callers tag each row in JS without an N+1 query.
export async function computeFieldDuplicates(
  emails: (string | null | undefined)[],
  mobiles: (string | null | undefined)[],
) {
  const emailLowers = Array.from(new Set(
    emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e),
  ))
  const mobileTrim = Array.from(new Set(
    mobiles.map((m) => m?.trim()).filter((m): m is string => !!m),
  ))

  const [dupEmails, dupMobiles] = await Promise.all([
    emailLowers.length
      ? prisma.$queryRaw<Array<{ email: string }>>(Prisma.sql`
          SELECT LOWER(email) AS email
          FROM leads
          WHERE LOWER(email) IN (${Prisma.join(emailLowers)})
            AND email IS NOT NULL AND email <> ''
            AND trash = 0
          GROUP BY LOWER(email)
          HAVING COUNT(*) > 1
        `)
      : Promise.resolve([] as Array<{ email: string }>),
    mobileTrim.length
      ? prisma.$queryRaw<Array<{ mobile: string }>>(Prisma.sql`
          SELECT mobile
          FROM leads
          WHERE mobile IN (${Prisma.join(mobileTrim)})
            AND mobile IS NOT NULL AND mobile <> ''
            AND trash = 0
          GROUP BY mobile
          HAVING COUNT(*) > 1
        `)
      : Promise.resolve([] as Array<{ mobile: string }>),
  ])

  return {
    emailSet: new Set(dupEmails.map((d) => d.email)),
    mobileSet: new Set(dupMobiles.map((d) => d.mobile)),
  }
}

export function tagFieldDuplicates<T extends { email?: string | null; mobile?: string | null }>(
  rows: T[],
  sets: { emailSet: Set<string>; mobileSet: Set<string> },
): Array<T & { emailDup: boolean; mobileDup: boolean }> {
  return rows.map((r) => ({
    ...r,
    emailDup: !!r.email && sets.emailSet.has(r.email.trim().toLowerCase()),
    mobileDup: !!r.mobile && sets.mobileSet.has(r.mobile.trim()),
  }))
}

// ─── GET ALL LEADS (paginated, filtered, role-scoped) ─────────────────────────
export async function getAll(query: Record<string, string>, userId: number, role: string) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Number(query.limit) || 25)
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = { trash: 0 }

  // Search
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { mobile: { contains: query.search, mode: 'insensitive' } },
    ]
  }

  // Filters
  if (query.departmentId) where.departmentId = BigInt(query.departmentId)
  if (query.leadStatusId) where.leadStatusId = BigInt(query.leadStatusId)
  if (query.leadSubStatusId) where.leadSubStatusId = BigInt(query.leadSubStatusId)
  if (query.leadType) where.leadType = query.leadType
  if (query.website) where.website = query.website
  if (query.source) where.source = query.source
  if (query.state) where.state = { contains: query.state, mode: 'insensitive' }
  if (query.country) where.country = query.country
  if (query.called) where.called = Number(query.called)
  if (query.wapp) where.wapp = Number(query.wapp)
  if (query.trash === '1') { where.trash = 1 }
  if (query.isDuplicate === '1') where.isDuplicate = true
  if (query.isDuplicate === '0') where.isDuplicate = false

  // Date range
  if (query.fromDate || query.toDate) {
    where.createdAt = {
      ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
      ...(query.toDate ? { lte: new Date(query.toDate + 'T23:59:59') } : {}),
    }
  }

  // Follow-up date
  if (query.followupDate) {
    where.followupDate = { equals: new Date(query.followupDate) }
  }

  // Role scoping — counsellors/employees (+ sales-head) see only their own leads
  if (['counsellor', 'employee', 'franchise', 'sales-head'].includes(role) && userId) {
    where.assignedTo = { some: { clrId: BigInt(userId), status: 1 } }
  }

  const [total, data] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      skip,
      take: limit,
      orderBy: { id: 'desc' },
      select: {
        id: true, name: true, father: true, email: true, email2: true,
        mobile: true, mobile2: true, city: true, state: true, country: true,
        intrestedCourse: true, neetQualified: true, neetResult: true, neetscore: true, intrResult: true,
        leadType: true, leadStatus: true, leadSubStatus: true,
        leadStatusId: true, leadSubStatusId: true,
        departmentId: true, website: true, source: true, event: true, comment: true,
        called: true, wapp: true, flagSend: true, flagRcv: true,
        followupDate: true, commentDate: true, reminderDate: true,
        trash: true, asign: true, isDuplicate: true, duplicateOfId: true,
        createdAt: true, updatedAt: true,
        assignedTo: {
          where: { status: 1 },
          select: {
            clrId: true,
            counsellor: { select: { id: true, name: true } },
          },
        },
        followups: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { comment: true, followupDate: true, createdAt: true },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { note: true, createdAt: true, user: { select: { id: true, name: true } } },
        },
      },
    }),
  ])

  return { data: bigintFix(data), total, page, limit, totalPages: Math.ceil(total / limit) }
}

// ─── GET SINGLE LEAD ──────────────────────────────────────────────────────────
export async function getById(id: bigint) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: {
        where: { status: 1 },
        include: { counsellor: { select: { id: true, name: true, role: true, email: true } } },
      },
      followups: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: { select: { id: true, name: true } } },
      },
      notes: { orderBy: { createdAt: 'desc' } },
      documents: true,
      reminders: { orderBy: { reminderDate: 'asc' } },
    },
  })
  return lead ? bigintFix(lead) : null
}

// ─── CREATE LEAD ──────────────────────────────────────────────────────────────
export async function create(data: Record<string, unknown>, userId: number) {
  const lead = await prisma.lead.create({
    data: {
      name: String(data.name || ''),
      father: data.father ? String(data.father) : null,
      mother: data.mother ? String(data.mother) : null,
      email: data.email ? String(data.email) : null,
      email2: data.email2 ? String(data.email2) : null,
      email3: data.email3 ? String(data.email3) : null,
      mobile: data.mobile ? String(data.mobile) : null,
      mobile2: data.mobile2 ? String(data.mobile2) : null,
      mobile3: data.mobile3 ? String(data.mobile3) : null,
      fatherMobile: data.fatherMobile ? String(data.fatherMobile) : null,
      motherMobile: data.motherMobile ? String(data.motherMobile) : null,
      city: data.city ? String(data.city) : null,
      state: data.state ? String(data.state) : null,
      country: data.country ? String(data.country) : null,
      pincode: data.pincode ? String(data.pincode) : null,
      dob: data.dob ? String(data.dob) : null,
      castCategory: data.castCategory ? String(data.castCategory) : null,
      intrestedCourse: data.intrestedCourse ? String(data.intrestedCourse) : null,
      intrestedSubject: data.intrestedSubject ? String(data.intrestedSubject) : null,
      approximateBudget: data.approximateBudget ? String(data.approximateBudget) : null,
      neetRank: data.neetRank ? String(data.neetRank) : null,
      neetQualified: data.neetQualified ? String(data.neetQualified) : null,
      leadType: String(data.leadType || 'new'),
      departmentId: data.departmentId ? BigInt(data.departmentId as number) : BigInt(2),
      source: data.source ? String(data.source) : null,
      event: data.event ? String(data.event) : null,
      website: String(data.website || 'other'),
      comment: data.comment ? String(data.comment) : null,
      userId: BigInt(userId),
    },
  })

  // Auto-assign logic: assign to all users with automatic_asign_lead = 1
  await autoAssign(lead.id)

  return bigintFix(lead)
}

// ─── AUTO-ASSIGN ON LEAD CREATE ───────────────────────────────────────────────
export async function autoAssign(leadId: bigint) {
  const autoUsers = await prisma.user.findMany({
    where: { automaticAsignLead: 1, status: 1 },
    select: { id: true },
  })

  if (autoUsers.length > 0) {
    await prisma.asignedLead.createMany({
      data: autoUsers.map((u) => ({
        stdId: leadId,
        clrId: u.id,
        leadType: 'new',
        status: 1,
      })),
      skipDuplicates: true,
    })
    await prisma.lead.update({ where: { id: leadId }, data: { asign: 0 } })
  }
}

// ─── UPDATE LEAD ──────────────────────────────────────────────────────────────

// The frontend sends empty string "" for every blank field regardless of type.
// Prisma rejects "" for Int? columns — they must be null or a valid number.
function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

// All nullable Int columns on the Lead model that the edit form touches.
const LEAD_INT_FIELDS = [
  'overallScore',
  'neetPassingYear',
  'ucat',
  'dmat',
  'sat',
  'totalFees',
  'totalDepositFees',
  'balanceFees',
  'enrolled',
] as const

export async function update(id: bigint, data: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = { ...data }

  // Handle BigInt conversions for FK fields
  if (cleaned.departmentId) cleaned.departmentId = BigInt(cleaned.departmentId as number)
  if (cleaned.leadStatusId) cleaned.leadStatusId = BigInt(cleaned.leadStatusId as number)
  if (cleaned.leadSubStatusId) cleaned.leadSubStatusId = BigInt(cleaned.leadSubStatusId as number)
  if (cleaned.statusLeadTypeId) cleaned.statusLeadTypeId = BigInt(cleaned.statusLeadTypeId as number)

  // Coerce all Int? fields: convert "" / undefined → null, strings → number
  for (const field of LEAD_INT_FIELDS) {
    if (field in cleaned) {
      cleaned[field] = toIntOrNull(cleaned[field])
    }
  }

  const lead = await prisma.lead.update({ where: { id }, data: cleaned })
  return bigintFix(lead)
}

// ─── SOFT DELETE (TRASH) ──────────────────────────────────────────────────────
export async function softDelete(id: bigint) {
  await prisma.lead.update({ where: { id }, data: { trash: 1 } })
}

// ─── RESTORE FROM TRASH ───────────────────────────────────────────────────────
export async function restore(id: bigint) {
  await prisma.lead.update({ where: { id }, data: { trash: 0 } })
}

// ─── PERMANENT DELETE ─────────────────────────────────────────────────────────
export async function permanentDelete(id: bigint) {
  await prisma.lead.delete({ where: { id } })
}

// ─── FIND DUPLICATES ─────────────────────────────────────────────────────────
export async function findDuplicates() {
  const dupes = await prisma.$queryRaw<Array<{ mobile: string; count: bigint }>>`
    SELECT mobile, COUNT(*) as count
    FROM leads
    WHERE mobile IS NOT NULL AND mobile != '' AND trash = 0
    GROUP BY mobile
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 200
  `
  const mobileList = dupes.map((d) => d.mobile)
  const leads = await prisma.lead.findMany({
    where: { mobile: { in: mobileList }, trash: 0 },
    orderBy: [{ mobile: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, mobile: true, email: true, leadStatus: true, createdAt: true },
  })
  return { duplicates: dupes.map((d) => ({ mobile: d.mobile, count: Number(d.count) })), leads: bigintFix(leads) }
}

// ─── ASSIGN LEADS TO COUNSELLOR ──────────────────────────────────────────────
export async function assignLeads(leadIds: number[], counsellorId: number) {
  await prisma.asignedLead.createMany({
    data: leadIds.map((stdId) => ({
      stdId: BigInt(stdId),
      clrId: BigInt(counsellorId),
      leadType: 'new',
      status: 1,
    })),
    skipDuplicates: true,
  })
  return { assigned: leadIds.length }
}

// ─── UNASSIGN LEAD ────────────────────────────────────────────────────────────
export async function unassignLead(leadId: bigint, counsellorId: bigint) {
  await prisma.asignedLead.deleteMany({ where: { stdId: leadId, clrId: counsellorId } })
  // Keep the lead in its own department instead of letting it slip back into
  // the shared bucket pool. Cleared next time the lead is reassigned.
  await prisma.lead.update({ where: { id: leadId }, data: { bucketExcluded: true } })
}

// ─── BULK OPERATIONS ─────────────────────────────────────────────────────────
export async function bulkDelete(leadIds: number[]) {
  const result = await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: { trash: 1 },
  })
  return result.count
}

export async function bulkMove(leadIds: number[], departmentId: number) {
  const result = await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: { departmentId: BigInt(departmentId) },
  })
  return result.count
}

export async function bulkStatusReset(leadIds: number[]) {
  const result = await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: { leadStatus: 'Fresh', leadStatusId: null, leadSubStatus: null, leadSubStatusId: null },
  })
  return result.count
}

export async function bulkUpdateField(leadIds: number[], field: string, value: unknown) {
  const allowedFields = ['leadType', 'leadStatus', 'departmentId', 'website', 'source', 'called', 'wapp']
  if (!allowedFields.includes(field)) throw new Error(`Field ${field} is not allowed for bulk update`)

  const updateData: Record<string, unknown> = {}
  updateData[field] = field === 'departmentId' ? BigInt(value as number) : value

  const result = await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: updateData,
  })
  return result.count
}

// ─── BULK ASSIGN BY DATE ──────────────────────────────────────────────────────
export async function bulkAssignByDate(params: {
  counsellorId: number
  fromDate?: string
  toDate?: string
  departmentId?: number
  leadType?: string
}) {
  const where: Record<string, unknown> = { trash: 0 }
  if (params.fromDate || params.toDate) {
    where.createdAt = {
      ...(params.fromDate ? { gte: new Date(params.fromDate) } : {}),
      ...(params.toDate ? { lte: new Date(params.toDate + 'T23:59:59') } : {}),
    }
  }
  if (params.departmentId) where.departmentId = BigInt(params.departmentId)
  if (params.leadType) where.leadType = params.leadType

  const leads = await prisma.lead.findMany({ where, select: { id: true } })
  await prisma.asignedLead.createMany({
    data: leads.map((l) => ({
      stdId: l.id,
      clrId: BigInt(params.counsellorId),
      leadType: params.leadType || 'new',
      status: 1,
    })),
    skipDuplicates: true,
  })
  return leads.length
}

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────
export async function importFromCsv(rows: Array<Record<string, string>>, userId: number) {
  let success = 0
  let failed = 0

  for (const row of rows) {
    try {
      const lead = await prisma.lead.create({
        data: {
          name: row.name || row.Name || 'Unknown',
          email: row.email || row.Email || null,
          mobile: row.mobile || row.Mobile || null,
          city: row.city || row.City || null,
          state: row.state || row.State || null,
          country: row.country || row.Country || null,
          source: row.source || row.Source || null,
          website: row.website || row.Website || 'other',
          leadType: row.lead_type || row['Lead Type'] || 'new',
          event: row.event || row.Event || null,
          comment: row.comment || row.Comment || null,
          userId: BigInt(userId),
        },
      })
      // Add initial comment if present
      if (row.comment || row.Comment) {
        await prisma.leadFollowup.create({
          data: {
            stdId: lead.id,
            userid: BigInt(userId),
            comment: row.comment || row.Comment || '',
            status: 1,
          },
        })
      }
      await autoAssign(lead.id)
      success++
    } catch {
      failed++
    }
  }

  return { success, failed }
}

// ─── MARK CALLED / WHATSAPP ───────────────────────────────────────────────────
export async function toggleCalled(id: bigint, currentValue: number) {
  const lead = await prisma.lead.update({
    where: { id },
    data: { called: currentValue === 1 ? 0 : 1 },
  })
  return bigintFix(lead)
}

export async function toggleWapp(id: bigint, currentValue: number) {
  const lead = await prisma.lead.update({
    where: { id },
    data: { wapp: currentValue === 1 ? 0 : 1 },
  })
  return bigintFix(lead)
}
