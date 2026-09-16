import { prisma } from '../lib/prisma'
import { emailService } from './email.service'
import { recordStatusChange } from './leads/status-history.service'
import { resolveStatusCascade } from './leads/status-cascade.service'
import { currentTenant } from '../lib/tenant-context'

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
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { leadStatus: true, leadSubStatus: true, leadStatusId: true, departmentId: true },
  })
  if (!lead) return

  const status = await prisma.leadStatus.findFirst({
    where: {
      slug: 'catalog-sent',
      status: 1,
      ...(lead.departmentId ? { departmentId: lead.departmentId } : {}),
    },
    select: { id: true, title: true, departmentId: true },
  })
  if (!status || lead.leadStatusId === status.id) return

  const cascade = await resolveStatusCascade({
    leadStatusId: status.id,
    currentDepartmentId: lead.departmentId,
  })
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      leadStatusId: status.id,
      leadStatus: cascade.leadStatus ?? status.title,
      ...(cascade.departmentId !== undefined ? { departmentId: cascade.departmentId } : {}),
      ...(cascade.statusLeadTypeId !== undefined ? { statusLeadTypeId: cascade.statusLeadTypeId } : {}),
    },
  })
  await recordStatusChange({
    leadId,
    changedById: userId,
    fromStatus: lead.leadStatus,
    toStatus: cascade.leadStatus ?? status.title,
    fromSubStatus: lead.leadSubStatus,
    toSubStatus: lead.leadSubStatus,
    reason: 'Catalog sent',
    source: 'api',
  })
}

export async function sendLeadCatalog(opts: {
  leadId: bigint
  userId: bigint
  productIds: bigint[]
  channel: 'email' | 'whatsapp'
  note?: string | null
}): Promise<{
  send: unknown
  channel: 'email' | 'whatsapp'
  email?: { status: 'sent' | 'failed'; error?: string }
  waUrl?: string
  text?: string
}> {
  const ids = [...new Set(opts.productIds)]
  if (!ids.length) throw new Error('Pick at least one product')

  const [lead, products] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, name: true, email: true, mobile: true },
    }),
    prisma.product.findMany({
      where: { id: { in: ids }, active: true },
      select: { id: true, name: true, description: true, unitPrice: true, currency: true, imageUrl: true },
    }),
  ])
  if (!lead) throw new Error('Lead not found')
  if (!products.length) throw new Error('No active products matched')
  if (opts.channel === 'email' && !lead.email) throw new Error('This lead has no email')
  if (opts.channel === 'whatsapp' && !waPhone(lead.mobile)) throw new Error('This lead has no mobile number')

  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))

  const send = await prisma.leadCatalogSend.create({
    data: {
      leadId: lead.id,
      sentById: opts.userId,
      channel: opts.channel,
      note: opts.note?.trim() || null,
      items: {
        create: ordered.map((p) => ({
          productId: p.id,
          name: p.name,
          description: p.description,
          unitPrice: p.unitPrice ?? 0,
          imageUrl: p.imageUrl,
        })),
      },
    },
    include: {
      items: true,
      sentBy: { select: { id: true, name: true } },
    },
  })

  await markCatalogSent(lead.id, opts.userId)

  const greeting = (lead.name || '').trim() || 'there'
  const note = opts.note?.trim()
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

  const cards = ordered.map((p) => productCardHtml(p)).join('')
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">
  <p>Hi ${esc(greeting)},</p>
  <p>${esc(note || 'Here are the products you asked about.')}</p>
  ${cards}
  <p style="font-size:13px;color:#64748b;margin-top:24px">${esc(company)}</p>
</div>`

  try {
    await emailService.send({
      to: lead.email!,
      subject: note ? note.slice(0, 80) : `Products from ${company}`,
      html,
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
