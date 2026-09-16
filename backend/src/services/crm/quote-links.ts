// ─────────────────────────────────────────────────────────────────────────────
// The customer-facing quote link.
//
// A quote emailed as HTML is read once and buried. A link the customer can
// open, re-open, and ACCEPT from — without a login — is what turns "did they
// see it?" into a timestamp and "are they going ahead?" into a click.
//
// NO NEW COLUMN. The token is an HMAC of the quote id under the platform's JWT
// secret, so it needs no storage, cannot be guessed, and is invalidated the day
// the secret rotates. `t=<slug>` names the customer, the same way the tracking
// pixel and the public university-application routes already do it.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto'
import { currentTenant } from '../../lib/tenant-context'

function secret(): string {
  return process.env.JWT_SECRET || 'dev-secret'
}

function sign(id: bigint | number): string {
  return createHmac('sha256', secret()).update(`quote:${id}`).digest('hex').slice(0, 32)
}

export function quoteToken(id: bigint | number): string {
  return `${id}.${sign(id)}`
}

/** The quote id a token names, or null when it was forged or mistyped. */
export function verifyQuoteToken(token: string): bigint | null {
  const m = /^(\d+)\.([a-f0-9]{32})$/.exec(token || '')
  if (!m) return null
  const expected = Buffer.from(sign(BigInt(m[1])))
  const given = Buffer.from(m[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return BigInt(m[1])
}

/** Absolute URL of the public page, with the customer pinned in the query. */
export function publicQuoteUrl(id: bigint | number): string | null {
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  if (!base) return null
  const slug = currentTenant()?.slug
  return `${base}/api/public/quotes/${quoteToken(id)}${slug ? `?t=${encodeURIComponent(slug)}` : ''}`
}
