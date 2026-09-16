import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, Film, Image as ImageIcon, Paperclip, X, Download, File as FileIcon,
  FileSpreadsheet, FileArchive, Music, Trash2, ChevronDown,
} from 'lucide-react'
import {
  teamsApi, fileUrl, formatBytes, statusMeta, PROJECT_PRIORITIES,
  type ProjectFile, type ProjectUser, type TeamMember,
} from '@/lib/projects-api'
import { cn } from '@/lib/utils'

/**
 * The small parts every project screen is built from — one definition each,
 * so a status pill on the list, the detail page and the lead panel cannot
 * drift apart.
 */

// ─── Status & priority ────────────────────────────────────────────────────────

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status)
  return (
    <span
      title={m.hint}
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', m.tone, className)}
    >
      {m.label}
    </span>
  )
}

export function PriorityMark({ priority }: { priority: string }) {
  const m = PROJECT_PRIORITIES.find((p) => p.value === priority) ?? PROJECT_PRIORITIES[1]
  if (priority === 'medium') return null
  return <span className={cn('text-[11px] font-semibold uppercase tracking-wide', m.tone)}>{m.label}</span>
}

// ─── People ───────────────────────────────────────────────────────────────────

export function Avatar({ user, size = 'md' }: { user: ProjectUser | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
  if (user?.imgpath) {
    return <img src={fileUrl(user.imgpath)} alt={user.name} className={cn('shrink-0 rounded-full object-cover', dim)} />
  }
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary', dim)}>
      {initials || '?'}
    </div>
  )
}

export function Person({ user, label, sub }: { user: ProjectUser | null | undefined; label?: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar user={user} />
      <div className="min-w-0">
        {label && <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>}
        <p className="truncate text-sm font-medium">{user?.name ?? <span className="text-muted-foreground">Nobody yet</span>}</p>
        {(sub ?? user?.designation) && <p className="truncate text-xs text-muted-foreground">{sub ?? user?.designation}</p>}
      </div>
    </div>
  )
}

// ─── Team → member picker ─────────────────────────────────────────────────────

/**
 * Pick a department, then somebody in it.
 *
 * The member list is read live from the team, so it is whoever is an active
 * member right now — a rep cannot hand a brief to someone who left.
 */
export function TeamMemberPicker({
  teamId,
  assigneeId,
  onChange,
  compact,
}: {
  teamId: number | null
  assigneeId: number | null
  onChange: (next: { teamId: number | null; assigneeId: number | null }) => void
  compact?: boolean
}) {
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list(), staleTime: 60_000 })
  const team = teams.find((t) => t.id === teamId) ?? null
  const members: TeamMember[] = (team?.members ?? []).filter((m) => m.active)
  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

  return (
    <div className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : '')}>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Department</label>
        <select
          className={input}
          value={teamId ?? ''}
          onChange={(e) => onChange({ teamId: e.target.value ? Number(e.target.value) : null, assigneeId: null })}
        >
          <option value="">Choose a department…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.members.filter((m) => m.active).length ? ` (${t.members.filter((m) => m.active).length})` : ' (no members)'}
            </option>
          ))}
        </select>
        {!teams.length && (
          <p className="mt-1 text-xs text-muted-foreground">
            No departments yet. An admin creates them under Administration → Teams.
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Assign to</label>
        <select
          className={input}
          value={assigneeId ?? ''}
          disabled={!team}
          onChange={(e) => onChange({ teamId, assigneeId: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{team ? (members.length ? 'Pick a person…' : 'No active members in this team') : 'Pick a department first'}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.memberRole === 'lead' ? ' · team lead' : m.designation ? ` · ${m.designation}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ─── Files ────────────────────────────────────────────────────────────────────

export function fileIcon(type: string | null | undefined) {
  const t = type ?? ''
  if (t.startsWith('image/')) return ImageIcon
  if (t.startsWith('video/')) return Film
  if (t.startsWith('audio/')) return Music
  if (t === 'application/pdf') return FileText
  if (t.includes('spreadsheet') || t.includes('excel') || t === 'text/csv') return FileSpreadsheet
  if (t.includes('zip') || t.includes('compressed') || t.includes('rar')) return FileArchive
  return FileIcon
}

/**
 * Attachments as they appear on a message or in the project's file drawer:
 * images and videos inline, everything else as a card that opens or downloads.
 */
export function AttachmentGrid({
  files,
  onRemove,
  dense,
}: {
  files: ProjectFile[]
  onRemove?: (file: ProjectFile) => void
  dense?: boolean
}) {
  const [preview, setPreview] = useState<ProjectFile | null>(null)
  if (!files.length) return null

  const media = files.filter((f) => f.isImage || f.isVideo)
  const docs = files.filter((f) => !f.isImage && !f.isVideo)

  return (
    <div className="space-y-2">
      {!!media.length && (
        <div className={cn('grid gap-2', dense ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
          {media.map((f) => (
            <div key={f.id} className="group relative overflow-hidden rounded-lg border bg-muted">
              {f.isImage ? (
                <button type="button" onClick={() => setPreview(f)} className="block w-full">
                  <img src={fileUrl(f.filePath)} alt={f.fileName} className="aspect-video w-full object-cover" loading="lazy" />
                </button>
              ) : (
                <video src={fileUrl(f.filePath)} controls preload="metadata" className="aspect-video w-full bg-black" />
              )}
              <div className="flex items-center justify-between gap-1 px-2 py-1">
                <span className="truncate text-[11px]" title={f.fileName}>{f.fileName}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(f.fileSize)}</span>
              </div>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(f)}
                  title="Remove"
                  className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!!docs.length && (
        <div className="flex flex-wrap gap-2">
          {docs.map((f) => {
            const Icon = fileIcon(f.fileType)
            return (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <a
                  href={fileUrl(f.filePath)}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[220px] truncate font-medium hover:text-primary"
                  title={f.fileName}
                >
                  {f.fileName}
                </a>
                <span className="text-muted-foreground">{formatBytes(f.fileSize)}</span>
                <a href={fileUrl(f.filePath)} download={f.fileName} title="Download" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <Download className="h-3.5 w-3.5" />
                </a>
                {onRemove && (
                  <button type="button" onClick={() => onRemove(f)} title="Remove" className="rounded p-0.5 text-muted-foreground hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" onClick={() => setPreview(null)}>
            <X className="h-5 w-5" />
          </button>
          <img src={fileUrl(preview.filePath)} alt={preview.fileName} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

/** Files chosen but not yet uploaded — the composer's tray. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, i) => {
        const Icon = fileIcon(f.type)
        const url = f.type.startsWith('image/') ? URL.createObjectURL(f) : null
        return (
          <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
            {url ? <img src={url} alt="" className="h-6 w-6 rounded object-cover" onLoad={() => URL.revokeObjectURL(url)} /> : <Icon className="h-4 w-4 text-muted-foreground" />}
            <span className="max-w-[180px] truncate">{f.name}</span>
            <span className="text-muted-foreground">{formatBytes(f.size)}</span>
            <button type="button" onClick={() => onRemove(i)} className="rounded p-0.5 hover:text-rose-600">
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** An "Attach" button plus drag-and-drop onto the wrapped area. */
export function FilePicker({
  onPick,
  maxBytes,
  children,
  className,
}: {
  onPick: (files: File[]) => void
  maxBytes?: number
  children?: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const accept = (list: FileList | File[]) => {
    const files = Array.from(list)
    const ok = maxBytes ? files.filter((f) => f.size <= maxBytes) : files
    if (ok.length !== files.length) {
      alert(`Some files were skipped: the limit is ${formatBytes(maxBytes)} each.`)
    }
    if (ok.length) onPick(ok)
  }

  return (
    <div
      className={cn('relative', over && 'ring-2 ring-primary/40 rounded-lg', className)}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        accept(e.dataTransfer.files)
      }}
    >
      {children}
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) accept(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
      >
        <Paperclip className="h-3.5 w-3.5" /> Attach files
      </button>
    </div>
  )
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function when(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A dropdown of actions, closing on outside click. */
export function Menu({ label, items }: { label: React.ReactNode; items: { label: string; onClick: () => void; tone?: 'danger' }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        {label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[190px] overflow-hidden rounded-lg border bg-card py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              className={cn('block w-full px-3 py-2 text-left text-sm hover:bg-accent', it.tone === 'danger' && 'text-rose-600')}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
