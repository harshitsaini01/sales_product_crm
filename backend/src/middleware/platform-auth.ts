// ─────────────────────────────────────────────────────────────────────────────
// Super admin authentication.
//
// Platform tokens are signed with their OWN secret and carry scope:'platform'.
// Two independent guards therefore stand between a customer and the control
// plane: a tenant token fails the signature check here, and a platform token is
// rejected by tenantMiddleware before it can reach any customer route.
// ─────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import { sign, verify, TokenExpiredError, type SignOptions } from 'jsonwebtoken'
import { platformPrisma } from '../lib/platform'

export interface PlatformJWTPayload {
  platformUserId: number
  name: string
  email: string
  isRoot: boolean
  sid: string
  scope: 'platform'
}

declare module 'hono' {
  interface ContextVariableMap {
    platformUser: PlatformJWTPayload
  }
}

function platformSecret(): string {
  const secret = process.env.JWT_PLATFORM_SECRET
  if (secret) return secret

  // Deriving from JWT_SECRET keeps a fresh install working, but the derived key
  // must never equal JWT_SECRET itself or a tenant token could be replayed as a
  // platform token.
  const base = process.env.JWT_SECRET
  if (!base) throw new Error('JWT_PLATFORM_SECRET (or JWT_SECRET) must be set')
  return `platform::${base}`
}

export function signPlatformToken(payload: Omit<PlatformJWTPayload, 'scope'>): string {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_PLATFORM_EXPIRES_IN || '12h') as SignOptions['expiresIn'],
  }
  return sign({ ...payload, scope: 'platform' }, platformSecret(), options)
}

export const authenticatePlatform = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header', reason: 'token_missing' }, 401)
  }

  let payload: PlatformJWTPayload
  try {
    payload = verify(header.slice(7), platformSecret()) as PlatformJWTPayload
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      return c.json({ error: 'Session expired, please sign in again', reason: 'token_expired' }, 401)
    }
    return c.json({ error: 'Invalid token', reason: 'token_invalid' }, 401)
  }

  if (payload.scope !== 'platform') {
    return c.json({ error: 'Invalid token', reason: 'token_invalid' }, 401)
  }

  // Same single-session rule the customer app uses: signing in anywhere else
  // invalidates this token.
  const user = await platformPrisma.platformUser.findUnique({
    where: { id: BigInt(payload.platformUserId) },
    select: { status: true, activeSessionId: true },
  })

  if (!user || user.status !== 1) {
    return c.json({ error: 'Account disabled', reason: 'account_disabled' }, 401)
  }
  if (!payload.sid || user.activeSessionId !== payload.sid) {
    return c.json({ error: 'Signed in on another device', reason: 'session_invalidated' }, 401)
  }

  c.set('platformUser', payload)
  await next()
})

/** Guards the handful of actions only the root super admin may take. */
export const rootPlatformOnly = createMiddleware(async (c, next) => {
  const user = c.get('platformUser')
  if (!user?.isRoot) {
    return c.json({ error: 'Only the root super admin can do that' }, 403)
  }
  await next()
})
