import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { buildInvoicePdf } from '../services/financial/invoice-pdf.service'

export const financialRoutes = new Hono()

financialRoutes.use('*', authenticate)

financialRoutes.post('/invoices', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json()

  const invoice = await prisma.invoice.create({
    data: {
      leadId: BigInt(body.leadId),
      userId: BigInt(userId),
      invoiceNo: `INV-${Date.now()}`,
      amount: body.amount,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      description: body.description,
    },
  })

  return c.json(invoice, 201)
})

financialRoutes.get('/invoices', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)
  const leadId = c.req.query('leadId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '25')

  const where: Record<string, unknown> = {}
  if (leadId) where.leadId = BigInt(leadId)
  if (!isAdmin) where.userId = BigInt(userId)

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { createdAt: 'desc' },
      include: { payments: true, user: { select: { id: true, name: true } } },
    }),
  ])

  return c.json({ data: invoices, total, page, limit, totalPages: Math.ceil(total / limit) })
})

// GET /api/financial/invoices/:id/pdf — generated invoice PDF (Common.GetInvoicePdf parity)
financialRoutes.get('/invoices/:id/pdf', async (c) => {
  const id = BigInt(c.req.param('id'))
  try {
    const pdf = await buildInvoicePdf({ invoiceId: id })
    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { invoiceNo: true } })
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${invoice?.invoiceNo || id}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to generate PDF'
    return c.json({ error: msg }, 404)
  }
})

financialRoutes.get('/invoices/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: true, user: { select: { id: true, name: true } } },
  })
  if (!invoice) return c.json({ error: 'Not found' }, 404)
  return c.json(invoice)
})

financialRoutes.patch('/invoices/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  const body = await c.req.json()
  const invoice = await prisma.invoice.update({
    where: { id },
    data: { amount: body.amount, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, status: body.status, description: body.description },
  })
  return c.json(invoice)
})

financialRoutes.delete('/invoices/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.invoice.delete({ where: { id } })
  return c.json({ message: 'Invoice deleted' })
})

financialRoutes.post('/payments', async (c) => {
  const body = await c.req.json()

  const payment = await prisma.feePayment.create({
    data: {
      invoiceId: BigInt(body.invoiceId),
      leadId: BigInt(body.leadId),
      amount: body.amount,
      paidAt: new Date(body.paidAt),
      mode: body.mode,
      note: body.note,
    },
  })

  return c.json(payment, 201)
})

financialRoutes.delete('/payments/:id', adminOnly, async (c) => {
  const id = BigInt(c.req.param('id'))
  await prisma.feePayment.delete({ where: { id } })
  return c.json({ message: 'Payment deleted' })
})
