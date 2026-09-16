import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

export const webmailAccountsRoutes = new Hono()

webmailAccountsRoutes.use('*', authenticate)
webmailAccountsRoutes.use('*', adminOnly)

const webmailAccountSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
  webmailUrl: z.string().url('Valid webmail URL is required').default('https://webmail.tutelagestudy.com'),
})

const updateWebmailAccountSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().optional(),
  webmailUrl: z.string().url('Valid webmail URL is required').default('https://webmail.tutelagestudy.com'),
})

// GET /api/webmail-accounts — List webmail accounts
webmailAccountsRoutes.get('/', async (c) => {
  const accounts = await prisma.webmailAccount.findMany({
    where: { status: 1 },
    orderBy: { createdAt: 'desc' },
  })

  const data = accounts.map((a) => ({
    id: Number(a.id),
    email: a.email,
    password: a.password,
    webmailUrl: a.webmailUrl,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }))

  return c.json(data)
})

// POST /api/webmail-accounts — Create webmail account
webmailAccountsRoutes.post('/', zValidator('json', webmailAccountSchema), async (c) => {
  const body = c.req.valid('json')
  const webmailUrl = body.webmailUrl.replace(/\/+$/, '')

  const account = await prisma.webmailAccount.create({
    data: {
      email: body.email.trim(),
      password: body.password,
      webmailUrl,
      status: 1,
    },
  })

  return c.json({
    message: 'Webmail account added successfully',
    account: {
      id: Number(account.id),
      email: account.email,
      webmailUrl: account.webmailUrl,
      createdAt: account.createdAt,
    },
  }, 201)
})

// PUT /api/webmail-accounts/:id — Update webmail account
webmailAccountsRoutes.put('/:id', zValidator('json', updateWebmailAccountSchema), async (c) => {
  const idRaw = c.req.param('id')
  if (!/^\d+$/.test(idRaw)) {
    return c.json({ error: 'Invalid account ID' }, 400)
  }
  const id = BigInt(idRaw)
  const body = c.req.valid('json')

  const existing = await prisma.webmailAccount.findFirst({
    where: { id, status: 1 },
  })
  if (!existing) {
    return c.json({ error: 'Webmail account not found' }, 404)
  }

  const webmailUrl = body.webmailUrl.replace(/\/+$/, '')
  const updateData: { email: string; webmailUrl: string; password?: string } = {
    email: body.email.trim(),
    webmailUrl,
  }
  if (body.password && body.password.trim()) {
    updateData.password = body.password
  }

  const updated = await prisma.webmailAccount.update({
    where: { id },
    data: updateData,
  })

  return c.json({
    message: 'Webmail account updated successfully',
    account: {
      id: Number(updated.id),
      email: updated.email,
      webmailUrl: updated.webmailUrl,
      updatedAt: updated.updatedAt,
    },
  })
})

// DELETE /api/webmail-accounts/:id — Delete webmail account
webmailAccountsRoutes.delete('/:id', async (c) => {
  const idRaw = c.req.param('id')
  if (!/^\d+$/.test(idRaw)) {
    return c.json({ error: 'Invalid account ID' }, 400)
  }
  const id = BigInt(idRaw)

  const existing = await prisma.webmailAccount.findFirst({
    where: { id, status: 1 },
  })
  if (!existing) {
    return c.json({ error: 'Webmail account not found' }, 404)
  }

  await prisma.webmailAccount.update({
    where: { id },
    data: { status: 0 },
  })

  return c.json({ message: 'Webmail account deleted successfully' })
})

// GET /api/webmail-accounts/:id/login-url — Direct auto-login URL for cPanel Webmail
webmailAccountsRoutes.get('/:id/login-url', async (c) => {
  const idRaw = c.req.param('id')
  if (!/^\d+$/.test(idRaw)) {
    return c.json({ error: 'Invalid account ID' }, 400)
  }
  const id = BigInt(idRaw)

  const account = await prisma.webmailAccount.findFirst({
    where: { id, status: 1 },
  })
  if (!account) {
    return c.json({ error: 'Webmail account not found' }, 404)
  }

  const baseUrl = account.webmailUrl.replace(/\/+$/, '')
  const loginUrl = `${baseUrl}/login/?user=${encodeURIComponent(account.email)}&pass=${encodeURIComponent(account.password)}&login_theme=cpanel&goto_uri=%2F`

  return c.json({ loginUrl })
})
