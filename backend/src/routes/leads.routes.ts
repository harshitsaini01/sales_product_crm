import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { currentTenant, hasFeature } from '../lib/tenant-context'
import { isLeadFieldVisible } from '../config/lead-fields'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { accessibleUserIds, isBranchManager, isFullAdmin } from '../utils/branch-scope'
import { todayDateOnly, REAL_FOLLOWUP_MIN } from '../utils/date-range'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'
import { negateLeadClause, NEVER_INVERTED_KEYS, safeBigInt } from '../utils/lead-filter'
import { recordStatusChange } from '../services/leads/status-history.service'
import { resolveAutoTransition, type CallOutcome } from '../services/leads/call-rules'
import { computeFieldDuplicates, tagFieldDuplicates } from '../services/leads/lead.service'
import { permanentlyDeleteLeads } from '../services/leads/permanent-delete.service'
import { applyFieldUpdate, isBulkUpdatableField } from '../services/leads/field-update.service'
import { canMoveTo } from '../services/leads/pipeline.service'
import { bumpLeadScore } from '../services/crm/sales-events.service'
import { resolveStatusCascade } from '../services/leads/status-cascade.service'
import { listLeadCatalogSends, sendLeadCatalog } from '../services/catalog-send.service'
import { buildBulkStatusPlan } from '../services/leads/bulk-status-plan.service'
import { uploadSingle } from '../middleware/upload'
import { buildLeadPhoneIndex, normalizePhone } from '../utils/phone'
import path from 'path'

// Phone fields on the Lead model that should run through normalizePhone()
// before they hit the DB. Kept in one place so create + patch + CSV stay aligned.
const LEAD_PHONE_FIELDS = [
  'mobile', 'mobile2', 'mobile3',
  'fatherMobile', 'motherMobile', 'homeContactNumber',
] as const

function normalizeLeadPhones(body: Record<string, any>): void {
  for (const f of LEAD_PHONE_FIELDS) {
    if (f in body && body[f] !== undefined) {
      body[f] = normalizePhone(body[f]) ?? body[f]
    }
  }
}

// ─── BigInt → number/string serializer ───────────────────────────────────────
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

// ─── Safe date-filter parser ─────────────────────────────────────────────────
// Date filter values arrive from the UI as free strings (or from saved /
// bookmarked URLs). A malformed value — a typo'd date, a partial digit string,
// a paste accident — makes `new Date(...)` return an `Invalid Date` or an
// absurd out-of-range year (e.g. "+020502-..."). Passing either to Prisma
// throws `PrismaClientUnknownRequestError: Could not convert argument value ...`
// which 500s the ENTIRE leads list, tab-count, and department-count queries —
// breaking the whole filtered view and every status/department counter at once.
//
// Returns a valid Date only when the input parses AND lands in a sane range
// (year 1900..2200). Anything else → undefined, so the caller simply drops that
// half of the date range instead of crashing.
// Anchor the day bounds to IST (UTC+5:30) — the business's local time. Parsing
// a bare "YYYY-MM-DD" defaults to UTC midnight, so a lead created at 02:50 IST
// (21:20 UTC the day before) fell outside a same-day "today" filter and showed
// up as yesterday. Building the ISO string with an explicit +05:30 offset puts
// the boundary at real midnight IST regardless of the server's own timezone.
function safeDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:30`
    : trimmed
  const d = new Date(iso)
  const t = d.getTime()
  if (Number.isNaN(t)) return undefined
  const year = d.getUTCFullYear()
  if (year < 1900 || year > 2200) return undefined
  return d
}

// Midnight IST for "now" — used by the "New Today" counter so it lines up with
// the fromDate/toDate filter above instead of following the server's timezone.
function startOfTodayIST(): Date {
  const label = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  return new Date(`${label}T00:00:00.000+05:30`)
}

function parseMultiFilterValue(value: string | undefined): string[] {
  const trimmed = value?.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean)
      }
    } catch {
      // Older saved filters and URLs use comma-separated values.
    }
  }
  return trimmed.split(',').map((v) => v.trim()).filter(Boolean)
}

export const leadsRoutes = new Hono()

leadsRoutes.use('*', authenticate)

// Resolve the IDs of any LeadDepartment with slug='archive'. Used to hide
// archived leads from the shared Bucket and Duplicates views — once a lead
// has been moved into the Archive department, it should not surface anywhere
// counsellors might pick it back up.
async function getArchiveDepartmentIds(): Promise<bigint[]> {
  const rows = await prisma.leadDepartment.findMany({
    where: { slug: 'archive' },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

async function fallbackDepartmentId(): Promise<bigint> {
  const sales = await prisma.leadDepartment.findFirst({
    where: { slug: 'sales', status: 1 },
    select: { id: true },
  })
  if (sales) return sales.id
  const any = await prisma.leadDepartment.findFirst({
    where: { status: 1 },
    orderBy: { priority: 'asc' },
    select: { id: true },
  })
  return any?.id ?? BigInt(1)
}

// ─── Shared status → department / type cascade ────────────────────────────────
// When a status or sub-status changes, the lead's departmentId and
// statusLeadTypeId must follow — otherwise the lead is stamped with a status
// that belongs to Department B while its departmentId still points at A, and
// it vanishes from B's filtered view.
//
// The rules live in services/leads/status-cascade.service.ts — the single
// implementation shared by PATCH /:id, POST /bulk-status, addLeadFollowup and
// the bulk-engine, so no two paths can drift on what `move_to` means.

// ─── Unified lead WHERE clause ───────────────────────────────────────────────
// Exported so the bulk-engine routes can re-use the same filter semantics for
// `POST /bulk/select-ids` and `POST /bulk/apply { filter }`.
//
// When filters.excludeMode === '1' / 'true', every USER-SELECTED filter is
// negated independently (each clause negated and ANDed together):
//   include: status=Hot AND source=FB AND city=Mumbai
//   exclude: status!=Hot AND source!=FB AND city!=Mumbai
// Negation is NULL-safe — see negateLeadClause above.
//
// Scope filters — trash flag, role-based assignment, branch scope, and the
// Calling-Task `ids` batch — are NEVER inverted: they are guardrails, not user
// choices. Callers may additionally pass `excludeFields` (comma-separated
// filter keys) to restrict which clauses Exclude applies to; anything not
// listed stays a plain include. The Leads page uses this so that flipping
// Exclude in the Advanced Filters panel negates only what that panel controls,
// and does not silently invert the department sub-nav or the lead-type tab it
// also sends on every request. Callers that omit `excludeFields` (Bulk
// Management, the mobile app) keep the original negate-everything behaviour.
export async function buildLeadWhere(filters: Record<string, string | undefined>, userId?: number, role?: string) {
  const isExclude = filters.excludeMode === '1' || filters.excludeMode === 'true'

  // === Scope: hard filters that ALWAYS apply (never inverted) ===
  const where: Record<string, unknown> = { trash: filters.trash === '1' ? 1 : 0 }
  if (filters.includeTrash === '1') delete where.trash

  // Optional allow-list of filter keys that Exclude mode may invert. Absent /
  // empty ⇒ every user clause is invertible (legacy behaviour).
  const excludeFields = (filters.excludeFields ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const excludeFieldSet = excludeFields.length ? new Set(excludeFields) : null

  // === User-selected filter clauses (each tagged with the filter key it came
  // from, then ANDed at the end — negated first when Exclude applies to it) ===
  const userClauses: Array<{ key: string; clause: Record<string, unknown> }> = []
  const addClause = (key: string, clause: Record<string, unknown>) => {
    userClauses.push({ key, clause })
  }
  // Should Exclude mode invert the clause contributed by `key`?
  const invert = (key: string) =>
    isExclude && !NEVER_INVERTED_KEYS.has(key) && (!excludeFieldSet || excludeFieldSet.has(key))

  // Explicit ID filter — used when the Leads page is opened from a Calling Task
  // ("View leads") to restrict the list to that batch's leads only. Comma-separated
  // integer ids; anything unparseable is dropped silently.
  if (filters.ids) {
    const ids = filters.ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => { try { return BigInt(s) } catch { return null } })
      .filter((v): v is bigint => v !== null)
    if (ids.length) addClause('ids', { id: { in: ids } })
    else addClause('ids', { id: BigInt(-1) }) // ids param provided but empty → return nothing
  }

  if (filters.search) {
    const or: Array<Record<string, unknown>> = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { mobile: { contains: filters.search, mode: 'insensitive' } },
    ]
    // The search box advertises "Search by ID …" — when the term is a pure
    // positive integer, also match on the lead's primary key. Wrap in try/catch
    // because BigInt() throws on overflow (e.g. user pastes a 30-digit number)
    // and we'd rather degrade to a name/email/mobile search than 500.
    const trimmed = filters.search.trim()
    if (/^\d+$/.test(trimmed)) {
      try { or.push({ id: BigInt(trimmed) }) } catch { /* ignore overflow */ }
    }
    addClause('search', { OR: or })
  }

  if (filters.departmentId) {
    const ids = filters.departmentId
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => { try { return BigInt(s) } catch { return null } })
      .filter((v): v is bigint => v !== null)
    if (ids.length === 1) addClause('departmentId', { departmentId: ids[0] })
    else if (ids.length > 1) addClause('departmentId', { departmentId: { in: ids } })
  }
  if (filters.leadStatusId === 'fresh') {
    addClause('leadStatusId', { leadStatus: { equals: 'Fresh', mode: 'insensitive' } })
  } else if (filters.leadStatusId) {
    const statusId = safeBigInt(filters.leadStatusId)
    if (statusId !== null) addClause('leadStatusId', { leadStatusId: statusId })
  }
  if (filters.leadSubStatusId) {
    const subId = safeBigInt(filters.leadSubStatusId)
    if (subId !== null) addClause('leadSubStatusId', { leadSubStatusId: subId })
  }

  if (filters.statusLeadTypeId) {
    // A lead belongs to EXACTLY the bucket its `statusLeadTypeId` points to.
    // This is the single source of truth for the lead-type tabs — and it's also
    // what the tab badge counts (see /tab-counts: groupBy statusLeadTypeId), so
    // the list and the badge are guaranteed to match.
    //
    // We used to additionally fuzzy-match the legacy `leadType` *string* here,
    // but that pulled already-bucketed leads into the wrong tab (e.g. a lead
    // moved to "Not Interested" but still carrying leadType="greetings" leaked
    // back into Greetings, inflating the list past the badge). The handful of
    // legacy-string-only leads have been backfilled with a real
    // statusLeadTypeId, so the string fallback is no longer needed.
    //
    // Special case — the "Default" bucket: every department has exactly one
    // Default lead-type (slug ends in `-default`). A brand-new / unsorted lead
    // has statusLeadTypeId = NULL (no bucket assigned yet) — conceptually it IS
    // "Default". So the Default tab must surface BOTH the explicit Default bucket
    // AND the NULL-bucket leads; otherwise those NULL leads sit in the dept's
    // "All" total but have no clickable tab, and the tabs never sum to All.
    //
    // Special case — Archive's "Old Data": archived leads keep the bucket they
    // had in their origin department (e.g. an archived lead still carries its old
    // "Not Interested" bucket #8), so they don't fit Archive's own tabs. Rather
    // than scatter them across foreign-bucket tabs (which Archive doesn't show),
    // the "Old Data" tab acts as the catch-all for EVERYTHING in the Archive
    // department — it's effectively the "All" of Archive. These leads stay scoped
    // to departmentId = Archive, so they never leak into other departments' tabs.
    const typeId = safeBigInt(filters.statusLeadTypeId)
    const typeRow = typeId === null ? null : await prisma.leadTypeConfig.findUnique({
      where: { id: typeId },
      select: { slug: true },
    })
    const isDefaultBucket = !!typeRow && (typeRow.slug === 'default' || typeRow.slug.endsWith('-default'))
    const isArchiveOldData = !!typeRow && typeRow.slug === 'old-data'
    if (isArchiveOldData) {
      // No bucket restriction — the department scope (departmentId = Archive,
      // applied separately above) already limits this to archived leads.
    } else if (typeId === null) {
      // Junk tab value — ignore it rather than 500 the list.
    } else if (isDefaultBucket) {
      addClause('statusLeadTypeId', { OR: [{ statusLeadTypeId: typeId }, { statusLeadTypeId: null }] })
    } else {
      addClause('statusLeadTypeId', { statusLeadTypeId: typeId })
    }
  }

  if (filters.leadType) addClause('leadType', { leadType: filters.leadType })
  if (filters.website) addClause('website', { website: filters.website })
  if (filters.source) {
    const list = parseMultiFilterValue(filters.source)
    addClause('source', {
      source: list.length > 1 ? { in: list } : { contains: list[0] || filters.source, mode: 'insensitive' },
    })
  }
  // state / city / event / intrestedCourse accept either a single free-text
  // value (legacy / mobile API) or a comma-separated list from the multi-select
  // dropdown on the web UI. Multi-value → exact `in` match (values come from
  // the field-values endpoint so they're already canonical). Single value →
  // case-insensitive contains.
  if (filters.state) {
    const list = parseMultiFilterValue(filters.state)
    addClause('state', {
      state: list.length > 1 ? { in: list } : { contains: list[0] || filters.state, mode: 'insensitive' },
    })
  }
  if (filters.city) {
    const list = parseMultiFilterValue(filters.city)
    addClause('city', {
      city: list.length > 1 ? { in: list } : { contains: list[0] || filters.city, mode: 'insensitive' },
    })
  }
  if (filters.event) {
    // Dropdown is labeled "Event / Source" and its options are merged from BOTH
    // the `event` and `source` columns. Match against either column so picking
    // e.g. "facebook campaign" (which lives in `source`) or "Modal Form" (also
    // in `source`) still returns results.
    const list = parseMultiFilterValue(filters.event)
    if (list.length > 1) {
      addClause('event', {
        OR: [
          { event: { in: list } },
          { source: { in: list } },
        ],
      })
    } else {
      const v = list[0] || filters.event
      addClause('event', {
        OR: [
          { event: { contains: v, mode: 'insensitive' } },
          { source: { contains: v, mode: 'insensitive' } },
        ],
      })
    }
  }
  if (filters.country) {
    const list = parseMultiFilterValue(filters.country)
    addClause('country', {
      country: list.length > 1 ? { in: list } : { contains: list[0] || filters.country, mode: 'insensitive' },
    })
  }
  if (filters.intrestedCourse) {
    const list = parseMultiFilterValue(filters.intrestedCourse)
    addClause('intrestedCourse', {
      intrestedCourse: list.length > 1 ? { in: list } : { contains: list[0] || filters.intrestedCourse, mode: 'insensitive' },
    })
  }
  // Lead score bucket filter. Accepts either a JSON array or comma-separated
  // list of "min-max" tokens. Each token is an inclusive-lower / exclusive-upper
  // range, matching the bucket boundaries used by the UI (0-10 = [0,10), etc.).
  // A trailing empty upper ("100-") is an open-ended "and above" bucket.
  if (filters.leadScoreRanges) {
    const raw = parseMultiFilterValue(filters.leadScoreRanges)
    const ranges: Array<{ gte: number; lt?: number }> = []
    for (const token of raw) {
      const m = /^\s*(\d+)\s*-\s*(\d*)\s*$/.exec(token)
      if (!m) continue
      const lo = Number(m[1])
      const hi = m[2] === '' ? undefined : Number(m[2])
      if (Number.isNaN(lo)) continue
      if (hi !== undefined && (Number.isNaN(hi) || hi <= lo)) continue
      ranges.push(hi === undefined ? { gte: lo } : { gte: lo, lt: hi })
    }
    if (ranges.length) {
      addClause('leadScoreRanges', {
        OR: ranges.map((r) => ({
          leadScore: r.lt === undefined ? { gte: r.gte } : { gte: r.gte, lt: r.lt },
        })),
      })
    }
  }

  // Number('') === 0 and Number('abc') === NaN — an empty or junk value used to
  // become a real `called = 0` clause (or a NaN that Prisma rejects outright),
  // so only accept the two flags these columns actually store.
  if (filters.called === '0' || filters.called === '1') addClause('called', { called: Number(filters.called) })
  if (filters.wapp === '0' || filters.wapp === '1') addClause('wapp', { wapp: Number(filters.wapp) })
  if (filters.hasEmail === '1') addClause('hasEmail', { email: { not: null } })
  if (filters.hasMobile === '1') addClause('hasMobile', { mobile: { not: null } })
  if (filters.missingEmail === '1') addClause('missingEmail', { email: null })
  if (filters.missingMobile === '1') addClause('missingMobile', { mobile: null })
  if (filters.mobilePrefix) addClause('mobilePrefix', { mobile: { startsWith: filters.mobilePrefix } })
  // "No follow-up scheduled in the last N days" — null/missing followupDate counts as stale.
  if (filters.noFollowupSinceDays) {
    const days = Number(filters.noFollowupSinceDays)
    if (!Number.isNaN(days) && days > 0) {
      const cutoff = new Date(Date.now() - days * 86_400_000)
      addClause('noFollowupSinceDays', {
        OR: [{ followupDate: null }, { followupDate: { lt: cutoff } }],
      })
    }
  }
  if (filters.unassigned === '1') addClause('unassigned', { assignedTo: { none: { status: 1 } } })
  if (filters.duplicatesOnly === '1') addClause('duplicatesOnly', { isDuplicate: true })
  // The Leads page's Duplicate chip sends isDuplicate=1 (duplicates) / 0
  // (originals). It had no handler here at all, so picking it changed nothing
  // while the chip claimed the list was filtered.
  if (filters.isDuplicate === '1') addClause('isDuplicate', { isDuplicate: true })
  else if (filters.isDuplicate === '0') addClause('isDuplicate', { isDuplicate: false })

  // Enrolled state — matches the dashboard's "Enrolled" and "Active Pipeline"
  // cards. enrolled=1 → the student is enrolled; enrolled=0 → active pipeline
  // (not yet enrolled), which must also match rows where the column is NULL
  // (leads created before the field was populated). The dashboard counts the
  // NULL rows in the active-pipeline total, so this filter must too — otherwise
  // the Active Pipeline card and the leads-page count disagree.
  if (filters.enrolled === '1') addClause('enrolled', { enrolled: 1 })
  else if (filters.enrolled === '0') addClause('enrolled', { OR: [{ enrolled: 0 }, { enrolled: null }] })

  // Overdue follow-ups — matches the dashboard's "Overdue" card. Anchors both
  // ends: gte REAL_FOLLOWUP_MIN drops "N/A" placeholders (0001-01-01) and
  // lt today (IST) matches the dashboard's cutoff. Without this, the URL used
  // to send only `followupTo=yesterday`, which pulled every placeholder row in
  // and inflated the count to something bigger than the dashboard reported.
  if (filters.overdue === '1') {
    addClause('overdue', { followupDate: { gte: REAL_FOLLOWUP_MIN, lt: todayDateOnly() } })
  }

  // Created date range. Each bound is validated independently via safeDate — an
  // invalid value is dropped, never forwarded to Prisma. If neither bound
  // survives, the whole createdAt clause is skipped rather than pushing an empty
  // (and therefore meaningless) filter object.
  {
    const gte = safeDate(filters.fromDate)
    const lte = safeDate(filters.toDate, true)
    if (gte || lte) {
      addClause('createdAt', {
        createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) },
      })
    }
  }

  // Follow-up date range. followupDate is a `@db.Date` (calendar date) column
  // stored without a timezone, so Prisma round-trips it as UTC midnight. If we
  // pass IST-midnight bounds here (as safeDate produces for createdAt), Prisma
  // truncates them to the UTC-date portion and the range shifts one day
  // earlier — the URL's `followupFrom=today&followupTo=today` then also matched
  // yesterday's follow-ups, inflating the count vs the dashboard card. Parse
  // the bounds as UTC midnight instead so they compare directly against the
  // stored calendar-date values.
  {
    const parseUtcDate = (value: string | undefined, endOfDay = false): Date | undefined => {
      const trimmed = value?.trim()
      if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined
      return new Date(`${trimmed}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}Z`)
    }
    const gte = parseUtcDate(filters.followupFrom)
    const lte = parseUtcDate(filters.followupTo, true)
    if (gte || lte) {
      addClause('followupDate', {
        followupDate: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) },
      })
    } else if (filters.followupDate) {
      const d = parseUtcDate(filters.followupDate)
      if (d) {
        const next = new Date(d); next.setUTCDate(d.getUTCDate() + 1)
        addClause('followupDate', { followupDate: { gte: d, lt: next } })
      }
    }
  }

  // Assignment-date range — filters leads by when the ACTIVE assignment was
  // created (AsignedLead.createdAt). Useful for "leads assigned to me today"
  // even if the lead itself is months old.
  const assignedFromDate = safeDate(filters.assignedFrom)
  const assignedToDate = safeDate(filters.assignedTo, true)
  const assignedCreatedAt =
    assignedFromDate || assignedToDate
      ? {
          ...(assignedFromDate ? { gte: assignedFromDate } : {}),
          ...(assignedToDate ? { lte: assignedToDate } : {}),
        }
      : undefined

  // Role-scoping — counsellors/employees (and sales-head, which is just a
  // counsellor with a team-wide Calls view) see only their own assigned leads.
  // This is HARD scope: never inverted, even in excludeMode.
  if (role && ['counsellor', 'employee', 'sales-head'].includes(role) && userId) {
    const mine: Prisma.AsignedLeadListRelationFilter['some'] = {
      clrId: BigInt(userId),
      status: 1,
      ...(assignedCreatedAt ? { createdAt: assignedCreatedAt } : {}),
    }
    if (filters.ids) {
      // Opening a calling task's leads (`?ids=...`). A lead can be reassigned
      // out from under an open task — building a task for another counsellor
      // deactivates every earlier assignment row for those leads — while the
      // old task still counts it as pending. Requiring an active assignment
      // then hid exactly the lead the task said was left: "1 call to do" with
      // nothing in the list. Membership of one of THIS user's own tasks is an
      // equally hard scope, so accept either.
      where.OR = [
        { assignedTo: { some: mine } },
        { workBatchItems: { some: { batch: { assignedToId: BigInt(userId) } } } },
      ]
    } else {
      where.assignedTo = { some: mine }
    }
  } else if (role && userId && isBranchManager(role)) {
    // Branch manager (sub-admin) — leads assigned to any counsellor in their
    // branches. Empty (no branch assigned) → matches nothing. The branch scope
    // is HARD; an explicit assignedCounsellors filter narrows within it (and
    // can be inverted via excludeMode).
    //
    // Special case: if accessibleUserIds returns null, the sub-admin has access
    // to every branch and should see ALL leads (including unassigned + leads
    // whose counsellor has no branchId). Skip the hard scope filter entirely.
    const branchIds = await accessibleUserIds({ userId, role })
    if (branchIds !== null) {
      where.assignedTo = {
        some: {
          clrId: { in: branchIds },
          status: 1,
          ...(assignedCreatedAt ? { createdAt: assignedCreatedAt } : {}),
        },
      }
    } else if (assignedCreatedAt) {
      // All-branches sub-admin → behave like admin: only constrain by
      // assignment-date when one was supplied.
      addClause('assignedDate', { assignedTo: { some: { status: 1, createdAt: assignedCreatedAt } } })
    }
    if (filters.assignedCounsellors) {
      const picked = filters.assignedCounsellors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => { try { return BigInt(s) } catch { return null } })
        .filter((v): v is bigint => v !== null)
      if (picked.length) {
        addClause('assignedCounsellors', {
          assignedTo: { some: { clrId: { in: picked }, status: 1 } },
        })
      }
    }
  } else if (filters.assignedCounsellors) {
    // Admin filter: comma-separated counsellor ids — match leads assigned to ANY of them.
    // This IS user-selected, so it's invertible.
    const ids = filters.assignedCounsellors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        try { return BigInt(s) } catch { return null }
      })
      .filter((v): v is bigint => v !== null)
    if (ids.length) {
      addClause('assignedCounsellors', {
        assignedTo: {
          some: {
            clrId: { in: ids },
            status: 1,
            ...(assignedCreatedAt ? { createdAt: assignedCreatedAt } : {}),
          },
        },
      })
    }
  } else if (assignedCreatedAt) {
    // Admin filtering by assignment date without picking a counsellor — match
    // any lead with an active assignment in that window.
    addClause('assignedDate', { assignedTo: { some: { status: 1, createdAt: assignedCreatedAt } } })
  }

  // Combine user clauses into where via AND, negating the ones Exclude mode
  // applies to (see invert() / negateLeadClause above).
  if (userClauses.length > 0) {
    where.AND = userClauses.map(({ key, clause }) =>
      invert(key) ? negateLeadClause(clause) : clause,
    )
  }

  return where
}

// Shared select for lead-list rows (used by both the default path and the
// counsellor "order by my assignment date" path below).
const LEAD_LIST_SELECT = {
  id: true, name: true, father: true, email: true, email2: true,
  mobile: true, mobile2: true, city: true, state: true, country: true,
  intrestedCourse: true, neetQualified: true, neetResult: true, neetscore: true, intrResult: true,
  leadType: true, leadStatus: true, leadSubStatus: true,
  leadStatusId: true, leadSubStatusId: true,
  departmentId: true, website: true, source: true, event: true,
  called: true, wapp: true, flagSend: true, flagRcv: true,
  leadScore: true,
  comment: true,
  followupDate: true, commentDate: true,
  trash: true, asign: true, createdAt: true, updatedAt: true,
  assignedTo: {
    where: { status: 1 },
    orderBy: { createdAt: 'desc' },
    select: {
      clrId: true,
      createdAt: true,
      counsellor: { select: { id: true, name: true } },
    },
  },
  followups: {
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: {
      comment: true,
      followupDate: true,
      createdAt: true,
      fStatus: true,
      type: true,
      callAnsweredStatus: true,
      user: { select: { id: true, name: true } },
    },
  },
  comments: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      comment: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  },
  notes: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      note: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.LeadSelect

/**
 * The list select, plus the company a lead belongs to for customers that have
 * companies at all.
 *
 * Conditional rather than always-on so the education install's list query — the
 * hottest query in the product, over 63,000 leads — is byte-identical to what it
 * was. `crm_lead_business` is empty there and would join to nothing, but an
 * extra round trip per page is not a cost anybody asked that customer to pay.
 *
 * companyName is populated both by recording a company by hand and by
 * conversion (which writes the account's name back to it), so one field covers
 * "company noted" and "company created" without a second lookup.
 */
function leadListSelect() {
  if (!hasFeature('accounts')) return LEAD_LIST_SELECT
  return {
    ...LEAD_LIST_SELECT,
    business: { select: { companyName: true, accountId: true, projectTitle: true } },
  }
}

type LeadListRow = Prisma.LeadGetPayload<{ select: typeof LEAD_LIST_SELECT }> & {
  business?: {
    companyName: string | null
    accountId: bigint | null
    projectTitle: string | null
  } | null
}

// GET /api/leads
leadsRoutes.get('/', async (c) => {
  const { page, limit, skip } = parsePagination(c.req.query())
  const user = c.get('user')
  const filters = c.req.query()

  const where = await buildLeadWhere(filters, user.userId, user.role)

  // Default sort is createdAt desc for active leads, updatedAt desc for trashed leads.
  // Ordering by updatedAt makes recently deleted leads land on page 1 top.
  const defaultOrderField = filters.trash === '1' ? 'updatedAt' : 'createdAt'
  const orderField = filters.orderBy || defaultOrderField
  const orderDir = (filters.orderDir as 'asc' | 'desc') || 'desc'

  // For counsellors viewing their own leads (no explicit sort), show the
  // most-recently-assigned leads on top — including ones they just claimed
  // from the bucket. We do this by pivoting the query: instead of paging
  // leads ordered by Lead.id, we page the AsignedLead rows ordered by
  // AsignedLead.createdAt (the time the assignment happened), then hydrate
  // full lead details in a second round-trip.
  const useAssignmentOrder =
    ['counsellor', 'employee', 'sales-head'].includes(user.role) && !filters.orderBy

  let total: number
  let data: LeadListRow[]

  if (useAssignmentOrder) {
    // Strip the `assignedTo` clause out of the lead-side where — it's expressed
    // explicitly on the AsignedLead side below, so we don't want to filter twice.
    const { assignedTo: _scope, ...leadWhere } = where as Record<string, unknown>
    void _scope

    const assignedFromDate = safeDate(filters.assignedFrom)
    const assignedToDate = safeDate(filters.assignedTo, true)
    const assignedCreatedAt =
      assignedFromDate || assignedToDate
        ? {
            ...(assignedFromDate ? { gte: assignedFromDate } : {}),
            ...(assignedToDate ? { lte: assignedToDate } : {}),
          }
        : undefined

    const asignedWhere: Prisma.AsignedLeadWhereInput = {
      clrId: BigInt(user.userId),
      status: 1,
      ...(assignedCreatedAt ? { createdAt: assignedCreatedAt } : {}),
      lead: leadWhere as Prisma.LeadWhereInput,
    }

    const [t, assignments] = await Promise.all([
      prisma.asignedLead.count({ where: asignedWhere }),
      prisma.asignedLead.findMany({
        where: asignedWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { stdId: true },
      }),
    ])
    total = t
    const orderedIds = assignments.map((a) => a.stdId)
    if (orderedIds.length === 0) {
      data = []
    } else {
      const unordered = (await prisma.lead.findMany({
        where: { id: { in: orderedIds } },
        select: leadListSelect(),
      })) as LeadListRow[]
      const byId = new Map(unordered.map((l) => [l.id.toString(), l]))
      data = orderedIds
        .map((id) => byId.get(id.toString()))
        .filter((v): v is (typeof unordered)[number] => !!v)
    }
  } else {
    ;[total, data] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: orderDir },
        select: leadListSelect(),
      }) as Promise<LeadListRow[]>,
    ])
  }

  // Per-field duplicate detection for the rows on this page.
  // Tag a lead with emailDup=true if its email appears on >1 non-trash lead overall.
  // Same for mobileDup. Email match is case-insensitive after trim; mobile is trimmed exact.
  const dupSets = await computeFieldDuplicates(
    data.map((d) => d.email),
    data.map((d) => d.mobile),
  )
  const enriched = tagFieldDuplicates(data, dupSets)

  const result = buildPaginatedResult(enriched, total, page, limit)
  return c.json(bigintFix(result))
})

// GET /api/leads/tab-counts — counts per statusLeadTypeId for current filters
leadsRoutes.get('/tab-counts', async (c) => {
  const user = c.get('user')
  const filters = c.req.query()
  const baseWhere = await buildLeadWhere(filters, user.userId, user.role)

  // Get all lead type configs for the given department
  const departmentId = filters.departmentId ? BigInt(filters.departmentId) : undefined
  const [leadTypes, grouped, totalCount] = await Promise.all([
    prisma.leadTypeConfig.findMany({
      where: departmentId ? { departmentId } : {},
      orderBy: { priority: 'asc' },
    }),
    prisma.lead.groupBy({
      by: ['statusLeadTypeId'],
      where: baseWhere,
      _count: { id: true },
    }),
    prisma.lead.count({ where: baseWhere }),
  ])
 const countByBucketId = new Map<number, number>()
  let unbucketedCount = 0
  for (const g of grouped) {
    if (g.statusLeadTypeId === null) {
      unbucketedCount += g._count.id
    } else {
      countByBucketId.set(Number(g.statusLeadTypeId), g._count.id)
    }
  }

  // Archive's "Old Data" is the catch-all for the whole Archive department:
  // archived leads keep their origin bucket (a foreign type Archive can't show),
  // so Old Data absorbs everything that isn't in another Archive-own tab. Its
  // count = department total minus the sum of the OTHER Archive-own tabs.
  const hasOldData = !!departmentId && leadTypes.some((lt) => lt.slug === 'old-data')
  const nonOldDataOwnSum = hasOldData
    ? leadTypes
        .filter((lt) => lt.slug !== 'old-data')
        .reduce((acc, lt) => acc + (countByBucketId.get(Number(lt.id)) ?? 0), 0)
    : 0

  const counts = leadTypes.map((lt) => {
    const base = countByBucketId.get(Number(lt.id)) ?? 0

    // Archive "Old Data" → catch-all for the whole department (see buildLeadWhere).
    if (hasOldData && lt.slug === 'old-data') {
      return { id: Number(lt.id), title: lt.title, slug: lt.slug, count: totalCount - nonOldDataOwnSum }
    }

    // The Default bucket also owns every NULL-bucket (unsorted) lead — see the
    // matching special case in buildLeadWhere. Fold unbucketedCount into the
    // Default type's count so the badge equals what clicking the tab shows, and
    // so the per-dept tabs sum exactly to "All".
    //
    // Only fold when a single department is scoped: with a department, leadTypes
    // contains exactly one Default row, so all NULL-bucket leads belong to it.
    // Without a department (All-Departments view), leadTypes lists every dept's
    // Default — folding into each would multiply-count, so we leave it to the
    // separate `default` field instead. (In Archive the catch-all is Old Data,
    // so we don't also fold NULL into Default there — avoids double counting.)
    const isDefault = lt.slug === 'default' || lt.slug.endsWith('-default')
    return {
      id: Number(lt.id),
      title: lt.title,
      slug: lt.slug,
      count: isDefault && departmentId && !hasOldData ? base + unbucketedCount : base,
    }
  })

  return c.json(bigintFix({ all: totalCount, default: unbucketedCount, types: counts }))
})

// GET /api/leads/department-counts — counts per departmentId for the current
// filters. departmentId / statusLeadTypeId are stripped so each department tab
// shows its own total under the remaining filters (search, date, assignee…).
leadsRoutes.get('/department-counts', async (c) => {
  const user = c.get('user')
  const filters = { ...c.req.query() }
  delete filters.departmentId
  delete filters.statusLeadTypeId
  const baseWhere = await buildLeadWhere(filters, user.userId, user.role)

  const [departments, grouped, totalCount] = await Promise.all([
    prisma.leadDepartment.findMany({ orderBy: { priority: 'asc' } }),
    prisma.lead.groupBy({
      by: ['departmentId'],
      where: baseWhere,
      _count: { id: true },
    }),
    prisma.lead.count({ where: baseWhere }),
  ])

  const countByDeptId = new Map<number, number>()
  let unassignedDeptCount = 0
  for (const g of grouped) {
    if (g.departmentId === null) unassignedDeptCount += g._count.id
    else countByDeptId.set(Number(g.departmentId), g._count.id)
  }

  const counts = departments.map((d) => ({
    id: Number(d.id),
    name: d.name,
    count: countByDeptId.get(Number(d.id)) ?? 0,
  }))

  return c.json(bigintFix({ all: totalCount, noDepartment: unassignedDeptCount, departments: counts }))
})

// GET /api/leads/bucket — unassigned leads (no active counsellor) available to claim
// Counsellors see all unassigned leads in the bucket (cross-org pool).
// Admins also can view it for visibility.
// Bucket visibility is a per-user admin policy. UI hiding is only cosmetic, so
// every bucket read/claim route checks it again before touching shared leads.
async function canAccessBucket(userId: number, role: string): Promise<boolean> {
  if (['admin', 'sub-admin'].includes(role)) return true
  const user = await prisma.user.findUnique({ where: { id: BigInt(userId) }, select: { showBucket: true } })
  return user?.showBucket !== false
}
leadsRoutes.get('/bucket', async (c) => {
  const requester = c.get('user')
  if (!await canAccessBucket(requester.userId, requester.role)) return c.json({ error: 'Bucket access has been disabled by your administrator' }, 403)
  const { page, limit, skip } = parsePagination(c.req.query())
  const filters = c.req.query()

  // `flagBucket=1` switches this endpoint into the shared Flag pool. Includes:
  //   • counsellor-raised flags (flagRcv=1): unassigned, anyone can claim
  //   • admin-raised flags (flagSend=1): may still be assigned — shown for
  //     visibility so the same items that appear in the Notifications "Flags"
  //     tab also surface here.
  const isFlagBucket = filters.flagBucket === '1'

  const archiveDeptIds = await getArchiveDepartmentIds()

  const where: Record<string, unknown> = isFlagBucket
    ? {
        trash: 0,
        OR: [{ flagRcv: 1 }, { flagSend: 1 }],
      }
    : {
        trash: 0,
        assignedTo: { none: { status: 1 } },
        flagRcv: 0,
        flagSend: 0,
        leadStatus: 'Fresh',
        // Leads explicitly unassigned by an admin stay in their own department
        // — they're not re-pooled into the shared bucket.
        bucketExcluded: false,
      }
  if (archiveDeptIds.length) {
    where.departmentId = { notIn: archiveDeptIds }
  }

  if (filters.search) {
    const searchOr = [
      { name: { contains: filters.search, mode: 'insensitive' as const } },
      { email: { contains: filters.search, mode: 'insensitive' as const } },
      { mobile: { contains: filters.search, mode: 'insensitive' as const } },
    ]
    if (isFlagBucket) {
      // Flag bucket already uses where.OR for (flagRcv=1 OR flagSend=1) —
      // combine via AND so search narrows that pool instead of overwriting it.
      where.AND = [{ OR: where.OR }, { OR: searchOr }]
      delete where.OR
    } else {
      where.OR = searchOr
    }
  }
  function parseMulti(v: unknown): string[] {
    if (!v || typeof v !== 'string') return []
    return v.split(',').map((s) => s.trim()).filter(Boolean)
  }

  if (filters.website) {
    const list = parseMulti(filters.website)
    where.website = list.length > 1 ? { in: list } : list[0] || filters.website
  }
  if (filters.source) {
    const list = parseMulti(filters.source)
    where.source = list.length > 1 ? { in: list } : list[0] || filters.source
  }
  if (filters.event) {
    const list = parseMulti(filters.event)
    where.event = list.length > 1 ? { in: list } : list[0] || filters.event
  }
  if (filters.city) {
    const list = parseMulti(filters.city)
    where.city = list.length > 1 ? { in: list } : { contains: list[0] || filters.city, mode: 'insensitive' }
  }
  if (filters.state) {
    const list = parseMulti(filters.state)
    where.state = list.length > 1 ? { in: list } : { contains: list[0] || filters.state, mode: 'insensitive' }
  }
  {
    const gte = safeDate(filters.fromDate)
    const lte = safeDate(filters.toDate, true)
    if (gte || lte) {
      where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
    }
  }

  const orderField = filters.orderBy === 'name' ? 'name' : 'createdAt'
  const orderDir = (filters.orderDir as 'asc' | 'desc') || 'desc'

  const [total, data] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderField]: orderDir },
      select: {
        id: true, name: true, email: true, mobile: true,
        city: true, state: true, country: true,
        leadType: true, leadStatus: true, leadSubStatus: true,
        website: true, source: true, event: true,
        intrestedCourse: true, comment: true,
        flagRcv: true, flagSend: true,
        leadScore: true,
        createdAt: true,
        ...(isFlagBucket
          ? {
              assignedTo: {
                where: { status: 1 },
                select: {
                  clrId: true,
                  counsellor: { select: { id: true, name: true } },
                },
              },
            }
          : {}),
      },
    }),
  ])

  // Attach the most recent comment per lead so the bucket row can show context.
  // For flag-bucket rows we also attach the latest FlagMessage (of EITHER
  // direction) so the reader sees WHY the lead was flagged — matches the
  // Notifications page where both admin-raised (send) and counsellor-raised
  // (rcv) flags appear together.
  const leadIds = data.map((d) => d.id)
  const [latestComments, latestFlagMessages] = await Promise.all([
    leadIds.length
      ? prisma.leadComment.findMany({
          where: { leadId: { in: leadIds } },
          orderBy: { createdAt: 'desc' },
          distinct: ['leadId'],
          select: { leadId: true, comment: true, createdAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: bigint; comment: string; createdAt: Date }>),
    isFlagBucket && leadIds.length
      ? prisma.flagMessage.findMany({
          where: { leadId: { in: leadIds } },
          orderBy: { createdAt: 'desc' },
          distinct: ['leadId'],
          select: { leadId: true, message: true, createdAt: true, userId: true, type: true },
        })
      : Promise.resolve([] as Array<{ leadId: bigint; message: string; createdAt: Date; userId: bigint; type: string }>),
  ])

  // Hydrate counsellor name for each flag reason so the UI can show "Flagged by X"
  const flagUserIds = Array.from(new Set(latestFlagMessages.map((m) => m.userId)))
  const flagUsers = flagUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: flagUserIds } },
        select: { id: true, name: true },
      })
    : []
  const flagUserMap = new Map(flagUsers.map((u) => [String(u.id), u.name]))

  const commentByLead = new Map(latestComments.map((c) => [String(c.leadId), c]))
  const flagByLead = new Map(latestFlagMessages.map((m) => [String(m.leadId), m]))

  const dupSets = await computeFieldDuplicates(
    data.map((d) => d.email),
    data.map((d) => d.mobile),
  )

  const enriched = tagFieldDuplicates(data, dupSets).map((d) => {
    const lc = commentByLead.get(String(d.id))
    const fl = flagByLead.get(String(d.id))
    return {
      ...d,
      latestComment: lc ? { comment: lc.comment, createdAt: lc.createdAt } : null,
      flagReason: fl
        ? {
            message: fl.message,
            createdAt: fl.createdAt,
            byName: flagUserMap.get(String(fl.userId)) ?? null,
            type: fl.type, // 'send' = admin-raised, 'rcv' = counsellor-raised
          }
        : null,
    }
  })

  const result = buildPaginatedResult(enriched, total, page, limit)
  return c.json(bigintFix(result))
})

// GET /api/leads/bucket/facets — distinct websites/sources currently in the bucket
leadsRoutes.get('/bucket/facets', async (c) => {
  const requester = c.get('user')
  if (!await canAccessBucket(requester.userId, requester.role)) return c.json({ error: 'Bucket access has been disabled by your administrator' }, 403)
  const isFlagBucket = c.req.query('flagBucket') === '1'
  const archiveDeptIds = await getArchiveDepartmentIds()
  const archiveFilter = archiveDeptIds.length
    ? { departmentId: { notIn: archiveDeptIds } }
    : {}
  // Flag bucket: any active flag (counsellor- OR admin-raised), regardless of
  // assignment. Normal bucket: unassigned, unflagged.
  const flagWhere = {
    trash: 0,
    OR: [{ flagRcv: 1 }, { flagSend: 1 }],
    ...archiveFilter,
  }
  const unassignedWhere = {
    trash: 0,
    assignedTo: { none: { status: 1 } },
    flagRcv: 0,
    flagSend: 0,
    leadStatus: 'Fresh',
    // Mirror the /bucket query — admin-unassigned leads don't return to the pool.
    bucketExcluded: false,
    ...archiveFilter,
  }
  const baseWhere = isFlagBucket ? flagWhere : unassignedWhere
  const otherBucketWhere = isFlagBucket ? unassignedWhere : flagWhere

  const [websites, sources, events, cities, states, total, todayCount, otherCount] = await Promise.all([
    prisma.lead.groupBy({
      by: ['website'],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { website: 'desc' } },
    }),
    prisma.lead.groupBy({
      by: ['source'],
      where: { ...baseWhere, source: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { source: 'desc' } },
    }),
    prisma.lead.groupBy({
      by: ['event'],
      where: { ...baseWhere, event: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { event: 'desc' } },
    }),
    prisma.lead.groupBy({
      by: ['city'],
      where: { ...baseWhere, city: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { city: 'desc' } },
    }),
    prisma.lead.groupBy({
      by: ['state'],
      where: { ...baseWhere, state: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { state: 'desc' } },
    }),
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({
      where: {
        ...baseWhere,
        createdAt: { gte: startOfTodayIST() },
      },
    }),
    prisma.lead.count({ where: otherBucketWhere }),
  ])

  return c.json({
    total,
    todayCount,
    unassignedCount: isFlagBucket ? otherCount : total,
    flaggedCount: isFlagBucket ? total : otherCount,
    websites: websites.map((w) => ({ value: w.website, count: w._count._all })),
    sources: sources
      .filter((s) => s.source && s.source.trim() !== '')
      .map((s) => ({ value: s.source as string, count: s._count._all })),
    events: events
      .filter((e) => e.event && e.event.trim() !== '')
      .map((e) => ({ value: e.event as string, count: e._count._all })),
    cities: cities
      .filter((c) => c.city && c.city.trim() !== '')
      .map((c) => ({ value: c.city as string, count: c._count._all })),
    states: states
      .filter((s) => s.state && s.state.trim() !== '')
      .map((s) => ({ value: s.state as string, count: s._count._all })),
  })
})

// POST /api/leads/bucket/claim — self-assign one or more bucket leads to the caller
// Body: { leadIds: number[] }. Only leads still unassigned are claimed (race-safe).
leadsRoutes.post('/bucket/claim', async (c) => {
  const requester = c.get('user')
  if (!await canAccessBucket(requester.userId, requester.role)) return c.json({ error: 'Bucket access has been disabled by your administrator' }, 403)
  const { userId, role } = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const leadIds: unknown = body?.leadIds
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return c.json({ error: 'leadIds must be a non-empty array' }, 400)
  }
  if (!['counsellor', 'employee', 'admin', 'sub-admin', 'sales-head'].includes(role)) {
    return c.json({ error: 'Not allowed' }, 403)
  }

  const ids = leadIds
    .map((v) => { try { return BigInt(v as never) } catch { return null } })
    .filter((v): v is bigint => v !== null)
  if (!ids.length) return c.json({ error: 'No valid leadIds' }, 400)

  const clrId = BigInt(userId)

  // Filter to leads that are still in the bucket (no active assignment, not trashed,
  // and still in 'Fresh' status — old non-Fresh leads aren't bucket-eligible even
  // if they happen to be unassigned). Flagged leads are claimable regardless of
  // status because the Flagged bucket is the explicit re-route pool.
  // Admin-unassigned leads (bucketExcluded=true) are NOT claimable from the
  // non-flag pool — they live in their department until an admin reassigns.
  const claimable = await prisma.lead.findMany({
    where: {
      id: { in: ids },
      trash: 0,
      assignedTo: { none: { status: 1 } },
      OR: [
        { leadStatus: 'Fresh', bucketExcluded: false },
        { flagRcv: 1 },
        { flagSend: 1 },
      ],
    },
    select: { id: true },
  })

  if (!claimable.length) {
    return c.json({ message: 'No leads available to claim (already assigned)', claimed: 0 })
  }

  await prisma.asignedLead.createMany({
    data: claimable.map((l) => ({
      clrId,
      stdId: l.id,
      leadType: 'new',
      status: 1,
    })),
    skipDuplicates: true,
  })

  // Claiming clears any counsellor-side flag — the flag's whole purpose was to
  // re-route the lead and that has now happened. Same goes for the admin
  // "bucketExcluded" mark: the lead has an owner again.
  await prisma.lead.updateMany({
    where: { id: { in: claimable.map((l) => l.id) }, flagRcv: 1 },
    data: { flagRcv: 0 },
  })
  await prisma.lead.updateMany({
    where: { id: { in: claimable.map((l) => l.id) }, bucketExcluded: true },
    data: { bucketExcluded: false },
  })

  return c.json({
    message: `${claimable.length} lead${claimable.length === 1 ? '' : 's'} assigned to you`,
    claimed: claimable.length,
    skipped: ids.length - claimable.length,
  })
})

// GET /api/leads/field-values (admin only) — get distinct values for a field
// Open to all authenticated users — counsellors need this to populate filter
// dropdowns (e.g. Website) with the actual distinct values in the DB.
leadsRoutes.get('/field-values', async (c) => {
  const field = c.req.query('field')

  // A field this customer has switched off has no values to offer — refusing
  // here keeps a hidden column from leaking its contents through a filter
  // dropdown someone calls directly.
  if (field && !isLeadFieldVisible(currentTenant()?.leadFields, field)) {
    return c.json({ error: 'That field is not enabled for this account' }, 403)
  }
  const withCount = c.req.query('withCount') === 'true'
  // Map API field names → actual Postgres column names. Most match, but a few
  // are @map'd to snake_case in the Prisma schema and must use the DB column.
  const fieldToColumn: Record<string, string> = {
    city: 'city',
    state: 'state',
    nationality: 'nationality',
    source: 'source',
    event: 'event',
    intrestedCourse: 'intrested_course',
    intrestedUniversity: 'intrested_university',
    neetQualified: 'neet_qualified',
    website: 'website',
    country: 'country',
  }
  const column = field ? fieldToColumn[field] : undefined
  if (!column) {
    return c.json({ error: 'Invalid field' }, 400)
  }

  if (withCount) {
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string; count: number | bigint }>>(
      `SELECT "${column}" as value, COUNT(*) as count FROM leads WHERE "${column}" IS NOT NULL AND "${column}" != '' AND trash = 0 GROUP BY "${column}" ORDER BY "${column}"`
    )
    return c.json(rows.map((r) => ({ value: r.value, count: Number(r.count) })))
  } else {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, string | null>>>(
      `SELECT DISTINCT "${column}" FROM leads WHERE "${column}" IS NOT NULL AND "${column}" != '' AND trash = 0 ORDER BY "${column}"`
    )
    return c.json(rows.map((r) => r[column]).filter(Boolean))
  }
})

// GET /api/leads/filter-options — distinct filter options for leads matching current criteria
leadsRoutes.get('/filter-options', async (c) => {
  const user = c.get('user')
  const filters: Record<string, string | undefined> = c.req.query()

  async function getWhereOmitting(...omitKeys: string[]) {
    const f = { ...filters }
    for (const k of omitKeys) {
      delete f[k]
    }
    return buildLeadWhere(f, user?.userId, user?.role)
  }

  const [
    whereStatus,
    whereSubStatus,
    whereWebsite,
    whereState,
    whereCity,
    whereCourse,
    whereEvent,
    whereCountry,
  ] = await Promise.all([
    getWhereOmitting('leadStatusId', 'leadSubStatusId'),
    getWhereOmitting('leadSubStatusId'),
    getWhereOmitting('website'),
    getWhereOmitting('state'),
    getWhereOmitting('city'),
    getWhereOmitting('intrestedCourse'),
    getWhereOmitting('event', 'source'),
    getWhereOmitting('country'),
  ])

  const whereScoreMax = await getWhereOmitting('leadScoreRanges')

  const [
    statusRows,
    subStatusRows,
    websiteRows,
    stateRows,
    cityRows,
    courseRows,
    eventRows,
    sourceRows,
    countryRows,
    scoreAgg,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ['leadStatusId', 'leadStatus'], where: whereStatus }),
    prisma.lead.groupBy({ by: ['leadSubStatusId', 'leadSubStatus'], where: whereSubStatus }),
    prisma.lead.groupBy({ by: ['website'], where: whereWebsite }),
    prisma.lead.groupBy({ by: ['state'], where: whereState }),
    prisma.lead.groupBy({ by: ['city'], where: whereCity }),
    prisma.lead.groupBy({ by: ['intrestedCourse'], where: whereCourse }),
    prisma.lead.groupBy({ by: ['event'], where: whereEvent }),
    prisma.lead.groupBy({ by: ['source'], where: whereEvent }),
    prisma.lead.groupBy({ by: ['country'], where: whereCountry }),
    prisma.lead.aggregate({ _max: { leadScore: true }, where: whereScoreMax }),
  ])
  const maxLeadScore = scoreAgg._max.leadScore ?? 0

  const statusIds: string[] = []
  let hasFresh = false
  for (const r of statusRows) {
    if (r.leadStatusId !== null && r.leadStatusId !== undefined) {
      statusIds.push(String(r.leadStatusId))
    }
    if (r.leadStatus && r.leadStatus.toLowerCase() === 'fresh') {
      hasFresh = true
    }
  }

  const subStatusIds: string[] = []
  for (const r of subStatusRows) {
    if (r.leadSubStatusId !== null && r.leadSubStatusId !== undefined) {
      subStatusIds.push(String(r.leadSubStatusId))
    }
  }

  const websites = Array.from(new Set(websiteRows.map((r) => r.website).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))).sort()
  const states = Array.from(new Set(stateRows.map((r) => r.state).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))).sort()
  const cities = Array.from(new Set(cityRows.map((r) => r.city).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))).sort()
  const courses = Array.from(new Set(courseRows.map((r) => r.intrestedCourse).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))).sort()
  const countries = Array.from(new Set(countryRows.map((r) => r.country).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))).sort()

  const eventSourceSet = new Set<string>()
  for (const r of [...eventRows.map((e) => e.event), ...sourceRows.map((s) => s.source)]) {
    if (typeof r === 'string' && r.trim()) {
      eventSourceSet.add(r.trim())
    }
  }
  const events = Array.from(eventSourceSet).sort((a, b) => a.localeCompare(b))
  // Standalone sources — needed by pages that filter on `source` distinctly from
  // `event` (mail-management Compose builds a "Source" dropdown from this).
  // Legacy `events` array above intentionally still returns the merged set for
  // the Leads-page filter bar, which treats them as one concept.
  const sources = Array.from(new Set(sourceRows.map((r) => r.source).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))).sort()

  return c.json({
    statusIds,
    hasFresh,
    subStatusIds,
    websites,
    states,
    cities,
    courses,
    countries,
    events,
    sources,
    maxLeadScore,
  })
})

// GET /api/leads/:id
leadsRoutes.get('/:id', async (c, next) => {
  const raw = c.req.param('id')
  // Guard: only handle numeric IDs — static routes like /duplicates /merge /flagged
  // registered AFTER this catch-all must be reached via next().
  if (!/^\d+$/.test(raw)) return next()
  const id = BigInt(raw)

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { include: { counsellor: { select: { id: true, name: true, role: true } } } },
      followups: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { id: true, name: true } },
        },
      },
      notes: { orderBy: { createdAt: 'desc' } },
      documents: true,
      reminders: { orderBy: { reminderDate: 'asc' } },
    },
  })

  if (!lead) return c.json({ error: 'Lead not found' }, 404)
  return c.json(bigintFix(lead))
})

const createLeadSchema = z.object({
  name: z.string().min(1).max(100),
  father: z.string().optional(),
  mother: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  email2: z.string().email().optional().or(z.literal('')),
  email3: z.string().email().optional().or(z.literal('')),
  mobile: z.string().optional(),
  mobile2: z.string().optional(),
  mobile3: z.string().optional(),
  fatherMobile: z.string().optional(),
  motherMobile: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  pincode: z.string().optional(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  castCategory: z.string().optional(),
  nationality: z.string().optional(),
  religion: z.string().optional(),
  passportNumber: z.string().optional(),
  intrestedCourse: z.string().optional(),
  intrestedSubject: z.string().optional(),
  intrestedUniversity: z.string().optional(),
  approximateBudget: z.string().optional(),
  highestQualification: z.string().optional(),
  neetscore: z.string().optional(),
  neetRank: z.string().optional(),
  neetQualified: z.string().optional(),
  departmentId: z.number().optional(),
  leadType: z.string().default('new'),
  source: z.string().optional(),
  event: z.string().optional(),
  website: z.string().optional(),
  comment: z.string().optional(),
})

// POST /api/leads
leadsRoutes.post('/', zValidator('json', createLeadSchema), async (c) => {
  const body = c.req.valid('json')
  const { userId, role } = c.get('user')

  normalizeLeadPhones(body as Record<string, any>)

  const departmentId = body.departmentId ? BigInt(body.departmentId) : await fallbackDepartmentId()
  const fresh = await prisma.leadStatus.findFirst({
    where: { slug: 'new', status: 1, departmentId },
    select: { id: true, title: true },
  })

  const lead = await prisma.lead.create({
    data: {
      ...body,
      userId: BigInt(userId),
      departmentId,
      ...(fresh ? { leadStatusId: fresh.id, leadStatus: fresh.title } : {}),
    },
  })

  // Auto-assign to the creator if they are a counsellor/employee/sales-head
  // so the lead shows up in their own dashboard & lead list
  if (['counsellor', 'employee', 'sales-head'].includes(role)) {
    await prisma.asignedLead.create({
      data: {
        clrId: BigInt(userId),
        stdId: lead.id,
        leadType: 'new',
        status: 1,
      },
    }).catch(() => {/* already assigned */})
  }

  return c.json(bigintFix(lead), 201)
})

// PATCH /api/leads/:id
leadsRoutes.patch('/:id', async (c, next) => {
  const raw = c.req.param('id')
  if (!/^\d+$/.test(raw)) return next()
  const id = BigInt(raw)
  const { userId, role } = c.get('user')
  const body = await c.req.json()

  normalizeLeadPhones(body)

  // Pre-fetch for audit comparison + pipeline-direction guard. Pull the
  // current departmentId so a PATCH that walks the lead backward through the
  // pipeline (e.g. Counselling → Tele Calling) is rejected for counsellors.
  const isStatusChange = body.leadStatusId !== undefined || body.leadSubStatusId !== undefined
    || body.leadStatus !== undefined || body.leadSubStatus !== undefined
    || body.departmentId !== undefined
  const current = isStatusChange
    ? await prisma.lead.findUnique({
        where: { id },
        select: { leadStatus: true, leadSubStatus: true, departmentId: true },
      })
    : null

  // Prisma's Int? columns can't accept "" — clients that bulk-PATCH every
  // form field (web Lead edit) include blanks for untouched numeric inputs.
  // Coerce empties to null, numeric strings to Number, for the Int columns
  // on Lead. Keep this list in sync with schema.prisma > model Lead.
  const intColumns = ['overallScore', 'neetPassingYear', 'ucat', 'dmat', 'sat']
  for (const col of intColumns) {
    if (col in body) {
      const v = body[col]
      body[col] = v === '' || v === null || v === undefined ? null : Number(v)
    }
  }

  // BigInt conversions + resolve titles when only IDs are passed
  const explicitDeptInBody = 'departmentId' in body && body.departmentId
  const explicitTypeInBody = 'statusLeadTypeId' in body && body.statusLeadTypeId
  if (body.departmentId) body.departmentId = BigInt(body.departmentId)
  if (body.leadStatusId) body.leadStatusId = BigInt(body.leadStatusId)
  if (body.leadSubStatusId) body.leadSubStatusId = BigInt(body.leadSubStatusId)
  if (body.statusLeadTypeId) body.statusLeadTypeId = BigInt(body.statusLeadTypeId)

  // Status-change cascade: when leadStatusId or leadSubStatusId changes, derive
  // departmentId and statusLeadTypeId from the chosen status so the lead moves
  // with it. Explicit body values still win — caller can override.
  if (body.leadStatusId || body.leadSubStatusId) {
    const cascade = await resolveStatusCascade({
      leadStatusId: body.leadStatusId,
      leadSubStatusId: body.leadSubStatusId,
      explicitDepartmentId: explicitDeptInBody ? body.departmentId : undefined,
      explicitStatusLeadTypeId: explicitTypeInBody ? body.statusLeadTypeId : undefined,
      currentDepartmentId: current?.departmentId ?? null,
    })
    if (cascade.leadStatus && !body.leadStatus) body.leadStatus = cascade.leadStatus
    if (cascade.leadSubStatus !== undefined && !body.leadSubStatus) {
      body.leadSubStatus = cascade.leadSubStatus
    }
    if (cascade.departmentId !== undefined) body.departmentId = cascade.departmentId
    if (cascade.statusLeadTypeId !== undefined) body.statusLeadTypeId = cascade.statusLeadTypeId
  }

  // Pipeline-direction guard — once the final target dept is known (either set
  // directly in the body or derived by the cascade above), block backward
  // moves for counsellor-class roles. Admins can recycle freely.
  if (body.departmentId && current?.departmentId && body.departmentId !== current.departmentId) {
    const verdict = await canMoveTo({
      currentDeptId: current.departmentId,
      targetDeptId: body.departmentId,
      role,
    })
    if (!verdict.allowed) {
      const e = verdict.error
      return c.json(
        {
          error: 'backward_move_blocked',
          message: e.message,
          fromDeptId: e.fromDeptId,
          toDeptId: e.toDeptId,
          fromDept: e.fromDeptName,
          toDept: e.toDeptName,
        },
        403,
      )
    }

    // "No lead will break" guarantee: when the dept changes and the caller
    // didn't say which bucket the lead belongs to, clear the bucket so the
    // lead falls into the new dept's Default tab (NULL-bucket leads are
    // folded into the dept's Default tab by the leads list). Without this,
    // the lead inherits the OLD dept's lead-type id and silently vanishes
    // from every tab in the new dept.
    if (!('statusLeadTypeId' in body)) {
      body.statusLeadTypeId = null
    }
  }

  const lead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { ...body, updatedAt: new Date() },
    })
    if (isStatusChange && current) {
      await recordStatusChange({
        leadId: id,
        changedById: BigInt(userId),
        fromStatus: current.leadStatus,
        toStatus: updated.leadStatus,
        fromSubStatus: current.leadSubStatus,
        toSubStatus: updated.leadSubStatus,
        source: 'manual',
        tx,
      })
    }
    return updated
  })

  return c.json(bigintFix(lead))
})

// DELETE /api/leads/:id (soft delete - move to trash)
leadsRoutes.delete('/:id', async (c, next) => {
  const raw = c.req.param('id')
  if (!/^\d+$/.test(raw)) return next()
  const id = BigInt(raw)
  await prisma.lead.update({ where: { id }, data: { trash: 1, updatedAt: new Date() } })
  return c.json({ message: 'Lead moved to trash' })
})

// POST /api/leads/:id/called — toggle called status
leadsRoutes.post('/:id/called', async (c) => {
  const id = BigInt(c.req.param('id'))
  const lead = await prisma.lead.findUnique({ where: { id }, select: { called: true } })
  if (!lead) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.lead.update({
    where: { id },
    data: { called: lead.called === 1 ? 0 : 1 },
  })
  if (lead.called !== 1 && updated.called === 1) {
    await bumpLeadScore(id, 8, 'first call')
  }
  return c.json(bigintFix({ called: updated.called }))
})

// POST /api/leads/:id/wapp — toggle WhatsApp status
leadsRoutes.post('/:id/wapp', async (c) => {
  const id = BigInt(c.req.param('id'))
  const lead = await prisma.lead.findUnique({ where: { id }, select: { wapp: true } })
  if (!lead) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.lead.update({
    where: { id },
    data: { wapp: lead.wapp === 1 ? 0 : 1 },
  })
  if (lead.wapp !== 1 && updated.wapp === 1) {
    await bumpLeadScore(id, 6, 'whatsapp replied')
  }
  return c.json(bigintFix({ wapp: updated.wapp }))
})

const sendCatalogSchema = z.object({
  productIds: z.array(z.number().int().positive()).max(50).default([]),
  channel: z.enum(['email', 'whatsapp']),
  note: z.string().max(2000).optional(),
  templateId: z.number().int().positive().optional(),
})

leadsRoutes.get('/:id/catalog-sends', async (c) => {
  const raw = c.req.param('id')
  if (!/^\d+$/.test(raw)) return c.json({ error: 'Not found' }, 404)
  const rows = await listLeadCatalogSends(BigInt(raw))
  return c.json(bigintFix(rows))
})

leadsRoutes.post('/:id/send-catalog', zValidator('json', sendCatalogSchema), async (c) => {
  const raw = c.req.param('id')
  if (!/^\d+$/.test(raw)) return c.json({ error: 'Not found' }, 404)
  const user = c.get('user') as { userId: number }
  const body = c.req.valid('json')
  try {
    const result = await sendLeadCatalog({
      leadId: BigInt(raw),
      userId: BigInt(user.userId),
      productIds: body.productIds.map((id) => BigInt(id)),
      channel: body.channel,
      note: body.note,
      templateId: body.templateId ? BigInt(body.templateId) : undefined,
    })
    return c.json(bigintFix(result))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not send'
    const status = /not found/i.test(msg) ? 404 : 400
    return c.json({ error: msg }, status)
  }
})

// POST /api/leads/:id/flag — toggle priority flag.
// `which` = 'send' toggles flagSend (admin → counsellor),
//        = 'rcv'  toggles flagRcv  (counsellor → admin).
// Defaults to 'send' for admins, 'rcv' for counsellors.
// Optional body: { message?: string } — when flagging ON and a message is given,
// it is recorded in FlagMessage (legacy Common.AddFlag with reason).
leadsRoutes.post('/:id/flag', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const which = (c.req.query('which') || (isAdmin ? 'send' : 'rcv')) as 'send' | 'rcv'

  let message: string | undefined
  try {
    const body = await c.req.json()
    message = body?.message
  } catch {
    // no body
  }

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { flagSend: true, flagRcv: true },
  })
  if (!lead) return c.json({ error: 'Not found' }, 404)

  const wasOn = which === 'rcv' ? lead.flagRcv === 1 : lead.flagSend === 1
  const hasMessage = !!message?.trim()

  // Behaviour:
  //  • already flagged + comment  → append comment, keep flag ON (don't toggle off)
  //  • already flagged + no comment → toggle OFF
  //  • not flagged + (comment or no comment) → toggle ON, record comment if any
  const shouldToggleOff = wasOn && !hasMessage

  if (wasOn && hasMessage) {
    // Append-only path. No state change.
    await prisma.flagMessage.create({
      data: {
        leadId: id,
        userId: BigInt(userId),
        message: message!.trim(),
        type: which,
      },
    })
    const current = await prisma.lead.findUnique({
      where: { id }, select: { flagSend: true, flagRcv: true },
    })
    return c.json(current)
  }

  const data =
    which === 'rcv'
      ? { flagRcv: shouldToggleOff ? 0 : 1 }
      : { flagSend: shouldToggleOff ? 0 : 1 }

  const updated = await prisma.lead.update({
    where: { id }, data,
    select: { flagSend: true, flagRcv: true },
  })

  // Record reason note when turning ON. Toggling OFF leaves history intact.
  if (!wasOn && hasMessage) {
    await prisma.flagMessage.create({
      data: {
        leadId: id,
        userId: BigInt(userId),
        message: message!.trim(),
        type: which,
      },
    })
  }

  // When a counsellor flags a lead (rcv ON), release it from every active
  // counsellor so it surfaces in the shared Flag bucket for anyone to pick up.
  // Admin-side flags (send) do not unassign.
  if (which === 'rcv' && !wasOn) {
    await prisma.asignedLead.updateMany({
      where: { stdId: id, status: 1 },
      data: { status: 0 },
    })
  }

  return c.json(updated)
})

// GET /api/leads/:id/flags — list flag messages (legacy Common.viewFlag)
leadsRoutes.get('/:id/flags', async (c) => {
  const id = BigInt(c.req.param('id'))
  const which = c.req.query('which') as 'send' | 'rcv' | undefined

  const messages = await prisma.flagMessage.findMany({
    where: { leadId: id, ...(which ? { type: which } : {}) },
    orderBy: { createdAt: 'desc' },
  })

  // hydrate user names
  const userIds = Array.from(new Set(messages.map((m) => m.userId)))
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : []
  const userMap = new Map(users.map((u) => [String(u.id), u]))

  return c.json(
    bigintFix(messages.map((m) => ({ ...m, user: userMap.get(String(m.userId)) ?? null }))),
  )
})

// DELETE /api/leads/:id/flags — clear all flags + messages for a lead
// (legacy Common.clearFlag).
leadsRoutes.delete('/:id/flags', async (c) => {
  const id = BigInt(c.req.param('id'))
  const which = c.req.query('which') as 'send' | 'rcv' | undefined

  await prisma.flagMessage.deleteMany({
    where: { leadId: id, ...(which ? { type: which } : {}) },
  })

  await prisma.lead.update({
    where: { id },
    data: which === 'send' ? { flagSend: 0 } : which === 'rcv' ? { flagRcv: 0 } : { flagSend: 0, flagRcv: 0 },
  })

  return c.json({ message: 'Flags cleared' })
})

// DELETE /api/leads/flag-messages/:msgId — remove a single flag message
leadsRoutes.delete('/flag-messages/:msgId', async (c) => {
  const id = BigInt(c.req.param('msgId'))
  await prisma.flagMessage.delete({ where: { id } })
  return c.json({ message: 'Removed' })
})

// GET /api/leads/flagged — list leads currently flagged for the calling user
// (admin sees flagSend; counsellor sees flagRcv). Legacy Common.flagList.
leadsRoutes.get('/flagged', async (c) => {
  const { role, userId } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)

  const where: Record<string, unknown> = { trash: 0 }
  if (isAdmin) {
    where.flagSend = 1
  } else {
    where.flagRcv = 1
    where.assignedTo = { some: { clrId: BigInt(userId) } }
  }

  const leads = await prisma.lead.findMany({
    where,
    select: {
      id: true, name: true, email: true, mobile: true,
      leadStatus: true, leadSubStatus: true, flagSend: true, flagRcv: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
  return c.json(bigintFix(leads))
})

// POST /api/leads/bulk-assign
leadsRoutes.post('/bulk-assign', adminOnly, async (c) => {
  const { leadIds, counsellorId } = await c.req.json()
  const clrId = BigInt(counsellorId)
  const stdIds = (leadIds as Array<number | string>).map((id) => BigInt(id))

  // Filter out leads already assigned to this counsellor so we never insert
  // a duplicate (clrId, stdId) row — the source of the "counsellor name appears
  // twice on the lead" bug. Kept in app code too so this works even when the
  // unique-index migration hasn't been applied yet.
  const existing = await prisma.asignedLead.findMany({
    where: { clrId, stdId: { in: stdIds } },
    select: { stdId: true },
  })
  const alreadyAssigned = new Set(existing.map((e) => e.stdId.toString()))
  const toAssign = stdIds.filter((id) => !alreadyAssigned.has(id.toString()))

  if (toAssign.length) {
    await prisma.asignedLead.createMany({
      data: toAssign.map((stdId) => ({ clrId, stdId, leadType: 'new', status: 1 })),
      skipDuplicates: true,
    })
  }

  // Admin re-routing a flagged lead from the shared Flag bucket clears the rcv
  // flag (the flag's purpose was to re-route — that has happened).
  await prisma.lead.updateMany({
    where: { id: { in: stdIds }, flagRcv: 1 },
    data: { flagRcv: 0 },
  })
  // Same idea for the admin "bucketExcluded" mark — the lead now has an owner.
  await prisma.lead.updateMany({
    where: { id: { in: stdIds }, bucketExcluded: true },
    data: { bucketExcluded: false },
  })

  return c.json({
    message: `${toAssign.length} leads assigned`,
    assigned: toAssign.length,
    skipped: alreadyAssigned.size,
    total: stdIds.length,
  })
})

// POST /api/leads/bulk-status/preview
// Dry run. Returns the exact per-lead From → To the apply step will perform,
// so the confirmation screen can list every affected lead (and every lead the
// pipeline guard will refuse) before anything is written.
leadsRoutes.post('/bulk-status/preview', async (c) => {
  const body = await c.req.json()
  const { leadIds, leadStatusId, leadSubStatusId, departmentId } = body
  const { role } = c.get('user')

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return c.json({ error: 'leadIds must be a non-empty array' }, 400)
  }

  const plan = await buildBulkStatusPlan({
    leadIds: leadIds.map(BigInt),
    leadStatusId: leadStatusId ? Number(leadStatusId) : undefined,
    leadSubStatusId: leadSubStatusId ? Number(leadSubStatusId) : undefined,
    departmentId: departmentId ? Number(departmentId) : undefined,
    role,
  })

  const page = Math.max(1, Number(body.page) || 1)
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 100))

  return c.json({
    data: plan.rows.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: plan.total,
    totalPages: Math.ceil(plan.total / limit),
    movingCount: plan.movingCount,
    blockedCount: plan.blockedCount,
    fromDepartments: plan.fromDepartments,
    toDepartment: plan.toDepartment,
    toStatus: plan.cascade.leadStatus ?? null,
    toSubStatus: plan.cascade.leadSubStatus ?? null,
  })
})

// POST /api/leads/bulk-status
// `approvedIds` (optional) narrows the write to the subset ticked in the
// preview screen; omit it to apply to every lead in `leadIds`.
leadsRoutes.post('/bulk-status', async (c) => {
  const body = await c.req.json()
  const { leadIds, leadStatusId, leadSubStatusId, departmentId, approvedIds } = body
  const { userId, role } = c.get('user')

  const requested: bigint[] = Array.isArray(approvedIds) && approvedIds.length > 0
    ? approvedIds.map(BigInt)
    : (leadIds as Array<number | string>).map(BigInt)

  // Same planner the preview endpoint renders — the confirmation screen and
  // the write can't disagree about which leads move where.
  const plan = await buildBulkStatusPlan({
    leadIds: requested,
    leadStatusId: leadStatusId ? Number(leadStatusId) : undefined,
    leadSubStatusId: leadSubStatusId ? Number(leadSubStatusId) : undefined,
    departmentId: departmentId ? Number(departmentId) : undefined,
    role,
  })

  const { cascade, allowedIds, movingIds } = plan

  const updateData: Record<string, unknown> = {}
  if (leadStatusId) updateData.leadStatusId = BigInt(leadStatusId)
  if (leadSubStatusId) updateData.leadSubStatusId = BigInt(leadSubStatusId)
  if (cascade.leadStatus) updateData.leadStatus = cascade.leadStatus
  if (cascade.leadSubStatus !== undefined) updateData.leadSubStatus = cascade.leadSubStatus
  if (cascade.departmentId !== undefined) updateData.departmentId = cascade.departmentId
  if (cascade.statusLeadTypeId !== undefined) updateData.statusLeadTypeId = cascade.statusLeadTypeId

  if (allowedIds.length > 0) {
    const allowedSet = new Set(allowedIds.map((b) => b.toString()))
    const beforeAllowed = plan.rows.filter((r) => allowedSet.has(String(r.id)))
    await prisma.$transaction(async (tx) => {
      await tx.lead.updateMany({ where: { id: { in: allowedIds } }, data: updateData })

      // Stale-bucket guarantee, per lead: a lead that changed department while
      // nothing supplied a replacement bucket would otherwise keep the OLD
      // department's statusLeadTypeId and vanish from every tab in the new one.
      // Clearing it drops the lead into the new department's Default tab.
      if (cascade.statusLeadTypeId === undefined && movingIds.length > 0) {
        await tx.lead.updateMany({
          where: { id: { in: movingIds } },
          data: { statusLeadTypeId: null },
        })
      }

      // asigned_leads mirrors the department for dept-scoped views — keep every
      // active assignment row in step with the lead row.
      const assignedData: Record<string, unknown> = {}
      if (leadStatusId) assignedData.leadStatusId = BigInt(leadStatusId)
      if (leadSubStatusId) assignedData.leadSubStatusId = BigInt(leadSubStatusId)
      if (cascade.departmentId !== undefined) assignedData.departmentId = cascade.departmentId
      if (cascade.statusLeadTypeId !== undefined) assignedData.statusLeadTypeId = cascade.statusLeadTypeId
      if (Object.keys(assignedData).length > 0) {
        await tx.asignedLead.updateMany({
          where: { stdId: { in: allowedIds }, status: 1 },
          data: assignedData,
        })
      }
      if (cascade.statusLeadTypeId === undefined && movingIds.length > 0) {
        await tx.asignedLead.updateMany({
          where: { stdId: { in: movingIds }, status: 1 },
          data: { statusLeadTypeId: null },
        })
      }

      for (const row of beforeAllowed) {
        await recordStatusChange({
          leadId: BigInt(row.id),
          changedById: BigInt(userId),
          fromStatus: row.fromStatus,
          toStatus: row.toStatus ?? row.fromStatus ?? '',
          fromSubStatus: row.fromSubStatus,
          toSubStatus: row.toSubStatus,
          source: 'bulk',
          tx,
        })
      }
    })
  }

  return c.json({
    message: plan.blockedCount
      ? `${allowedIds.length} updated, ${plan.blockedCount} skipped (backward move blocked)`
      : 'Status updated',
    updated: allowedIds.length,
    moved: movingIds.length,
    skipped: plan.blockedCount,
    blockedBackward: plan.blocked.map((r) => ({
      leadId: r.id,
      reason: 'backward_move_blocked',
      from: r.fromDepartment ?? undefined,
      to: r.toDepartment ?? undefined,
    })),
  })
})

// DELETE /api/leads/:id/permanent (admin only)
leadsRoutes.delete('/:id/permanent', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const lead = await prisma.lead.findUnique({ where: { id }, select: { trash: true } })
  if (!lead) return c.json({ error: 'Lead not found' }, 404)
  if (lead.trash !== 1) return c.json({ error: 'Move the lead to trash before deleting it permanently' }, 400)
  await permanentlyDeleteLeads([id])
  return c.json({ message: 'Lead permanently deleted' })
})

// POST /api/leads/:id/restore (admin only)
leadsRoutes.post('/:id/restore', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.lead.update({ where: { id }, data: { trash: 0 } })
  return c.json({ message: 'Lead restored' })
})

// POST /api/leads/:id/reset-status (admin only)
leadsRoutes.post('/:id/reset-status', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')

  await prisma.$transaction(async (tx) => {
    const current = await tx.lead.findUnique({
      where: { id }, select: { leadStatus: true, leadSubStatus: true },
    })
    await tx.lead.update({
      where: { id },
      data: { leadStatus: 'Fresh', leadStatusId: null, leadSubStatus: null, leadSubStatusId: null },
    })
    if (current) {
      await recordStatusChange({
        leadId: id,
        changedById: BigInt(userId),
        fromStatus: current.leadStatus,
        toStatus: 'Fresh',
        fromSubStatus: current.leadSubStatus,
        toSubStatus: null,
        reason: 'Admin reset',
        source: 'manual',
        tx,
      })
    }
  })
  return c.json({ message: 'Lead status reset to Fresh' })
})

// POST /api/leads/:id/assign (single assign, admin only)
leadsRoutes.post('/:id/assign', adminOnly, async (c) => {
  const stdId = BigInt(c.req.param('id'))
  const { counsellorId } = await c.req.json()
  const clrId = BigInt(counsellorId)

  const existing = await prisma.asignedLead.findFirst({
    where: { clrId, stdId },
    select: { id: true },
  })
  if (existing) {
    return c.json({ message: 'Lead already assigned to this counsellor', alreadyAssigned: true })
  }

  await prisma.asignedLead.create({
    data: { clrId, stdId, status: 1, leadType: 'new' },
  })
  // Reassignment cancels the "admin unassigned" flag so the lead behaves like
  // any other assigned lead from here on.
  await prisma.lead.update({ where: { id: stdId }, data: { bucketExcluded: false } })

  return c.json({ message: 'Lead assigned' })
})

// DELETE /api/leads/:id/assign/:counsellorId (admin only)
leadsRoutes.delete('/:id/assign/:counsellorId', adminOnly, async (c) => {
  const stdId = BigInt(c.req.param('id'))
  const clrId = BigInt(c.req.param('counsellorId'))

  await prisma.asignedLead.deleteMany({ where: { stdId, clrId } })
  // Lead must stay in its own department — don't let it fall back into the
  // shared bucket pool just because the last counsellor was removed.
  await prisma.lead.update({ where: { id: stdId }, data: { bucketExcluded: true } })
  return c.json({ message: 'Lead unassigned' })
})

// POST /api/leads/bulk-update (admin only)
leadsRoutes.post('/bulk-update', adminOnly, async (c) => {
  const { leadIds, data } = await c.req.json()

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }
  if (data.departmentId) updateData.departmentId = BigInt(data.departmentId)
  if (data.leadType) updateData.leadType = data.leadType
  if (data.website) updateData.website = data.website
  if (data.source) updateData.source = data.source
  if (data.event) updateData.event = data.event
  if (data.called !== undefined) updateData.called = data.called
  if (data.wapp !== undefined) updateData.wapp = data.wapp
  if (data.city !== undefined) updateData.city = data.city ? String(data.city).trim() : null
  if (data.state !== undefined) updateData.state = data.state ? String(data.state).trim() : null
  if (data.country !== undefined) updateData.country = data.country ? String(data.country).trim() : null
  if (data.nationality !== undefined) updateData.nationality = data.nationality ? String(data.nationality).trim() : null

  await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: updateData,
  })

  return c.json({ message: `${leadIds.length} leads updated` })
})

// POST /api/leads/bulk-delete (admin only)
leadsRoutes.post('/bulk-delete', adminOnly, async (c) => {
  const { leadIds } = await c.req.json()

  await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: { trash: 1, updatedAt: new Date() },
  })

  return c.json({ message: `${leadIds.length} leads moved to trash` })
})

// POST /api/leads/bulk-move (admin only)
// Admin-only by route guard — pipeline-direction check is therefore a no-op
// (admins are always allowed), but we still null out a stale statusLeadTypeId
// when the dept changes so the moved leads land in the new dept's Default
// bucket instead of orphaning under a foreign lead-type tab.
leadsRoutes.post('/bulk-move', adminOnly, async (c) => {
  const { leadIds, departmentId, statusLeadTypeId } = await c.req.json()
  const ids = leadIds.map(BigInt) as bigint[]
  const targetDept = BigInt(departmentId)

  const updateData: Record<string, unknown> = {
    departmentId: targetDept,
  }

  if (statusLeadTypeId !== undefined && statusLeadTypeId !== null && statusLeadTypeId !== '') {
    updateData.statusLeadTypeId = BigInt(statusLeadTypeId)
  } else {
    // No bucket picked → clear it, so the lead lands in the target dept's
    // Default tab rather than keeping the old dept's (invisible) bucket.
    updateData.statusLeadTypeId = null
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.updateMany({ where: { id: { in: ids } }, data: updateData })
    // asigned_leads mirrors department/bucket for dept-scoped views. Leaving
    // it behind is what made moved leads keep showing under the old dept.
    await tx.asignedLead.updateMany({
      where: { stdId: { in: ids }, status: 1 },
      data: updateData,
    })
  })

  return c.json({ message: `${leadIds.length} leads moved`, moved: ids.length })
})

// POST /api/leads/bulk-restore (admin only)
leadsRoutes.post('/bulk-restore', adminOnly, async (c) => {
  const { leadIds } = await c.req.json()
  await prisma.lead.updateMany({
    where: { id: { in: leadIds.map(BigInt) } },
    data: { trash: 0 },
  })
  return c.json({ message: `${leadIds.length} leads restored` })
})

// POST /api/leads/bulk-permanent-delete (admin only)
leadsRoutes.post('/bulk-permanent-delete', adminOnly, async (c) => {
  const { leadIds } = await c.req.json() as { leadIds?: Array<number | string> }
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return c.json({ error: 'Select at least one lead' }, 400)
  }

  const ids = leadIds.map(BigInt)
  const nonTrashed = await prisma.lead.count({ where: { id: { in: ids }, trash: { not: 1 } } })
  if (nonTrashed > 0) {
    return c.json({ error: 'Only leads already in trash can be permanently deleted' }, 400)
  }

  const deleted = await permanentlyDeleteLeads(ids)
  return c.json({ message: `${deleted} leads permanently deleted`, deleted })
})

// POST /api/leads/empty-trash (admin only)
// Resolve IDs on the server so this is not limited by frontend pagination.
leadsRoutes.post('/empty-trash', adminOnly, async (c) => {
  const rows = await prisma.lead.findMany({ where: { trash: 1 }, select: { id: true } })
  if (rows.length === 0) return c.json({ message: 'Trash is already empty', deleted: 0 })

  const deleted = await permanentlyDeleteLeads(rows.map((row) => row.id))
  return c.json({ message: `${deleted} leads permanently deleted`, deleted })
})

// GET /api/leads/field-preview (admin only) — paginated preview of leads that
// would be affected by a bulk update. Supports two modes:
//   1. Same-field find/replace (default): field=X, oldValues=A,B — shows X's old value.
//   2. Cascade: filterField=X, oldValues=A,B, writeField=Y — shows Y's current value
//      as "old" (since Y is what will change), and newValue as target.
leadsRoutes.get('/field-preview', adminOnly, async (c) => {
  const q = c.req.query()
  const filterField = q.filterField || q.field
  const writeField = q.writeField || q.field
  const rawOldValues = q.oldValues
  const newValue = q.newValue ?? ''
  const page  = Math.max(1, Number(q.page)  || 1)
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 100))

  if (!filterField || !isBulkUpdatableField(filterField)) return c.json({ error: 'Invalid filterField' }, 400)
  if (!writeField || !isBulkUpdatableField(writeField))   return c.json({ error: 'Invalid writeField' }, 400)

  const oldValues: string[] = rawOldValues ? rawOldValues.split(',').map((v) => v.trim()).filter(Boolean) : []
  if (!oldValues.length) return c.json({ data: [], total: 0, page, limit, totalPages: 0 })

  const where: Prisma.LeadWhereInput = { [filterField]: { in: oldValues }, trash: 0 }
  const skip = (page - 1) * limit

  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      select: { id: true, name: true, [filterField]: true, [writeField]: true } as Prisma.LeadSelect,
      skip,
      take: limit,
      orderBy: { id: 'asc' },
    }),
  ])

  const data = rows.map((r) => ({
    id: Number((r as any).id),
    name: (r as any).name as string,
    // For same-field mode oldValue == filterField's value; for cascade it's the
    // current writeField value (what's about to be overwritten).
    oldValue: (r as any)[writeField] as string | null,
    filterValue: (r as any)[filterField] as string | null,
    newValue,
  }))

  return c.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
})

// POST /api/leads/field-update (admin only) — bulk find & replace a field value
// Saves a BulkOperation row with before-snapshot so undo is possible via /bulk/operations/:id/undo
leadsRoutes.post('/field-update', adminOnly, async (c) => {
  const user = c.get('user')
  const { field, oldValues, newValue, approvedLeadIds } = await c.req.json() as {
    field: string
    oldValues: string[]
    newValue: string
    approvedLeadIds?: number[]
  }

  if (!isBulkUpdatableField(field)) {
    return c.json({ error: `Field "${field}" is not allowed for bulk update` }, 400)
  }

  try {
    const result = await applyFieldUpdate({
      filterField: field,
      filterValues: oldValues,
      writeField: field,
      writeValue: newValue,
      approvedLeadIds,
      actorId: BigInt(user.userId),
    })
    return c.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'update failed'
    return c.json({ error: msg }, 500)
  }
})

// POST /api/leads/assign-all (admin only)
leadsRoutes.post('/assign-all', adminOnly, async (c) => {
  const { counsellorId, fromDate, toDate } = await c.req.json()
  const clrId = BigInt(counsellorId)

  const where: Record<string, unknown> = { trash: 0 }
  if (fromDate || toDate) {
    // This is a destructive bulk-assign — a malformed bound must NOT be silently
    // dropped (that would widen the date window and assign more leads than the
    // admin intended). Reject the request instead.
    const gte = safeDate(fromDate)
    const lte = safeDate(toDate, true)
    if ((fromDate && !gte) || (toDate && !lte)) {
      return c.json({ error: 'Invalid fromDate / toDate' }, 400)
    }
    where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
  }

  const leads = await prisma.lead.findMany({ where, select: { id: true } })
  const stdIds = leads.map((l) => l.id)

  const existing = await prisma.asignedLead.findMany({
    where: { clrId, stdId: { in: stdIds } },
    select: { stdId: true },
  })
  const alreadyAssigned = new Set(existing.map((e) => e.stdId.toString()))
  const toAssign = stdIds.filter((id) => !alreadyAssigned.has(id.toString()))

  if (toAssign.length) {
    await prisma.asignedLead.createMany({
      data: toAssign.map((stdId) => ({ clrId, stdId, leadType: 'new', status: 1 })),
      skipDuplicates: true,
    })
    // Reassignment clears the admin-unassigned flag on the newly-claimed leads.
    await prisma.lead.updateMany({
      where: { id: { in: toAssign }, bucketExcluded: true },
      data: { bucketExcluded: false },
    })
  }

  return c.json({
    message: `${toAssign.length} leads assigned`,
    assigned: toAssign.length,
    skipped: alreadyAssigned.size,
    total: stdIds.length,
  })
})

// POST /api/leads/unassign-all (admin only)
leadsRoutes.post('/unassign-all', adminOnly, async (c) => {
  const { counsellorId } = await c.req.json()
  const clrId = BigInt(counsellorId)

  // Capture which leads this counsellor was on BEFORE deletion so we can flip
  // their `bucketExcluded` flag — otherwise we lose the id list.
  const rows = await prisma.asignedLead.findMany({
    where: { clrId },
    select: { stdId: true },
  })
  const stdIds = Array.from(new Set(rows.map((r) => String(r.stdId)))).map(BigInt)

  await prisma.asignedLead.deleteMany({ where: { clrId } })
  if (stdIds.length) {
    await prisma.lead.updateMany({
      where: { id: { in: stdIds } },
      data: { bucketExcluded: true },
    })
  }
  return c.json({ message: 'Leads unassigned' })
})

// POST /api/leads/bulk-assignees (admin only)
// Body: { leadIds: number[] }
// Returns the counsellors currently assigned to the given leads, with the
// number of selected leads each one holds. Used by the bulk Unassign modal so
// the admin can pick a specific counsellor instead of stripping every active
// assignment at once.
leadsRoutes.post('/bulk-assignees', adminOnly, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { leadIds?: number[] }
  const ids = (Array.isArray(body.leadIds) ? body.leadIds : [])
    .map((v) => { try { return BigInt(v) } catch { return null } })
    .filter((v): v is bigint => v !== null)
  if (!ids.length) return c.json({ assignees: [] })

  const rows = await prisma.asignedLead.findMany({
    where: { stdId: { in: ids }, status: 1 },
    select: {
      clrId: true,
      counsellor: { select: { id: true, name: true, role: true, email: true } },
    },
  })

  const byCounsellor = new Map<string, { id: number; name: string; role: string | null; email: string | null; count: number }>()
  for (const r of rows) {
    if (!r.counsellor) continue
    const key = String(r.counsellor.id)
    const existing = byCounsellor.get(key)
    if (existing) {
      existing.count += 1
    } else {
      byCounsellor.set(key, {
        id: Number(r.counsellor.id),
        name: r.counsellor.name,
        role: r.counsellor.role ?? null,
        email: r.counsellor.email ?? null,
        count: 1,
      })
    }
  }

  const assignees = Array.from(byCounsellor.values()).sort((a, b) => b.count - a.count)
  return c.json({ assignees })
})

// POST /api/leads/bulk-unassign (admin only)
// Body: { leadIds: number[], counsellorId?: number }
// If counsellorId is provided, only that counsellor's assignment is removed.
// Otherwise every active assignment on those leads is cleared.
leadsRoutes.post('/bulk-unassign', adminOnly, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { leadIds?: number[]; counsellorId?: number }
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds : []
  if (!leadIds.length) return c.json({ error: 'leadIds is required' }, 400)

  const ids = leadIds
    .map((v) => { try { return BigInt(v) } catch { return null } })
    .filter((v): v is bigint => v !== null)
  if (!ids.length) return c.json({ error: 'No valid leadIds' }, 400)

  const where: Prisma.AsignedLeadWhereInput = { stdId: { in: ids }, status: 1 }
  if (body.counsellorId != null) where.clrId = BigInt(body.counsellorId)

  const result = await prisma.asignedLead.deleteMany({ where })
  // Mark them as admin-unassigned so they stay in their own department and
  // don't surface in the shared bucket. (Flagged leads keep showing in the
  // Flag bucket independently — that pool isn't gated by bucketExcluded.)
  await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: { bucketExcluded: true },
  })
  return c.json({ message: `${result.count} assignment(s) removed`, unassigned: result.count })
})


// GET /api/leads/duplicates (admin only)
// Two detection paths:
//  1. Mobile match — normalize numbers (strip country code + spaces) and group
//  2. isDuplicate flag — leads already tagged at insert time by the website intake
leadsRoutes.get('/duplicates', adminOnly, async (c) => {
  // Cap the number of groups returned. Default 10 — list grows fast so we
  // intentionally page small and let the UI ask for more.
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || 10)))
  const sortOrder = (c.req.query('sortOrder') || c.req.query('sort') || 'newest') as string
  const search = (c.req.query('search') || '').trim().slice(0, 100)
  const isEmailSearch = search.includes('@')
  const mobileSearch = isEmailSearch ? '' : search.replace(/[^0-9]/g, '')

  let orderBySql: Prisma.Sql
  if (sortOrder === 'oldest') {
    orderBySql = Prisma.sql`ORDER BY MAX(created_at) ASC`
  } else if (sortOrder === 'count') {
    orderBySql = Prisma.sql`ORDER BY count DESC, MAX(created_at) DESC`
  } else {
    // default 'newest'
    orderBySql = Prisma.sql`ORDER BY MAX(created_at) DESC`
  }

  // Leads sitting in the Archive department are intentionally excluded from
  // the duplicate view — once archived they're out of play and shouldn't be
  // resurfaced for merge decisions.
  const archiveDeptIds = await getArchiveDepartmentIds()
  const archiveIdsNum = archiveDeptIds.map((id) => Number(id))
  const archiveSqlFilter = archiveIdsNum.length
    ? Prisma.sql`AND (department_id IS NULL OR department_id NOT IN (${Prisma.join(archiveIdsNum)}))`
    : Prisma.empty

  // Search before applying the group limit, so a lookup finds duplicate
  // records anywhere in the database instead of only in the visible page.
  const mobileSearchFilter = search
    ? mobileSearch
      ? Prisma.sql`AND RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) LIKE ${`%${mobileSearch}%`}`
      : Prisma.sql`AND FALSE`
    : Prisma.empty
  const emailSearchFilter = isEmailSearch
    ? Prisma.sql`AND LOWER(TRIM(email)) LIKE ${`%${search.toLowerCase()}%`}`
    : search ? Prisma.sql`AND FALSE` : Prisma.empty
  // Use a normalized mobile column: strip leading +91 / 0 / spaces / dashes,
  // take last 10 digits. This means +919999999999 == 9999999999 == 09999999999.
  // We also compute the FULL count of duplicate groups so the UI can show
  // "showing 10 of 247" — that's the totalGroupsAvailable below.
  const [dupes, totalGroupsRow, emailDupes, totalEmailGroupsRow] = await Promise.all([
    prisma.$queryRaw<Array<{ normalizedMobile: string; count: bigint }>>`
      SELECT
        RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) AS "normalizedMobile",
        COUNT(*) as count,
        MAX(created_at) as "latestCreatedAt"
      FROM leads
      WHERE mobile IS NOT NULL AND mobile != '' AND trash = 0
        AND LENGTH(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g')) >= 10
        ${archiveSqlFilter}
        ${mobileSearchFilter}
      GROUP BY "normalizedMobile"
      HAVING COUNT(*) > 1
      ${orderBySql}
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) as total FROM (
        SELECT 1 FROM leads
        WHERE mobile IS NOT NULL AND mobile != '' AND trash = 0
          AND LENGTH(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g')) >= 10
          ${archiveSqlFilter}
        ${mobileSearchFilter}
        GROUP BY RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10)
        HAVING COUNT(*) > 1
      ) g
    `,
    prisma.$queryRaw<Array<{ normalizedEmail: string; count: bigint }>>`
      SELECT
        LOWER(TRIM(email)) AS "normalizedEmail",
        COUNT(*) as count,
        MAX(created_at) as "latestCreatedAt"
      FROM leads
      WHERE email IS NOT NULL AND email != '' AND trash = 0
        ${archiveSqlFilter}
        ${emailSearchFilter}
      GROUP BY "normalizedEmail"
      HAVING COUNT(*) > 1
      ${orderBySql}
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) as total FROM (
        SELECT 1 FROM leads
        WHERE email IS NOT NULL AND email != '' AND trash = 0
          ${archiveSqlFilter}
        ${emailSearchFilter}
        GROUP BY LOWER(TRIM(email))
        HAVING COUNT(*) > 1
      ) g
    `,
  ])
  const totalGroupsAvailable = Number(totalGroupsRow[0]?.total ?? 0) + Number(totalEmailGroupsRow[0]?.total ?? 0)

  // Also grab leads explicitly flagged as isDuplicate (even if mobile doesn't repeat)
  const flaggedDupes = await prisma.lead.findMany({
    where: {
      isDuplicate: true,
      trash: 0,
      ...(archiveDeptIds.length ? { departmentId: { notIn: archiveDeptIds } } : {}),
      ...(search ? {
        OR: [
          ...(mobileSearch ? [{ mobile: { contains: mobileSearch } }] : []),
          ...(isEmailSearch ? [{ email: { contains: search, mode: 'insensitive' as const } }] : []),
        ],
      } : {}),
    },
    select: { id: true, mobile: true, duplicateOfId: true },
    orderBy: { createdAt: sortOrder === 'oldest' ? 'asc' : 'desc' },
    take: limit,
  })

  // Build a set of all lead IDs we need to fetch in detail
  let allLeadIds: bigint[] = []

  if (dupes.length > 0) {
    const normalizedList = dupes.map((d) => d.normalizedMobile)
    const matchedLeads = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM leads
      WHERE trash = 0
        AND mobile IS NOT NULL AND mobile != ''
        AND LENGTH(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g')) >= 10
        AND RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) = ANY(${normalizedList}::text[])
        ${archiveSqlFilter}
    `
    allLeadIds = matchedLeads.map((r) => r.id)
  }

  if (emailDupes.length > 0) {
    const normalizedEmailList = emailDupes.map((d) => d.normalizedEmail)
    const matchedEmailLeads = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM leads
      WHERE trash = 0
        AND email IS NOT NULL AND email != ''
        AND LOWER(TRIM(email)) = ANY(${normalizedEmailList}::text[])
        ${archiveSqlFilter}
    `
    for (const r of matchedEmailLeads) {
      if (!allLeadIds.includes(r.id)) {
        allLeadIds.push(r.id)
      }
    }
  }

  // Add leads related to isDuplicate flagged ones (the originals too)
  for (const fl of flaggedDupes) {
    if (!allLeadIds.includes(fl.id)) allLeadIds.push(fl.id)
    if (fl.duplicateOfId && !allLeadIds.includes(fl.duplicateOfId)) {
      allLeadIds.push(fl.duplicateOfId)
    }
  }

  if (allLeadIds.length === 0) {
    return c.json({ groups: [], totalGroups: 0, totalDuplicateLeads: 0 })
  }

  // Fetch all relevant leads with rich detail in one query
  const leads = await prisma.lead.findMany({
    where: {
      id: { in: allLeadIds },
      trash: 0,
      ...(archiveDeptIds.length ? { departmentId: { notIn: archiveDeptIds } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      mobile: true,
      mobile2: true,
      email: true,
      father: true,
      city: true,
      state: true,
      country: true,
      leadStatus: true,
      leadSubStatus: true,
      leadType: true,
      website: true,
      source: true,
      isDuplicate: true,
      duplicateOfId: true,
      createdAt: true,
      updatedAt: true,
      assignedTo: {
        where: { status: 1 },
        select: { counsellor: { select: { id: true, name: true } } },
      },
      _count: {
        select: { followups: true, notes: true, reminders: true, documents: true },
      },
    },
  })

  // Build groups keyed by normalized-mobile (last 10 digits)
  const normalizePhone = (m: string | null) => {
    if (!m) return null
    const digits = m.replace(/[^0-9]/g, '')
    return digits.length >= 10 ? digits.slice(-10) : digits || null
  }

  const mobileGroupMap = new Map<string, typeof leads>()
  for (const lead of leads) {
    const key = normalizePhone(lead.mobile)
    if (!key) continue
    if (!mobileGroupMap.has(key)) mobileGroupMap.set(key, [])
    if (!mobileGroupMap.get(key)!.some((l) => l.id === lead.id)) {
      mobileGroupMap.get(key)!.push(lead)
    }
  }

  const emailGroupMap = new Map<string, typeof leads>()
  for (const lead of leads) {
    if (!lead.email) continue
    const key = lead.email.trim().toLowerCase()
    if (!key) continue
    if (!emailGroupMap.has(key)) emailGroupMap.set(key, [])
    if (!emailGroupMap.get(key)!.some((l) => l.id === lead.id)) {
      emailGroupMap.get(key)!.push(lead)
    }
  }

  const mobileGroups = Array.from(mobileGroupMap.entries())
    .filter(([, groupLeads]) => groupLeads.length > 1)
    .map(([normalizedMobile, groupLeads]) => {
      const displayMobile = groupLeads[0].mobile ?? normalizedMobile
      const sorted = groupLeads.sort((a, b) => {
        if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? 1 : -1
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })
      return {
        type: 'mobile',
        mobile: displayMobile,
        normalizedMobile,
        count: sorted.length,
        leads: bigintFix(sorted),
      }
    })

  const emailGroups = Array.from(emailGroupMap.entries())
    .filter(([, groupLeads]) => groupLeads.length > 1)
    .map(([normalizedEmail, groupLeads]) => {
      const displayEmail = groupLeads[0].email ?? normalizedEmail
      const sorted = groupLeads.sort((a, b) => {
        if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? 1 : -1
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })
      return {
        type: 'email',
        email: displayEmail,
        normalizedEmail,
        count: sorted.length,
        leads: bigintFix(sorted),
      }
    })

  // Deduplicate email groups: if an email group's lead IDs are fully contained in any mobile group, discard it.
  const mobileGroupIdsSets = mobileGroups.map(g => new Set(g.leads.map((l: any) => l.id)))

  const uniqueEmailGroups = emailGroups.filter(eg => {
    const egIds = eg.leads.map((l: any) => l.id)
    const isContained = mobileGroupIdsSets.some(mgSet => 
      egIds.every((id: any) => mgSet.has(id))
    )
    return !isContained
  })

  const getGroupLatestTime = (g: { leads: any[] }) =>
    g.leads.reduce((max: number, l: any) => Math.max(max, new Date(l.createdAt).getTime()), 0)

  const sortedGroups = [...mobileGroups, ...uniqueEmailGroups].sort((a, b) => {
    if (sortOrder === 'oldest') {
      return getGroupLatestTime(a) - getGroupLatestTime(b)
    }
    if (sortOrder === 'count') {
      if (b.count !== a.count) return b.count - a.count
      return getGroupLatestTime(b) - getGroupLatestTime(a)
    }
    return getGroupLatestTime(b) - getGroupLatestTime(a)
  })

  const groups = sortedGroups.slice(0, limit)
  const totalDuplicateLeads = groups.reduce((sum, g) => sum + g.count - 1, 0)

  return c.json({
    groups,
    totalGroups: groups.length,
    totalGroupsAvailable,
    totalDuplicateLeads,
    limit,
  })
})

// POST /api/leads/merge (admin only)
// Merges one or more duplicate leads INTO a single "winner" lead.
// All followups, notes, reminders, documents and call logs are re-assigned.
// Any blank fields on the winner are filled from the merged leads (oldest-first).
// The merged leads are then soft-deleted (trash=1).
leadsRoutes.post('/merge', adminOnly, async (c) => {
  const { keepId, mergeIds } = await c.req.json() as { keepId: number; mergeIds: number[] }

  if (!keepId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return c.json({ error: 'keepId and non-empty mergeIds are required' }, 400)
  }
  if (mergeIds.includes(keepId)) {
    return c.json({ error: 'keepId cannot be in mergeIds' }, 400)
  }

  const keepBig = BigInt(keepId)
  const mergeBigs = mergeIds.map(BigInt)

  const result = await prisma.$transaction(async (tx) => {
    // Verify winner exists and is not trashed
    const winner = await tx.lead.findUnique({ where: { id: keepBig } })
    if (!winner || winner.trash !== 0) throw new Error('Winner lead not found or is in trash')

    // Verify all merge leads exist
    const dupeLeads = await tx.lead.findMany({
      where: { id: { in: mergeBigs }, trash: 0 },
    })
    if (dupeLeads.length !== mergeBigs.length) {
      throw new Error('One or more duplicate leads not found or already trashed')
    }

    // Re-assign all related records from merge leads → winner
    await Promise.all([
      tx.leadFollowup.updateMany({ where: { stdId: { in: mergeBigs } }, data: { stdId: keepBig } }),
      tx.leadNote.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
      tx.reminder.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
      tx.studentDocument.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
      tx.callLog.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
      tx.asignedLead.deleteMany({ where: { stdId: { in: mergeBigs } } }),
      tx.leadStatusHistory.updateMany({ where: { leadId: { in: mergeBigs } }, data: { leadId: keepBig } }),
    ])

    // Build unique email list (order-preserving, case-insensitive check)
    const emails: string[] = []
    const seenEmail = new Set<string>()
    const addEmail = (e: string | null | undefined) => {
      if (!e) return
      const val = e.trim()
      if (!val) return
      const lower = val.toLowerCase()
      if (!seenEmail.has(lower)) {
        seenEmail.add(lower)
        emails.push(val)
      }
    }

    addEmail(winner.email)
    addEmail(winner.email2)
    addEmail(winner.email3)

    for (const d of dupeLeads) {
      addEmail(d.email)
      addEmail(d.email2)
      addEmail(d.email3)
    }

    // Build unique mobile list (order-preserving, normalized digits check)
    const mobiles: string[] = []
    const seenMobile = new Set<string>()
    const normalizePhone = (m: string | null | undefined) => {
      if (!m) return null
      const digits = m.replace(/[^0-9]/g, '')
      return digits.length >= 10 ? digits.slice(-10) : digits || null
    }
    const addMobile = (m: string | null | undefined) => {
      if (!m) return
      const val = m.trim()
      if (!val) return
      const norm = normalizePhone(val)
      if (!norm) return
      if (!seenMobile.has(norm)) {
        seenMobile.add(norm)
        mobiles.push(val)
      }
    }

    addMobile(winner.mobile)
    addMobile(winner.mobile2)
    addMobile(winner.mobile3)

    for (const d of dupeLeads) {
      addMobile(d.mobile)
      addMobile(d.mobile2)
      addMobile(d.mobile3)
    }

    // Fill any blank string/null fields on the winner from the merged leads (oldest first)
    const fillableFields = [
      'father', 'mother', 'fatherMobile', 'motherMobile', 'city', 'state', 'country',
      'pincode', 'dob', 'gender', 'nationality', 'religion',
      'castCategory', 'passportNumber', 'intrestedCourse',
      'intrestedSubject', 'intrestedUniversity', 'source', 'event',
      'neetscore', 'neetRank', 'neetQualified', 'comment',
    ] as const

    const fillPatch: Record<string, unknown> = {}
    for (const field of fillableFields) {
      const winnerVal = (winner as Record<string, unknown>)[field]
      if (!winnerVal) {
        // Find first non-empty value from dupeLeads
        for (const d of dupeLeads) {
          const v = (d as Record<string, unknown>)[field]
          if (v && String(v).trim()) {
            fillPatch[field] = v
            break
          }
        }
      }
    }

    // Assign emails
    fillPatch.email = emails[0] ?? null
    fillPatch.email2 = emails[1] ?? null
    fillPatch.email3 = emails[2] ?? null

    // Assign mobiles
    fillPatch.mobile = mobiles[0] ?? null
    fillPatch.mobile2 = mobiles[1] ?? null
    fillPatch.mobile3 = mobiles[2] ?? null

    // Clear the isDuplicate flag on the winner (it may have been marked as a dupe itself)
    fillPatch.isDuplicate = false
    fillPatch.duplicateOfId = null

    const updatedWinner = await tx.lead.update({
      where: { id: keepBig },
      data: fillPatch,
    })

    // Soft-delete the merged leads
    await tx.lead.updateMany({
      where: { id: { in: mergeBigs } },
      data: { trash: 1, updatedAt: new Date() },
    })

    return updatedWinner
  }, {
    maxWait: 10000,
    timeout: 30000,
  })

  return c.json({ message: `Merged ${mergeIds.length} lead(s) into #${keepId}`, lead: bigintFix(result) })
})

// GET /api/leads/:id/stats
leadsRoutes.get('/:id/stats', async (c) => {
  const id = BigInt(c.req.param('id'))

  const [followupCount, noteCount, reminderCount, documentCount] = await Promise.all([
    prisma.leadFollowup.count({ where: { stdId: id } }),
    prisma.leadNote.count({ where: { leadId: id } }),
    prisma.reminder.count({ where: { leadId: id } }),
    prisma.studentDocument.count({ where: { leadId: id } }),
  ])

  return c.json({ followupCount, noteCount, reminderCount, documentCount })
})

// POST /api/leads/import (CSV/Excel import)
leadsRoutes.post('/import', async (c) => {
  const body = await c.req.json() as { leads: Array<Record<string, string>> }
  const { userId } = c.get('user')

  // Case-insensitive lookup helper for headers like "Father Name" / "father_name" / "father".
  const get = (row: Record<string, string>, ...keys: string[]) => {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')
    const lookup: Record<string, string> = {}
    for (const k of Object.keys(row)) lookup[norm(k)] = row[k]
    for (const k of keys) {
      const v = lookup[norm(k)]
      if (v && v.trim()) return v.trim()
    }
    return null
  }

  const validRows = body.leads
    .map((row) => ({
      name: get(row, 'name') || '',
      father: get(row, 'father', 'father_name', 'fathername'),
      mother: get(row, 'mother', 'mother_name', 'mothername'),
      email: get(row, 'email'),
      email2: get(row, 'email2', 'father_email'),
      email3: get(row, 'email3', 'other_email'),
      mobile: normalizePhone(get(row, 'mobile', 'phone')),
      mobile2: normalizePhone(get(row, 'mobile2', 'father_mobile')),
      mobile3: normalizePhone(get(row, 'mobile3', 'other_mobile')),
      fatherMobile: normalizePhone(get(row, 'father_mobile', 'fathermobile')),
      motherMobile: normalizePhone(get(row, 'mother_mobile', 'mothermobile')),
      city: get(row, 'city'),
      state: get(row, 'state'),
      country: get(row, 'country'),
      pincode: get(row, 'pincode', 'zip'),
      dob: get(row, 'dob', 'date_of_birth'),
      gender: get(row, 'gender'),
      nationality: get(row, 'nationality'),
      religion: get(row, 'religion'),
      castCategory: get(row, 'cast_category', 'cast', 'category'),
      passportNumber: get(row, 'passport_number', 'passport'),
      intrestedCourse: get(row, 'intrested_course', 'interested_course', 'course'),
      intrestedSubject: get(row, 'intrested_subject', 'interested_subject', 'subject'),
      intrestedUniversity: get(row, 'intrested_university', 'interested_university', 'university'),
      neetscore: get(row, 'neet_score', 'neetscore'),
      neetRank: get(row, 'neet_rank', 'neetrank'),
      neetQualified: get(row, 'neet_qualified'),
      source: get(row, 'source'),
      event: get(row, 'event'),
      website: get(row, 'website') || 'other',
      leadType: get(row, 'lead_type', 'leadtype') || 'new',
      comment: get(row, 'comment', 'notes', 'remark'),
    }))
    .filter((r) => r.name) // drop rows with no name

  const skipped = body.leads.length - validRows.length

  const created = await prisma.lead.createMany({
    data: validRows.map((r) => ({ ...r, userId: BigInt(userId) })),
    skipDuplicates: true,
  })

  return c.json({
    message: `${created.count} leads imported${skipped ? ` (${skipped} rows skipped — missing name)` : ''}`,
    imported: created.count,
    skipped,
  })
})

// POST /api/leads/export-selected — export specific lead IDs as CSV
leadsRoutes.post('/export-selected', async (c) => {
  // Exporting leads is restricted to the top-level admin only.
  if (!isFullAdmin(c.get('user').role)) return c.json({ error: 'Only admins can export leads' }, 403)
  const { leadIds } = await c.req.json()

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds.map(BigInt) } },
    orderBy: { createdAt: 'desc' },
  })

  const headers = ['ID', 'Name', 'Father', 'Mother', 'Email', 'Mobile', 'Mobile2',
    'City', 'State', 'Country', 'Lead Type', 'Lead Status', 'Website', 'Source', 'Event',
    'Interested Course', 'NEET Score', 'Created At']

  const rows = leads.map((l) => [
    Number(l.id), l.name, l.father || '', l.mother || '',
    l.email || '', l.mobile || '', l.mobile2 || '',
    l.city || '', l.state || '', l.country || '',
    l.leadType, l.leadStatus, l.website,
    l.source || '', l.event || '', l.intrestedCourse || '',
    l.neetscore || '', l.createdAt.toISOString(),
  ])

  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')

  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', 'attachment; filename=selected-leads.csv')
  return c.body(csv)
})

// ─── CALL LOG + STATUS HISTORY + TIMELINE ────────────────────────────────────

const callSchema = z.object({
  outcome: z.enum(['answered', 'not_answered', 'declined', 'busy', 'wrong_number', 'switched_off']),
  durationSeconds: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
})

// POST /api/leads/:id/call — log a call and apply auto-transition rules
leadsRoutes.post('/:id/call', zValidator('json', callSchema), async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  const body = c.req.valid('json')

  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id },
      select: { leadStatus: true, leadSubStatus: true },
    })
    if (!lead) throw new Error('Lead not found')

    const { toStatus, followupIn } = resolveAutoTransition(lead.leadStatus, body.outcome as CallOutcome)

    // Create the call log row first (so we can stamp autoStatusApplied if transition applied)
    const log = await tx.callLog.create({
      data: {
        leadId: id,
        userId: BigInt(userId),
        outcome: body.outcome,
        direction: 'outbound',
        durationSeconds: body.durationSeconds,
        notes: body.notes,
      },
    })

    // Patch lead with call flag + outcome
    const leadPatch: Record<string, unknown> = {
      called: 1,
      callAnsweredStatus: body.outcome,
      commentDate: new Date(),
    }
    // Lead score: +1 whenever this call was picked up. Each CallLog row is a
    // distinct call attempt, so unlike the MobileCall path we don't need a
    // "first transition" guard — every answered log is a fresh score event.
    if (body.outcome === 'answered') {
      leadPatch.leadScore = { increment: 1 }
    }
    let followupDate: Date | null = null
    if (followupIn !== null) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + followupIn)
      followupDate = d
      leadPatch.followupDate = d
    }
    if (toStatus && toStatus !== lead.leadStatus) {
      leadPatch.leadStatus = toStatus
      // lookup status id so leadStatusId stays consistent
      const ls = await tx.leadStatus.findFirst({ where: { title: toStatus } })
      if (ls) leadPatch.leadStatusId = ls.id
    }
    await tx.lead.update({ where: { id }, data: leadPatch })

    // Audit trail
    if (toStatus && toStatus !== lead.leadStatus) {
      await recordStatusChange({
        leadId: id,
        changedById: BigInt(userId),
        fromStatus: lead.leadStatus,
        toStatus,
        fromSubStatus: lead.leadSubStatus,
        toSubStatus: null,
        reason: `Auto from call: ${body.outcome}`,
        source: 'call',
        tx,
      })
      await tx.callLog.update({ where: { id: log.id }, data: { autoStatusApplied: toStatus } })
    }

    if (followupDate) {
      const existingReminder = await tx.reminder.findFirst({
        where: { leadId: id, reminderDate: followupDate }
      })

      if (existingReminder) {
        await tx.reminder.update({
          where: { id: existingReminder.id },
          data: { note: `Auto retry: ${body.outcome}`, userId: BigInt(userId), status: 0 }
        })
      } else {
        await tx.reminder.create({
          data: {
            leadId: id,
            userId: BigInt(userId),
            reminderDate: followupDate,
            note: `Auto retry: ${body.outcome}`,
            status: 0,
          }
        })
      }
    }

    return log
  })

  return c.json(bigintFix(result), 201)
})

// GET /api/leads/:id/calls — call history
leadsRoutes.get('/:id/calls', async (c) => {
  const id = BigInt(c.req.param('id'))
  // Include logs filed against duplicate rows for the same number — but only
  // when the person who logged them is a counsellor assigned to THIS lead.
  // Duplicates are often owned by different counsellors; see utils/phone.ts.
  const phoneIndex = await buildLeadPhoneIndex([id])
  const leadIds = phoneIndex.siblingsOf(id).map((value) => BigInt(value))
  const owners = (await prisma.asignedLead.findMany({ where: { stdId: id, status: 1 }, select: { clrId: true } })).map((row) => row.clrId)
  const logs = await prisma.callLog.findMany({
    where: owners.length
      ? { OR: [{ leadId: id }, { AND: [{ leadId: { in: leadIds } }, { userId: { in: owners } }] }] }
      : { leadId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true } } },
  })
  return c.json(bigintFix(logs))
})

// GET /api/leads/:id/mails — sent + inbound thread for a single lead
leadsRoutes.get('/:id/mails', async (c) => {
  const id = BigInt(c.req.param('id'))
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { email: true, email2: true, email3: true },
  })
  const emails = [lead?.email, lead?.email2, lead?.email3]
    .map((e) => (e || '').trim().toLowerCase())
    .filter(Boolean)

  const [history, catalogs, inbounds, sent] = await Promise.all([
    prisma.studentMailHistory.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    prisma.leadCatalogSend.findMany({
      where: { leadId: id, channel: 'email' },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { items: true },
    }),
    prisma.inboundMail.findMany({
      where: {
        OR: [
          { leadId: id },
          ...emails.map((e) => ({ fromEmail: { equals: e, mode: 'insensitive' as const } })),
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: 200,
    }),
    prisma.sentMail.findMany({
      where: {
        status: { not: 'failed' },
        OR: [
          { leadId: id },
          ...emails.map((e) => ({ toEmail: { equals: e, mode: 'insensitive' as const } })),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
  ])

  const historyKeys = new Set(history.map((m) => `${m.subject.trim().toLowerCase()}|${m.createdAt.toISOString().slice(0, 16)}`))

  type ThreadItem = {
    id: number
    direction: 'out' | 'in'
    source: 'mail' | 'catalog' | 'inbound'
    subject: string
    body: string
    createdAt: Date
    inboundId: number | null
  }

  const thread: ThreadItem[] = history.map((m) => ({
    id: Number(m.id),
    direction: 'out',
    source: 'mail',
    subject: m.subject,
    body: m.body,
    createdAt: m.createdAt,
    inboundId: null,
  }))

  for (const m of sent) {
    const dup = thread.some((t) => t.subject === m.subject && Math.abs(t.createdAt.getTime() - m.createdAt.getTime()) < 120_000)
    if (dup) continue
    thread.push({
      id: Number(m.id),
      direction: 'out',
      source: 'mail',
      subject: m.subject,
      body: m.body,
      createdAt: m.createdAt,
      inboundId: null,
    })
  }

  for (const s of catalogs) {
    const key = `${(s.note ? s.note.slice(0, 80) : 'catalog').trim().toLowerCase()}|${s.createdAt.toISOString().slice(0, 16)}`
    const subject = s.note ? s.note.slice(0, 80) : `Catalog: ${s.items.map((i) => i.name).join(', ')}`
    if (historyKeys.has(key) || thread.some((t) => t.subject === subject && Math.abs(t.createdAt.getTime() - s.createdAt.getTime()) < 120_000)) {
      continue
    }
    thread.push({
      id: Number(s.id),
      direction: 'out',
      source: 'catalog',
      subject,
      body: `<p>${s.note || 'Catalog sent'}</p><ul>${s.items.map((i) => `<li>${i.name}</li>`).join('')}</ul>`,
      createdAt: s.createdAt,
      inboundId: null,
    })
  }

  for (const m of inbounds) {
    thread.push({
      id: Number(m.id),
      direction: 'in',
      source: 'inbound',
      subject: m.subject,
      body: m.bodyHtml || m.bodyText || '',
      createdAt: m.receivedAt,
      inboundId: Number(m.id),
    })
  }

  thread.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return c.json(bigintFix(thread))
})

// GET /api/leads/:id/history — status change audit trail
leadsRoutes.get('/:id/history', async (c) => {
  const id = BigInt(c.req.param('id'))
  const rows = await prisma.leadStatusHistory.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { changedBy: { select: { id: true, name: true } } },
  })
  return c.json(bigintFix(rows))
})

// GET /api/leads/:id/timeline — unified activity feed
leadsRoutes.get('/:id/timeline', async (c) => {
  const id = BigInt(c.req.param('id'))

  const [history, followups, notes, calls, mails, comments, flags, lead] = await Promise.all([
    prisma.leadStatusHistory.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { changedBy: { select: { id: true, name: true } } },
    }),
    prisma.leadFollowup.findMany({
      where: { stdId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.leadNote.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.callLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.studentMailHistory.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.leadComment.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.flagMessage.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.lead.findUnique({
      where: { id },
      select: { comment: true, createdAt: true },
    }),
  ])

  // FlagMessage has no relation to User — hydrate names in a single round trip.
  const flagUserIds = Array.from(new Set(flags.map((f) => f.userId)))
  const flagUsers = flagUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: flagUserIds } },
        select: { id: true, name: true },
      })
    : []
  const flagUserMap = new Map(flagUsers.map((u) => [String(u.id), u]))

  type TimelineEntry = {
    id: string
    type: 'status' | 'followup' | 'note' | 'call' | 'mail' | 'comment' | 'flag'
    at: Date
    by: { id: number; name: string } | null
    summary: string
    meta: Record<string, unknown>
  }

  const entries: TimelineEntry[] = []

  for (const h of history) {
    entries.push({
      id: `status-${h.id}`,
      type: 'status',
      at: h.createdAt,
      by: h.changedBy ? { id: Number(h.changedBy.id), name: h.changedBy.name } : null,
      summary: `Status: ${h.fromStatus ?? '—'} → ${h.toStatus}` +
        (h.toSubStatus ? ` (${h.toSubStatus})` : ''),
      meta: { source: h.source, reason: h.reason },
    })
  }
  for (const f of followups) {
    entries.push({
      id: `followup-${f.id}`,
      type: 'followup',
      at: f.createdAt,
      by: f.user ? { id: Number(f.user.id), name: f.user.name } : null,
      summary: f.comment,
      meta: { followupDate: f.followupDate, callAnsweredStatus: f.callAnsweredStatus, type: f.type },
    })
  }
  for (const n of notes) {
    entries.push({
      id: `note-${n.id}`,
      type: 'note',
      at: n.createdAt,
      by: n.user ? { id: Number(n.user.id), name: n.user.name } : null,
      summary: n.note,
      meta: {},
    })
  }
  for (const cl of calls) {
    entries.push({
      id: `call-${cl.id}`,
      type: 'call',
      at: cl.createdAt,
      by: cl.user ? { id: Number(cl.user.id), name: cl.user.name } : null,
      summary: `Call: ${cl.outcome}` +
        (cl.durationSeconds ? ` (${cl.durationSeconds}s)` : '') +
        (cl.autoStatusApplied ? ` → ${cl.autoStatusApplied}` : ''),
      meta: { outcome: cl.outcome, direction: cl.direction, notes: cl.notes },
    })
  }
  for (const m of mails) {
    entries.push({
      id: `mail-${m.id}`,
      type: 'mail',
      at: m.createdAt,
      by: null,
      summary: `Email: ${m.subject}`,
      meta: {},
    })
  }
  for (const cm of comments) {
    entries.push({
      id: `comment-${cm.id}`,
      type: 'comment',
      at: cm.createdAt,
      by: cm.user ? { id: Number(cm.user.id), name: cm.user.name } : null,
      summary: cm.comment,
      meta: {},
    })
  }
  for (const fl of flags) {
    const u = flagUserMap.get(String(fl.userId))
    entries.push({
      id: `flag-${fl.id}`,
      type: 'flag',
      at: fl.createdAt,
      by: u ? { id: Number(u.id), name: u.name } : null,
      summary: fl.message,
      // type: 'send' = admin-raised, 'rcv' = counsellor-raised
      meta: { flagType: fl.type },
    })
  }
  // Intake comment captured at lead creation — anchored to the lead's createdAt.
  // No user attribution: leads created via the public API have no creator.
  if (lead?.comment?.trim()) {
    entries.push({
      id: `intake-${id}`,
      type: 'note',
      at: lead.createdAt,
      by: null,
      summary: lead.comment,
      meta: { source: 'intake' },
    })
  }

  entries.sort((a, b) => b.at.getTime() - a.at.getTime())
  return c.json(bigintFix(entries))
})

// GET /api/leads/export/csv
leadsRoutes.get('/export/csv', async (c) => {
  const filters = c.req.query()
  const user = c.get('user')
  // Exporting leads is restricted to the top-level admin only.
  if (!isFullAdmin(user.role)) return c.json({ error: 'Only admins can export leads' }, 403)
  const where = await buildLeadWhere(filters, user.userId, user.role)

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  })

  const headers = ['ID', 'Name', 'Father', 'Mother', 'Email', 'Mobile', 'City', 'State', 'Country',
    'Lead Type', 'Lead Status', 'Website', 'Source', 'Event', 'Interested Course', 'NEET Score', 'Called', 'WhatsApp', 'Created At']

  const rows = leads.map((l) => [
    Number(l.id), l.name, l.father || '', l.mother || '',
    l.email || '', l.mobile || '', l.city || '',
    l.state || '', l.country || '', l.leadType, l.leadStatus, l.website,
    l.source || '', l.event || '', l.intrestedCourse || '',
    l.neetscore || '', l.called, l.wapp, l.createdAt.toISOString(),
  ])

  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')

  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', 'attachment; filename=leads.csv')
  return c.body(csv)
})

// ─── Lead Documents ───────────────────────────────────────────────────────────

leadsRoutes.get('/:id/documents', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const docs = await prisma.studentDocument.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } })
  return c.json(docs)
})

leadsRoutes.post('/:id/documents', uploadSingle('file'), async (c) => {
  const leadId = BigInt(c.req.param('id'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as any)?.incoming as any)?.file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  const title = c.req.query('title') || file.originalname
  const filepath = `/uploads/${path.basename(file.filename)}`

  const doc = await prisma.studentDocument.create({
    data: { leadId, title, filepath, filename: file.originalname },
  })
  return c.json(doc, 201)
})

leadsRoutes.delete('/:id/documents/:docId', async (c) => {
  const id = BigInt(c.req.param('docId'))
  await prisma.studentDocument.delete({ where: { id } })
  return c.json({ message: 'Document deleted' })
})
