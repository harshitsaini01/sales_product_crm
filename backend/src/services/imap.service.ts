import { ImapFlow } from 'imapflow'

interface ImapConfig {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
}

function getImapConfig(): ImapConfig {
  const host = process.env.IMAP_HOST || process.env.SMTP_HOST
  const user = process.env.IMAP_USER || process.env.SMTP_USER
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS
  if (!host || !user || !pass) {
    throw new Error('IMAP not configured: set IMAP_HOST/IMAP_USER/IMAP_PASS env vars')
  }
  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: process.env.IMAP_SECURE !== 'false',
    auth: { user, pass },
  }
}

async function withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({ ...getImapConfig(), logger: false })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => {})
  }
}

export interface ImapFolder {
  path: string
  name: string
  delimiter: string
  flags: string[]
  specialUse?: string
  unread?: number
  total?: number
}

export interface ImapMessage {
  uid: number
  seq: number
  subject: string
  from: { name?: string; address: string }
  to: { name?: string; address: string }[]
  date: string
  flags: string[]
  seen: boolean
  bodyPreview: string
  hasAttachments: boolean
}

export interface ImapMessageFull extends ImapMessage {
  html: string | null
  text: string | null
}

export async function listFolders(): Promise<ImapFolder[]> {
  return withConnection(async (client) => {
    const list = await client.list()
    const result: ImapFolder[] = []
    for (const f of list) {
      let unread: number | undefined
      let total: number | undefined
      try {
        const status = await client.status(f.path, { messages: true, unseen: true })
        unread = status.unseen
        total = status.messages
      } catch {
        // skip un-statusable folders (e.g. \Noselect)
      }
      result.push({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter,
        flags: Array.from(f.flags),
        specialUse: f.specialUse,
        unread,
        total,
      })
    }
    return result
  })
}

export async function listMessages(
  folder = 'INBOX',
  page = 1,
  limit = 25,
): Promise<{ messages: ImapMessage[]; total: number; page: number; totalPages: number }> {
  return withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      const status = await client.status(folder, { messages: true })
      const total = status.messages || 0
      if (total === 0) {
        return { messages: [], total: 0, page, totalPages: 0 }
      }
      const totalPages = Math.ceil(total / limit)
      const safePage = Math.max(1, Math.min(page, totalPages))
      // Newest first: pick the trailing slice of seq numbers
      const endSeq = total - (safePage - 1) * limit
      const startSeq = Math.max(1, endSeq - limit + 1)
      const range = `${startSeq}:${endSeq}`

      const messages: ImapMessage[] = []
      for await (const msg of client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        // BODY.PEEK[TEXT]<0.500> would be ideal but imapflow uses bodyParts; preview computed below
        source: false,
      })) {
        const env = msg.envelope
        const flags = Array.from(msg.flags || [])
        messages.push({
          uid: msg.uid as number,
          seq: msg.seq as number,
          subject: env?.subject || '(no subject)',
          from: {
            name: env?.from?.[0]?.name,
            address: env?.from?.[0]?.address || '',
          },
          to: (env?.to || []).map((t) => ({ name: t.name, address: t.address || '' })),
          date: env?.date ? new Date(env.date).toISOString() : new Date().toISOString(),
          flags,
          seen: flags.includes('\\Seen'),
          bodyPreview: '',
          hasAttachments: hasAttachmentInStructure(msg.bodyStructure),
        })
      }
      // Reverse so newest is first
      messages.reverse()
      return { messages, total, page: safePage, totalPages }
    } finally {
      lock.release()
    }
  })
}

export async function getMessage(folder: string, uid: number): Promise<ImapMessageFull | null> {
  return withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      const msg = await client.fetchOne(
        String(uid),
        { envelope: true, flags: true, bodyStructure: true, source: true },
        { uid: true },
      )
      if (!msg) return null

      // Pull text + html parts
      let html: string | null = null
      let text: string | null = null
      const htmlPart = findPart(msg.bodyStructure, 'text/html')
      const textPart = findPart(msg.bodyStructure, 'text/plain')
      if (htmlPart) {
        const dl = await client.download(String(uid), htmlPart, { uid: true })
        html = await streamToString(dl?.content)
      }
      if (textPart) {
        const dl = await client.download(String(uid), textPart, { uid: true })
        text = await streamToString(dl?.content)
      }

      // Mark as seen
      try {
        await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true })
      } catch {
        // ignore
      }

      const env = msg.envelope
      const flags = Array.from(msg.flags || [])
      return {
        uid: msg.uid as number,
        seq: msg.seq as number,
        subject: env?.subject || '(no subject)',
        from: {
          name: env?.from?.[0]?.name,
          address: env?.from?.[0]?.address || '',
        },
        to: (env?.to || []).map((t) => ({ name: t.name, address: t.address || '' })),
        date: env?.date ? new Date(env.date).toISOString() : new Date().toISOString(),
        flags,
        seen: true,
        bodyPreview: (text || stripHtml(html || '')).slice(0, 200),
        hasAttachments: hasAttachmentInStructure(msg.bodyStructure),
        html,
        text,
      }
    } finally {
      lock.release()
    }
  })
}

export async function markSeen(folder: string, uid: number, seen: boolean): Promise<void> {
  return withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      if (seen) {
        await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true })
      } else {
        await client.messageFlagsRemove({ uid: String(uid) }, ['\\Seen'], { uid: true })
      }
    } finally {
      lock.release()
    }
  })
}

export async function deleteMessage(folder: string, uid: number): Promise<void> {
  return withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      await client.messageDelete({ uid: String(uid) }, { uid: true })
    } finally {
      lock.release()
    }
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPart(structure: any, mime: string, prefix = ''): string | null {
  if (!structure) return null
  if (Array.isArray(structure.childNodes) && structure.childNodes.length > 0) {
    for (let i = 0; i < structure.childNodes.length; i++) {
      const child = structure.childNodes[i]
      const part = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      const found = findPart(child, mime, part)
      if (found) return found
    }
    return null
  }
  const t = `${structure.type}/${structure.subtype}`.toLowerCase()
  if (t === mime) return structure.part || prefix || '1'
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAttachmentInStructure(structure: any): boolean {
  if (!structure) return false
  if (Array.isArray(structure.childNodes)) {
    return structure.childNodes.some(hasAttachmentInStructure)
  }
  const disposition = structure.disposition?.toLowerCase?.()
  return disposition === 'attachment'
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function streamToString(stream: NodeJS.ReadableStream | null | undefined): Promise<string> {
  if (!stream) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return Buffer.concat(chunks).toString('utf8')
}
