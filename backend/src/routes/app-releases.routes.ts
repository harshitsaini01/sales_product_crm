import { Hono } from 'hono'
import { authenticate, authenticateAny, verifyAnyToken, checkSessionValidity } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { createMiddleware } from 'hono/factory'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bigintFix(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(bigintFix)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = bigintFix(obj[k])
    return out
  }
  return obj
}

const RELEASES_DIR = path.join(process.cwd(), 'uploads', 'app-releases')
if (!fs.existsSync(RELEASES_DIR)) fs.mkdirSync(RELEASES_DIR, { recursive: true })

const apkStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RELEASES_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.apk'
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)}${ext.endsWith('.apk') ? '' : '.apk'}`)
  },
})
const apkUpload = multer({
  storage: apkStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB cap
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/vnd.android.package-archive'
      || file.originalname.toLowerCase().endsWith('.apk')
    cb(null, ok)
  },
})

function uploadApk(field: string) {
  return createMiddleware(async (c, next) => {
    const handler = apkUpload.single(field)
    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler((c.env as { incoming: unknown }).incoming as any, (c.env as { outgoing: unknown }).outgoing as any, (err: unknown) => {
        if (err) reject(err)
        else resolve()
      })
    })
    await next()
  })
}

function sha256OfFile(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(p)
    s.on('error', reject)
    s.on('data', (d) => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * BigInt('abc') throws a SyntaxError, and these handlers called it directly on
 * an unvalidated path param — so /api/app-releases/xyz/download answered with an
 * opaque 500 instead of a 404.
 */
function parseId(raw: string | undefined): bigint | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

export const appReleasesRoutes = new Hono()

// ─── Admin: upload a new release ────────────────────────────────────────────
appReleasesRoutes.post('/', authenticate, adminOnly, uploadApk('apk'), async (c) => {
  const requester = c.get('user')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = ((c.env as { incoming: unknown }).incoming as any).file as Express.Multer.File | undefined
  if (!file) return c.json({ error: 'No APK uploaded' }, 400)

  // Form fields are on the request body — multer parses them automatically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = ((c.env as { incoming: unknown }).incoming as any).body as Record<string, string>
  const versionCode = Number(body.versionCode)
  const versionName = String(body.versionName ?? '').trim()
  const releaseNotes = body.releaseNotes ? String(body.releaseNotes) : null
  const isMandatory = body.isMandatory === 'true' || body.isMandatory === '1'
  // Defaults to NOT published: uploading an APK and releasing it to the field
  // are two decisions, and conflating them is how one bad row reaches everyone.
  const isPublished = body.isPublished === 'true' || body.isPublished === '1'

  if (!Number.isFinite(versionCode) || versionCode <= 0 || !versionName) {
    fs.unlink(file.path, () => undefined)
    return c.json({ error: 'versionCode (number) and versionName (string) are required' }, 400)
  }

  // Reject duplicates
  const existing = await prisma.appRelease.findUnique({ where: { versionCode } })
  if (existing) {
    fs.unlink(file.path, () => undefined)
    return c.json({ error: `versionCode ${versionCode} already uploaded` }, 409)
  }

  const sha256 = await sha256OfFile(file.path)
  const relPath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')

  const row = await prisma.appRelease.create({
    data: {
      versionCode,
      versionName,
      fileUrl: relPath,
      sha256,
      sizeBytes: file.size,
      releaseNotes,
      isMandatory,
      isPublished,
      uploadedBy: BigInt(requester.userId),
    },
  })
  return c.json(bigintFix(row), 201)
})

// ─── List all releases (any authenticated user) ─────────────────────────────
appReleasesRoutes.get('/', authenticate, async (c) => {
  const rows = await prisma.appRelease.findMany({
    orderBy: { versionCode: 'desc' },
    include: { uploader: { select: { id: true, name: true } } },
    take: 100,
  })
  return c.json(bigintFix(rows))
})

// ─── Latest release (mobile auto-update check) ──────────────────────────────
appReleasesRoutes.get('/latest', authenticateAny, async (c) => {
  // isPublished, not just "highest versionCode". Without this filter a staged
  // or mistyped upload immediately prompted every counsellor — and if it was
  // flagged mandatory, hard-blocked them in a gate they could not dismiss.
  const row = await prisma.appRelease.findFirst({
    where: { isPublished: true },
    orderBy: { versionCode: 'desc' },
  })
  if (!row) return c.json(null)
  return c.json(bigintFix(row))
})

// ─── Stream APK download ────────────────────────────────────────────────────
// Header auth only. This used to also accept ?token=<jwt> so the admin page
// could use a plain <a href> — which put a full session JWT into nginx access
// logs, browser history and any outbound Referer. The web client now fetches
// the APK as a blob (see appReleasesApi.download), so the header is enough.
appReleasesRoutes.get('/:id/download', async (c) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!token) {
    return c.json({ error: 'Missing or invalid authorization header', reason: 'token_missing' }, 401)
  }
  const result = verifyAnyToken(token)
  if (!result.ok) {
    return c.json({
      error: result.reason === 'token_expired' ? 'Session expired, please sign in again' : 'Invalid token',
      reason: result.reason,
    }, 401)
  }
  const sessionError = await checkSessionValidity(result.payload, result.kind)
  if (sessionError) {
    return c.json({ error: sessionError, reason: 'session_invalidated' }, 401)
  }
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'Not found' }, 404)
  const row = await prisma.appRelease.findUnique({ where: { id } })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const abs = path.join(process.cwd(), row.fileUrl)
  if (!fs.existsSync(abs)) return c.json({ error: 'File missing' }, 410)

  const stat = fs.statSync(abs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = fs.createReadStream(abs) as any
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="tutelage-counsellor-${row.versionName}.apk"`,
    },
  })
})

// ─── Admin: publish / unpublish ─────────────────────────────────────────────
// The switch between "the APK is on the server" and "every counsellor's app is
// being told to install it". Unpublishing is the rollback that used to require
// deleting the row outright.
appReleasesRoutes.patch('/:id/publish', authenticate, adminOnly, async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'Not found' }, 404)
  const body = await c.req
    .json<{ isPublished?: boolean }>()
    .catch(() => ({}) as { isPublished?: boolean })
  if (typeof body.isPublished !== 'boolean') {
    return c.json({ error: 'isPublished (boolean) is required' }, 400)
  }
  const row = await prisma.appRelease.findUnique({ where: { id } })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.appRelease.update({
    where: { id },
    data: { isPublished: body.isPublished },
  })
  return c.json(bigintFix(updated))
})

// ─── Admin: delete a release ────────────────────────────────────────────────
appReleasesRoutes.delete('/:id', authenticate, adminOnly, async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'Not found' }, 404)
  const row = await prisma.appRelease.findUnique({ where: { id } })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const abs = path.join(process.cwd(), row.fileUrl)
  fs.unlink(abs, () => undefined)
  await prisma.appRelease.delete({ where: { id } })
  return c.json({ ok: true })
})
