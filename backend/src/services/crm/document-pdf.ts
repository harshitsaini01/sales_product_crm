// ─────────────────────────────────────────────────────────────────────────────
// Invoices and contracts as documents — HTML for the email body, PDF for the
// attachment — built the same way the quote is (quote-document.ts /
// quote-pdf.ts), so all three documents a customer receives from the same
// company look like they came from the same company.
//
// Standard PDF fonts have no rupee glyph, so PDF amounts read "INR 1,234.00".
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit'
import { prisma } from '../../lib/prisma'
import { currentTenant } from '../../lib/tenant-context'

const INK = '#0f172a'
const MUTED = '#64748b'
const LINE = '#e2e8f0'
const ACCENT = '#4f46e5'

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const pdfMoney = (v: unknown, currency: string) => `${currency} ${n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const htmlMoney = (v: unknown, currency: string) => `${currency === 'INR' ? '₹' : `${currency} `}${n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (v: Date | string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const normState = (s?: string | null) => (s || '').trim().toLowerCase()

function gstSplit(tax: number, from?: string | null, to?: string | null) {
  const intra = !!(normState(from) && normState(to) && normState(from) === normState(to))
  const half = Math.round((tax / 2) * 100) / 100
  return intra
    ? { intra: true, cgst: half, sgst: Math.round((tax - half) * 100) / 100, igst: 0 }
    : { intra: false, cgst: 0, sgst: 0, igst: Math.round(tax * 100) / 100 }
}

export interface Party {
  name: string
  email?: string | null
  phone?: string | null
  gstin?: string | null
  address?: string | null
  contactName?: string | null
  state?: string | null
}

/** The customer's own letterhead, from their settings. */
export async function letterhead(): Promise<Party> {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: ['company_name', 'company_email', 'company_phone', 'company_gstin', 'company_address', 'company_state'] } },
  })
  const s = (k: string) => settings.find((r) => r.key === k)?.value || null
  return {
    name: s('company_name') || currentTenant()?.companyName || 'Our Company',
    email: s('company_email'),
    phone: s('company_phone'),
    gstin: s('company_gstin'),
    address: s('company_address'),
    state: s('company_state'),
  }
}

export async function partyForAccount(accountId: bigint | null, contactId: bigint | null): Promise<Party> {
  const [account, contact, location] = await Promise.all([
    accountId ? prisma.account.findUnique({ where: { id: accountId }, select: { name: true, email: true, gstin: true, phone: true, billingState: true } }) : null,
    contactId ? prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, email: true } }) : null,
    accountId
      ? prisma.crmLocation.findFirst({ where: { accountId }, orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }], select: { address: true, city: true, state: true, pincode: true } })
      : null,
  ])
  return {
    name: account?.name || 'Customer',
    contactName: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null,
    email: contact?.email || account?.email || null,
    phone: account?.phone ?? null,
    gstin: account?.gstin ?? null,
    address: location ? [location.address, location.city, location.state, location.pincode].filter(Boolean).join(', ') : null,
    state: account?.billingState || location?.state || null,
  }
}

export async function partyForLead(leadId: bigint | null): Promise<Party> {
  if (!leadId) return { name: 'Customer' }
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { name: true, email: true, mobile: true, homeAddress: true, city: true, state: true, pincode: true },
  })
  if (!lead) return { name: 'Customer' }
  return {
    name: lead.name || 'Customer',
    email: lead.email,
    phone: lead.mobile,
    address: [lead.homeAddress, lead.city, lead.state, lead.pincode].filter(Boolean).join(', ') || null,
    state: lead.state,
  }
}

// ═══ INVOICE ═════════════════════════════════════════════════════════════════

export interface InvoiceDoc {
  invoiceNumber: string
  status: string
  issueDate: Date | string
  dueDate: Date | string | null
  currency: string
  subtotal: unknown
  discount: unknown
  tax: unknown
  total: unknown
  amountPaid: unknown
  terms: string | null
  notes: string | null
  orderNumber?: string | null
  items: { name: string; sku: string | null; hsnCode?: string | null; quantity: unknown; unitPrice: unknown; discountPercent: unknown; taxPercent: unknown; total: unknown }[]
  payments: { amount: unknown; paymentDate: Date | string; mode: string; reference: string | null }[]
  from: Party
  to: Party
  gst?: { intra: boolean; cgst: number; sgst: number; igst: number }
}

export async function buildInvoiceDoc(id: bigint): Promise<InvoiceDoc | null> {
  const inv = await prisma.crmInvoice.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { paymentDate: 'asc' } }, order: { select: { orderNumber: true } } },
  })
  if (!inv) return null
  const [from, to] = await Promise.all([
    letterhead(),
    inv.accountId ? partyForAccount(inv.accountId, inv.contactId) : partyForLead(inv.leadId),
  ])
  return {
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    subtotal: inv.subtotal,
    discount: inv.discount,
    tax: inv.tax,
    total: inv.total,
    amountPaid: inv.amountPaid,
    terms: inv.terms,
    notes: inv.notes,
    orderNumber: inv.order?.orderNumber ?? null,
    items: inv.items,
    payments: inv.payments,
    from,
    to,
    gst: gstSplit(n(inv.tax), from.state, to.state),
  }
}

export function renderInvoiceHtml(d: InvoiceDoc): string {
  const balance = n(d.total) - n(d.amountPaid)
  const rows = d.items
    .map(
      (l, i) => `<tr style="background:${i % 2 ? '#fbfcfe' : '#fff'}">
        <td style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${esc(l.name)}${l.sku ? `<div style="color:${MUTED};font-size:11px">${esc(l.sku)}</div>` : ''}${(l as { hsnCode?: string | null }).hsnCode ? `<div style="color:${MUTED};font-size:11px">HSN ${esc((l as { hsnCode?: string | null }).hsnCode)}</div>` : ''}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${n(l.quantity)}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${htmlMoney(l.unitPrice, d.currency)}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${n(l.discountPercent)}%</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${n(l.taxPercent)}%</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px;font-weight:600">${htmlMoney(l.total, d.currency)}</td>
      </tr>`,
    )
    .join('')
  const totalRow = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:5px 12px;text-align:right;color:${strong ? INK : MUTED};font-size:${strong ? 15 : 13}px;${strong ? 'font-weight:700' : ''}">${label}</td><td align="right" style="padding:5px 12px;width:150px;font-size:${strong ? 17 : 13}px;font-weight:${strong ? 700 : 600}">${value}</td></tr>`
  const party = (p: Party) =>
    [p.contactName ? `Attn: ${esc(p.contactName)}` : '', p.address ? esc(p.address) : '', p.email ? esc(p.email) : '', p.phone ? esc(p.phone) : '', p.gstin ? `GSTIN ${esc(p.gstin)}` : ''].filter(Boolean).join('<br>')

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.invoiceNumber)}</title>
<style>@media print{@page{margin:14mm}.no-print{display:none!important}body{background:#fff!important}.sheet{box-shadow:none!important;border:0!important;margin:0!important;max-width:none!important}}</style></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${INK}">
<div class="sheet" style="max-width:760px;margin:0 auto;background:#fff;border:1px solid ${LINE};border-radius:10px;overflow:hidden">
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><td style="padding:26px 28px 18px;border-bottom:3px solid ${ACCENT}"><table width="100%"><tr>
  <td style="vertical-align:top"><div style="font-size:19px;font-weight:700">${esc(d.from.name)}</div><div style="color:${MUTED};font-size:12px;margin-top:4px;line-height:1.6">${party(d.from)}</div></td>
  <td align="right" style="vertical-align:top"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};font-weight:600">Tax Invoice</div><div style="font-size:20px;font-weight:700;font-family:ui-monospace,Menlo,monospace;margin-top:3px">${esc(d.invoiceNumber)}</div>
  <div style="color:${MUTED};font-size:12px;margin-top:6px;line-height:1.7">Issued <strong style="color:${INK}">${date(d.issueDate)}</strong><br>${d.dueDate ? `Due <strong style="color:${INK}">${date(d.dueDate)}</strong><br>` : ''}${d.orderNumber ? `Order ${esc(d.orderNumber)}` : ''}</div></td>
</tr></table></td></tr>
<tr><td style="padding:20px 28px 6px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:600">Bill to</div><div style="font-size:15px;font-weight:600;margin-top:5px">${esc(d.to.name)}</div><div style="color:${MUTED};font-size:12px;margin-top:3px;line-height:1.6">${party(d.to)}</div></td></tr>
<tr><td style="padding:18px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE}"><thead><tr style="background:#f8fafc">
  ${['Item', 'Qty', 'Rate', 'Disc', 'Tax', 'Amount'].map((h, i) => `<th align="${i ? 'right' : 'left'}" style="padding:9px 12px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE}">${h}</th>`).join('')}
</tr></thead><tbody>${rows || `<tr><td colspan="6" style="padding:28px;text-align:center;color:${MUTED}">No items.</td></tr>`}</tbody></table></td></tr>
<tr><td style="padding:14px 28px 0"><table align="right" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:320px">
  ${totalRow('Subtotal', htmlMoney(d.subtotal, d.currency))}${n(d.discount) > 0 ? totalRow('Discount', `− ${htmlMoney(d.discount, d.currency)}`) : ''}${
    d.gst?.intra
      ? totalRow('CGST', htmlMoney(d.gst.cgst, d.currency)) + totalRow('SGST', htmlMoney(d.gst.sgst, d.currency))
      : d.gst
        ? totalRow('IGST', htmlMoney(d.gst.igst, d.currency))
        : totalRow('Tax', htmlMoney(d.tax, d.currency))
  }
  <tr><td colspan="2" style="padding:4px 12px"><div style="border-top:2px solid ${INK}"></div></td></tr>${totalRow('Total', htmlMoney(d.total, d.currency), true)}
  ${n(d.amountPaid) > 0 ? totalRow('Received', `− ${htmlMoney(d.amountPaid, d.currency)}`) : ''}${n(d.amountPaid) > 0 ? totalRow('Balance due', htmlMoney(balance, d.currency), true) : ''}
</table></td></tr>
${d.payments.length ? `<tr><td style="padding:30px 28px 0"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:600;margin-bottom:6px">Payments received</div>${d.payments.map((p) => `<div style="font-size:13px;margin:3px 0">${date(p.paymentDate)} · ${htmlMoney(p.amount, d.currency)} · ${esc(p.mode.replace(/_/g, ' '))}${p.reference ? ` · ${esc(p.reference)}` : ''}</div>`).join('')}</td></tr>` : ''}
${d.terms || d.notes ? `<tr><td style="padding:30px 28px 0"><div style="border-top:1px solid ${LINE};padding-top:16px">${d.terms ? `<div style="margin-bottom:8px"><span style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};font-weight:600">Terms</span><div style="font-size:13px;margin-top:2px">${esc(d.terms)}</div></div>` : ''}${d.notes ? `<div><span style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};font-weight:600">Notes</span><div style="font-size:13px;margin-top:2px;white-space:pre-wrap">${esc(d.notes)}</div></div>` : ''}</div></td></tr>` : ''}
<tr><td style="padding:26px 28px"><div style="border-top:1px solid ${LINE};padding-top:14px;color:${MUTED};font-size:11px;line-height:1.7">${balance > 0 ? `Balance of ${htmlMoney(balance, d.currency)} is payable${d.dueDate ? ` by ${date(d.dueDate)}` : ''}.` : 'Paid in full — thank you.'}</div></td></tr>
</table></div></body></html>`
}

export function renderInvoiceEmailIntro(d: InvoiceDoc, message?: string | null): string {
  const balance = n(d.total) - n(d.amountPaid)
  const body = message?.trim()
    ? `<p style="font-size:14px;line-height:1.7;margin:0 0 18px;white-space:pre-wrap">${esc(message)}</p>`
    : `<p style="font-size:14px;line-height:1.7;margin:0 0 18px">Hello${d.to.contactName ? ` ${esc(d.to.contactName.split(' ')[0])}` : ''},<br><br>Please find invoice <strong>${esc(d.invoiceNumber)}</strong> for <strong>${htmlMoney(d.total, d.currency)}</strong> below${d.dueDate ? `, due <strong>${date(d.dueDate)}</strong>` : ''}.${balance < n(d.total) ? ` ${htmlMoney(d.amountPaid, d.currency)} has already been received; the balance is ${htmlMoney(balance, d.currency)}.` : ''} A PDF copy is attached.</p>`
  return `<div style="max-width:760px;margin:0 auto;padding:0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${INK}">${body}</div>`
}

// ═══ CONTRACT ════════════════════════════════════════════════════════════════

export interface ContractDoc {
  contractNumber: string
  title: string
  type: string | null
  status: string
  startDate: Date | string | null
  endDate: Date | string | null
  renewalDate: Date | string | null
  value: unknown
  currency: string
  paymentTerms: string | null
  signedBy: string | null
  signedAt: Date | string | null
  notes: string | null
  quoteNumber: string | null
  /** Scope of work — the lines of the quote it was drawn up from. */
  items: { name: string; sku: string | null; quantity: unknown; unitPrice: unknown; total: unknown }[]
  from: Party
  to: Party
  preparedBy: string | null
}

export async function buildContractDoc(id: bigint): Promise<ContractDoc | null> {
  const ct = await prisma.contract.findUnique({ where: { id }, include: { owner: { select: { name: true } } } })
  if (!ct) return null
  const [from, to, quote] = await Promise.all([
    letterhead(),
    partyForAccount(ct.accountId, null),
    ct.quoteId ? prisma.quote.findUnique({ where: { id: ct.quoteId }, include: { items: { orderBy: { sortOrder: 'asc' } } } }) : null,
  ])
  return {
    contractNumber: ct.contractNumber,
    title: ct.title,
    type: ct.type,
    status: ct.status,
    startDate: ct.startDate,
    endDate: ct.endDate,
    renewalDate: ct.renewalDate,
    value: ct.value,
    currency: ct.currency,
    paymentTerms: ct.paymentTerms,
    signedBy: ct.signedBy,
    signedAt: ct.signedAt,
    notes: ct.notes,
    quoteNumber: quote?.quoteNumber ?? null,
    items: quote?.items ?? [],
    from,
    to,
    preparedBy: ct.owner?.name ?? null,
  }
}

export function renderContractHtml(d: ContractDoc): string {
  const party = (p: Party) =>
    [p.address ? esc(p.address) : '', p.email ? esc(p.email) : '', p.phone ? esc(p.phone) : '', p.gstin ? `GSTIN ${esc(p.gstin)}` : ''].filter(Boolean).join('<br>')
  const clause = (h: string, body: string) => `<div style="margin-top:16px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:600">${h}</div><div style="font-size:13px;line-height:1.7;margin-top:4px;white-space:pre-wrap">${body}</div></div>`
  const scope = d.items.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};margin-top:6px"><thead><tr style="background:#f8fafc">${['Deliverable', 'Qty', 'Rate', 'Amount'].map((h, i) => `<th align="${i ? 'right' : 'left'}" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE}">${h}</th>`).join('')}</tr></thead><tbody>${d.items.map((l) => `<tr><td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13px">${esc(l.name)}</td><td align="right" style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13px">${n(l.quantity)}</td><td align="right" style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13px">${htmlMoney(l.unitPrice, d.currency)}</td><td align="right" style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13px;font-weight:600">${htmlMoney(l.total, d.currency)}</td></tr>`).join('')}</tbody></table>`
    : `<div style="font-size:13px;color:${MUTED}">As described in the attached proposal${d.quoteNumber ? ` (${esc(d.quoteNumber)})` : ''}.</div>`

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.contractNumber)}</title>
<style>@media print{@page{margin:16mm}.no-print{display:none!important}body{background:#fff!important}.sheet{box-shadow:none!important;border:0!important;margin:0!important;max-width:none!important}}</style></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${INK}">
<div class="sheet" style="max-width:760px;margin:0 auto;background:#fff;border:1px solid ${LINE};border-radius:10px;padding:32px 36px">
<div style="border-bottom:3px solid ${ACCENT};padding-bottom:14px"><table width="100%"><tr><td><div style="font-size:19px;font-weight:700">${esc(d.from.name)}</div><div style="color:${MUTED};font-size:12px;line-height:1.6;margin-top:4px">${party(d.from)}</div></td>
<td align="right" style="vertical-align:top"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};font-weight:600">${esc(d.type || 'Agreement')}</div><div style="font-size:18px;font-weight:700;font-family:ui-monospace,Menlo,monospace;margin-top:3px">${esc(d.contractNumber)}</div></td></tr></table></div>
<h1 style="font-size:20px;margin:22px 0 4px">${esc(d.title)}</h1>
<div style="font-size:13px;color:${MUTED}">Between <strong style="color:${INK}">${esc(d.from.name)}</strong> ("the Provider") and <strong style="color:${INK}">${esc(d.to.name)}</strong> ("the Client")${d.quoteNumber ? `, pursuant to quotation ${esc(d.quoteNumber)}` : ''}.</div>
<div style="margin-top:14px;font-size:12px;color:${MUTED};line-height:1.6"><strong style="color:${INK}">The Client:</strong> ${esc(d.to.name)}${d.to.address || d.to.email || d.to.gstin ? `<br>${party(d.to)}` : ''}</div>
${clause('1. Term', `${d.startDate ? `Commences ${date(d.startDate)}` : 'Commences on signature'}${d.endDate ? ` and runs until ${date(d.endDate)}` : ' and continues until terminated in writing'}.${d.renewalDate ? ` Renewal to be agreed by ${date(d.renewalDate)}.` : ''}`)}
${clause('2. Scope of work', scope)}
${clause('3. Value', `${d.value != null ? `<strong>${htmlMoney(d.value, d.currency)}</strong>` : 'As per the schedule above'}${d.paymentTerms ? `, payable ${esc(d.paymentTerms)}` : ''}. Taxes as applicable.`)}
${d.notes ? clause('4. Additional terms', esc(d.notes)) : ''}
<table width="100%" style="margin-top:40px"><tr>
<td style="width:50%;padding-right:20px"><div style="border-top:1px solid ${INK};padding-top:8px;font-size:12px"><strong>For ${esc(d.from.name)}</strong><br><span style="color:${MUTED}">${d.preparedBy ? esc(d.preparedBy) : 'Authorised signatory'}</span></div></td>
<td style="width:50%;padding-left:20px"><div style="border-top:1px solid ${INK};padding-top:8px;font-size:12px"><strong>For ${esc(d.to.name)}</strong><br><span style="color:${MUTED}">${d.signedBy ? `${esc(d.signedBy)}${d.signedAt ? ` · signed ${date(d.signedAt)}` : ''}` : 'Authorised signatory · Date'}</span></div></td>
</tr></table>
</div></body></html>`
}

// ═══ PDF ═════════════════════════════════════════════════════════════════════

type Doc = PDFKit.PDFDocument

function pdfShell(title: string, run: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title } })
      const chunks: Buffer[] = []
      doc.on('data', (c) => chunks.push(c as Buffer))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
      run(doc)
      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

const L = 48
const R = 547
const W = R - L

function head(doc: Doc, from: Party, kind: string, number: string, lines: string[]): number {
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(from.name, L, 48, { width: 300 })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  let y = 72
  for (const t of [from.address, from.email, from.phone, from.gstin ? `GSTIN ${from.gstin}` : null].filter(Boolean) as string[]) {
    doc.text(t, L, y, { width: 300 })
    y += 12
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(kind.toUpperCase(), 380, 48, { width: 167, align: 'right', characterSpacing: 1.2 })
  doc.font('Courier-Bold').fontSize(16).fillColor(INK).text(number, 380, 62, { width: 167, align: 'right' })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  let ry = 84
  for (const t of lines) {
    doc.text(t, 380, ry, { width: 167, align: 'right' })
    ry += 12
  }
  y = Math.max(y, ry) + 8
  doc.moveTo(L, y).lineTo(R, y).lineWidth(2).strokeColor(ACCENT).stroke()
  return y + 18
}

function partyBlock(doc: Doc, y: number, label: string, p: Party): number {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(label, L, y, { characterSpacing: 1 })
  y += 13
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(p.name, L, y)
  y += 16
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  for (const t of [p.contactName ? `Attn: ${p.contactName}` : null, p.address, p.email, p.gstin ? `GSTIN ${p.gstin}` : null].filter(Boolean) as string[]) {
    doc.text(t, L, y, { width: W })
    y += 12
  }
  return y
}

export function buildInvoicePdf(d: InvoiceDoc): Promise<Buffer> {
  return pdfShell(`Invoice ${d.invoiceNumber}`, (doc) => {
    let y = head(doc, d.from, 'Tax Invoice', d.invoiceNumber, [`Issued ${date(d.issueDate)}`, ...(d.dueDate ? [`Due ${date(d.dueDate)}`] : []), ...(d.orderNumber ? [`Order ${d.orderNumber}`] : [])])
    y = partyBlock(doc, y, 'BILL TO', d.to) + 14

    const cols = { qty: 330, rate: 380, disc: 440, tax: 480, amt: 490 }
    const header = (yy: number) => {
      doc.rect(L, yy, W, 20).fill('#f8fafc')
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      doc.text('ITEM', L + 8, yy + 6)
      doc.text('QTY', cols.qty, yy + 6, { width: 40, align: 'right' })
      doc.text('RATE', cols.rate, yy + 6, { width: 55, align: 'right' })
      doc.text('DISC', cols.disc, yy + 6, { width: 35, align: 'right' })
      doc.text('TAX', cols.tax, yy + 6, { width: 35, align: 'right' })
      doc.text('AMOUNT', cols.amt, yy + 6, { width: 57, align: 'right' })
      return yy + 20
    }
    y = header(y)
    doc.font('Helvetica').fontSize(9).fillColor(INK)
    for (const l of d.items) {
      const h = Math.max(20, doc.heightOfString(l.name, { width: 270 }) + (l.sku ? 12 : 0) + 8)
      if (y + h > 760) {
        doc.addPage()
        y = header(48)
        doc.font('Helvetica').fontSize(9).fillColor(INK)
      }
      doc.fillColor(INK).text(l.name, L + 8, y + 5, { width: 270 })
      if (l.sku) doc.fillColor(MUTED).fontSize(8).text(l.sku, L + 8, y + 5 + doc.heightOfString(l.name, { width: 270 }), { width: 270 }).fontSize(9)
      doc.fillColor(INK)
      doc.text(String(n(l.quantity)), cols.qty, y + 5, { width: 40, align: 'right' })
      doc.text(pdfMoney(l.unitPrice, d.currency), cols.rate, y + 5, { width: 55, align: 'right' })
      doc.text(`${n(l.discountPercent)}%`, cols.disc, y + 5, { width: 35, align: 'right' })
      doc.text(`${n(l.taxPercent)}%`, cols.tax, y + 5, { width: 35, align: 'right' })
      doc.font('Helvetica-Bold').text(pdfMoney(l.total, d.currency), cols.amt, y + 5, { width: 57, align: 'right' }).font('Helvetica')
      y += h
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke()
    }

    y += 10
    if (y > 660) {
      doc.addPage()
      y = 48
    }
    const row = (label: string, value: string, strong = false) => {
      doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9).fillColor(strong ? INK : MUTED)
      doc.text(label, 320, y, { width: 120, align: 'right' })
      doc.fillColor(INK).text(value, 445, y, { width: 102, align: 'right' })
      y += strong ? 18 : 14
    }
    row('Subtotal', pdfMoney(d.subtotal, d.currency))
    if (n(d.discount) > 0) row('Discount', `- ${pdfMoney(d.discount, d.currency)}`)
    if (d.gst?.intra) {
      row('CGST', pdfMoney(d.gst.cgst, d.currency))
      row('SGST', pdfMoney(d.gst.sgst, d.currency))
    } else if (d.gst) {
      row('IGST', pdfMoney(d.gst.igst, d.currency))
    } else {
      row('Tax', pdfMoney(d.tax, d.currency))
    }
    doc.moveTo(320, y).lineTo(R, y).lineWidth(1.2).strokeColor(INK).stroke()
    y += 6
    row('Total', pdfMoney(d.total, d.currency), true)
    const balance = n(d.total) - n(d.amountPaid)
    if (n(d.amountPaid) > 0) {
      row('Received', `- ${pdfMoney(d.amountPaid, d.currency)}`)
      row('Balance due', pdfMoney(balance, d.currency), true)
    }

    if (d.payments.length) {
      y += 12
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('PAYMENTS RECEIVED', L, y, { characterSpacing: 1 })
      y += 12
      doc.font('Helvetica').fontSize(9).fillColor(INK)
      for (const p of d.payments) {
        doc.text(`${date(p.paymentDate)} · ${pdfMoney(p.amount, d.currency)} · ${p.mode.replace(/_/g, ' ')}${p.reference ? ` · ${p.reference}` : ''}`, L, y, { width: W })
        y += 12
      }
    }
    for (const [k, v] of [['TERMS', d.terms], ['NOTES', d.notes]] as [string, string | null][]) {
      if (!v) continue
      y += 12
      if (y > 740) {
        doc.addPage()
        y = 48
      }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(k, L, y, { characterSpacing: 1 })
      y += 12
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(v, L, y, { width: W })
      y += doc.heightOfString(v, { width: W })
    }
    y += 16
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke()
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(balance > 0 ? `Balance of ${pdfMoney(balance, d.currency)} is payable${d.dueDate ? ` by ${date(d.dueDate)}` : ''}.` : 'Paid in full. Thank you.', L, y + 8, { width: W })
  })
}

export function buildContractPdf(d: ContractDoc): Promise<Buffer> {
  return pdfShell(`Contract ${d.contractNumber}`, (doc) => {
    let y = head(doc, d.from, d.type || 'Agreement', d.contractNumber, [d.startDate ? `From ${date(d.startDate)}` : 'From signature', ...(d.endDate ? [`To ${date(d.endDate)}`] : [])])
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(d.title, L, y, { width: W })
    y += doc.heightOfString(d.title, { width: W }) + 6
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Between ${d.from.name} ("the Provider") and ${d.to.name} ("the Client")${d.quoteNumber ? `, pursuant to quotation ${d.quoteNumber}` : ''}.`, L, y, { width: W })
    y += 26
    y = partyBlock(doc, y, 'THE CLIENT', d.to) + 10

    const clause = (h: string, body: string) => {
      if (y > 700) {
        doc.addPage()
        y = 48
      }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(h, L, y, { characterSpacing: 1 })
      y += 13
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(body, L, y, { width: W, lineGap: 2 })
      y += doc.heightOfString(body, { width: W, lineGap: 2 }) + 12
    }
    clause('1. TERM', `${d.startDate ? `Commences ${date(d.startDate)}` : 'Commences on signature'}${d.endDate ? ` and runs until ${date(d.endDate)}` : ' and continues until terminated in writing'}.${d.renewalDate ? ` Renewal to be agreed by ${date(d.renewalDate)}.` : ''}`)

    if (y > 640) {
      doc.addPage()
      y = 48
    }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('2. SCOPE OF WORK', L, y, { characterSpacing: 1 })
    y += 13
    if (d.items.length) {
      doc.rect(L, y, W, 18).fill('#f8fafc')
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      doc.text('DELIVERABLE', L + 8, y + 5)
      doc.text('QTY', 380, y + 5, { width: 40, align: 'right' })
      doc.text('RATE', 425, y + 5, { width: 55, align: 'right' })
      doc.text('AMOUNT', 485, y + 5, { width: 62, align: 'right' })
      y += 18
      doc.font('Helvetica').fontSize(9).fillColor(INK)
      for (const l of d.items) {
        const h = Math.max(18, doc.heightOfString(l.name, { width: 320 }) + 8)
        if (y + h > 760) {
          doc.addPage()
          y = 48
        }
        doc.text(l.name, L + 8, y + 4, { width: 320 })
        doc.text(String(n(l.quantity)), 380, y + 4, { width: 40, align: 'right' })
        doc.text(pdfMoney(l.unitPrice, d.currency), 425, y + 4, { width: 55, align: 'right' })
        doc.font('Helvetica-Bold').text(pdfMoney(l.total, d.currency), 485, y + 4, { width: 62, align: 'right' }).font('Helvetica')
        y += h
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke()
      }
      y += 12
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(`As described in the attached proposal${d.quoteNumber ? ` (${d.quoteNumber})` : ''}.`, L, y, { width: W })
      y += 24
    }

    clause('3. VALUE', `${d.value != null ? pdfMoney(d.value, d.currency) : 'As per the schedule above'}${d.paymentTerms ? `, payable ${d.paymentTerms}` : ''}. Taxes as applicable.`)
    if (d.notes) clause('4. ADDITIONAL TERMS', d.notes)

    if (y > 680) {
      doc.addPage()
      y = 48
    }
    y += 30
    const sig = (x: number, who: string, sub: string) => {
      doc.moveTo(x, y).lineTo(x + 230, y).lineWidth(0.8).strokeColor(INK).stroke()
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(who, x, y + 6, { width: 230 })
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(sub, x, y + 19, { width: 230 })
    }
    sig(L, `For ${d.from.name}`, d.preparedBy || 'Authorised signatory')
    sig(R - 230, `For ${d.to.name}`, d.signedBy ? `${d.signedBy}${d.signedAt ? ` · signed ${date(d.signedAt)}` : ''}` : 'Authorised signatory · Date')
  })
}

// ═══ DELIVERY CHALLAN / PACKING LIST ═════════════════════════════════════════

export interface DispatchDoc {
  kind: 'challan' | 'packing'
  number: string
  orderNumber: string
  date: Date | string
  courier: string | null
  trackingNumber: string | null
  from: Party
  to: Party
  items: { name: string; sku: string | null; hsnCode?: string | null; quantity: unknown }[]
}

export async function buildDispatchDoc(orderId: bigint, kind: 'challan' | 'packing'): Promise<DispatchDoc | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!order) return null
  const [from, to] = await Promise.all([letterhead(), partyForAccount(order.accountId, order.contactId)])
  return {
    kind,
    number: kind === 'challan' ? `DC-${order.orderNumber.replace(/^ORD-?/, '')}` : `PL-${order.orderNumber.replace(/^ORD-?/, '')}`,
    orderNumber: order.orderNumber,
    date: order.shippedAt || order.packedAt || order.orderDate,
    courier: order.courier,
    trackingNumber: order.trackingNumber,
    from,
    to,
    items: order.items,
  }
}

export function renderDispatchHtml(d: DispatchDoc): string {
  const title = d.kind === 'challan' ? 'Delivery Challan' : 'Packing List'
  const rows = d.items
    .map(
      (l, i) => `<tr style="background:${i % 2 ? '#fbfcfe' : '#fff'}">
        <td style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${esc(l.name)}${l.sku ? `<div style="color:${MUTED};font-size:11px">${esc(l.sku)}</div>` : ''}${l.hsnCode ? `<div style="color:${MUTED};font-size:11px">HSN ${esc(l.hsnCode)}</div>` : ''}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px">${n(l.quantity)}</td>
      </tr>`,
    )
    .join('')
  const party = (p: Party) =>
    [p.contactName ? `Attn: ${esc(p.contactName)}` : '', p.address ? esc(p.address) : '', p.phone ? esc(p.phone) : '', p.gstin ? `GSTIN ${esc(p.gstin)}` : ''].filter(Boolean).join('<br>')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)}</title>
<style>@media print{@page{margin:14mm}body{background:#fff!important}}</style></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${INK}">
<div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid ${LINE};border-radius:10px;overflow:hidden">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:26px 28px 18px;border-bottom:3px solid ${ACCENT}">
<table width="100%"><tr>
  <td><div style="font-size:19px;font-weight:700">${esc(d.from.name)}</div><div style="color:${MUTED};font-size:12px;margin-top:4px;line-height:1.6">${party(d.from)}</div></td>
  <td align="right"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};font-weight:600">${title}</div>
  <div style="font-size:20px;font-weight:700;font-family:ui-monospace,Menlo,monospace;margin-top:3px">${esc(d.number)}</div>
  <div style="color:${MUTED};font-size:12px;margin-top:6px">Order ${esc(d.orderNumber)} · ${date(d.date)}${d.trackingNumber ? `<br>${esc(d.courier || '')} ${esc(d.trackingNumber)}` : ''}</div></td>
</tr></table></td></tr>
<tr><td style="padding:20px 28px 6px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:600">Ship to</div>
<div style="font-size:15px;font-weight:600;margin-top:5px">${esc(d.to.name)}</div>
<div style="color:${MUTED};font-size:12px;margin-top:3px;line-height:1.6">${party(d.to)}</div></td></tr>
<tr><td style="padding:18px 28px 24px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE}">
<thead><tr style="background:#f8fafc"><th align="left" style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:${MUTED}">Item</th>
<th align="right" style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:${MUTED}">Qty</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:${MUTED};font-size:11px;margin-top:16px">${d.kind === 'challan' ? 'This is a delivery challan, not a tax invoice.' : 'Packing list — check quantities against the carton.'}</p>
</td></tr></table></div></body></html>`
}

export function buildDispatchPdf(d: DispatchDoc): Promise<Buffer> {
  const title = d.kind === 'challan' ? 'Delivery Challan' : 'Packing List'
  return pdfShell(`${title} ${d.number}`, (doc) => {
    let y = head(doc, d.from, title, d.number, [
      `Order ${d.orderNumber}`,
      date(d.date),
      ...(d.trackingNumber ? [`${d.courier || 'Courier'} ${d.trackingNumber}`] : []),
    ])
    y = partyBlock(doc, y, 'SHIP TO', d.to) + 12
    doc.rect(L, y, W, 18).fill('#f8fafc')
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
    doc.text('ITEM', L + 8, y + 5)
    doc.text('QTY', R - 50, y + 5, { width: 42, align: 'right' })
    y += 18
    doc.font('Helvetica').fontSize(9).fillColor(INK)
    for (const l of d.items) {
      if (y > 740) {
        doc.addPage()
        y = 48
      }
      doc.text(l.name, L + 8, y + 4, { width: 400 })
      doc.text(String(n(l.quantity)), R - 50, y + 4, { width: 42, align: 'right' })
      y += 18
      if (l.sku) {
        doc.fontSize(8).fillColor(MUTED).text(l.sku, L + 8, y - 2, { width: 400 })
        doc.fontSize(9).fillColor(INK)
        y += 10
      }
    }
    y += 16
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      d.kind === 'challan' ? 'This is a delivery challan, not a tax invoice.' : 'Packing list — check quantities against the carton.',
      L,
      y,
      { width: W },
    )
  })
}
