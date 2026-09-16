// Public API routes — for external lead creation (landing pages, websites)
import { Hono } from 'hono'
import { hash } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { normalizePhone } from '../utils/phone'

export const publicApiRoutes = new Hono()

// Env-API_KEY middleware applies ONLY to legacy/per-website endpoints.
// The /inbound/* routes have their own per-partner Bearer auth — see below.
// Exact path match — anything else (notably /v1/inbound/*) is handled by its
// own auth and must not be intercepted here.
const ENV_KEY_PATHS = new Set([
  '/api/v1/website-lead',
  '/api/v1/tutelage-web',
  '/api/v1/my-mbbs-admission',
  '/api/v1/lead',
  '/api/v1/create-user',
])
publicApiRoutes.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (!ENV_KEY_PATHS.has(path)) return await next()

  const apiKey = c.req.header('X-API-KEY') || c.req.header('API-KEY')
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }
  await next()
})

// Helper: read field from JSON body OR url-encoded/multipart form
async function readBody(c: any): Promise<Record<string, any>> {
  const ct = c.req.header('content-type') || ''
  if (ct.includes('application/json')) return await c.req.json()
  // covers application/x-www-form-urlencoded and multipart/form-data
  const form = await c.req.parseBody()
  return form as Record<string, any>
}

const str = (v: any) => (v === undefined || v === null ? '' : String(v).trim())

// Normalize a course/program string coming from external intake:
//   - trims leading/trailing whitespace
//   - collapses internal runs of whitespace to a single space
// Case is intentionally preserved — auto-lowercasing/title-casing would
// diverge from the millions of rows already stored as raw input and break
// the substring filter on /api/leads.
const normalizeCourse = (v: any): string | null => {
  const s = str(v).replace(/\s+/g, ' ')
  return s || null
}

// Read the course value from a website payload, accepting every common
// field-name variant the various sites and partners send.
const pickCourse = (body: Record<string, any>) =>
  normalizeCourse(
    body.intrested_course ??
    body.interested_course ??
    body.course ??
    body.intrestedCourse,
  )

// Tutelage Study + My MBBS Admission landing forms only post a `destination`
// (e.g. "South Korea", "Russia"). The old CRM stored the lead's course as
// "MBBS in <destination>", so the new CRM does the same when the payload has
// a destination but no explicit course — otherwise the course column is blank
// on every fresh lead from these sites.
const deriveMbbsCourseFromDestination = (body: Record<string, any>): string | null => {
  const dest = normalizeCourse(body.destination ?? body.preferred_destination)
  if (!dest) return null
  return /mbbs/i.test(dest) ? dest : `MBBS in ${dest}`
}

// Whitelist of website slugs accepted by the public lead intake.
// The frontend (Leads.tsx) renders badges only for these slugs — anything
// else falls back to "other". Keep this list small and curated.
//   - tutelagestudy     → Tutelage Study main site
//   - mymbbsadmission   → My MBBS Admission site
//   - other             → manual entries, walk-ins, anything uncategorized
const ALLOWED_WEBSITES = new Set(['tutelagestudy', 'mymbbsadmission', 'other'])

// Map human-friendly values the websites may send → canonical slug.
const WEBSITE_ALIASES: Record<string, string> = {
  'my mbbs admission': 'mymbbsadmission',
  'mymbbsadmission': 'mymbbsadmission',
  'tutelage study': 'tutelagestudy',
  'tutelagestudy': 'tutelagestudy',
  'tutelage': 'tutelagestudy',
}
function normalizeWebsite(raw: string, fallback: string): string {
  const v = raw.trim().toLowerCase()
  if (!v) return fallback
  const slug = WEBSITE_ALIASES[v] || v.replace(/\s+/g, '')
  return ALLOWED_WEBSITES.has(slug) ? slug : 'other'
}

// Shared intake for all owned websites (Tutelage Study, My MBBS Admission, …).
// Exposed at TWO paths:
//   • POST /api/v1/website-lead   (canonical, neutral name — use this for new sites)
//   • POST /api/v1/tutelage-web   (legacy alias, kept so existing Tutelage site keeps working)
// Both paths share the same API_KEY and the same handler. The site is
// identified by the `website` field in the body (defaults to "tutelagestudy"
// when omitted). Unknown values fall back to "other".
// Accepts BOTH field-name conventions used by the two sites:
//   • c_code | country_code            → mobile country code
//   • destination | preferred_destination
//   • source | event                   → tracking source
//   • question | inquiry_message       → free-text message
async function handleWebsiteLead(c: any, defaultWebsite = 'tutelagestudy') {
  const body = await readBody(c)

  const name = str(body.name)
  const emailRaw = str(body.email)
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : ''
  const countryCode = str(body.c_code) || str(body.country_code)
  const mobileDigits = (countryCode + str(body.mobile)).replace(/[^\d+]/g, '')
  // Apply the CRM-wide storage rule: 12-digit numbers get a "+" prefix so the
  // country code is preserved; 10-digit numbers stay as-is.
  const mobile = normalizePhone(mobileDigits) ?? ''

  if (!name || (!email && !mobile)) {
    return c.json({ success: false, message: 'name and email or mobile are required' }, 400)
  }

  const data: any = {
    name,
    email: email || null,
    mobile: mobile || null,
    preferredDestination: str(body.destination) || str(body.preferred_destination) || null,
    nationality: str(body.nationality) || null,
    intrestedUniversity: str(body.intrested_university) || null,
    intrestedCourse: pickCourse(body) ?? deriveMbbsCourseFromDestination(body),
    state: str(body.state) || null,
    city: str(body.city) || null,
    neetQualified: str(body.neet_qualified) || null,
    comment: str(body.question) || str(body.inquiry_message) || null,
    sourceUrl: str(body.source_url) || null,
    event: str(body.source) || str(body.event) || null,
    website: normalizeWebsite(str(body.website), defaultWebsite),
    departmentId: BigInt(2),
    userId: BigInt(28),
    leadType: 'new',
  }

  // Detect duplicate on email or mobile, but ALWAYS insert. If a match is found,
  // flag the new row as a duplicate and link it to the original so the CRM can
  // surface every repeat submission instead of silently dropping it.
  const existing = await prisma.lead.findFirst({
    where: {
      AND: [
        { trash: 0 },
        {
          OR: [
            ...(email ? [{ email }] : []),
            ...(mobile ? [{ mobile }] : []),
          ],
        },
      ],
    },
    orderBy: { id: 'asc' }, // root of the duplicate chain
  })

  if (existing) {
    data.isDuplicate = true
    // If the matched row is itself a duplicate, point to its original instead of chaining.
    data.duplicateOfId = existing.duplicateOfId ?? existing.id
  }

  const lead = await prisma.lead.create({ data })
  const lastId = lead.id

  // Auto-assign to all users with automaticAsignLead = 1 (replicates old behaviour)
  const autoUsers = await prisma.user.findMany({
    where: { automaticAsignLead: 1 },
    select: { id: true },
  })
  const assignedTeamIds: number[] = []
  if (autoUsers.length) {
    await prisma.asignedLead.createMany({
      data: autoUsers.map((u) => ({
        stdId: lastId,
        clrId: u.id,
        status: 1,
      })),
      skipDuplicates: true,
    })
    for (const u of autoUsers) assignedTeamIds.push(Number(u.id))
  }

  return c.json({
    success: true,
    message: 'Lead submitted',
    id: Number(lastId),
    insert_id: Number(lastId),
    assigned_team_ids: assignedTeamIds,
    duplicate: !!existing,
    duplicateOfId: existing ? Number(data.duplicateOfId) : null,
  })
}

// Canonical path — caller decides which site via the `website` field.
publicApiRoutes.post('/website-lead', (c) => handleWebsiteLead(c))
// Alias — Tutelage Study site (legacy URL kept for backward compatibility).
publicApiRoutes.post('/tutelage-web', (c) => handleWebsiteLead(c, 'tutelagestudy'))
// Alias — My MBBS Admission site. Defaults `website` to "mymbbsadmission"
// when the caller omits it, so leads from this URL are tagged correctly.
publicApiRoutes.post('/my-mbbs-admission', (c) => handleWebsiteLead(c, 'mymbbsadmission'))

// POST /api/v1/lead — create lead from external source (website forms, landing pages)
publicApiRoutes.post('/lead', async (c) => {
  const body = await c.req.json()

  const { name, email, source, website,
    state, city, country, neetscore, comment, departmentId } = body
  const mobile = normalizePhone(body.mobile) ?? undefined
  const mobile2 = normalizePhone(body.mobile2) ?? undefined
  const intrestedCourse = pickCourse(body) ?? deriveMbbsCourseFromDestination(body)

  if (!name || (!email && !mobile)) {
    return c.json({ error: 'name and email or mobile are required' }, 400)
  }

  // Detect duplicate but ALWAYS insert — flag the new row so the CRM can surface it.
  const existing = await prisma.lead.findFirst({
    where: {
      AND: [
        { trash: 0 },
        {
          OR: [
            ...(email ? [{ email }] : []),
            ...(mobile ? [{ mobile }] : []),
          ],
        },
      ],
    },
    orderBy: { id: 'asc' },
  })

  const duplicateOfId = existing ? (existing.duplicateOfId ?? existing.id) : null

  const lead = await prisma.lead.create({
    data: {
      name,
      email,
      mobile,
      mobile2,
      intrestedCourse,
      source,
      website: website || 'other',
      state,
      city,
      country,
      neetscore,
      comment,
      departmentId: departmentId ? BigInt(departmentId) : BigInt(2),
      userId: BigInt(28), // default admin
      leadType: 'new',
      isDuplicate: !!existing,
      duplicateOfId,
    },
  })

  return c.json({
    success: true,
    id: Number(lead.id),
    duplicate: !!existing,
    duplicateOfId: duplicateOfId ? Number(duplicateOfId) : null,
  }, 201)
})

// POST /api/v1/create-user — mirrors old PHP Api::createNewUser().
// Lets an external CRM seed a CRM user. Auth: API-KEY header (handled above).
//
// Body fields (JSON or form):
//   name, email, mobile, role, loginid, password    — required
//   officeBranchName                                 — branch to attach the user to
//   new_applicant                                    — 0/1, defaults to 0
//
// Side effects (same as PHP):
//   1. Inserts the user (password is bcrypt-hashed, unlike the old plaintext storage).
//   2. Inserts a row into asign_branches linking user → branch.
//   3. Inserts a row into asign_departments for every lead_departments row whose
//      asign_default=1. Both of these legacy tables/columns are accessed via raw
//      SQL — they're inherited from the pgloader migration and not declared in
//      schema.prisma. If the column/table is missing, the step is skipped with a
//      warning rather than failing the whole request.
publicApiRoutes.post('/create-user', async (c) => {
  const body = await readBody(c)

  const name = str(body.name)
  const email = str(body.email)
  const mobile = normalizePhone(str(body.mobile)) ?? ''
  const role = str(body.role)
  const loginid = str(body.loginid)
  const password = str(body.password)
  const officeBranchName = str(body.officeBranchName)
  const newApplicant = Number(body.new_applicant || 0) ? 1 : 0

  if (!name || !email || !mobile || !role || !loginid || !password) {
    return c.json({
      success: false,
      message: 'name, email, mobile, role, loginid and password are required',
    }, 400)
  }

  // 1) Resolve branch (optional — old PHP failed silently if not found; we return 400 instead)
  let branchId: bigint | null = null
  if (officeBranchName) {
    const branch = await prisma.branch.findFirst({
      where: { name: officeBranchName },
      select: { id: true },
    })
    if (!branch) {
      return c.json({ success: false, message: `Branch not found: ${officeBranchName}` }, 400)
    }
    branchId = branch.id
  }

  // 2) Duplicate checks so the request fails fast with a clean message
  const existing = await prisma.user.findFirst({
    where: { OR: [{ loginid }, { email: { equals: email, mode: 'insensitive' } }] },
    select: { id: true, loginid: true, email: true },
  })
  if (existing) {
    const field = existing.loginid === loginid ? 'loginid' : 'email'
    return c.json({ success: false, message: `A user with this ${field} already exists` }, 409)
  }

  // 3) Hash password (old PHP stored plaintext; new auth uses bcrypt compare)
  const hashed = await hash(password, 10)

  // 4) Create user
  const user = await prisma.user.create({
    data: {
      name,
      email,
      mobile,
      role,
      loginid,
      username: loginid,
      password: hashed,
      newApplicant,
      branchId,
      status: 1,
    },
  })

  // 5) user_roles row so existing rbac.ts checks resolve correctly
  await prisma.userRole_.create({ data: { userId: user.id, role } })

  // 6) asign_branches insert — matches PHP `mm->addData($asignBranchArr, 'asign_branches')`
  if (branchId) {
    try {
      await prisma.asignBranch.create({ data: { userId: user.id, branchId } })
    } catch (err) {
      console.warn('[create-user] asign_branches insert failed:', err)
    }
  }

  // 7) asign_departments insert for every default department.
  //    Legacy table — accessed via raw SQL. Skipped if the table/column doesn't exist.
  try {
    // to_regclass returns NULL if the table/relation doesn't exist
    const tableCheck = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('public.asign_departments') IS NOT NULL AS exists
    `
    const tableExists = tableCheck[0]?.exists === true

    if (tableExists) {
      const defaults = await prisma.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM lead_departments WHERE asign_default = 1
      `
      for (const row of defaults) {
        await prisma.$executeRaw`
          INSERT INTO asign_departments (user_id, department_id)
          VALUES (${user.id}, ${row.id})
        `
      }
    } else {
      console.warn('[create-user] skipping asign_departments — table not present')
    }
  } catch (err) {
    console.warn('[create-user] asign_departments seeding failed:', err)
  }

  return c.json({
    success: true,
    id: Number(user.id),
    loginid: user.loginid,
  })
})
