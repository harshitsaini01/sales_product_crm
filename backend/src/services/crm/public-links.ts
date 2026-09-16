import { createHmac, timingSafeEqual } from 'crypto'
import { currentTenant } from '../../lib/tenant-context'

function secret(): string {
  return process.env.JWT_SECRET || 'dev-secret'
}

function sign(kind: string, id: bigint | number): string {
  return createHmac('sha256', secret()).update(`${kind}:${id}`).digest('hex').slice(0, 32)
}

function token(kind: string, id: bigint | number): string {
  return `${id}.${sign(kind, id)}`
}

function verify(kind: string, raw: string): bigint | null {
  const m = /^(\d+)\.([a-f0-9]{32})$/.exec(raw || '')
  if (!m) return null
  const expected = Buffer.from(sign(kind, BigInt(m[1])))
  const given = Buffer.from(m[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return BigInt(m[1])
}

function abs(path: string): string | null {
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  if (!base) return null
  const slug = currentTenant()?.slug
  return `${base}${path}${slug ? `${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(slug)}` : ''}`
}

export function orderToken(id: bigint | number) {
  return token('order', id)
}
export function verifyOrderToken(t: string) {
  return verify('order', t)
}
export function publicOrderUrl(id: bigint | number) {
  return abs(`/api/public/orders/${orderToken(id)}`)
}

export function invoiceToken(id: bigint | number) {
  return token('invoice', id)
}
export function verifyInvoiceToken(t: string) {
  return verify('invoice', t)
}
export function publicInvoiceUrl(id: bigint | number) {
  return abs(`/api/public/invoices/${invoiceToken(id)}`)
}
