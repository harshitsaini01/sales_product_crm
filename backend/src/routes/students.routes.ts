import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { leadScopeWhere } from '../utils/branch-scope'
import { parsePagination, buildPaginatedResult } from '../utils/pagination'
import { uploadSingle } from '../middleware/upload'
import path from 'path'
import { negateLeadClause } from '../utils/lead-filter'

export const studentsRoutes = new Hono()

studentsRoutes.use('*', authenticate)

// GET /api/students
studentsRoutes.get('/', async (c) => {
  const { userId, role } = c.get('user')
  const { page, limit, skip } = parsePagination(c.req.query())
  const search = c.req.query('search')
  const excludeRaw = c.req.query('excludeMode')
  const isExclude = excludeRaw === '1' || excludeRaw === 'true'

  const where: Record<string, unknown> = { enrolled: 1, trash: 0, ...(await leadScopeWhere({ userId, role })) }
  if (search) {
    const searchClause = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } },
      ],
    }
    if (isExclude) {
      // NULL-safe negation — a plain `where.NOT` here dropped every student
      // with no email or mobile on file, because SQL's `NOT NULL` is NULL
      // rather than TRUE. See negateLeadClause.
      where.AND = [negateLeadClause(searchClause)]
    } else {
      where.OR = searchClause.OR
    }
  }

  const [total, students] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where, skip, take: limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, email: true, mobile: true,
        city: true, country: true, course: true,
        totalFees: true, balanceFees: true, createdAt: true,
        assignedTo: { select: { counsellor: { select: { id: true, name: true } } } },
      },
    }),
  ])

  return c.json(buildPaginatedResult(students, total, page, limit))
})

// POST /api/leads/:id/enroll (admin only)
studentsRoutes.post('/enroll/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()

  const student = await prisma.lead.update({
    where: { id },
    data: {
      enrolled: 1,
      course: body.course || null,
      totalFees: body.totalFees ? Number(body.totalFees) : null,
    },
  })

  return c.json(student)
})

// GET /api/students/:id
studentsRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))

  const student = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { include: { counsellor: { select: { id: true, name: true } } } },
      documents: true,
    },
  })

  if (!student) return c.json({ error: 'Student not found' }, 404)
  return c.json(student)
})

// PATCH /api/students/:id (general update)
studentsRoutes.patch('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  delete body.id
  const student = await prisma.lead.update({ where: { id }, data: body })
  return c.json(student)
})

// PATCH /api/students/:id/info
studentsRoutes.patch('/:id/info', async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const { name, email, mobile, mobile2, city, state, country, gender, dob, nationality, religion, passportNumber } = body

  const student = await prisma.lead.update({
    where: { id },
    data: { name, email, mobile, mobile2, city, state, country, gender, dob, nationality, religion, passportNumber },
  })
  return c.json(student)
})

// PATCH /api/students/:id/education
studentsRoutes.patch('/:id/education', async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const { highestQualification, neetscore, neetRank, neetQualified, neetPassingYear, persuingCountry, preferredDestination, englishExamType, overallScore } = body

  const student = await prisma.lead.update({
    where: { id },
    data: { highestQualification, neetscore, neetRank, neetQualified, neetPassingYear, persuingCountry, preferredDestination, englishExamType, overallScore },
  })
  return c.json(student)
})

// PATCH /api/students/:id/personal (fees/course)
studentsRoutes.patch('/:id/personal', async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const { course, totalFees, totalDepositFees, balanceFees } = body

  const student = await prisma.lead.update({
    where: { id },
    data: { course, totalFees: totalFees ? Number(totalFees) : undefined, totalDepositFees: totalDepositFees ? Number(totalDepositFees) : undefined, balanceFees: balanceFees ? Number(balanceFees) : undefined },
  })
  return c.json(student)
})

// DELETE /api/students/:id (admin only — un-enroll)
studentsRoutes.delete('/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.lead.update({ where: { id }, data: { enrolled: 0 } })
  return c.json({ message: 'Student un-enrolled' })
})

// GET /api/students/:id/documents
studentsRoutes.get('/:id/documents', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const docs = await prisma.studentDocument.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } })
  return c.json(docs)
})

// POST /api/students/:id/documents (file upload)
studentsRoutes.post('/:id/documents', uploadSingle('file'), async (c) => {
  const leadId = BigInt(c.req.param('id'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as any)?.incoming as any)?.file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  const title = c.req.query('title') || file.originalname
  const filepath = `/uploads/${path.basename(file.filename)}`

  const doc = await prisma.studentDocument.create({
    data: {
      leadId,
      title,
      filepath,
      filename: file.originalname,
    },
  })
  return c.json(doc, 201)
})

// DELETE /api/students/:id/documents/:docId
studentsRoutes.delete('/:id/documents/:docId', async (c) => {
  const id = BigInt(c.req.param('docId'))
  await prisma.studentDocument.delete({ where: { id } })
  return c.json({ message: 'Document deleted' })
})

// GET /api/students/:id/invoices
studentsRoutes.get('/:id/invoices', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const invoices = await prisma.invoice.findMany({
    where: { leadId },
    include: { payments: true },
    orderBy: { createdAt: 'desc' },
  })
  return c.json(invoices)
})

// ─── SCHOOL HISTORY (legacy Common.addSchool / updSchool) ─────────────────────

// GET /api/students/:id/school
studentsRoutes.get('/:id/school', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const rows = await prisma.studentSchoolHistory.findMany({
    where: { leadId },
    orderBy: { passingYear: 'desc' },
  })
  return c.json(rows)
})

// POST /api/students/:id/school
studentsRoutes.post('/:id/school', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const row = await prisma.studentSchoolHistory.create({
    data: {
      leadId,
      level: body.level || null,
      schoolName: body.schoolName || null,
      board: body.board || null,
      passingYear: body.passingYear ? Number(body.passingYear) : null,
      percentage: body.percentage || null,
      stream: body.stream || null,
      city: body.city || null,
      country: body.country || null,
    },
  })
  return c.json(row, 201)
})

// PATCH /api/students/:id/school/:rowId
studentsRoutes.patch('/:id/school/:rowId', async (c) => {
  const id = BigInt(c.req.param('rowId'))
  const body = await c.req.json()
  const row = await prisma.studentSchoolHistory.update({
    where: { id },
    data: {
      level: body.level ?? undefined,
      schoolName: body.schoolName ?? undefined,
      board: body.board ?? undefined,
      passingYear: body.passingYear !== undefined ? (body.passingYear ? Number(body.passingYear) : null) : undefined,
      percentage: body.percentage ?? undefined,
      stream: body.stream ?? undefined,
      city: body.city ?? undefined,
      country: body.country ?? undefined,
    },
  })
  return c.json(row)
})

// DELETE /api/students/:id/school/:rowId
studentsRoutes.delete('/:id/school/:rowId', async (c) => {
  const id = BigInt(c.req.param('rowId'))
  await prisma.studentSchoolHistory.delete({ where: { id } })
  return c.json({ message: 'Removed' })
})

// ─── UCAT (legacy Common.updUcat) ────────────────────────────────────────────
// Single record per student (upsert).

studentsRoutes.get('/:id/ucat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const row = await prisma.studentExamUcat.findUnique({ where: { leadId } })
  return c.json(row)
})

studentsRoutes.put('/:id/ucat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const b = await c.req.json()
  const data = {
    examDate: b.examDate ? new Date(b.examDate) : null,
    totalScore: b.totalScore != null ? Number(b.totalScore) : null,
    verbalReasoning: b.verbalReasoning != null ? Number(b.verbalReasoning) : null,
    decisionMaking: b.decisionMaking != null ? Number(b.decisionMaking) : null,
    quantitative: b.quantitative != null ? Number(b.quantitative) : null,
    abstractReason: b.abstractReason != null ? Number(b.abstractReason) : null,
    situational: b.situational || null,
    notes: b.notes || null,
  }
  const row = await prisma.studentExamUcat.upsert({
    where: { leadId },
    update: data,
    create: { leadId, ...data },
  })
  return c.json(row)
})

studentsRoutes.delete('/:id/ucat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  await prisma.studentExamUcat.deleteMany({ where: { leadId } })
  return c.json({ message: 'Removed' })
})

// ─── DMAT (legacy Common.updDmat) ────────────────────────────────────────────

studentsRoutes.get('/:id/dmat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const row = await prisma.studentExamDmat.findUnique({ where: { leadId } })
  return c.json(row)
})

studentsRoutes.put('/:id/dmat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const b = await c.req.json()
  const data = {
    examDate: b.examDate ? new Date(b.examDate) : null,
    totalScore: b.totalScore != null ? Number(b.totalScore) : null,
    physics: b.physics != null ? Number(b.physics) : null,
    chemistry: b.chemistry != null ? Number(b.chemistry) : null,
    biology: b.biology != null ? Number(b.biology) : null,
    reasoning: b.reasoning != null ? Number(b.reasoning) : null,
    notes: b.notes || null,
  }
  const row = await prisma.studentExamDmat.upsert({
    where: { leadId },
    update: data,
    create: { leadId, ...data },
  })
  return c.json(row)
})

studentsRoutes.delete('/:id/dmat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  await prisma.studentExamDmat.deleteMany({ where: { leadId } })
  return c.json({ message: 'Removed' })
})

// ─── SAT (legacy Common.updSat) ──────────────────────────────────────────────

studentsRoutes.get('/:id/sat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const row = await prisma.studentExamSat.findUnique({ where: { leadId } })
  return c.json(row)
})

studentsRoutes.put('/:id/sat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const b = await c.req.json()
  const data = {
    examDate: b.examDate ? new Date(b.examDate) : null,
    totalScore: b.totalScore != null ? Number(b.totalScore) : null,
    reading: b.reading != null ? Number(b.reading) : null,
    writing: b.writing != null ? Number(b.writing) : null,
    math: b.math != null ? Number(b.math) : null,
    essay: b.essay != null ? Number(b.essay) : null,
    notes: b.notes || null,
  }
  const row = await prisma.studentExamSat.upsert({
    where: { leadId },
    update: data,
    create: { leadId, ...data },
  })
  return c.json(row)
})

studentsRoutes.delete('/:id/sat', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  await prisma.studentExamSat.deleteMany({ where: { leadId } })
  return c.json({ message: 'Removed' })
})

// ─── FEEDBACK (legacy Common.addFB / updFB) ──────────────────────────────────
// Multiple feedback entries per student.

studentsRoutes.get('/:id/feedback', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const rows = await prisma.studentFeedback.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
  })
  // hydrate user names
  const userIds = Array.from(new Set(rows.map((r) => r.userId)))
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : []
  const userMap = new Map(users.map((u) => [String(u.id), u]))
  return c.json(rows.map((r) => ({ ...r, user: userMap.get(String(r.userId)) ?? null })))
})

studentsRoutes.post('/:id/feedback', async (c) => {
  const leadId = BigInt(c.req.param('id'))
  const { userId } = c.get('user')
  const b = await c.req.json()
  if (!b.feedback?.trim()) return c.json({ error: 'feedback required' }, 400)

  const row = await prisma.studentFeedback.create({
    data: {
      leadId,
      userId: BigInt(userId),
      feedback: b.feedback.trim(),
      rating: b.rating != null ? Number(b.rating) : null,
    },
  })
  return c.json(row, 201)
})

studentsRoutes.patch('/:id/feedback/:fbId', async (c) => {
  const id = BigInt(c.req.param('fbId'))
  const b = await c.req.json()
  const row = await prisma.studentFeedback.update({
    where: { id },
    data: {
      feedback: b.feedback ?? undefined,
      rating: b.rating !== undefined ? (b.rating != null ? Number(b.rating) : null) : undefined,
    },
  })
  return c.json(row)
})

studentsRoutes.delete('/:id/feedback/:fbId', adminOnly, async (c) => {
  const id = BigInt(c.req.param('fbId'))
  await prisma.studentFeedback.delete({ where: { id } })
  return c.json({ message: 'Removed' })
})
