import { createMiddleware } from 'hono/factory'
import { verify, sign, TokenExpiredError, type SignOptions } from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import type { JWTPayload } from '../types'

const MOBILE_AUDIENCE = 'mobile'

/**
 * Machine-readable 401 reasons.
 *
 * The app can only react to a 401 it can classify. Before these existed, an
 * expired JWT came back as a bare `{error: 'Invalid or expired mobile token'}`,
 * which the client could not tell apart from a transient backend blip — so it
 * kept the dead token, stayed "logged in", and every poller (home overview,
 * today's followups, activity ping, location upload, lead-work batches) went on
 * hammering the API forever. That zombie loop was the bulk of our 401 volume.
 *
 * Every one of these means "this token will never work again — sign in".
 */
export const AUTH_FATAL_REASONS = ['token_missing', 'token_expired', 'token_invalid', 'session_invalidated'] as const

export function signMobileToken(payload: JWTPayload): string {
  const secret = process.env.JWT_MOBILE_SECRET || process.env.JWT_SECRET!
  const opts: SignOptions = {
    audience: MOBILE_AUDIENCE,
    expiresIn: (process.env.JWT_MOBILE_EXPIRES_IN || '30d') as SignOptions['expiresIn'],
  }
  return sign(payload, secret, opts)
}

export const authenticateMobile = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header', reason: 'token_missing' }, 401)
  }
  const token = authHeader.slice(7)
  const secret = process.env.JWT_MOBILE_SECRET || process.env.JWT_SECRET!

  let payload: JWTPayload
  try {
    payload = verify(token, secret, { audience: MOBILE_AUDIENCE }) as JWTPayload
  } catch (err) {
    // Expiry is the common, expected case (mobile tokens live JWT_MOBILE_EXPIRES_IN,
    // 30d by default, and there is no refresh flow). Name it explicitly so the app
    // clears the session and shows Login instead of retrying forever.
    if (err instanceof TokenExpiredError) {
      return c.json({ error: 'Session expired, please sign in again', reason: 'token_expired' }, 401)
    }
    return c.json({ error: 'Invalid mobile token', reason: 'token_invalid' }, 401)
  }

  if (!payload.sid) {
    return c.json({ error: 'Session invalid', reason: 'session_invalidated' }, 401)
  }
  const user = await prisma.user.findUnique({
    where: { id: BigInt(payload.userId) },
    select: { activeMobileSessionId: true },
  })
  if (!user || user.activeMobileSessionId !== payload.sid) {
    return c.json({ error: 'Signed in on another device', reason: 'session_invalidated' }, 401)
  }

  c.set('user', payload)
  await next()
})
