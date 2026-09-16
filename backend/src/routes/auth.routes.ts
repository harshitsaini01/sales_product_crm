import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { compare, hash } from 'bcryptjs'
import { sign, verify, type SignOptions } from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { authenticate } from '../middleware/auth'
import { rateLimit, loginSubject } from '../middleware/rate-limit'
import { emailService } from '../services/email.service'
import { superAdminOnly } from '../middleware/rbac'
import { platformPrisma } from '../lib/platform'
import { sanitizeLeadFieldConfig, hiddenFieldKeys } from '../config/lead-fields'
import { resolveTerms } from '../config/terminology'
import { signPlatformToken } from '../middleware/platform-auth'
import {
  runWithTenant,
  TenantUnavailableError,
  currentTenant,
  type TenantContext,
} from '../lib/tenant-context'
import {
  assertTenantUsable,
  getPrimaryTenant,
  getTenantById,
  tenantsForLoginIdentifier,
} from '../services/tenant.service'

// In-memory OTP store: "<tenantId>:<email>" → { otp, expiresAt, attempts }.
// Keyed by tenant as well as email because the same address can legitimately
// exist at two different customers.
const otpStore = new Map<string, { otp: string; expiresAt: number; attempts: number }>()
const otpKey = (tenantId: number, email: string) => `${tenantId}:${email}`
const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
const OTP_MAX_ATTEMPTS = 5

// ─── BigInt → number serializer (Prisma returns BigInt for IDs) ────────────────────
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

export const authRoutes = new Hono()

const loginSchema = z.object({
  loginid: z.string().min(1),
  password: z.string().min(1),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
})

// Brute-force defence on the web admin login, which had none at all — the mobile
// login was rate limited but this one, the way into the ADMIN surface, was open
// to unlimited password guessing. Keyed on the targeted account rather than the
// caller's IP: an attacker rotating IPs still burns one account's budget, and a
// shared office address does not throttle real staff. The per-IP ceiling below
// bounds total login traffic from any single address.
authRoutes.use('/login', rateLimit({ windowMs: 60_000, max: 10, subject: loginSubject('loginid') }))
authRoutes.use('/login', rateLimit({ windowMs: 60_000, max: 60 }))

// Password reset is the same guessing surface by another door — OTP codes are
// short, so an unbounded verify endpoint is brute-forceable even with the
// per-email attempt counter the handler keeps.
authRoutes.use('/forgot-password', rateLimit({ windowMs: 60_000, max: 5, subject: loginSubject('email') }))
authRoutes.use('/verify-otp', rateLimit({ windowMs: 60_000, max: 10, subject: loginSubject('email') }))

// ─── Tenant resolution for the shared login page ──────────────────────────────

const tenantsForIdentifier = tenantsForLoginIdentifier

/**
 * The original single-tenant login, unchanged apart from the tenant fields now
 * baked into the JWT. Returns null when this customer does not have the user or
 * the password does not match, so the caller can try the next candidate.
 */
async function attemptTenantLogin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  ctx: TenantContext,
  identifier: string,
  password: string,
) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { loginid: identifier },
        { email: { equals: identifier, mode: 'insensitive' } },
        { username: identifier },
      ],
      status: 1,
    },
    include: { roles: true },
  })

  if (!user) return null

  const isValid = await compare(password, user.password)
  if (!isValid) return null

  const roles = user.roles.map((r) => r.role)
  const primaryRole = user.role

  // Single-session enforcement: rotate the web session id on every successful login.
  // Any previously-issued web JWT for this user immediately becomes invalid (the
  // auth middleware compares JWT.sid against users.active_web_session_id).
  const sid = randomUUID()
  await prisma.user.update({
    where: { id: user.id },
    data: { activeWebSessionId: sid },
  })

  const signOptions: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'] }
  const token = sign(
    {
      userId: Number(user.id),
      role: primaryRole,
      roles,
      name: user.name,
      email: user.email,
      sid,
      kind: 'web',
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
    },
    process.env.JWT_SECRET!,
    signOptions
  )

  // Log login
  await prisma.loginDetail.create({
    data: {
      userId: user.id,
      ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '',
      browser: c.req.header('user-agent')?.substring(0, 100) || '',
    },
  })

  return c.json(bigintFix({
    token,
    scope: 'tenant',
    tenant: {
      id: ctx.tenantId,
      slug: ctx.slug,
      name: ctx.companyName,
      planName: ctx.planName,
      planExpiresAt: ctx.planExpiresAt,
      vertical: ctx.vertical,
    },
    features: ctx.features,
    labels: resolveTerms(ctx.labels),
    leadFields: {
      ...sanitizeLeadFieldConfig(ctx.leadFields),
      hiddenFieldKeys: hiddenFieldKeys(ctx.leadFields),
    },
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: primaryRole,
      roles,
      branchId: user.branchId ? Number(user.branchId) : null,
      showFullPhone: user.showFullPhone ?? 0,
      showBucket: user.showBucket,
    },
  }))
}

/** Super admins live in the platform schema, not in any customer's users table. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function attemptPlatformLogin(c: any, identifier: string, password: string) {
  if (!identifier.includes('@')) return null
  try {

  const admin = await platformPrisma.platformUser.findFirst({
    where: { email: { equals: identifier, mode: 'insensitive' }, status: 1 },
  })
  if (!admin) return null

  const isValid = await compare(password, admin.password)
  if (!isValid) return null

  const sid = randomUUID()
  await platformPrisma.platformUser.update({
    where: { id: admin.id },
    data: { activeSessionId: sid, lastLoginAt: new Date() },
  })

  const token = signPlatformToken({
    platformUserId: Number(admin.id),
    name: admin.name,
    email: admin.email,
    isRoot: admin.isRoot,
    sid,
  })

  return c.json({
    token,
    scope: 'platform',
    user: {
      id: Number(admin.id),
      name: admin.name,
      email: admin.email,
      isRoot: admin.isRoot,
    },
  })
  } catch {
    return null
  }
}

// POST /api/auth/login
//
// ONE login page for everyone. The account itself decides where you land:
// a super admin gets a platform token and the /super panel, everybody else is
// matched to their customer via the platform directory and gets the app.
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { loginid, password } = c.req.valid('json')
  const trimmed = loginid.trim()

  const asPlatform = await attemptPlatformLogin(c, trimmed, password)
  if (asPlatform) return asPlatform

  const tenants = await tenantsForIdentifier(trimmed)

  // Remembered so that a suspended or expired customer gets told exactly that
  // instead of a misleading "invalid credentials".
  let blocked: TenantUnavailableError | null = null

  for (const ctx of tenants) {
    try {
      assertTenantUsable(ctx)
    } catch (err) {
      if (err instanceof TenantUnavailableError) {
        blocked = err
        continue
      }
      throw err
    }

    const response = await runWithTenant(ctx, () => attemptTenantLogin(c, ctx, trimmed, password))
    if (response) return response
  }

  if (blocked) return c.json({ error: blocked.message, reason: blocked.reason }, 403)
  return c.json({ error: 'Invalid credentials' }, 401)
})

// GET /api/auth/me
authRoutes.get('/me', authenticate, async (c) => {
  const { userId } = c.get('user')

  const user = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      role: true,
      designation: true,
      branchId: true,
      showFullPhone: true,
      showBucket: true,
      roles: { select: { role: true } },
    },
  })

  if (!user) return c.json({ error: 'User not found' }, 404)

  // The tenant block is what drives the frontend's feature gating — the sidebar
  // hides modules the customer's plan does not include, and the router
  // redirects their routes.
  const ctx = currentTenant()

  return c.json(bigintFix({
    ...user,
    id: Number(user.id),
    branchId: user.branchId ? Number(user.branchId) : null,
    roles: user.roles.map((r) => r.role),
    tenant: ctx
      ? {
          id: ctx.tenantId,
          slug: ctx.slug,
          name: ctx.companyName,
          planName: ctx.planName,
          planExpiresAt: ctx.planExpiresAt,
          isPrimary: ctx.isPrimary,
          vertical: ctx.vertical,
        }
      : null,
    features: ctx?.features ?? {},
    // Resolved to a COMPLETE map, not just the deviations, because the client
    // renders these strings directly — it has no catalogue of its own to fall
    // back to, unlike leadFields below where it does.
    labels: resolveTerms(ctx?.labels),
    // Just the deviations from "show everything" — the client keeps its own
    // labels and field order and only needs to know what to hide. A change made
    // in the super admin panel reaches the customer on their next /auth/me, so
    // no re-login is needed.
    leadFields: {
      ...sanitizeLeadFieldConfig(ctx?.leadFields),
      // Groups flattened into field keys, so the client never has to know which
      // group a field belongs to in order to hide it correctly.
      hiddenFieldKeys: hiddenFieldKeys(ctx?.leadFields),
    },
    impersonatedBy: ctx?.impersonatedBy ?? null,
  }))
})

// ─── Forgot-password flow ─────────────────────────────────────────────────────

const forgotPasswordSchema = z.object({ email: z.string().email() })
const verifyOtpSchema = z.object({ email: z.string().email(), otp: z.string().length(6) })
const resetPasswordSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(6),
})

// POST /api/auth/forgot-password — send a 6-digit OTP to the user's email.
// Always returns 200 so we don't leak which emails are registered.
authRoutes.post('/forgot-password', zValidator('json', forgotPasswordSchema), async (c) => {
  const { email } = c.req.valid('json')
  const normalized = email.trim().toLowerCase()

  // Tokenless request, so no tenant context has been established yet — resolve
  // it from the address the same way login does.
  const candidates = await tenantsForIdentifier(normalized)
  const ctx = candidates[0] ?? (await getPrimaryTenant())

  const user = await runWithTenant(ctx, () =>
    prisma.user.findFirst({ where: { email: normalized, status: 1 } }),
  )

  if (user) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    otpStore.set(otpKey(ctx.tenantId, normalized), {
      otp,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    })

    try {
      await emailService.send({
        to: normalized,
        subject: 'Tutelage CRM — Password Reset OTP',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="color:#111;">Password Reset Request</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>Use the OTP below to reset your Tutelage CRM password. It expires in 10 minutes.</p>
            <div style="font-size:28px;font-weight:bold;letter-spacing:6px;background:#f3f4f6;padding:16px;text-align:center;border-radius:6px;margin:16px 0;">
              ${otp}
            </div>
            <p style="color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      })
    } catch (err) {
      console.error('[forgot-password] email send failed:', err)
      return c.json({ error: 'Failed to send OTP email. Please try again later.' }, 500)
    }
  }

  return c.json({ message: 'If an account exists for that email, an OTP has been sent.' })
})

// POST /api/auth/verify-otp — verify OTP; returns a short-lived reset token.
authRoutes.post('/verify-otp', zValidator('json', verifyOtpSchema), async (c) => {
  const { email, otp } = c.req.valid('json')
  const normalized = email.trim().toLowerCase()

  const candidates = await tenantsForIdentifier(normalized)
  const ctx = candidates[0] ?? (await getPrimaryTenant())
  const key = otpKey(ctx.tenantId, normalized)
  const entry = otpStore.get(key)

  if (!entry || entry.expiresAt < Date.now()) {
    otpStore.delete(key)
    return c.json({ error: 'OTP expired or not found. Please request a new one.' }, 400)
  }

  entry.attempts += 1
  if (entry.attempts > OTP_MAX_ATTEMPTS) {
    otpStore.delete(key)
    return c.json({ error: 'Too many invalid attempts. Please request a new OTP.' }, 429)
  }

  if (entry.otp !== otp) {
    return c.json({ error: 'Invalid OTP.' }, 400)
  }

  otpStore.delete(key)

  // The tenant is bound into the reset token so the reset step cannot be
  // steered at a different customer's account with the same address.
  const resetToken = sign(
    { email: normalized, purpose: 'password-reset', tenantId: ctx.tenantId },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  )

  return c.json({ resetToken })
})

// POST /api/auth/reset-password — consume reset token and set the new password.
authRoutes.post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
  const { resetToken, newPassword } = c.req.valid('json')

  let payload: { email: string; purpose: string; tenantId?: number }
  try {
    payload = verify(resetToken, process.env.JWT_SECRET!) as typeof payload
  } catch {
    return c.json({ error: 'Invalid or expired reset token.' }, 400)
  }

  if (payload.purpose !== 'password-reset' || !payload.email) {
    return c.json({ error: 'Invalid reset token.' }, 400)
  }

  const ctx =
    (payload.tenantId != null ? await getTenantById(payload.tenantId) : null) ??
    (await getPrimaryTenant())

  return runWithTenant(ctx, async () => {
    const user = await prisma.user.findFirst({
      where: { email: payload.email, status: 1 },
    })
    if (!user) return c.json({ error: 'User not found.' }, 404)

    const hashed = await hash(newPassword, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, activeWebSessionId: randomUUID(), passwordCopy: newPassword },
    })

    return c.json({ message: 'Password updated successfully. You can now log in.' })
  })
})

// POST /api/auth/change-password
authRoutes.post('/change-password', authenticate, zValidator('json', changePasswordSchema), async (c) => {
  const { userId } = c.get('user')
  const { currentPassword, newPassword } = c.req.valid('json')

  const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } })
  if (!user) return c.json({ error: 'User not found' }, 404)

  const isValid = await compare(currentPassword, user.password)
  if (!isValid) return c.json({ error: 'Current password is incorrect' }, 400)

  const hashed = await hash(newPassword, 10)
  await prisma.user.update({ where: { id: BigInt(userId) }, data: { password: hashed, passwordCopy: newPassword } })

  return c.json({ message: 'Password updated successfully' })
})

// POST /api/auth/impersonate/:userId
authRoutes.post('/impersonate/:userId', authenticate, superAdminOnly, async (c) => {
  const targetUserId = c.req.param('userId')

  const user = await prisma.user.findFirst({
    where: {
      id: BigInt(targetUserId),
      status: 1, // Active users only
    },
    include: { roles: true },
  })

  if (!user) {
    return c.json({ error: 'User not found or inactive' }, 404)
  }

  const roles = user.roles.map((r) => r.role)
  const primaryRole = user.role

  const sid = randomUUID()
  await prisma.user.update({
    where: { id: user.id },
    data: { activeWebSessionId: sid },
  })

  // Stays inside the impersonating admin's own customer — this endpoint is an
  // admin acting as one of their own staff, not a super admin crossing customers.
  const ctx = currentTenant()

  const signOptions: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'] }
  const token = sign(
    {
      userId: Number(user.id),
      role: primaryRole,
      roles,
      name: user.name,
      email: user.email,
      sid,
      kind: 'web',
      tenantId: ctx?.tenantId,
      tenantSlug: ctx?.slug,
    },
    process.env.JWT_SECRET!,
    signOptions
  )

  return c.json(bigintFix({
    token,
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: primaryRole,
      roles,
      branchId: user.branchId ? Number(user.branchId) : null,
    },
  }))
})
