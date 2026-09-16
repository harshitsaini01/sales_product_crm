import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { verifyOrderToken, verifyInvoiceToken } from '../services/crm/public-links'

export const publicOrdersRoutes = new Hono()
export const publicInvoicesRoutes = new Hono()

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const LABELS: Record<string, string> = {
  confirmed: 'Order confirmed',
  packed: 'Packed',
  processing: 'Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

publicOrdersRoutes.get('/:token', async (c) => {
  const id = verifyOrderToken(c.req.param('token'))
  if (!id) return c.text('This tracking link is not valid.', 404)
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, shipments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!order) return c.text('Not found', 404)
  const ship = order.shipments[0]
  const status = order.status
  const steps = ['confirmed', 'packed', 'out_for_delivery', 'delivered']
  const idx = Math.max(0, steps.indexOf(status === 'processing' ? 'packed' : status))
  const rail = steps
    .map((s, i) => {
      const on = i <= idx && status !== 'cancelled'
      return `<span style="padding:6px 10px;border-radius:999px;font-size:12px;font-weight:600;${on ? 'background:#4f46e5;color:#fff' : 'background:#e2e8f0;color:#64748b'}">${esc(LABELS[s])}</span>`
    })
    .join('<span style="color:#cbd5e1">—</span>')

  const lines = order.items
    .map((l) => `<tr><td style="padding:8px 0">${esc(l.name)}</td><td>${esc(l.quantity)}</td></tr>`)
    .join('')

  return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(order.orderNumber)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#0f172a">
  <p style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Shipment tracking</p>
  <h1 style="margin:4px 0 16px">${esc(order.orderNumber)}</h1>
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:24px">${rail}</div>
  ${order.trackingNumber ? `<p><strong>Tracking:</strong> ${esc(order.courier || '')} ${esc(order.trackingNumber)}</p>` : ''}
  ${ship?.eta ? `<p><strong>ETA:</strong> ${esc(ship.eta.toLocaleDateString('en-IN'))}</p>` : ''}
  ${order.podNotes ? `<p><strong>Proof of delivery:</strong> ${esc(order.podNotes)}</p>` : ''}
  <table style="width:100%;border-top:1px solid #e2e8f0;margin-top:24px">${lines}</table>
</body></html>`)
})

publicInvoicesRoutes.get('/:token', async (c) => {
  const id = verifyInvoiceToken(c.req.param('token'))
  if (!id) return c.text('This invoice link is not valid.', 404)
  const inv = await prisma.crmInvoice.findUnique({ where: { id }, include: { items: true, payments: true } })
  if (!inv) return c.text('Not found', 404)
  const due = Math.max(0, Number(inv.total) - Number(inv.amountPaid))
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: ['company_upi', 'company_upi_name', 'company_bank'] } },
  })
  const s = (k: string) => settings.find((r) => r.key === k)?.value || ''
  const upi = s('company_upi')
  const payee = s('company_upi_name') || 'Payment'
  const upiLink = upi && due > 0
    ? `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(payee)}&am=${due.toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoiceNumber)}`
    : ''
  const lines = inv.items
    .map(
      (l) =>
        `<tr><td style="padding:6px 0">${esc(l.name)}</td><td>${esc(l.quantity)}</td><td style="text-align:right">${Number(l.total).toLocaleString('en-IN')}</td></tr>`,
    )
    .join('')
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNumber)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#0f172a">
  <p style="font-size:12px;color:#64748b;text-transform:uppercase">Tax invoice</p>
  <h1>${esc(inv.invoiceNumber)}</h1>
  <p>Status: <strong>${esc(inv.status)}</strong> · Due: ₹${due.toLocaleString('en-IN')}</p>
  <table style="width:100%;margin-top:16px">${lines}</table>
  <p style="text-align:right;font-size:18px;font-weight:700">Total ₹${Number(inv.total).toLocaleString('en-IN')}</p>
  ${due > 0 ? `<div style="margin-top:24px;padding:16px;border:1px solid #e2e8f0;border-radius:12px">
    <p style="margin:0 0 8px;font-weight:600">Pay now</p>
    ${upi ? `<p style="margin:0 0 8px;font-size:14px">UPI: <strong>${esc(upi)}</strong>${payee ? ` · ${esc(payee)}` : ''}</p>` : ''}
    ${s('company_bank') ? `<p style="margin:0 0 8px;font-size:13px;color:#475569">${esc(s('company_bank'))}</p>` : ''}
    ${upiLink ? `<p><a href="${esc(upiLink)}" style="display:inline-block;padding:10px 16px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Pay with UPI</a></p>` : ''}
    ${!upi && !s('company_bank') ? `<p style="font-size:13px;color:#64748b;margin:0">Add company_upi (and optional company_bank) in Settings to show a payment link here.</p>` : ''}
  </div>` : '<p style="color:#059669;font-weight:600">Paid in full. Thank you.</p>'}
</body></html>`)
})
