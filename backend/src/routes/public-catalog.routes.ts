import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { bigintFix } from '../services/crm/serialize'
import { serializeProduct } from '../services/crm/stock.service'
import { productCardHtml } from '../services/crm/product-email.service'

export const publicCatalogRoutes = new Hono()

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

publicCatalogRoutes.get('/', async (c) => {
  const q = c.req.query()
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(q.collection ? { collection: q.collection } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { sku: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 100,
  })
  if (c.req.query('format') === 'json') return c.json(bigintFix(products.map(serializeProduct)))

  const slug = c.req.query('t') || ''
  const cards = products.map((p) => productCardHtml(p)).join('')
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Catalog</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:880px;margin:32px auto;padding:0 16px;color:#0f172a">
  <h1>Product catalog</h1>
  <form method="get" style="margin:16px 0">
    ${slug ? `<input type="hidden" name="t" value="${esc(slug)}">` : ''}
    <input name="search" value="${esc(q.search || '')}" placeholder="Search products" style="padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;width:240px">
    <button style="padding:10px 14px;border:0;background:#4f46e5;color:#fff;border-radius:8px;font-weight:600">Search</button>
  </form>
  ${cards || '<p>No products yet.</p>'}
  <h2 style="margin-top:40px">Enquire</h2>
  <form method="post" action="${esc(new URL(c.req.url).pathname)}${slug ? `?t=${encodeURIComponent(slug)}` : ''}" style="display:grid;gap:8px;max-width:420px">
    <input name="name" required placeholder="Your name" style="padding:10px;border:1px solid #cbd5e1;border-radius:8px">
    <input name="email" type="email" placeholder="Email" style="padding:10px;border:1px solid #cbd5e1;border-radius:8px">
    <input name="mobile" placeholder="Mobile" style="padding:10px;border:1px solid #cbd5e1;border-radius:8px">
    <input name="company" placeholder="Company" style="padding:10px;border:1px solid #cbd5e1;border-radius:8px">
    <select name="sku" style="padding:10px;border:1px solid #cbd5e1;border-radius:8px">
      <option value="">Product of interest</option>
      ${products.map((p) => `<option value="${esc(p.sku || p.id)}">${esc(p.name)}</option>`).join('')}
    </select>
    <textarea name="comment" placeholder="What do you need?" rows="3" style="padding:10px;border:1px solid #cbd5e1;border-radius:8px"></textarea>
    <button style="padding:12px;border:0;background:#059669;color:#fff;border-radius:8px;font-weight:700">Send enquiry</button>
  </form>
</body></html>`)
})

publicCatalogRoutes.post('/', async (c) => {
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim().slice(0, 100)
  if (!name) return c.text('Name is required', 400)
  const sku = String(form.sku ?? '').trim()
  const product = sku
    ? await prisma.product.findFirst({
        where: /^\d+$/.test(sku) ? { OR: [{ sku }, { id: BigInt(sku) }] } : { sku },
      })
    : null
  const lead = await prisma.lead.create({
    data: {
      name,
      email: String(form.email ?? '').trim() || null,
      mobile: String(form.mobile ?? '').trim() || null,
      comment: [form.company && `Company: ${form.company}`, product && `Product: ${product.name}`, form.comment]
        .filter(Boolean)
        .join('\n') || null,
      source: 'catalog',
      website: 'catalog',
      leadType: 'new',
      leadScore: 3,
    },
  })
  return c.html(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
    <h1>Thanks, ${esc(name)}</h1>
    <p>We have your enquiry${product ? ` for ${esc(product.name)}` : ''}. A sales rep will be in touch.</p>
    <p style="color:#94a3b8;font-size:12px">Ref #${Number(lead.id)}</p>
  </body></html>`)
})
