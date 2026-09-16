import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'
import transporter from '../../lib/mailer'

// ─── SEND EMAIL TO A LEAD ─────────────────────────────────────────────────────
export async function sendEmail(params: {
  leadId: number
  userId: number
  toEmail: string
  subject: string
  body: string
  from?: string
  fromName?: string
}) {
  // Record in tbl_chats (student chat/email history) — same as old CRM
  await prisma.studentMailHistory.create({
    data: {
      leadId: BigInt(params.leadId),
      subject: params.subject,
      body: params.body,
    },
  })

  // Record in sent_mails
  await prisma.sentMail.create({
    data: {
      leadId: BigInt(params.leadId),
      userId: BigInt(params.userId),
      toEmail: params.toEmail,
      subject: params.subject,
      body: params.body,
      status: 'sent',
    },
  })

  // Send via SMTP
  const fromAddress = params.from || process.env.SMTP_FROM || process.env.SMTP_USER || ''
  const fromDisplay = params.fromName ? `"${params.fromName}" <${fromAddress}>` : fromAddress

  await transporter.sendMail({
    from: fromDisplay,
    to: params.toEmail,
    subject: params.subject,
    html: params.body,
  })

  return { message: 'Email sent' }
}

// ─── SEND BULK EMAIL ─────────────────────────────────────────────────────────
export async function sendBulkEmail(params: {
  leadIds: number[]
  userId: number
  subject: string
  body: string
  from?: string
  fromName?: string
}) {
  // Fetch lead emails
  const leads = await prisma.lead.findMany({
    where: { id: { in: params.leadIds.map(BigInt) }, trash: 0 },
    select: { id: true, name: true, email: true, leadType: true },
  })

  const results = []
  for (const lead of leads) {
    if (!lead.email) { results.push({ leadId: Number(lead.id), success: false, reason: 'No email' }); continue }

    try {
      await sendEmail({
        leadId: Number(lead.id),
        userId: params.userId,
        toEmail: lead.email,
        subject: params.subject,
        body: params.body,
        from: params.from,
        fromName: params.fromName,
      })

      // Old CRM: if lead_type == 'new', change to 'ongoing' after bulk email
      if (lead.leadType === 'new') {
        await prisma.lead.update({ where: { id: lead.id }, data: { leadType: 'ongoing' } })
      }

      results.push({ leadId: Number(lead.id), success: true })
    } catch (err) {
      results.push({ leadId: Number(lead.id), success: false, reason: String(err) })
    }
  }

  return results
}

// ─── TEMPLATES ───────────────────────────────────────────────────────────────
export async function getTemplates(userId: number) {
  const templates = await prisma.mailTemplate.findMany({
    where: { status: 1 },
    orderBy: { createdAt: 'desc' },
  })
  return bigintFix(templates)
}

export async function createTemplate(data: { title: string; subject: string; body: string; userId: number }) {
  const template = await prisma.mailTemplate.create({
    data: {
      title: data.title,
      subject: data.subject,
      body: data.body,
      userId: BigInt(data.userId),
      status: 1,
    },
  })
  return bigintFix(template)
}

export async function updateTemplate(id: bigint, data: Record<string, unknown>) {
  delete data.userId
  const template = await prisma.mailTemplate.update({ where: { id }, data })
  return bigintFix(template)
}

export async function deleteTemplate(id: bigint) {
  await prisma.mailTemplate.update({ where: { id }, data: { status: 0 } })
}

// ─── SIGNATURES ──────────────────────────────────────────────────────────────
export async function getSignatures(userId?: number) {
  const where: Record<string, unknown> = {}
  if (userId) where.userId = BigInt(userId)
  const sigs = await prisma.signature.findMany({ where, orderBy: { isDefault: 'desc' } })
  return bigintFix(sigs)
}

export async function createSignature(data: { title: string; content: string; userId: number; isDefault?: number }) {
  if (data.isDefault === 1) {
    // Unset existing default
    await prisma.signature.updateMany({ where: { userId: BigInt(data.userId) }, data: { isDefault: 0 } })
  }
  const sig = await prisma.signature.create({
    data: {
      title: data.title,
      content: data.content,
      userId: BigInt(data.userId),
      isDefault: data.isDefault || 0,
    },
  })
  return bigintFix(sig)
}

export async function updateSignature(id: bigint, data: Record<string, unknown>) {
  if (data.isDefault === 1 && data.userId) {
    await prisma.signature.updateMany({ where: { userId: BigInt(data.userId as number) }, data: { isDefault: 0 } })
  }
  const sig = await prisma.signature.update({ where: { id }, data })
  return bigintFix(sig)
}

export async function deleteSignature(id: bigint) {
  await prisma.signature.delete({ where: { id } })
}

export async function setDefaultSignature(id: bigint, userId: bigint) {
  await prisma.signature.updateMany({ where: { userId }, data: { isDefault: 0 } })
  await prisma.signature.update({ where: { id }, data: { isDefault: 1 } })
}

// ─── EMAIL HEADERS ────────────────────────────────────────────────────────────
export async function getEmailHeaders() {
  const headers = await prisma.emailHeader.findMany({
    where: { status: 1 },
    orderBy: { isDefault: 'desc' },
  })
  return bigintFix(headers)
}

export async function createEmailHeader(data: { name: string; email: string; userId: number; isDefault?: number }) {
  const header = await prisma.emailHeader.create({
    data: {
      name: data.name,
      email: data.email,
      userId: BigInt(data.userId),
      isDefault: data.isDefault || 0,
      status: 1,
    },
  })
  return bigintFix(header)
}

export async function updateEmailHeader(id: bigint, data: Record<string, unknown>) {
  delete data.userId
  const header = await prisma.emailHeader.update({ where: { id }, data })
  return bigintFix(header)
}

export async function deleteEmailHeader(id: bigint) {
  await prisma.emailHeader.update({ where: { id }, data: { status: 0 } })
}

// ─── GET MAIL HISTORY FOR LEAD ────────────────────────────────────────────────
export async function getMailHistory(leadId: bigint) {
  const history = await prisma.studentMailHistory.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
  })
  return bigintFix(history)
}
