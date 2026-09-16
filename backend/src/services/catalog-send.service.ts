import { prisma } from '../lib/prisma'
import { emailService } from './email.service'
import { markLeadBySlug } from './leads/lifecycle.service'
import { currentTenant } from '../lib/tenant-context'
import { resolveProductTokens } from './crm/product-email.service'

const n = (v: unknown) => (v == null ? 0 : Number(v))
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function absUrl(u?: string | null): string {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const path = u.startsWith('/') ? u : `/${u}`
  return base ? `${base}${path.replace(/^\/uploads\//, '/api/uploads/')}` : path
}

function money(price: number, currency?: string | null): string {
  const symbol = currency === 'INR' || !currency ? '₹' : `${currency} `
  return `${symbol}${price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function productCardHtml(p: {
  name: string
  description?: string | null
  unitPrice?: unknown
  currency?: string | null
  imageUrl?: string | null
}): string {
  const img = absUrl(p.imageUrl)
    ? `<img src="${esc(absUrl(p.imageUrl))}" alt="${esc(p.name)}" width="160" height="160" style="display:block;width:160px;height:160px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0" />`
    : `<div style="width:160px;height:160px;border-radius:10px;background:#f1f5f9;color:#94a3b8;font-size:12px;text-align:center;line-height:160px">No photo</div>`
  const desc = (p.description || '').trim()
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;margin:8px 0;max-width:480px">
  <tr>
    <td style="padding:12px;vertical-align:top">${img}</td>
    <td style="padding:12px 16px 12px 0;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
      <div style="font-size:16px;font-weight:700;color:#0f172a">${esc(p.name)}</div>
      ${desc ? `<div style="font-size:13px;color:#475569;margin-top:6px">${esc(desc)}</div>` : ''}
      <div style="font-size:18px;font-weight:700;color:#4f46e5;margin-top:8px">${esc(money(n(p.unitPrice), p.currency))}</div>
    </td>
  </tr>
</table>`
}

function whatsappLine(p: { name: string; description?: string | null; unitPrice?: unknown; currency?: string | null }): string {
  const desc = (p.description || '').trim()
  return desc
    ? `${p.name} — ${money(n(p.unitPrice), p.currency)}\n${desc}`
    : `${p.name} — ${money(n(p.unitPrice), p.currency)}`
}

function waPhone(mobile: string | null | undefined): string | null {
  const digits = String(mobile || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `91${digits}`
  return digits
}

async function markCatalogSent(leadId: bigint, userId: bigint): Promise<void> {
  await markLeadBySlug(leadId, 'catalog-sent', userId, 'Catalog sent')
}

function personalizeMail(
  html: string,
  lead: { name: string | null; email: string | null; mobile?: string | null },
  counsellor?: { name?: string | null; email?: string | null } | null,
): string {
  const name = (lead.name || '').trim() || 'there'
  const firstName = name.split(/\s+/)[0]
  const counsellorName = (counsellor?.name || '').trim()
  const counsellorFirst = counsellorName ? counsellorName.split(/\s+/)[0] : ''
  return html
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email || '')
    .replace(/\{\{\s*mobile\s*\}\}/gi, lead.mobile || '')
    .replace(/\{\{\s*counsellorName\s*\}\}/gi, counsellorName)
    .replace(/\{\{\s*counsellorFirstName\s*\}\}/gi, counsellorFirst)
    .replace(/\{\{\s*counsellorEmail\s*\}\}/gi, counsellor?.email || '')
}

function jsonIds(raw: unknown): bigint[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((v) => {
      try {
        return BigInt(v as number | string)
      } catch {
        return 0n
      }
    })
    .filter((id) => id > 0n)
}

export async function sendLeadCatalog(opts: {
  leadId: bigint
  userId: bigint
  productIds: bigint[]
  channel: 'email' | 'whatsapp'
  note?: string | null
  templateId?: bigint | null
}): Promise<{
  send: unknown
  channel: 'email' | 'whatsapp'
  email?: { status: 'sent' | 'failed'; error?: string }
  waUrl?: string
  text?: string
}> {
  const ids = [...new Set(opts.productIds)]
  const useTemplate = opts.channel === 'email' && Boolean(opts.templateId)
  if (!ids.length && !useTemplate) throw new Error('Pick at least one product or an email template')

  const [lead, products, template, counsellor] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, name: true, email: true, mobile: true },
    }),
    ids.length
      ? prisma.product.findMany({
          where: { id: { in: ids }, active: true },
          select: { id: true, name: true, description: true, unitPrice: true, currency: true, imageUrl: true },
        })
      : Promise.resolve([] as Array<{
          id: bigint
          name: string
          description: string | null
          unitPrice: unknown
          currency: string | null
          imageUrl: string | null
        }>),
    useTemplate
      ? prisma.mailTemplate.findFirst({
          where: {
            id: opts.templateId!,
            OR: [{ userId: opts.userId }, { status: 1 }],
          },
        })
      : Promise.resolve(null),
    prisma.user.findUnique({
      where: { id: opts.userId },
      select: { name: true, email: true },
    }),
  ])
  if (!lead) throw new Error('Lead not found')
  if (ids.length && !products.length) throw new Error('No active products matched')
  if (useTemplate && !template) throw new Error('Email template not found')
  if (opts.channel === 'email' && !lead.email) throw new Error('This lead has no email')
  if (opts.channel === 'whatsapp' && !waPhone(lead.mobile)) throw new Error('This lead has no mobile number')
  if (opts.channel === 'whatsapp' && !products.length) throw new Error('Pick at least one product')

  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))

  const note = opts.note?.trim()
  const send = await prisma.leadCatalogSend.create({
    data: {
      leadId: lead.id,
      sentById: opts.userId,
      channel: opts.channel,
      note: note || (template ? `Template: ${template.title}` : null),
      items: {
        create: ordered.map((p) => ({
          productId: p.id,
          name: p.name,
          description: p.description,
          unitPrice: n(p.unitPrice),
          imageUrl: p.imageUrl,
        })),
      },
    },
    include: {
      items: true,
      sentBy: { select: { id: true, name: true } },
    },
  })

  if (ordered.length) await markCatalogSent(lead.id, opts.userId)

  const greeting = (lead.name || '').trim() || 'there'
  const company = currentTenant()?.companyName || 'Sales CRM'

  if (opts.channel === 'whatsapp') {
    const phone = waPhone(lead.mobile)!
    const lines = [
      `Hi ${greeting},`,
      note || 'Here are the products you asked about:',
      '',
      ...ordered.map((p) => whatsappLine(p)),
    ]
    const text = lines.join('\n')
    return {
      send,
      channel: 'whatsapp',
      waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
      text,
    }
  }

  let subject = note ? note.slice(0, 80) : `Products from ${company}`
  let html = ''

  if (template) {
    subject = personalizeMail(template.subject, lead, counsellor) || subject
    let body = personalizeMail(template.body, lead, counsellor)
    const extraIds = [...ordered.map((p) => p.id), ...jsonIds(template.productIds)]
    const hasGrid = /\{\{\s*product_grid\s*\}\}/.test(body)
    const hasProductToken = /\{\{\s*product:/.test(body)
    if (ordered.length && !hasGrid && !hasProductToken) {
      body += ordered.map((p) => `{{product:${p.id}}}`).join('')
    } else if (ordered.length && hasProductToken && !hasGrid) {
      for (const p of ordered) {
        if (!new RegExp(`\\{\\{\\s*product:${p.id}\\s*\\}\\}`).test(body)) {
          body += `{{product:${p.id}}}`
        }
      }
    }
    body = await resolveProductTokens(body, extraIds)
    html = note
      ? `<p>${esc(note)}</p>${body}`
      : body
  } else {
    const cards = ordered.map((p) => productCardHtml(p)).join('')
    html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">
  <p>Hi ${esc(greeting)},</p>
  <p>${esc(note || 'Here are the products you asked about.')}</p>
  ${cards}
  <p style="font-size:13px;color:#64748b;margin-top:24px">${esc(company)}</p>
</div>`
  }

  try {
    await emailService.send({
      to: lead.email!,
      subject,
      html,
    })
    await prisma.studentMailHistory.create({
      data: { leadId: lead.id, subject, body: html },
    })
    return { send, channel: 'email', email: { status: 'sent' } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { send, channel: 'email', email: { status: 'failed', error: msg } }
  }
}

export async function listLeadCatalogSends(leadId: bigint) {
  return prisma.leadCatalogSend.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      items: true,
      sentBy: { select: { id: true, name: true } },
    },
  })
}
