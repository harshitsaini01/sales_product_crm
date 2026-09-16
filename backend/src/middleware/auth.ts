import { createMiddleware } from 'hono/factory'
import { verify, TokenExpiredError } from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import type { JWTPayload } from '../types'

declare module 'hono' {
  interface ContextVariableMap {
    user: JWTPayload
  }
}

// Checks whether the token's `sid` still matches the user's active session
// column. Returns a reason string on failure, or null when the session is valid.
export async function checkSessionValidity(
  payload: JWTPayload,
  kind: 'web' | 'mobile',
): Promise<string | null> {
  // A super admin acting as this customer gets a short-lived token of its own.
  // It must NOT be matched against active_web_session_id: doing so would either
  // fail (the real user is not signed in) or, worse, require rotating their
  // session id and silently sign the real user out.
  if (payload.impersonatedBy) return null

  // Tokens minted before this feature shipped don't carry sid → force re-login.
  if (!payload.sid) return 'Session invalid'
  const user = await prisma.user.findUnique({
    where: { id: BigInt(payload.userId) },
    select: { activeWebSessionId: true, activeMobileSessionId: true },
  })
  const active = kind === 'mobile' ? user?.activeMobileSessionId : user?.activeWebSessionId
  if (!user || !active || active !== payload.sid) return 'Signed in on another device'
  return null
}

// Reject the request when its token's `sid` doesn't match the user's active
// session column. Returns true to continue, false if a 401 was already sent.
async function checkSession(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
  payload: JWTPayload,
  kind: 'web' | 'mobile',
): Promise<Response | null> {
  const reason = await checkSessionValidity(payload, kind)
  if (reason) return c.json({ error: reason, reason: 'session_invalidated' }, 401)
  return null
}

export const authenticate = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header', reason: 'token_missing' }, 401)
  }

  const token = authHeader.slice(7)

  let payload: JWTPayload
  try {
    payload = verify(token, process.env.JWT_SECRET!) as JWTPayload
  } catch (err) {
    // Same rationale as the mobile middleware: a client can only stop retrying
    // a 401 it can classify. Expiry gets its own reason so the web app can drop
    // straight to Login instead of surfacing a generic error.
    if (err instanceof TokenExpiredError) {
      return c.json({ error: 'Session expired, please sign in again', reason: 'token_expired' }, 401)
    }
    return c.json({ error: 'Invalid token', reason: 'token_invalid' }, 401)
  }

  const denied = await checkSession(c, payload, 'web')
  if (denied) return denied

  c.set('user', payload)
  await next()
})

// Accepts either the web JWT (signed with JWT_SECRET, no audience) or the
// mobile JWT (signed with JWT_MOBILE_SECRET, audience='mobile'). Useful for
// endpoints that both the web admin and the mobile app need to call —
// e.g. recording playback, app-release downloads.
// Verifies a raw token as either the web or mobile JWT. Shared by the
// authenticateAny middleware and by routes that need to accept the token
// via a query param (e.g. <a href> downloads) instead of a header.
export type AnyTokenResult =
  | { ok: true; payload: JWTPayload; kind: 'web' | 'mobile' }
  | { ok: false; reason: 'token_expired' | 'token_invalid' }

export function verifyAnyToken(token: string): AnyTokenResult {
  const webSecret = process.env.JWT_SECRET!
  // Mirrors signMobileToken's fallback so verification and signing can never
  // disagree about which secret a mobile token was minted with.
  const mobileSecret = process.env.JWT_MOBILE_SECRET || webSecret
  let sawExpired = false

  // Mobile FIRST. The web verify passes no `audience` option, and jsonwebtoken
  // only checks an audience when you ask it to — so when JWT_MOBILE_SECRET is
  // unset (or happens to equal JWT_SECRET) a *mobile* token sails straight
  // through the web branch and gets labelled kind:'web'. Its `sid` is then
  // compared against activeWebSessionId, never matches, and every mobile call
  // to an authenticateAny route 401s with "Signed in on another device" — which
  // is what /api/app-releases/latest was doing. Trying the audience-scoped
  // verify first is correct under every secret configuration: a web token
  // carries no `aud`, so it can never satisfy the mobile branch.
  try {
    return { ok: true, payload: verify(token, mobileSecret, { audience: 'mobile' }) as JWTPayload, kind: 'mobile' }
  } catch (err) {
    if (err instanceof TokenExpiredError) sawExpired = true
  }
  try {
    return { ok: true, payload: verify(token, webSecret) as JWTPayload, kind: 'web' }
  } catch (err) {
    if (err instanceof TokenExpiredError) sawExpired = true
  }
  return { ok: false, reason: sawExpired ? 'token_expired' : 'token_invalid' }
}

export const authenticateAny = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header', reason: 'token_missing' }, 401)
  }
  const token = authHeader.slice(7)

  const result = verifyAnyToken(token)
  if (!result.ok) {
    return c.json({
      error: result.reason === 'token_expired' ? 'Session expired, please sign in again' : 'Invalid token',
      reason: result.reason,
    }, 401)
  }

  const denied = await checkSession(c, result.payload, result.kind)
  if (denied) return denied

  c.set('user', result.payload)
  await next()
})
