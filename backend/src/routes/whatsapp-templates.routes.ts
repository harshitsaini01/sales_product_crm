import { Hono } from 'hono'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { uploadArray } from '../middleware/upload'

export const whatsappTemplateRoutes = new Hono()

whatsappTemplateRoutes.use('*', authenticate)

// ─── GET /api/whatsapp-templates ──────────────────────────────────────────────
whatsappTemplateRoutes.get('/', async (c) => {
  const category = c.req.query('category')
  const search = c.req.query('search')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { status: 1 }
  if (category && category !== 'all') {
    where.category = category
  }
  if (search && search.trim()) {
    where.OR = [
      { title: { contains: search.trim(), mode: 'insensitive' } },
      { description: { contains: search.trim(), mode: 'insensitive' } },
    ]
  }

  const templates = await prisma.whatsappTemplate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      attachments: true,
      user: { select: { id: true, name: true, email: true } },
    },
  })

  // Format BigInt fields for JSON response
  const formatted = templates.map((t) => ({
    ...t,
    id: Number(t.id),
    userId: Number(t.userId),
    user: t.user ? { ...t.user, id: Number(t.user.id) } : null,
    attachments: t.attachments.map((f) => ({
      ...f,
      id: Number(f.id),
      templateId: Number(f.templateId),
      fileSize: f.fileSize ? Number(f.fileSize) : null,
    })),
  }))

  return c.json(formatted)
})

// ─── GET /api/whatsapp-templates/:id ─────────────────────────────────────────
whatsappTemplateRoutes.get('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))
  const template = await prisma.whatsappTemplate.findUnique({
    where: { id },
    include: {
      attachments: true,
      user: { select: { id: true, name: true, email: true } },
    },
  })

  if (!template || template.status === 0) {
    return c.json({ error: 'Template not found' }, 404)
  }

  const formatted = {
    ...template,
    id: Number(template.id),
    userId: Number(template.userId),
    user: template.user ? { ...template.user, id: Number(template.user.id) } : null,
    attachments: template.attachments.map((f) => ({
      ...f,
      id: Number(f.id),
      templateId: Number(f.templateId),
      fileSize: f.fileSize ? Number(f.fileSize) : null,
    })),
  }

  return c.json(formatted)
})

// ─── POST /api/whatsapp-templates ────────────────────────────────────────────
whatsappTemplateRoutes.post('/', uploadArray('files', 10), async (c) => {
  const { userId } = c.get('user')
  
  // Extract body fields from incoming request (processed by Multer middleware)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incoming = (c.env as any)?.incoming
  const body = incoming?.body || {}
  
  const title = (body.title as string || '').trim()
  const description = (body.description as string || '').trim()
  const category = (body.category as string || 'greeting').trim().toLowerCase()

  if (!title) {
    return c.json({ error: 'Title is required' }, 400)
  }
  if (!description) {
    return c.json({ error: 'Description is required' }, 400)
  }

  // Handle uploaded file metadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filesList = (incoming?.files as Express.Multer.File[]) || (incoming?.file ? [incoming.file] : [])
  const attachmentData = filesList.map((file) => ({
    filePath: `/uploads/${path.basename(file.filename)}`,
    fileName: file.originalname,
    fileType: file.mimetype,
    fileSize: BigInt(file.size),
  }))

  // Create WhatsApp template record with nested file attachments
  const template = await prisma.whatsappTemplate.create({
    data: {
      title,
      description,
      category,
      userId: BigInt(userId),
      attachments: {
        create: attachmentData,
      },
    },
    include: {
      attachments: true,
      user: { select: { id: true, name: true, email: true } },
    },
  })

  const formatted = {
    ...template,
    id: Number(template.id),
    userId: Number(template.userId),
    user: template.user ? { ...template.user, id: Number(template.user.id) } : null,
    attachments: template.attachments.map((f) => ({
      ...f,
      id: Number(f.id),
      templateId: Number(f.templateId),
      fileSize: f.fileSize ? Number(f.fileSize) : null,
    })),
  }

  return c.json(formatted, 201)
})

// ─── PATCH /api/whatsapp-templates/:id ───────────────────────────────────────
whatsappTemplateRoutes.patch('/:id', uploadArray('files', 10), async (c) => {
  const id = BigInt(c.req.param('id'))

  const existing = await prisma.whatsappTemplate.findUnique({
    where: { id },
  })
  if (!existing || existing.status === 0) {
    return c.json({ error: 'Template not found' }, 404)
  }

  // Extract body fields from Multer incoming object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incoming = (c.env as any)?.incoming
  const body = incoming?.body || {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {}
  if (body.title !== undefined) updateData.title = String(body.title).trim()
  if (body.description !== undefined) updateData.description = String(body.description).trim()
  if (body.category !== undefined) updateData.category = String(body.category).trim().toLowerCase()

  // Process newly uploaded files
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filesList = (incoming?.files as Express.Multer.File[]) || (incoming?.file ? [incoming.file] : [])
  if (filesList.length > 0) {
    updateData.attachments = {
      create: filesList.map((file) => ({
        filePath: `/uploads/${path.basename(file.filename)}`,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: BigInt(file.size),
      })),
    }
  }

  const updated = await prisma.whatsappTemplate.update({
    where: { id },
    data: updateData,
    include: {
      attachments: true,
      user: { select: { id: true, name: true, email: true } },
    },
  })

  const formatted = {
    ...updated,
    id: Number(updated.id),
    userId: Number(updated.userId),
    user: updated.user ? { ...updated.user, id: Number(updated.user.id) } : null,
    attachments: updated.attachments.map((f) => ({
      ...f,
      id: Number(f.id),
      templateId: Number(f.templateId),
      fileSize: f.fileSize ? Number(f.fileSize) : null,
    })),
  }

  return c.json(formatted)
})

// ─── DELETE /api/whatsapp-templates/:id ──────────────────────────────────────
whatsappTemplateRoutes.delete('/:id', async (c) => {
  const id = BigInt(c.req.param('id'))

  const template = await prisma.whatsappTemplate.findUnique({
    where: { id },
    include: { attachments: true },
  })

  if (!template) {
    return c.json({ error: 'Template not found' }, 404)
  }

  // Unlink file attachments from disk
  for (const file of template.attachments) {
    try {
      const fullPath = path.join(process.cwd(), file.filePath)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }
    } catch (e) {
      console.error(`Failed to delete file ${file.filePath}:`, e)
    }
  }

  // Delete from DB (cascade deletes attachment rows)
  await prisma.whatsappTemplate.delete({ where: { id } })

  return c.json({ message: 'WhatsApp template deleted successfully' })
})

// ─── DELETE /api/whatsapp-templates/files/:fileId ───────────────────────────
whatsappTemplateRoutes.delete('/files/:fileId', async (c) => {
  const fileId = BigInt(c.req.param('fileId'))

  const fileRecord = await prisma.whatsappTemplateFile.findUnique({
    where: { id: fileId },
  })

  if (!fileRecord) {
    return c.json({ error: 'Attachment file not found' }, 404)
  }

  // Remove file from disk
  try {
    const fullPath = path.join(process.cwd(), fileRecord.filePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
    }
  } catch (e) {
    console.error(`Failed to delete physical file ${fileRecord.filePath}:`, e)
  }

  // Remove file record from DB
  await prisma.whatsappTemplateFile.delete({ where: { id: fileId } })

  return c.json({ message: 'Attachment removed successfully' })
})
