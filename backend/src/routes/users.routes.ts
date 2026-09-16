import { Hono } from 'hono'
import path from 'path'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { superAdminOnly } from '../middleware/rbac'
import { uploadSingle } from '../middleware/upload'
import { hash } from 'bcryptjs'
import { randomUUID } from 'crypto'
import { bigintFix } from '../utils/bigint-fix'
import * as userService from '../services/users/user.service'
import { getFollowupBacklogCounts } from '../services/leads/followup-backlog.service'
import { accessibleUserIds } from '../utils/branch-scope'

export const usersRoutes = new Hono()

usersRoutes.use('*', authenticate)

// GET /api/users
usersRoutes.get('/', superAdminOnly, async (c) => {
  const role = c.req.query('role')
  const includeInactive = c.req.query('includeInactive') === '1'

  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(includeInactive ? {} : { status: 1 }),
    },
    select: {
      id: true, name: true, email: true, mobile: true,
      role: true, designation: true, branchId: true, status: true,
      loginid: true, nickName: true, automaticAsignLead: true, showFullPhone: true, locationTrackingEnabled: true, locationRequired: true,
      city: true, state: true, country: true, joiningDate: true,
      createdAt: true, passwordCopy: true,
      roles: { select: { role: true } },
    },
    orderBy: { name: 'asc' },
  })

  return c.json(users.map((u) => ({ ...u, id: Number(u.id), branchId: u.branchId ? Number(u.branchId) : null })))
})

// GET /api/users/counsellors - for lead assignment dropdowns
usersRoutes.get('/counsellors', async (c) => {
  const user = c.get('user')
  const scopeIds = user ? await accessibleUserIds(user) : null
  const assignableRoles = ['counsellor', 'sales-head', 'employee', 'franchise', 'agent']
  // Deactivated staff are hidden by default. The lead-assignment screen asks for
  // them explicitly (?includeInactive=1) because leads often still sit with a
  // counsellor who has left — the screen flags them so the admin can move those
  // leads on instead of silently assigning work to someone who is gone.
  const includeInactive = ['1', 'true'].includes((c.req.query('includeInactive') || '').toLowerCase())

  const users = await prisma.user.findMany({
    where: {
      ...(includeInactive ? {} : { status: 1 }),
      ...(scopeIds !== null ? { id: { in: scopeIds } } : {}),
      OR: [
        { roles: { some: { role: { in: assignableRoles } } } },
        { role: { in: assignableRoles } },
      ],
    },
    select: { id: true, name: true, email: true, role: true, designation: true, branchId: true, status: true },
    orderBy: { name: 'asc' },
  })

  return c.json(users.map((u) => ({
    ...u,
    id: Number(u.id),
    branchId: u.branchId ? Number(u.branchId) : null,
    active: u.status === 1,
  })))
})

// GET /api/users/:id
usersRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      roles: true,
      documents: true,
      leaves: { orderBy: { createdAt: 'desc' } },
      branch: true,
    },
  })

  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(user)
})

// GET /api/users/:id/activity?date=YYYY-MM-DD — one user's current app
// version/device, most-recent web + app login, current follow-up backlog
// (overdue/due-today/upcoming — a live snapshot, not scoped to `date`), and
// everything they did on leads that day (calls, follow-ups — with the old →
// new follow-up date, notes, comments, status changes — with old → new
// status/sub-status). Defaults to today; date is server-local (no timezone
// param). Admin/sub-admin may view anyone; everyone else may only view self.
usersRoutes.get('/:id/activity', async (c) => {
  const targetIdParam = c.req.param('id')
  const userId = BigInt(targetIdParam)
  const { userId: requesterId, role: requesterRole } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(requesterRole)
  if (!isAdmin && Number(targetIdParam) !== requesterId) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const dateParam = c.req.query('date')
  const day = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : new Date().toISOString().slice(0, 10)
  const dayStart = new Date(`${day}T00:00:00`)
  const dayEnd = new Date(`${day}T23:59:59.999`)

  const leadSelect = { select: { id: true, name: true } }

  const [targetUser, device, lastLoginWeb, lastLoginApp, calls, mobileCalls, followups, notes, comments, statusChanges] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.deviceToken.findFirst({ where: { userId }, orderBy: { lastSeenAt: 'desc' } }),
      // "Last web login" = the newest login that did NOT come from the app.
      // `browser` is nullable, and a bare `NOT: { browser: … }` compiles to SQL
      // `NOT (browser = 'Android App')`, which is NULL — not TRUE — for rows
      // with no browser recorded. Those rows are web logins too, so they have
      // to be OR'd back in or this silently reports a stale login (or none).
      prisma.loginDetail.findFirst({
        where: { userId, OR: [{ browser: null }, { browser: { not: 'Android App' } }] },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.loginDetail.findFirst({ where: { userId, browser: 'Android App' }, orderBy: { createdAt: 'desc' } }),
      prisma.callLog.findMany({
        where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
        include: { lead: leadSelect },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.mobileCall.findMany({
        where: { userId, startedAt: { gte: dayStart, lte: dayEnd } },
        include: { lead: leadSelect },
        orderBy: { startedAt: 'desc' },
      }),
      // Raw SQL so we can pull, per row, the follow-up date that was in place
      // immediately before this one on the same lead (prevFollowupDate) —
      // Prisma has no window-function support, and doing this via N+1 queries
      // would be one extra round-trip per follow-up logged that day.
      prisma.$queryRaw<Array<{
        id: bigint
        stdId: bigint
        leadName: string
        comment: string
        description: string | null
        type: string | null
        followupDate: Date | null
        prevFollowupDate: Date | null
        callAnsweredStatus: number | null
        createdAt: Date
      }>>`
        SELECT f.id, f.std_id AS "stdId", l.name AS "leadName", f.comment, f.description, f.type,
               f.followup_date AS "followupDate", f.call_answered_status AS "callAnsweredStatus",
               f.created_at AS "createdAt",
               (SELECT p.followup_date FROM lead_followups p
                WHERE p.std_id = f.std_id AND p.created_at < f.created_at
                ORDER BY p.created_at DESC LIMIT 1) AS "prevFollowupDate"
        FROM lead_followups f
        JOIN leads l ON l.id = f.std_id
        WHERE f.userid = ${userId} AND f.created_at >= ${dayStart} AND f.created_at <= ${dayEnd}
        ORDER BY f.created_at DESC
      `,
      prisma.leadNote.findMany({
        where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
        include: { lead: leadSelect },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.leadComment.findMany({
        where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
        include: { lead: leadSelect },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.leadStatusHistory.findMany({
        where: { changedById: userId, createdAt: { gte: dayStart, lte: dayEnd } },
        include: { lead: leadSelect },
        orderBy: { createdAt: 'desc' },
      }),
    ])

  if (!targetUser) return c.json({ error: 'User not found' }, 404)

  const backlog = await getFollowupBacklogCounts(userId, targetUser.role, dayStart)

  const timeline = [
    ...calls.map((r) => ({
      type: 'call',
      at: r.createdAt,
      leadId: r.leadId,
      leadName: r.lead.name,
      summary: `${r.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call — ${r.outcome}` +
        (r.durationSeconds ? ` (${r.durationSeconds}s)` : ''),
      source: 'web',
    })),
    ...mobileCalls.map((r) => ({
      type: 'call',
      at: r.startedAt,
      leadId: r.leadId,
      leadName: r.lead?.name ?? null,
      phoneNumber: r.lead ? null : r.phoneNumber,
      summary: `${r.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'} app call — ${r.status}` +
        (r.durationSec ? ` (${r.durationSec}s)` : ''),
      source: 'app',
    })),
    ...followups.map((r) => ({
      type: 'followup',
      at: r.createdAt,
      leadId: r.stdId,
      leadName: r.leadName,
      summary: `Follow-up: ${r.comment}`,
      oldFollowupDate: r.prevFollowupDate,
      newFollowupDate: r.followupDate,
      description: r.description,
      followupType: r.type,
      source: null,
    })),
    ...notes.map((r) => ({
      type: 'note',
      at: r.createdAt,
      leadId: r.leadId,
      leadName: r.lead.name,
      summary: `Note: ${r.note}`,
      source: null,
    })),
    ...comments.map((r) => ({
      type: 'comment',
      at: r.createdAt,
      leadId: r.leadId,
      leadName: r.lead.name,
      summary: `Comment: ${r.comment}`,
      source: null,
    })),
    ...statusChanges.map((r) => ({
      type: 'status',
      at: r.createdAt,
      leadId: r.leadId,
      leadName: r.lead.name,
      summary: `Status: ${r.fromStatus ?? '—'} → ${r.toStatus}` + (r.toSubStatus ? ` (${r.toSubStatus})` : ''),
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      fromSubStatus: r.fromSubStatus,
      toSubStatus: r.toSubStatus,
      reason: r.reason,
      source: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())

  return c.json(bigintFix({
    date: day,
    backlog,
    device: device
      ? {
          platform: device.platform,
          appVersion: device.appVersion,
          deviceId: device.deviceId,
          lastSeenAt: device.lastSeenAt,
        }
      : null,
    lastLoginWeb: lastLoginWeb
      ? { ip: lastLoginWeb.ip, browser: lastLoginWeb.browser, createdAt: lastLoginWeb.createdAt }
      : null,
    lastLoginApp: lastLoginApp
      ? { ip: lastLoginApp.ip, os: lastLoginApp.os, createdAt: lastLoginApp.createdAt }
      : null,
    timeline,
  }))
})

// POST /api/users
usersRoutes.post('/', superAdminOnly, async (c) => {
  const body = await c.req.json()

  if (!body.name || !body.email || !body.role) {
    return c.json({ error: 'name, email, and role are required' }, 400)
  }

  // Store email exactly as provided (only strip surrounding whitespace).
  // Login matching is case-insensitive (see auth.routes.ts), so casing here doesn't affect sign-in.
  const email = String(body.email).trim()

  // Reject duplicate email (case-insensitive) so login is unambiguous
  const emailTaken = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  })
  if (emailTaken) {
    return c.json({ error: 'A user with this email already exists' }, 409)
  }

  // Auto-generate loginid from name + 3-digit suffix; retry on collision
  const baseLogin = String(body.name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user'
  let loginid = body.loginid as string | undefined
  if (!loginid) {
    for (let i = 0; i < 6; i++) {
      const candidate = `${baseLogin}${Math.floor(100 + Math.random() * 900)}`
      const exists = await prisma.user.findFirst({ where: { loginid: candidate }, select: { id: true } })
      if (!exists) { loginid = candidate; break }
    }
    if (!loginid) loginid = `${baseLogin}${Date.now().toString().slice(-5)}`
  }

  // Auto-generate password if not provided (10 chars: letters + digits)
  const plainPassword: string = body.password || Array.from({ length: 10 }, () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return chars[Math.floor(Math.random() * chars.length)]
  }).join('')

  const hashed = await hash(plainPassword, 10)

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email,
      mobile: body.mobile,
      loginid,
      username: body.username || loginid,
      password: hashed,
      passwordCopy: plainPassword,
      role: body.role,
      designation: body.designation,
      city: body.city,
      state: body.state,
      status: 1,
      branchId: body.branchId ? BigInt(body.branchId) : null,
    },
  })

  // Add role to user_roles
  await prisma.userRole_.create({
    data: { userId: user.id, role: body.role },
  })

  return c.json({
    ...user,
    id: Number(user.id),
    branchId: user.branchId ? Number(user.branchId) : null,
    passwordCopy: plainPassword,
  }, 201)
})

// PATCH /api/users/:id
usersRoutes.patch('/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()

  const data: Record<string, unknown> = { ...body }
  if (body.password) {
    data.password = await hash(body.password, 10)
    data.passwordCopy = body.password
  }
  // branch_id is a BigInt column — coerce (and allow clearing to null).
  if ('branchId' in body) {
    data.branchId = body.branchId ? BigInt(body.branchId) : null
  }
  if ('showFullPhone' in body) {
    data.showFullPhone = Number(body.showFullPhone) ? 1 : 0
  }
  if ('showBucket' in body) {
    data.showBucket = Boolean(body.showBucket)
  }
  if ('locationTrackingEnabled' in body) {
    data.locationTrackingEnabled = Boolean(body.locationTrackingEnabled)
  }
  if ('locationRequired' in body) {
    data.locationRequired = Boolean(body.locationRequired)
  }
  delete data.id

  const user = await prisma.user.update({ where: { id }, data })
  return c.json({ ...user, id: Number(user.id) })
})

// DELETE /api/users/:id (soft delete)
usersRoutes.delete('/:id', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.user.update({ where: { id }, data: { status: 0 } })
  return c.json({ message: 'User deactivated' })
})

// PATCH /api/users/:id/role — change a user's role.
// Keeps user.role and the user_roles join table in sync (both are read by different parts of the app).
usersRoutes.patch('/:id/role', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const { role } = await c.req.json()

  const VALID_ROLES = ['admin', 'sub-admin', 'sales-head', 'counsellor', 'employee', 'franchise', 'agent', 'warehouse', 'accounts']
  if (!role || !VALID_ROLES.includes(role)) {
    return c.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, 400)
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  })
  if (!target) return c.json({ error: 'User not found' }, 404)

  // Rotate session ids so the affected user is forced to re-login. Their existing
  // JWT still encodes the OLD role; without this rotation, the promoted/demoted
  // user keeps seeing the previous role's UI on web AND mobile until they sign
  // out manually, which is why role changes "didn't take effect".
  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: {
        role,
        activeWebSessionId: randomUUID(),
        activeMobileSessionId: randomUUID(),
      },
    }),
    prisma.userRole_.deleteMany({ where: { userId: id } }),
    prisma.userRole_.create({ data: { userId: id, role } }),
  ])

  return c.json({ id: Number(id), role, previousRole: target.role })
})

// PATCH /api/users/:id/toggle-status (admin only)
usersRoutes.patch('/:id/toggle-status', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const user = await prisma.user.findUnique({ where: { id }, select: { status: true } })
  if (!user) return c.json({ error: 'Not found' }, 404)

  const updated = await prisma.user.update({
    where: { id },
    data: { status: user.status === 1 ? 0 : 1 },
    select: { id: true, status: true },
  })
  return c.json({ id: Number(updated.id), status: updated.status })
})

// PATCH /api/users/:id/password (admin resets user password)
usersRoutes.patch('/:id/password', superAdminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const { password } = await c.req.json()
  if (!password || password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

  const hashed = await hash(password, 10)
  await prisma.user.update({ where: { id }, data: { password: hashed, passwordCopy: password } })
  return c.json({ message: 'Password updated' })
})

// POST /api/users/:id/photo — upload profile photo. Owner or admin only.
usersRoutes.post('/:id/photo', uploadSingle('file'), async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  if (!isAdmin && Number(id) !== userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as any)?.incoming as any)?.file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  const filepath = `/uploads/${path.basename(file.filename)}`
  const updated = await prisma.user.update({
    where: { id },
    data: { imgpath: filepath },
    select: { id: true, imgpath: true },
  })
  return c.json({ id: Number(updated.id), imgpath: updated.imgpath })
})

// DELETE /api/users/:id/photo — clear profile photo
usersRoutes.delete('/:id/photo', async (c) => {
  const id = BigInt(c.req.param('id'))
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  if (!isAdmin && Number(id) !== userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await prisma.user.update({ where: { id }, data: { imgpath: null } })
  return c.json({ message: 'Photo removed' })
})

// GET /api/users/:id/lead-count
usersRoutes.get('/:id/lead-count', superAdminOnly, async (c) => {
  const clrId = BigInt(c.req.param('id'))

  const [total, today, thisMonth] = await Promise.all([
    prisma.asignedLead.count({ where: { clrId } }),
    prisma.asignedLead.count({
      where: { clrId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.asignedLead.count({
      where: { clrId, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
    }),
  ])

  return c.json({ total, today, thisMonth })
})

// ─── Branch access (which branches a sub-admin / sales-head may oversee) ──────
// GET /api/users/:id/branch-access → list of branch ids assigned to this user.
usersRoutes.get('/:id/branch-access', superAdminOnly, async (c) => {
  const userId = BigInt(c.req.param('id'))
  const rows = await prisma.userBranchAccess.findMany({
    where: { userId },
    select: { branchId: true },
  })
  return c.json(rows.map((r) => Number(r.branchId)))
})

// PUT /api/users/:id/branch-access { branchIds: number[] } → replace the whole
// set of branches this manager can oversee.
usersRoutes.put('/:id/branch-access', superAdminOnly, async (c) => {
  const userId = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const branchIds: bigint[] = Array.isArray(body.branchIds)
    ? body.branchIds
        .map((v: unknown) => { const n = Number(v); return Number.isFinite(n) ? BigInt(n) : null })
        .filter((v: bigint | null): v is bigint => v !== null)
    : []

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!target) return c.json({ error: 'User not found' }, 404)

  await prisma.$transaction([
    prisma.userBranchAccess.deleteMany({ where: { userId } }),
    ...(branchIds.length
      ? [prisma.userBranchAccess.createMany({
          data: branchIds.map((branchId) => ({ userId, branchId })),
          skipDuplicates: true,
        })]
      : []),
  ])

  return c.json({ userId: Number(userId), branchIds: branchIds.map(Number) })
})
