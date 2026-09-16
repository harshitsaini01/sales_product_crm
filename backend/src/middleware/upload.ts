import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { createMiddleware } from 'hono/factory'
import { UPLOADS_ROOT, currentUploadsDir } from '../utils/tenant-paths'

const UPLOADS_DIR = UPLOADS_ROOT

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

const storage = multer.diskStorage({
  // Files land under the CURRENT customer's folder. The original install keeps
  // writing to uploads/ root, so every path already stored in its database
  // still resolves — see utils/tenant-paths.ts.
  destination: (_req, _file, cb) => {
    const dir = currentUploadsDir()
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir))
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
    cb(null, `${Date.now()}_${base}${ext}`)
  },
})

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = [
    'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp',
    'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]
  if (allowed.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('File type not allowed'))
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } })

// ─── Project attachments ──────────────────────────────────────────────────────
//
// A proposal thread carries mock-ups, walkthrough videos, signed PDFs, decks,
// zipped source. The document filter above is right for a student's passport
// scan and wrong for that, so this is a second instance with a broader list
// and a bigger ceiling — kept separate so the existing uploads keep exactly
// the limits they have.
const MEDIA_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/heic',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown', 'application/json',
  'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed', 'application/x-rar-compressed',
])

const mediaFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (MEDIA_MIME.has(file.mimetype)) cb(null, true)
  else cb(new Error(`File type not allowed: ${file.mimetype}`))
}

export const MEDIA_MAX_BYTES = 200 * 1024 * 1024

const media = multer({ storage, fileFilter: mediaFilter, limits: { fileSize: MEDIA_MAX_BYTES } })

/** Several files under one field name, media rules. */
export function uploadMedia(field: string, maxCount = 10) {
  return createMiddleware(async (c, next) => {
    const handler = media.array(field, maxCount)
    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler(c.env.incoming as any, c.env.outgoing as any, (err: unknown) => {
        if (err) reject(err)
        else resolve()
      })
    })
    await next()
  })
}

/**
 * The URL path a stored file is served at.
 *
 * `/uploads/<relative-to-uploads-root>` — so a file written to
 * uploads/t/britannica_bots/123_brief.pdf is served at
 * /uploads/t/britannica_bots/123_brief.pdf, where the uploads guard checks the
 * customer. Older code hardcodes `/uploads/${basename}`, which only resolves for
 * the original install whose files sit at the root.
 */
export function storedUploadPath(file: { path: string }): string {
  const rel = path.relative(UPLOADS_ROOT, file.path).split(path.sep).join('/')
  return `/uploads/${rel}`
}

/** Back from the served path to the file on disk — for mail attachments. */
export function uploadDiskPath(storedPath: string): string {
  const rel = storedPath.replace(/^\/?uploads\//, '').replace(/^\/+/, '')
  return path.join(UPLOADS_ROOT, ...rel.split('/'))
}

// Hono middleware wrapper for single file upload
export function uploadSingle(field: string) {
  return createMiddleware(async (c, next) => {
    const handler = upload.single(field)
    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler(c.env.incoming as any, c.env.outgoing as any, (err: unknown) => {
        if (err) reject(err)
        else resolve()
      })
    })
    await next()
  })
}

// Hono middleware wrapper for multiple files upload
export function uploadArray(field: string, maxCount = 10) {
  return createMiddleware(async (c, next) => {
    const handler = upload.array(field, maxCount)
    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler(c.env.incoming as any, c.env.outgoing as any, (err: unknown) => {
        if (err) reject(err)
        else resolve()
      })
    })
    await next()
  })
}

