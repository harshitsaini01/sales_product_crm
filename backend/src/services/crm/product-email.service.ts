// Resolve {{product:SKU}} / {{product:id}} and {{product_grid}} in HTML at send time
// so catalog photos and prices stay current.

import { prisma } from '../../lib/prisma'

const n = (v: unknown) => (v == null ? 0 : Number(v))
const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function absUrl(u?: string | null): string {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const path = u.startsWith('/') ? u : `/${u}`
  return base ? `${base}${path.replace(/^\/uploads\//, '/api/uploads/')}` : path
}

export function productCardHtml(p: {
  name: string
  sku?: string | null
  imageUrl?: string | null
  shortDescription?: string | null
  description?: string | null
  unitPrice?: unknown
  currency?: string | null
}): string {
  const price = n(p.unitPrice)
  const money = `${p.currency === 'INR' || !p.currency ? '₹' : `${p.currency} `}${price.toLocaleString('en-IN', { minimumFractionDigits: 0 })}`
  const img = absUrl(p.imageUrl)
    ? `<img src="${esc(absUrl(p.imageUrl))}" alt="${esc(p.name)}" width="160" height="160" style="display:block;width:160px;height:160px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0" />`
    : `<div style="width:160px;height:160px;border-radius:10px;background:#f1f5f9;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:12px">No photo</div>`
  const desc = (p.shortDescription || p.description || '').trim()
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;margin:8px 0;max-width:420px">
  <tr>
    <td style="padding:12px;vertical-align:top">${img}</td>
    <td style="padding:12px 16px 12px 0;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
      <div style="font-size:16px;font-weight:700;color:#0f172a">${esc(p.name)}</div>
      ${desc ? `<div style="font-size:13px;color:#475569;margin-top:6px">${esc(desc)}</div>` : ''}
      <div style="font-size:18px;font-weight:700;color:#4f46e5;margin-top:8px">${money}</div>
    </td>
  </tr>
</table>`
}

export async function resolveProductTokens(html: string, extraIds: Array<number | bigint> = []): Promise<string> {
  if (!html && !extraIds.length) return html
  let out = html || ''

  const skuMatches = [...out.matchAll(/\{\{\s*product:([a-zA-Z0-9._-]+)\s*\}\}/g)]
  const ids = new Set<string>(extraIds.map(String))
  const skus = new Set<string>()
  for (const m of skuMatches) {
    const token = m[1]
    if (/^\d+$/.test(token)) ids.add(token)
    else skus.add(token)
  }

  const wantGrid = /\{\{\s*product_grid\s*\}\}/.test(out)
  if (!ids.size && !skus.size && !wantGrid) return out

  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(!wantGrid && (ids.size || skus.size)
        ? {
            OR: [
              ...(ids.size ? [{ id: { in: [...ids].map((id) => BigInt(id)) } }] : []),
              ...(skus.size ? [{ sku: { in: [...skus] } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 500,
  })

  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku as string, p]))
  const byId = new Map(products.map((p) => [String(p.id), p]))

  out = out.replace(/\{\{\s*product:([a-zA-Z0-9._-]+)\s*\}\}/g, (_all, token: string) => {
    const p = /^\d+$/.test(token) ? byId.get(token) : bySku.get(token)
    return p ? productCardHtml(p) : ''
  })

  if (/\{\{\s*product_grid\s*\}\}/.test(out)) {
    const gridSource =
      extraIds.length
        ? extraIds.map((id) => byId.get(String(id))).filter(Boolean)
        : products
    const grid = `<div>${gridSource.map((p) => (p ? productCardHtml(p) : '')).join('')}</div>`
    out = out.replace(/\{\{\s*product_grid\s*\}\}/g, grid)
  }

  const collMatches = [...out.matchAll(/\{\{\s*collection:([a-zA-Z0-9._-]+)\s*\}\}/g)]
  if (collMatches.length) {
    const slugs = [...new Set(collMatches.map((m) => m[1]))]
    const collProducts = await prisma.product.findMany({
      where: { active: true, collection: { in: slugs } },
      take: 24,
    })
    const byColl = new Map<string, typeof collProducts>()
    for (const p of collProducts) {
      const k = p.collection || ''
      const list = byColl.get(k) ?? []
      list.push(p)
      byColl.set(k, list)
    }
    out = out.replace(/\{\{\s*collection:([a-zA-Z0-9._-]+)\s*\}\}/g, (_all, slug: string) => {
      const list = byColl.get(slug) ?? []
      return list.length ? `<div>${list.map((p) => productCardHtml(p)).join('')}</div>` : ''
    })
  }

  return out
}

export const SALES_TOKENS = [
  { key: 'name', label: 'Contact name' },
  { key: 'firstName', label: 'First name' },
  { key: 'email', label: 'Email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'company', label: 'Company' },
  { key: 'quote_number', label: 'Quote number' },
  { key: 'quote_link', label: 'Quote accept link' },
  { key: 'order_number', label: 'Order number' },
  { key: 'invoice_number', label: 'Invoice number' },
  { key: 'invoice_link', label: 'Invoice link' },
  { key: 'tracking_number', label: 'Tracking number' },
  { key: 'delivery_status', label: 'Delivery status' },
  { key: 'amount_due', label: 'Amount due' },
  { key: 'product_grid', label: 'Product grid (from template products)' },
  { key: 'collection:best-sellers', label: 'Collection: best-sellers' },
]

export function applySalesTokens(html: string, vars: Record<string, string | null | undefined>): string {
  let out = html
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'gi'), esc(v ?? ''))
  }
  return out
}
