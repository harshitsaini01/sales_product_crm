import { Hono } from 'hono'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { emailService } from '../services/email.service'
import { accessibleUserIds } from '../utils/branch-scope'

// 1x1 transparent GIF buffer for open tracking
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

// Public routes (for email pixel tracking without JWT)
export const publicUniversityAppRoutes = new Hono()

// GET /api/university-applications/track-open/:token
publicUniversityAppRoutes.get('/track-open/:token', async (c) => {
  const token = c.req.param('token')

  if (token) {
    try {
      const record = await (prisma as any).universityApplicationMail.findUnique({
        where: { trackingToken: token },
      })

      if (record) {
        const now = new Date()
        await (prisma as any).universityApplicationMail.update({
          where: { id: record.id },
          data: {
            isOpened: true,
            openCount: { increment: 1 },
            firstOpenedAt: record.firstOpenedAt || now,
            lastOpenedAt: now,
          },
        })
      }
    } catch (err) {
      console.error('Error tracking email open pixel:', err)
    }
  }

  // Return 1x1 transparent GIF with no-cache headers
  return c.body(TRANSPARENT_GIF, 200, {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
  })
})

// Protected routes (requires JWT)
export const universityApplicationsRoutes = new Hono()

// Scope auth to THIS router's own paths only. It's mounted at `/` in routes/index.ts,
// so a bare `use('*', ...)` here would intercept every /api/* request — including
// public/query-token endpoints like /app-releases/:id/download — before they reach
// their real handlers.
universityApplicationsRoutes.use('/students/*', authenticate)
universityApplicationsRoutes.use('/university-mails*', authenticate)

// POST /api/university-mails/:id/toggle-opened (Manual open status toggle)
universityApplicationsRoutes.post('/university-mails/:id/toggle-opened', async (c) => {
  const id = BigInt(c.req.param('id'))
  const mail = await (prisma as any).universityApplicationMail.findUnique({
    where: { id },
  })

  if (!mail) {
    return c.json({ error: 'Mail record not found' }, 404)
  }

  const now = new Date()
  const newOpenedState = !mail.isOpened

  const updated = await (prisma as any).universityApplicationMail.update({
    where: { id },
    data: {
      isOpened: newOpenedState,
      openCount: newOpenedState ? Math.max(1, mail.openCount + 1) : mail.openCount,
      firstOpenedAt: newOpenedState ? mail.firstOpenedAt || now : mail.firstOpenedAt,
      lastOpenedAt: newOpenedState ? now : mail.lastOpenedAt,
    },
  })

  return c.json({
    message: `Mail marked as ${updated.isOpened ? 'Opened' : 'Unopened'}`,
    isOpened: updated.isOpened,
    openCount: updated.openCount,
  })
})

// GET /api/university-mails (Global listing with search, filters, pagination & summary stats)
universityApplicationsRoutes.get('/university-mails', async (c) => {
  const authUser = c.get('user') as any
  const userIdNum = Number(authUser?.userId || authUser?.id || 0)
  const roleStr = authUser?.role || 'employee'
  const userIds = userIdNum > 0 ? await accessibleUserIds({ userId: userIdNum, role: roleStr }) : null

  const search = c.req.query('search')?.trim() || ''
  const status = c.req.query('status') || 'all' // 'all' | 'opened' | 'unopened'
  const sentByUserId = c.req.query('sentByUserId')
  const universityName = c.req.query('universityName') || c.req.query('university')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
  const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10)))
  const skip = (page - 1) * limit

  const andConditions: any[] = []

  // Security Role Scoping: Non-admin users see ONLY mails for leads assigned to them
  if (userIds !== null) {
    andConditions.push({
      student: { assignedTo: { some: { clrId: { in: userIds }, status: 1 } } },
    })
  }

  if (status === 'opened') {
    andConditions.push({ isOpened: true })
  } else if (status === 'unopened') {
    andConditions.push({ isOpened: false })
  }

  if (sentByUserId) {
    andConditions.push({ sentByUserId: BigInt(sentByUserId) })
  }

  if (universityName) {
    andConditions.push({
      OR: [
        { universityName: { equals: universityName, mode: 'insensitive' } },
        { student: { intrestedUniversity: { equals: universityName, mode: 'insensitive' } } },
      ],
    })
  }

  if (startDate || endDate) {
    const dateCond: any = {}
    if (startDate) dateCond.gte = new Date(startDate)
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      dateCond.lte = end
    }
    andConditions.push({ createdAt: dateCond })
  }

  if (search) {
    andConditions.push({
      OR: [
        { toEmail: { contains: search, mode: 'insensitive' } },
        { cc: { contains: search, mode: 'insensitive' } },
        { greeting: { contains: search, mode: 'insensitive' } },
        { recipientName: { contains: search, mode: 'insensitive' } },
        { senderName: { contains: search, mode: 'insensitive' } },
        { program: { contains: search, mode: 'insensitive' } },
        { universityName: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
        { student: { name: { contains: search, mode: 'insensitive' } } },
        { student: { email: { contains: search, mode: 'insensitive' } } },
        { student: { intrestedUniversity: { contains: search, mode: 'insensitive' } } },
      ],
    })
  }

  const where: any = andConditions.length > 0 ? { AND: andConditions } : {}

  const scopedMailWhere: any = userIds !== null
    ? { student: { assignedTo: { some: { clrId: { in: userIds }, status: 1 } } } }
    : {}

  const senderWhere: any = {
    ...scopedMailWhere,
    sentByUserId: { not: null },
  }
  if (universityName) {
    senderWhere.OR = [
      { universityName: { equals: universityName, mode: 'insensitive' } },
      { student: { intrestedUniversity: { equals: universityName, mode: 'insensitive' } } },
    ]
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const [total, mails, totalSentCount, totalOpenedCount, todayCount, senderRecords, uniRecords] = await Promise.all([
    (prisma as any).universityApplicationMail.count({ where }),
    (prisma as any).universityApplicationMail.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            mobile: true,
            country: true,
            intrestedCourse: true,
            intrestedUniversity: true,
            assignedTo: {
              where: { status: 1 },
              select: { clrId: true },
            },
          },
        },
        sentBy: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
    (prisma as any).universityApplicationMail.count({ where: scopedMailWhere }),
    (prisma as any).universityApplicationMail.count({ where: { ...scopedMailWhere, isOpened: true } }),
    (prisma as any).universityApplicationMail.count({
      where: {
        ...scopedMailWhere,
        createdAt: {
          gte: startOfToday,
        },
      },
    }),
    (prisma as any).universityApplicationMail.findMany({
      where: senderWhere,
      distinct: ['sentByUserId'],
      select: {
        sentBy: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
    (prisma as any).universityApplicationMail.findMany({
      where: scopedMailWhere,
      select: {
        universityName: true,
        student: {
          select: { intrestedUniversity: true },
        },
      },
    }),
  ])

  const sendersMap = new Map<number, { id: number; name: string; email: string }>()
  for (const s of senderRecords) {
    if (s?.sentBy?.id) {
      sendersMap.set(Number(s.sentBy.id), {
        id: Number(s.sentBy.id),
        name: s.sentBy.name,
        email: s.sentBy.email,
      })
    }
  }
  const senders = Array.from(sendersMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  const universitiesSet = new Set<string>()
  for (const u of uniRecords) {
    const uniName = u?.universityName?.trim() || u?.student?.intrestedUniversity?.trim()
    if (uniName) {
      universitiesSet.add(uniName)
    }
  }
  const universities = Array.from(universitiesSet).sort((a, b) => a.localeCompare(b))

  const formattedItems = mails.map((m: any) => ({
    ...m,
    id: Number(m.id),
    studentId: Number(m.studentId),
    sentByUserId: m.sentByUserId ? Number(m.sentByUserId) : null,
    student: m.student
      ? { ...m.student, id: Number(m.student.id) }
      : null,
    sentBy: m.sentBy
      ? { ...m.sentBy, id: Number(m.sentBy.id) }
      : null,
    attachedDocs: m.attachedDocs ? JSON.parse(m.attachedDocs) : [],
  }))

  const openRate = totalSentCount > 0 ? Math.round((totalOpenedCount / totalSentCount) * 100) : 0

  return c.json({
    items: formattedItems,
    senders,
    universities,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      totalSent: totalSentCount,
      totalOpened: totalOpenedCount,
      totalUnopened: totalSentCount - totalOpenedCount,
      openRate,
      sentToday: todayCount,
    },
  })
})

// GET /api/students/:id/university-mail
universityApplicationsRoutes.get('/students/:id/university-mail', async (c) => {
  const studentId = BigInt(c.req.param('id'))

  const mails = await (prisma as any).universityApplicationMail.findMany({
    where: { studentId },
    orderBy: { createdAt: 'desc' },
    include: {
      sentBy: {
        select: { id: true, name: true, email: true },
      },
    },
  })

  const formatted = mails.map((m: any) => ({
    ...m,
    id: Number(m.id),
    studentId: Number(m.studentId),
    sentByUserId: m.sentByUserId ? Number(m.sentByUserId) : null,
    sentBy: m.sentBy
      ? { ...m.sentBy, id: Number(m.sentBy.id) }
      : null,
    attachedDocs: m.attachedDocs ? JSON.parse(m.attachedDocs) : [],
  }))

  return c.json(formatted)
})

// POST /api/students/:id/university-mail
universityApplicationsRoutes.post('/students/:id/university-mail', async (c) => {
  const { userId } = c.get('user')
  const studentId = BigInt(c.req.param('id'))
  const body = await c.req.json()

  const {
    toEmail,
    cc,
    greeting = 'Dear',
    recipientName = '',
    senderName = 'Aman Ahlawat',
    signatureId = null,
    program = '',
    universityName = '',
    subject = '',
    body: mailBody = '',
    selectedDocIds = [],
  } = body

  if (!toEmail) {
    return c.json({ error: 'Recipient email (Send to) is required' }, 400)
  }

  // Check student exists
  const student = await prisma.lead.findUnique({
    where: { id: studentId },
  })

  if (!student) {
    return c.json({ error: 'Student not found' }, 404)
  }

  // Retrieve custom signature from DB if available
  let signatureHtml = ''
  if (signatureId) {
    const sig = await prisma.signature.findUnique({
      where: { id: BigInt(signatureId) },
    })
    if (sig?.content) signatureHtml = sig.content
  }
  if (!signatureHtml) {
    const defaultSig = await prisma.signature.findFirst({
      where: {
        OR: [
          { userId: BigInt(userId), isDefault: 1 },
          { isDefault: 1 },
        ],
      },
      orderBy: { isDefault: 'desc' },
    })
    if (defaultSig?.content) signatureHtml = defaultSig.content
  }

  // Retrieve selected document attachments
  const attachedDocNames: string[] = []
  const attachments: Array<{ filename: string; path: string }> = []

  if (Array.isArray(selectedDocIds) && selectedDocIds.length > 0) {
    const docBigIds = selectedDocIds.map((id: number | string) => BigInt(id))
    const docs = await prisma.studentDocument.findMany({
      where: {
        id: { in: docBigIds },
        leadId: studentId,
      },
    })

    for (const doc of docs) {
      attachedDocNames.push(doc.title || doc.filename)
      // Resolve absolute file path on disk
      const baseFilename = path.basename(doc.filepath)
      let fullPath = path.join(process.cwd(), 'uploads', baseFilename)
      if (!fs.existsSync(fullPath)) {
        const cleanRelative = doc.filepath.replace(/^[/\\]+/, '')
        fullPath = path.join(process.cwd(), cleanRelative)
      }
      if (fs.existsSync(fullPath)) {
        attachments.push({
          filename: doc.filename || doc.title,
          path: fullPath,
        })
      } else {
        console.warn(`[UniversityMail] Attachment file not found at: ${fullPath}`)
      }
    }
  }

  // Generate tracking token
  const trackingToken = crypto.randomUUID()

  // Base URL for open tracking pixel (checks forwarded headers, APP_URL, or host)
  const forwardedHost = c.req.header('x-forwarded-host')
  const host = forwardedHost || c.req.header('host') || 'localhost:3001'
  const protocol = c.req.header('x-forwarded-proto') || 'https'
  let baseUrl = process.env.APP_URL || process.env.PUBLIC_URL || `${protocol}://${host}`
  if (!baseUrl.startsWith('http')) {
    baseUrl = `https://${baseUrl}`
  }
  const trackingPixelUrl = `${baseUrl}/api/university-applications/track-open/${trackingToken}`

  const progValue = program || student.course || student.intrestedCourse || ''
  const uniValue = universityName || student.intrestedUniversity || ''
  const finalSubject = subject || `Application - ${student.name || 'Applicant'}, ${student.country || student.nationality || ''}, ${progValue || ''} - Tutelage Study`

  // Compose Full HTML Email Body matching exact template
  const htmlBody = `
    <div style="background-color: #e9e9e9; padding: 20px 10px; font-family: Arial, Helvetica, sans-serif; color: #333333;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cccccc;">
        <!-- Header Banner -->
        <div style="background-color: #005b82; padding: 10px 15px; text-align: center; color: #ffffff; font-size: 15px; font-weight: bold; letter-spacing: 0.5px;">
          Tutelage Study
        </div>

        <div style="padding: 20px 25px;">
          <!-- Greeting & Intro -->
          <div style="margin-bottom: 20px; font-size: 14px; line-height: 1.5; color: #333333;">
            <p style="margin-top: 0; margin-bottom: 12px; font-size: 18px; font-weight: bold; color: #000000;">
              ${greeting} ${recipientName ? recipientName + ' ,' : ''}
            </p>
            <div style="color: #333333; line-height: 1.5;">
              ${mailBody}
            </div>
          </div>

          <!-- Program Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #888888; font-size: 13px;">
            <thead>
              <tr style="background-color: #005b82; color: #ffffff;">
                <th colspan="2" style="padding: 8px 12px; text-align: left; font-size: 14px; font-weight: bold; border: 1px solid #888888;">
                  Program
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="width: 36%; padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Program</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${progValue || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">University</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${uniValue || '—'}</td>
              </tr>
            </tbody>
          </table>

          <!-- Personal Info Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #888888; font-size: 13px;">
            <thead>
              <tr style="background-color: #005b82; color: #ffffff;">
                <th colspan="2" style="padding: 8px 12px; text-align: left; font-size: 14px; font-weight: bold; border: 1px solid #888888;">
                  Personal Info
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="width: 36%; padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Student Name</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.name || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Father Name</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.father || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Mother Name</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.mother || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Country of Citizenship</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.nationality || student.country || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Gender</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.gender || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">D.O.B</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.dob || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">First Language</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.firstLanguage || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Marital Status</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.maritalStatus || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Passport Number</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.passportNumber || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Passport Expiry</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.passportExpiry || '—'}</td>
              </tr>
            </tbody>
          </table>

          <!-- Address Details Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #888888; font-size: 13px;">
            <thead>
              <tr style="background-color: #005b82; color: #ffffff;">
                <th colspan="2" style="padding: 8px 12px; text-align: left; font-size: 14px; font-weight: bold; border: 1px solid #888888;">
                  Address Details
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="width: 36%; padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Address</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.homeAddress || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">City</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.city || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">State/Province</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.state || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Country</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.country || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Postal/Zipcode</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.pincode || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">D.O.B</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.dob || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">First Language</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.firstLanguage || '—'}</td>
              </tr>
            </tbody>
          </table>

          <!-- Education Summary Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #888888; font-size: 13px;">
            <thead>
              <tr style="background-color: #005b82; color: #ffffff;">
                <th colspan="2" style="padding: 8px 12px; text-align: left; font-size: 14px; font-weight: bold; border: 1px solid #888888;">
                  Education Summary
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="width: 36%; padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Country of Education</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.countryOfEducation || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Highest Level of Education</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.highestQualification || student.highestLevelOfEducation || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Grading Scheme</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.gradingScheme || '—'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 10px; border: 1px solid #888888; font-weight: bold; background-color: #ffffff; color: #000000;">Grade Average</td>
                <td style="padding: 6px 10px; border: 1px solid #888888; color: #333333; background-color: #ffffff;">${student.gradeAverage || '—'}</td>
              </tr>
            </tbody>
          </table>

          <!-- Footer Signature -->
          ${signatureHtml ? `
            <div style="font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: #333333; font-size: 13px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 15px; margin-top: 25px;">
              ${signatureHtml}
            </div>
          ` : `
            <div style="font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: #333333; font-size: 13px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 15px; margin-top: 25px;">
              <p style="margin: 0 0 5px 0;">With Best Regards,</p>
              <p style="margin: 0 0 3px 0; font-weight: bold; color: #111111;">${senderName || 'Aman Ahlawat'}</p>
              <p style="margin: 0 0 3px 0;">Director</p>
              <p style="margin: 0 0 3px 0; font-weight: bold; color: #005b82;">Tutelage Study</p>
              <p style="margin: 0 0 3px 0;">-Ramada Dua Sentral Plaza, Jalan tun Sambanthan, 50470, Kuala Lumpur, Malaysia</p>
              <p style="margin: 0 0 3px 0;">-B-16, GF, Mayfield Garden, Sector-50, Gurgaon, Haryana, India</p>
              <p style="margin: 0 0 3px 0;">Hand Phone- +60-104306714, +91-9870406867</p>
              <p style="margin: 0 0 3px 0;">WeChat, Kakao Talk +60-104306714</p>
              <p style="margin: 0;">Facebook page- <a href="https://www.facebook.com/educationmalaysia.in" style="color: #0000ee; text-decoration: underline;">https://www.facebook.com/educationmalaysia.in</a></p>
            </div>
          `}
          <img src="${trackingPixelUrl}" width="1" height="1" border="0" alt="" style="display:block; width:1px; min-width:1px; max-width:1px; height:1px; min-height:1px; max-height:1px; border:0; outline:none; text-decoration:none;" />
        </div>
      </div>
    </div>
  `

  // Send Email
  try {
    const fromAddr = process.env.SMTP_FROM || 'support@tutelagestudy.com'
    await emailService.send({
      from: `"Tutelage Study" <${fromAddr}>`,
      to: toEmail,
      cc: cc ? cc : undefined,
      subject: finalSubject,
      html: htmlBody,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
  } catch (emailErr: any) {
    console.error('Error sending application email to university:', emailErr)
    return c.json({ error: `Failed to send email: ${emailErr?.message || 'SMTP error'}` }, 500)
  }

  const savedProgram = (typeof program === 'string' && program.trim()) ? program.trim() : (student.course || student.intrestedCourse || null)
  const savedUniName = (typeof universityName === 'string' && universityName.trim()) ? universityName.trim() : (student.intrestedUniversity || null)

  // Save record to DB
  const mailRecord = await (prisma as any).universityApplicationMail.create({
    data: {
      studentId,
      toEmail,
      cc: cc || null,
      greeting: greeting || null,
      recipientName: recipientName || null,
      senderName: senderName || null,
      program: savedProgram,
      universityName: savedUniName,
      subject: finalSubject,
      body: mailBody,
      attachedDocs: JSON.stringify(attachedDocNames),
      sentByUserId: BigInt(userId),
      trackingToken,
    },
  })

  // Add followup / activity record to student history
  await prisma.leadFollowup.create({
    data: {
      stdId: studentId,
      userid: BigInt(userId),
      comment: `Sent application email to University (${toEmail})${attachedDocNames.length ? ` with ${attachedDocNames.length} attachment(s)` : ''}`,
      type: 'mail',
    },
  })

  return c.json({
    message: 'University application email sent successfully',
    mail: {
      ...mailRecord,
      id: Number(mailRecord.id),
      studentId: Number(mailRecord.studentId),
      sentByUserId: Number(mailRecord.sentByUserId),
      attachedDocs: attachedDocNames,
    },
  })
})
