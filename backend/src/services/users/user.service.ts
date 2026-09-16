import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'
import { generateLoginId, generatePassword } from '../../utils/id-generator'
import { hash } from 'bcryptjs'
import transporter from '../../lib/mailer'

// ─── GET ALL USERS ────────────────────────────────────────────────────────────
export async function getAll(role?: string, branchId?: number) {
  const where: Record<string, unknown> = { status: 1 }
  if (role) where.role = role
  if (branchId) where.branchId = BigInt(branchId)

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, name: true, email: true, mobile: true, role: true,
      loginid: true, nickName: true, designation: true, branchId: true,
      status: true, automaticAsignLead: true, joiningDate: true,
      city: true, state: true, country: true, createdAt: true,
    },
    orderBy: { name: 'asc' },
  })
  return bigintFix(users)
}

// ─── GET USER BY ID ───────────────────────────────────────────────────────────
export async function getById(id: bigint) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      roles: true,
      branch: { select: { id: true, name: true } },
      documents: true,
      assignedLeads: {
        take: 10,
        include: { lead: { select: { id: true, name: true, leadStatus: true } } },
      },
    },
  })
  return user ? bigintFix(user) : null
}

// ─── CREATE USER ──────────────────────────────────────────────────────────────
export async function create(data: {
  name: string
  email: string
  mobile: string
  role: string
  branchId?: number
  designation?: string
  nickName?: string
  automaticAsignLead?: number
  departmentIds?: number[]
  sendWelcomeEmail?: boolean
}) {
  // Auto-generate login ID and password
  const loginid = generateLoginId(data.role)
  const plainPassword = generatePassword()
  const hashedPassword = await hash(plainPassword, 10)

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      role: data.role,
      loginid,
      username: loginid,
      password: hashedPassword,
      passwordCopy: plainPassword,
      nickName: data.nickName || null,
      designation: data.designation || null,
      automaticAsignLead: data.automaticAsignLead || 0,
      branchId: data.branchId ? BigInt(data.branchId) : null,
      status: 1,
    },
  })

  // Assign departments if provided
  if (data.departmentIds?.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO asign_departments (user_id, department_id, status) VALUES ${data.departmentIds.map(() => '(?, ?, 1)').join(', ')}`,
      ...data.departmentIds.flatMap((dId) => [Number(user.id), dId])
    )
  }

  // Send welcome email
  if (data.sendWelcomeEmail !== false) {
    try {
      await transporter.sendMail({
        to: data.email,
        subject: 'Your CRM Login Credentials',
        html: `
          <h2>Welcome to Tutelage CRM</h2>
          <p>Dear ${data.name},</p>
          <p>Your account has been created. Please use the following credentials to login:</p>
          <p><strong>Login ID:</strong> ${loginid}</p>
          <p><strong>Password:</strong> ${plainPassword}</p>
          <p>Please change your password after first login.</p>
        `,
      })
    } catch { /* email failure shouldn't block user creation */ }
  }

  return { ...(bigintFix(user) as Record<string, unknown>), plainPassword, loginid }
}

// ─── UPDATE USER ──────────────────────────────────────────────────────────────
export async function update(id: bigint, data: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = { ...data }
  if (cleaned.branchId) cleaned.branchId = BigInt(cleaned.branchId as number)
  // Remove fields that shouldn't be updated directly
  delete cleaned.password
  delete cleaned.passwordCopy
  delete cleaned.loginid
  delete cleaned.username

  const user = await prisma.user.update({ where: { id }, data: cleaned })
  return bigintFix(user)
}

// ─── DELETE USER (soft delete) ────────────────────────────────────────────────
export async function deleteUser(id: bigint) {
  await prisma.user.update({ where: { id }, data: { status: 0 } })
}

// ─── GET COUNSELLORS (for assignment) ────────────────────────────────────────
export async function getCounsellors(branchId?: number) {
  const where: Record<string, unknown> = {
    role: { in: ['counsellor', 'employee', 'franchise'] },
    status: 1,
  }
  if (branchId) where.branchId = BigInt(branchId)

  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, role: true, email: true, mobile: true },
    orderBy: { name: 'asc' },
  })
  return bigintFix(users)
}

// ─── TRANSFER ALL LEADS ───────────────────────────────────────────────────────
export async function transferAllLeads(fromUserId: bigint, toUserId: bigint) {
  // Get all assignments from source counsellor
  const assignments = await prisma.asignedLead.findMany({
    where: { clrId: fromUserId },
    select: { stdId: true },
  })

  // Create new assignments for target
  await prisma.asignedLead.createMany({
    data: assignments.map((a) => ({
      stdId: a.stdId,
      clrId: toUserId,
      leadType: 'new',
      status: 1,
    })),
    skipDuplicates: true,
  })

  // Remove old assignments
  await prisma.asignedLead.deleteMany({ where: { clrId: fromUserId } })

  return assignments.length
}
