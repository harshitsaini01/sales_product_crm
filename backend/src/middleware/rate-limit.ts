import type { Context, MiddlewareHandler } from 'hono'

interface Bucket {
  count: number
  resetAt: number
}

/**
 * Counters live in this process only.
 *
 * Under PM2 cluster mode each worker keeps its own Map, so the real ceiling is
 * roughly `max × worker count` and a caller can be spread across workers by the
 * load balancer. That is fine for the coarse anti-scraping limits here, but it
 * means these numbers are a speed bump, not an enforcement boundary — anything
 * that must hold exactly (per-seat billing, hard API quotas for a tenant) needs
 * shared state in Redis or Postgres instead.
 */
const buckets = new Map<string, Bucket>()

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}, 60_000).unref?.()

function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('x-real-ip') || 'unknown'
}

/**
 * Every limiter gets its own bucket namespace.
 *
 * All limiters share one module-level Map, and the key used to be derived only
 * from the request (ip + path). Two limiters mounted on the SAME path therefore
 * incremented ONE counter: the login route carried a wildcard limiter (120/min)
 * plus a stricter login limiter (5/min), so each attempt counted twice and the
 * effective ceiling was two or three tries — not the five the comment claimed.
 * A counsellor who mistyped their password twice was locked out for a minute.
 */
let nextInstanceId = 0

/**
 * Resolves the thing being protected, so the limit can key on it instead of the
 * caller's IP. Return null to fall back to IP keying.
 */
export type SubjectResolver = (c: Context) => Promise<string | null> | string | null

/**
 * Key a login limiter on the ACCOUNT being targeted rather than the caller's IP.
 *
 * Brute force is per-account, but NAT is per-IP: a whole office shares one
 * public address, so an IP-keyed login limit throttles colleagues instead of
 * attackers. At six counsellors that never showed; at one company with twenty
 * people signing in at 9am it is a morning of failed logins.
 *
 * Reading the body here is safe — Hono caches the parsed JSON on the request, so
 * the zValidator and the handler still see it. A body that will not parse yields
 * null and the limiter falls back to IP, leaving the validator to reject it.
 */
export function loginSubject(field: string): SubjectResolver {
  return async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown> | null
      const raw = body?.[field]
      if (typeof raw !== 'string') return null
      const id = raw.trim().toLowerCase()
      return id ? `login:${id}` : null
    } catch {
      return null
    }
  }
}

export function rateLimit(opts: {
  windowMs: number
  max: number
  keyBy?: 'ip' | 'user'
  subject?: SubjectResolver
}): MiddlewareHandler {
  const { windowMs, max, keyBy = 'ip', subject } = opts
  const ns = `rl${nextInstanceId++}`

  return async (c, next) => {
    let scope: string | null = null

    if (subject) {
      const resolved = await subject(c)
      if (resolved) scope = resolved
    }
    if (!scope && keyBy === 'user') {
      const u = c.get('user') as { userId?: number } | undefined
      if (u?.userId) scope = `u:${u.userId}`
    }
    if (!scope) scope = `ip:${clientIp(c)}:${c.req.path}`

    const key = `${ns}:${scope}`
    const now = Date.now()
    const b = buckets.get(key)
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
    } else {
      b.count++
      if (b.count > max) {
        const retryAfter = Math.ceil((b.resetAt - now) / 1000)
        c.header('Retry-After', String(retryAfter))
        return c.json({ error: 'Too many requests', retryAfter }, 429)
      }
    }
    await next()
  }
}
