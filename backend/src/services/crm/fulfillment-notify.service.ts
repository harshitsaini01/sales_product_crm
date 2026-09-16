// Email + WhatsApp when an order is packed / out for delivery / delivered.

import { prisma } from '../../lib/prisma'
import { emailService } from '../email.service'
import { publicOrderUrl } from './public-links'
import * as activity from './activity.service'

const LABELS: Record<string, string> = {
  packed: 'Your order has been packed',
  out_for_delivery: 'Your order is out for delivery',
  delivered: 'Your order has been delivered',
}

function digits(phone: string) {
  return phone.replace(/\D/g, '').replace(/^0+/, '')
}

async function sendWhatsApp(phone: string, text: string) {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) return false
  const to = digits(phone)
  if (to.length < 10) return false
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function notifyFulfillment(orderId: bigint, status: string) {
  const subject = LABELS[status]
  if (!subject) return

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { select: { name: true, quantity: true } } },
  })
  if (!order) return

  const [account, contact] = await Promise.all([
    order.accountId
      ? prisma.account.findUnique({ where: { id: order.accountId }, select: { id: true, name: true, email: true, phone: true, whatsapp: true } })
      : null,
    order.contactId
      ? prisma.contact.findUnique({ where: { id: order.contactId }, select: { email: true, mobile: true, whatsapp: true, firstName: true } })
      : null,
  ])

  const track = publicOrderUrl(order.id)
  const lines = order.items.map((l) => `• ${l.name} × ${Number(l.quantity)}`).join('\n')
  const tracking =
    order.trackingNumber ? `\nTracking: ${order.courier || ''} ${order.trackingNumber}`.trim() : ''
  const body =
    `${subject}.\n\nOrder ${order.orderNumber}${tracking}` +
    (track ? `\nTrack: ${track}` : '') +
    (order.podNotes && status === 'delivered' ? `\nPOD: ${order.podNotes}` : '') +
    `\n\n${lines}`

  const html = `<p>${subject}.</p>
    <p>Order <strong>${order.orderNumber}</strong>${order.trackingNumber ? ` · ${order.courier || ''} ${order.trackingNumber}` : ''}.</p>
    ${track ? `<p><a href="${track}">Track this shipment</a></p>` : ''}
    <ul>${order.items.map((l) => `<li>${l.name} × ${Number(l.quantity)}</li>`).join('')}</ul>`

  const to = contact?.email || account?.email
  if (to) {
    await emailService.send({ to, subject: `${order.orderNumber} — ${subject}`, html }).catch((err) => {
      console.error('[fulfillment] mail failed', order.orderNumber, err)
    })
  }

  const phone = contact?.whatsapp || contact?.mobile || account?.whatsapp || account?.phone
  let waSent = false
  if (phone) waSent = await sendWhatsApp(phone, body)

  if (order.accountId) {
    await activity.recordSafe({
      entityType: 'account',
      entityId: order.accountId,
      kind: waSent ? 'whatsapp' : 'email',
      subject: `${order.orderNumber} ${status.replace(/_/g, ' ')} notified`,
      body,
      meta: { orderId: Number(order.id), status, waSent, email: to ?? null },
    })
  }
}
