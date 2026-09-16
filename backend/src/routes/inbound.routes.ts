// Per-partner inbound lead endpoint.
// POST /api/v1/inbound/:slug/lead
//
// Security model:
//   - Auth: `Authorization: Bearer <api-key>`. Key is bcrypt-hashed in DB.
//   - Per-partner rate limit (in-memory token bucket, 60 req/min default).
//   - Optional IP allowlist per partner.
//   - Optional HMAC signature: if partner has webhookSecret, the request MUST
//     include X-Signature: sha256=<hex> computed over the raw body.
//   - Endpoint is write-only — no GET, no PATCH, no DELETE.
//   - Every request (success or failure) is logged to LeadIngestionLog.
//
// Partners cannot read existing leads through any path here.

import { Hono } from 'hono'
import { compare } from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'

export const inboundRoutes = new Hono()

// ─── Rate limit (in-memory, per-process) ──────────────────────────────────────
// Good enough for single-instance deploys. For PM2 cluster mode replace with
// Redis-backed limiter (e.g. ioredis + rate-limiter-flexible).
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60
const buckets = new Map<string, { count: number; windowStart: number }>()
function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now })
    return true
  }
  if (b.count >= MAX_PER_WINDOW) return false
  b.count++
  return true
}

function getClientIp(c: any): string | null {
  // Honor X-Forwarded-For when behind Nginx. Fall back to direct.
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = c.req.header('x-real-ip')
  if (xri) return xri.trim()
  return null
}

// ─── Field pickers ────────────────────────────────────────────────────────────
// Partners send fields under many different names — snake_case, camelCase,
// short forms, historical typos. These helpers accept every alias and return
// the first non-empty value, capped to the DB column's declared length so a
// too-long payload never causes an INSERT to fail. Every Lead column is
// optional — a partner may send as much or as little as they have.

function pickStr(payload: any, aliases: string[], maxLen: number): string | null {
  for (const k of aliases) {
    const v = payload?.[k]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s) return s.slice(0, maxLen)
  }
  return null
}

function pickInt(payload: any, aliases: string[]): number | null {
  for (const k of aliases) {
    const v = payload?.[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
    const s = String(v).trim()
    if (!s) continue
    const n = parseInt(s, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

// SmallInt "flag" columns (ucat/dmat/sat) — accept 0/1/true/false/yes/no.
function pickFlag(payload: any, aliases: string[]): number | null {
  for (const k of aliases) {
    const v = payload?.[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'boolean') return v ? 1 : 0
    const s = String(v).trim().toLowerCase()
    if (!s) continue
    if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return 1
    if (['0', 'false', 'no', 'n', 'off'].includes(s)) return 0
    const n = parseInt(s, 10)
    if (Number.isFinite(n)) return n ? 1 : 0
  }
  return null
}

// Strip non-digit / non-plus characters and cap length. Mirrors the primary
// mobile handling in this file so alt phone fields land in the same format.
function pickPhone(payload: any, aliases: string[], maxLen: number): string | null {
  for (const k of aliases) {
    const v = payload?.[k]
    if (v === undefined || v === null) continue
    const cleaned = String(v).replace(/[^\d+]/g, '').slice(0, maxLen)
    if (cleaned) return cleaned
  }
  return null
}

// Every optional Lead column, mapped from the payload with alias variants.
// Add new columns here (and only here) when partners start sending new fields.
// Any key we don't map is still preserved verbatim in LeadIngestionLog.payload,
// so nothing sent is ever lost — this just decides what gets promoted to a
// first-class column on the lead row.
function extractOptionalLeadFields(payload: any): Record<string, any> {
  return {
    // ── Personal ────────────────────────────────────────────────────────────
    father: pickStr(payload, ['father', 'father_name', 'fatherName'], 100),
    mother: pickStr(payload, ['mother', 'mother_name', 'motherName'], 100),
    fatherMobile: pickPhone(payload, ['fatherMobile', 'father_mobile', 'father_phone'], 20),
    motherMobile: pickPhone(payload, ['motherMobile', 'mother_mobile', 'mother_phone'], 20),
    dob: pickStr(payload, ['dob', 'date_of_birth', 'dateOfBirth', 'birthDate'], 100),
    gender: pickStr(payload, ['gender', 'sex'], 10),
    castCategory: pickStr(payload, ['castCategory', 'cast_category', 'category', 'caste', 'casteCategory'], 100),
    nationality: pickStr(payload, ['nationality'], 50),
    religion: pickStr(payload, ['religion'], 100),
    passportNumber: pickStr(payload, ['passportNumber', 'passport_number', 'passport'], 100),
    firstLanguage: pickStr(payload, ['firstLanguage', 'first_language', 'motherTongue', 'mother_tongue'], 100),
    maritalStatus: pickStr(payload, ['maritalStatus', 'marital_status'], 50),
    passportExpiry: pickStr(payload, ['passportExpiry', 'passport_expiry'], 100),

    // ── Contact (secondary) ─────────────────────────────────────────────────
    email2: pickStr(payload, ['email2', 'secondary_email', 'secondaryEmail', 'altEmail', 'alt_email'], 100),
    email3: pickStr(payload, ['email3', 'tertiary_email', 'tertiaryEmail'], 100),
    mobile2: pickPhone(payload, ['mobile2', 'phone2', 'secondary_mobile', 'secondaryMobile', 'altMobile', 'alt_mobile', 'whatsapp'], 20),
    mobile3: pickPhone(payload, ['mobile3', 'phone3', 'tertiary_mobile', 'tertiaryMobile'], 20),

    // ── Address ─────────────────────────────────────────────────────────────
    pincode: pickStr(payload, ['pincode', 'pin_code', 'postal_code', 'postalCode', 'zip', 'zipCode', 'zip_code'], 20),
    homeAddress: pickStr(payload, ['homeAddress', 'home_address', 'address', 'residentialAddress', 'residential_address'], 4000),
    homeContactNumber: pickPhone(payload, ['homeContactNumber', 'home_contact_number', 'landline', 'home_phone', 'homePhone'], 50),

    // ── Academic (primary interest) ─────────────────────────────────────────
    intrestedSubject: pickStr(payload, ['intrestedSubject', 'interested_subject', 'interestedSubject', 'subject'], 100),
    approximateBudget: pickStr(payload, ['approximateBudget', 'approximate_budget', 'budget'], 100),
    highestQualification: pickStr(payload, ['highestQualification', 'highest_qualification', 'qualification'], 100),
    persuingCountry: pickStr(payload, ['persuingCountry', 'persuing_country', 'pursuingCountry', 'pursuing_country', 'currentCountry', 'current_country'], 100),
    englishExamType: pickStr(payload, ['englishExamType', 'english_exam_type', 'englishTest', 'english_test'], 50),
    overallScore: pickInt(payload, ['overallScore', 'overall_score']),
    neetscore: pickStr(payload, ['neetscore', 'neet_score', 'neetScore'], 20),
    neetRank: pickStr(payload, ['neetRank', 'neet_rank'], 100),
    neetPassingYear: pickInt(payload, ['neetPassingYear', 'neet_passing_year', 'neetYear', 'neet_year']),

    // ── Legacy education / english scores ──────────────────────────────────
    countryOfEducation: pickStr(payload, ['countryOfEducation', 'country_of_education'], 100),
    highestLevelOfEducation: pickStr(payload, ['highestLevelOfEducation', 'highest_level_of_education'], 100),
    gradingScheme: pickStr(payload, ['gradingScheme', 'grading_scheme'], 100),
    gradeAverage: pickStr(payload, ['gradeAverage', 'grade_average'], 100),
    studentType: pickStr(payload, ['studentType', 'student_type'], 100),
    neetResult: pickStr(payload, ['neetResult', 'neet_result'], 100),
    dateOfExam: pickStr(payload, ['dateOfExam', 'date_of_exam'], 100),
    listeningScore: pickStr(payload, ['listeningScore', 'listening_score', 'listening'], 50),
    readingScore: pickStr(payload, ['readingScore', 'reading_score', 'reading'], 50),
    writingScore: pickStr(payload, ['writingScore', 'writing_score', 'writing'], 50),
    speakingScore: pickStr(payload, ['speakingScore', 'speaking_score', 'speaking'], 50),

    // ── Legacy education qualifications (10th / 12th / UG) ─────────────────
    hs: pickStr(payload, ['hs', 'tenth', 'class_10', 'class10'], 50),
    hsSchoolName: pickStr(payload, ['hsSchoolName', 'hs_school_name', 'tenth_school'], 255),
    hsPassingYear: pickStr(payload, ['hsPassingYear', 'hs_passing_year', 'tenth_year'], 20),
    hsResult: pickStr(payload, ['hsResult', 'hs_result', 'tenth_result'], 50),
    intr: pickStr(payload, ['intr', 'twelfth', 'class_12', 'class12', 'intermediate'], 50),
    intrSchoolName: pickStr(payload, ['intrSchoolName', 'intr_school_name', 'twelfth_school'], 255),
    intrPassingYear: pickStr(payload, ['intrPassingYear', 'intr_passing_year', 'twelfth_year'], 20),
    intrResult: pickStr(payload, ['intrResult', 'intr_result', 'twelfth_result'], 50),
    ug: pickStr(payload, ['ug', 'ug_degree', 'graduation'], 50),
    ugSchoolName: pickStr(payload, ['ugSchoolName', 'ug_school_name', 'ug_college'], 255),
    ugPassingYear: pickStr(payload, ['ugPassingYear', 'ug_passing_year', 'ug_year'], 20),
    ugResult: pickStr(payload, ['ugResult', 'ug_result'], 50),

    // ── Legacy exams: UCAT / DMAT / SAT ────────────────────────────────────
    ucat: pickFlag(payload, ['ucat']),
    ucatExamDate: pickStr(payload, ['ucatExamDate', 'ucat_exam_date'], 50),
    ucatVScore: pickStr(payload, ['ucatVScore', 'ucat_v_score'], 50),
    ucatVRank: pickStr(payload, ['ucatVRank', 'ucat_v_rank'], 50),
    ucatQScore: pickStr(payload, ['ucatQScore', 'ucat_q_score'], 50),
    ucatQRank: pickStr(payload, ['ucatQRank', 'ucat_q_rank'], 50),
    ucatWScore: pickStr(payload, ['ucatWScore', 'ucat_w_score'], 50),
    ucatWRank: pickStr(payload, ['ucatWRank', 'ucat_w_rank'], 50),
    dmat: pickFlag(payload, ['dmat']),
    dmatExamDate: pickStr(payload, ['dmatExamDate', 'dmat_exam_date'], 50),
    dmatVScore: pickStr(payload, ['dmatVScore', 'dmat_v_score'], 50),
    dmatVRank: pickStr(payload, ['dmatVRank', 'dmat_v_rank'], 50),
    dmatQScore: pickStr(payload, ['dmatQScore', 'dmat_q_score'], 50),
    dmatQRank: pickStr(payload, ['dmatQRank', 'dmat_q_rank'], 50),
    dmatWScore: pickStr(payload, ['dmatWScore', 'dmat_w_score'], 50),
    dmatWRank: pickStr(payload, ['dmatWRank', 'dmat_w_rank'], 50),
    dmatIrScore: pickStr(payload, ['dmatIrScore', 'dmat_ir_score'], 50),
    dmatIrRank: pickStr(payload, ['dmatIrRank', 'dmat_ir_rank'], 50),
    dmatTotalScore: pickStr(payload, ['dmatTotalScore', 'dmat_total_score'], 50),
    dmatTotalRank: pickStr(payload, ['dmatTotalRank', 'dmat_total_rank'], 50),
    sat: pickFlag(payload, ['sat']),
    satExamDate: pickStr(payload, ['satExamDate', 'sat_exam_date'], 50),
    satReasoningPoints: pickStr(payload, ['satReasoningPoints', 'sat_reasoning_points'], 50),
    satSubjectPoints: pickStr(payload, ['satSubjectPoints', 'sat_subject_points'], 50),

    // ── Tracking (in addition to the ones handled in the main mapper) ──────
    campaign: pickStr(payload, ['campaign', 'utm_campaign', 'utmCampaign'], 255),
    keyword: pickStr(payload, ['keyword', 'utm_term', 'utmTerm', 'keywords'], 255),
  }
}

function verifyHmac(rawBody: string, secret: string, signature: string | null): boolean {
  if (!signature) return false
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  // Accept either "sha256=<hex>" or just "<hex>" — some clients omit the prefix.
  const presented = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const a = Buffer.from(presented.trim().toLowerCase(), 'utf8')
  const b = Buffer.from(expectedHex, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// POST /api/v1/inbound/:slug/lead
inboundRoutes.post('/:slug/lead', async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const ip = getClientIp(c)
  const rawBody = await c.req.text() // capture raw body once for HMAC + parse
  let payload: any = {}
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return c.json({ success: false, message: 'Body must be valid JSON' }, 400)
  }

  const source = await prisma.leadSource.findUnique({ where: { slug } })
  if (!source) {
    // Don't reveal whether the slug exists or not
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }

  const logBase = { sourceId: source.id, ip, payload }
  const logIt = async (status: string, errorMsg?: string, leadId?: bigint) => {
    await prisma.leadIngestionLog.create({
      data: { ...logBase, status, errorMsg, leadId: leadId ?? null },
    }).catch(() => {})
  }

  if (!source.active) {
    await logIt('inactive')
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }

  // IP allowlist
  if (source.ipAllowlist.length > 0 && (!ip || !source.ipAllowlist.includes(ip))) {
    await logIt('auth_error', `IP ${ip} not in allowlist`)
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }

  // Bearer auth
  const authHeader = c.req.header('authorization') || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) {
    await logIt('auth_error', 'Missing Bearer token')
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }
  const presented = m[1].trim()
  const ok = await compare(presented, source.keyHash).catch(() => false)
  if (!ok) {
    await logIt('auth_error', 'Invalid API key')
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }

  // HMAC (if configured)
  if (source.webhookSecret) {
    const sig = c.req.header('x-signature') || null
    if (!verifyHmac(rawBody, source.webhookSecret, sig)) {
      const expected = crypto.createHmac('sha256', source.webhookSecret).update(rawBody, 'utf8').digest('hex')
      const presented = sig ? (sig.startsWith('sha256=') ? sig.slice(7) : sig).trim().toLowerCase() : '(none)'
      await logIt(
        'auth_error',
        `HMAC mismatch: bodyLen=${rawBody.length} expected=sha256=${expected} received=sha256=${presented}`,
      )
      return c.json({ success: false, message: 'Signature verification failed' }, 401)
    }
  }

  // Rate limit
  if (!checkRateLimit(`source:${source.id}`)) {
    await logIt('rate_limited')
    return c.json({ success: false, message: 'Rate limit exceeded' }, 429)
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  const name = String(payload.name || '').trim().slice(0, 200)
  const email = String(payload.email || '').trim().slice(0, 200)
  const mobile = String(payload.mobile || '').replace(/[^\d+]/g, '').slice(0, 20)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''

  if (!name || (!validEmail && !mobile)) {
    await logIt('validation_error', 'name + (email or mobile) required')
    return c.json({ success: false, message: 'name and email or mobile are required' }, 400)
  }

  // ─── Dedupe & Create ──────────────────────────────────────────────────────
  const existing = await prisma.lead.findFirst({
    where: {
      trash: 0,
      OR: [
        ...(validEmail ? [{ email: validEmail }] : []),
        ...(mobile ? [{ mobile }] : []),
      ],
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  })

  const isDuplicate = !!existing

  // ─── Create ──────────────────────────────────────────────────────────────
  // Tutelage Study + My MBBS Admission landing forms post only a `destination`
  // (e.g. "South Korea") — no course field. Mirror the old CRM by deriving
  // intrested_course as "MBBS in <destination>" for those partners, so the
  // course column isn't blank on every lead from these sites. Other partners
  // (Sulekha, etc.) keep the literal payload — they have their own course
  // formats.
  const destinationRaw = String(payload.preferredDestination || payload.destination || '').slice(0, 100)
  const courseRaw = String(payload.intrestedCourse || payload.interestedCourse || payload.course || '').slice(0, 100)
  const COURSE_FROM_DESTINATION_SLUGS = new Set(['tutelagestudy', 'mymbbsadmission', 'tutelage-web', 'my-mbbs-admission'])
  let intrestedCourse: string | null = courseRaw || null
  if (!intrestedCourse && destinationRaw && COURSE_FROM_DESTINATION_SLUGS.has(source.slug)) {
    intrestedCourse = /mbbs/i.test(destinationRaw) ? destinationRaw : `MBBS in ${destinationRaw}`
  }

  // Every optional Lead column we know how to map. Kept in a separate helper
  // so the required/derived fields below stay easy to read. Any key we did NOT
  // map is still stored in LeadIngestionLog.payload, so nothing is dropped.
  const extras = extractOptionalLeadFields(payload)

  const lead = await prisma.lead.create({
    data: {
      // ── Optional extras (all snake/camel aliases, capped to column length) ──
      ...extras,

      // ── Required / derived / forced — MUST override any extras above ────────
      name,
      email: validEmail || null,
      mobile: mobile || null,
      city: pickStr(payload, ['city'], 100),
      state: pickStr(payload, ['state'], 50),
      country: pickStr(payload, ['country'], 100),
      intrestedCourse,
      intrestedUniversity: pickStr(payload, ['intrestedUniversity', 'interestedUniversity', 'university'], 50),
      preferredDestination: destinationRaw || null,
      neetQualified: pickStr(payload, ['neetQualified', 'neet_qualified'], 100),
      comment: pickStr(payload, ['comment', 'question', 'message', 'inquiry_message', 'inquiryMessage', 'notes'], 2000),
      source: pickStr(payload, ['source', 'utm_source', 'utmSource'], 100),
      sourceUrl: pickStr(payload, ['sourceUrl', 'source_url', 'landingUrl', 'landing_url', 'pageUrl', 'page_url'], 255),
      event: pickStr(payload, ['event'], 50),
      website: source.slug,                                  // forced — partner cannot spoof
      departmentId: source.defaultDepartmentId ?? BigInt(2),
      leadStatus: source.defaultLeadStatus ?? 'Fresh',
      userId: BigInt(28),
      leadType: 'new',
      isDuplicate,
      duplicateOfId: existing ? existing.id : null,
    },
  })

  if (isDuplicate) {
    await logIt('duplicate', undefined, lead.id)
  }

  // Auto-assign to counsellors with automatic_asign_lead = 1
  const autoUsers = await prisma.user.findMany({
    where: { automaticAsignLead: 1 },
    select: { id: true },
  })
  if (autoUsers.length) {
    await prisma.asignedLead.createMany({
      data: autoUsers.map((u) => ({ stdId: lead.id, clrId: u.id, status: 1 })),
      skipDuplicates: true,
    })
  }

  // Stats + log
  await prisma.leadSource.update({
    where: { id: source.id },
    data: { totalLeads: { increment: 1 }, lastUsedAt: new Date() },
  })
  await logIt('created', undefined, lead.id)

  return c.json({ success: true, id: Number(lead.id), duplicate: false }, 201)
})
