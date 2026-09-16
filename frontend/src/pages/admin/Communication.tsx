import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { communicationApi } from '@/lib/api'
import { productsApi, formatMoney, type Product } from '@/lib/deals-api'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Pencil, Image as ImageIcon, Check, X, Star, Braces } from 'lucide-react'
import type { MailTemplate, Signature } from '@/types'
import { RichTextEditor } from '@/components/common/RichTextEditor'

// Token catalog fetched from the server so the frontend never invents a token
// the backend can't substitute. `sample` values feed the live preview.
export interface MailToken { key: string; label: string; sample: string }
function useMailTokens() {
  return useQuery<MailToken[]>({
    queryKey: ['comm', 'tokens'],
    queryFn: () => communicationApi.tokens(),
    staleTime: 60 * 60 * 1000,
  })
}

// The old single-send Compose form + the standalone Communication page were
// removed on request: the sidebar no longer has a "Messages" entry, and
// Templates + Signatures now live inside /app/mail. This shim keeps the
// /app/communication URL alive so any bookmark or in-app link (e.g. the old
// EmailConfig redirect) still works instead of 404'ing — it just bounces the
// user to the new home.
export function Communication() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate({ to: '/app/mail', replace: true })
  }, [navigate])
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Redirecting to Mail Management…
    </div>
  )
}

// ─── Image upload button ──────────────────────────────────────────────────────
// Shared helper used by both the template body editor and the signature editor.
// Uploads to /communication/upload-image and returns the absolute URL so the
// resulting <img> loads in every mail client (mail clients have no notion of
// a page origin — a bare "/uploads/x.png" would silently break in Gmail).

function ImageUploadButton({ onInsert }: { onInsert: (html: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handle = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file (png / jpg / gif / webp).')
      return
    }
    setBusy(true)
    try {
      const { url } = await communicationApi.uploadImage(file)
      // Absolute URL so the tag works in a recipient's inbox — a page-relative
      // "/uploads/…" would be undefined outside the CRM.
      // The API returns a public, absolute file URL. Keeping that origin is
      // essential: the portal hosts the SPA while uploaded assets are served
      // through the backend API route.
      onInsert(`<img src="${url}" alt="" style="max-width:100%;height:auto;" />`)
      toast.success('Image inserted')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-md hover:bg-muted disabled:opacity-50"
        title="Upload and insert an image at the end of the body"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
        Insert image
      </button>
    </>
  )
}

// ─── Live preview (iframe) ────────────────────────────────────────────────────
// Renders the composed HTML inside an isolated iframe so the CRM's Tailwind
// styles can't leak in. The old preview used `.prose prose-sm` — every heading
// / paragraph / list picked up nice typography spacing that recipients' inboxes
// don't have, so what looked polished on screen shipped as unstyled/broken
// markup. An iframe gives a WYSIWYG preview: pixel-for-pixel what a mail client
// renders (allowing for per-client quirks).
//
// The `subs` map substitutes tokens live so previewers see actual names, not
// literal `{{name}}` placeholders — matches the server-side personalize().
export function HtmlPreview({
  html,
  empty,
  subs,
  height = 320,
  wrap,
}: {
  html: string
  empty: string
  subs?: Record<string, string>
  height?: number
  wrap?: (bodyHtml: string) => string  // optional letterhead/signature wrapper
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const raw = (html || '').trim()
  const personalized = raw ? substituteTokens(raw, subs) : ''
  const wrapped = personalized ? (wrap ? wrap(personalized) : personalized) : ''
  const doc = wrapped
    ? `<!doctype html><html><head><meta charset="utf-8"><style>
         html,body{margin:0;padding:0;background:#ffffff;color:#111;}
         body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;padding:14px;}
         img{max-width:100%;height:auto;}
         a{color:#2563eb;}
       </style></head><body>${wrapped}</body></html>`
    : ''

  // srcDoc changes cause the iframe to reload; keeping it stable in a variable
  // avoids flashes on every keystroke.
  useEffect(() => {
    const el = iframeRef.current
    if (!el) return
    if (doc) el.srcdoc = doc
    else el.srcdoc = `<!doctype html><body style="font-family:Arial;color:#9ca3af;padding:14px;font-style:italic;">${escapeHtml(empty)}</body>`
  }, [doc, empty])

  return (
    <div className="border rounded-md bg-white overflow-hidden">
      <div className="px-3 py-1.5 border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
        <span>Preview · exactly what recipients see</span>
        <span className="text-[10px] normal-case font-normal text-muted-foreground">isolated iframe</span>
      </div>
      {/* sandbox="allow-scripts" — drops allow-same-origin so the iframe gets
          its OWN opaque origin (can't touch parent cookies/DOM) but scripts run
          normally. Without allow-scripts the browser logs a warning every time
          srcdoc is assigned, which the recipient's real inbox never does — so
          the preview lied about its own console output. Setting srcdoc via the
          DOM property still works from the parent regardless of sandbox flags. */}
      <iframe
        ref={iframeRef}
        title="Email preview"
        sandbox="allow-scripts"
        className="w-full block bg-white"
        style={{ height, border: 0 }}
      />
    </div>
  )
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}

// Same set of tokens the server understands. Passed either the token->sample
// map from the API, or a caller-supplied `subs` (e.g. real recipient name from
// the leads list). Missing keys collapse to an empty string.
export function substituteTokens(html: string, subs?: Record<string, string>): string {
  if (!subs) return html
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => subs[key] ?? '')
}

// ─── Token insert bar ─────────────────────────────────────────────────────────
// Renders one small button per available token; clicking inserts the literal
// `{{token}}` at the textarea's cursor position. Uses useLayoutEffect to restore
// the cursor AFTER React commits the new value — otherwise React re-syncs the
// textarea and drops the caret back to the end.

export function TokenInsertBar({
  tokens,
  textareaRef,
  value,
  onChange,
}: {
  tokens: MailToken[]
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
}) {
  const pendingCursor = useRef<number | null>(null)
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (ta && pendingCursor.current !== null) {
      ta.focus()
      ta.setSelectionRange(pendingCursor.current, pendingCursor.current)
      pendingCursor.current = null
    }
  }, [value, textareaRef])

  const insert = (key: string) => {
    const literal = `{{${key}}}`
    const ta = textareaRef.current
    if (!ta) {
      onChange(value + literal)
      return
    }
    const s = ta.selectionStart ?? value.length
    const e = ta.selectionEnd ?? value.length
    const next = value.slice(0, s) + literal + value.slice(e)
    pendingCursor.current = s + literal.length
    onChange(next)
  }

  if (tokens.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider mr-1">
        <Braces className="h-3 w-3" /> Insert
      </span>
      {tokens.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => insert(t.key)}
          className="text-[11px] px-2 py-0.5 border rounded bg-background hover:bg-muted"
          title={t.label + ' — inserts {{' + t.key + '}} at your cursor'}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function productToken(p: Product): string {
  return `{{product:${p.id}}}`
}

function hasProductToken(body: string, p: Product): boolean {
  const idRe = new RegExp(`\\{\\{\\s*product:${p.id}\\s*\\}\\}`)
  if (idRe.test(body)) return true
  if (p.sku) {
    const skuRe = new RegExp(`\\{\\{\\s*product:${p.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`)
    if (skuRe.test(body)) return true
  }
  return false
}

export function ProductInsertBar({
  body,
  onChange,
}: {
  body: string
  onChange: (next: string) => void
}) {
  const [q, setQ] = useState('')
  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', 'mail-picker'],
    queryFn: () => productsApi.list(),
    staleTime: 30_000,
  })

  const filtered = q.trim()
    ? products.filter((p) => {
        const hay = `${p.name} ${p.description || ''}`.toLowerCase()
        return hay.includes(q.trim().toLowerCase())
      })
    : products

  const gridOn = /\{\{\s*product_grid\s*\}\}/.test(body)

  function toggle(p: Product) {
    const token = productToken(p)
    if (hasProductToken(body, p)) {
      let next = body.replace(new RegExp(`\\{\\{\\s*product:${p.id}\\s*\\}\\}`, 'g'), '')
      if (p.sku) {
        next = next.replace(
          new RegExp(`\\{\\{\\s*product:${p.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'),
          '',
        )
      }
      onChange(next)
      return
    }
    onChange(`${body}${token}`)
  }

  function toggleAll() {
    if (gridOn) onChange(body.replace(/\{\{\s*product_grid\s*\}\}/g, ''))
    else onChange(`${body}{{product_grid}}`)
  }

  return (
    <div className="mt-1 mb-2 rounded-lg border bg-background p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Products
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products…"
          className="flex-1 min-w-[140px] px-2 py-1 text-xs border rounded-md bg-background"
        />
        <button
          type="button"
          onClick={toggleAll}
          className={`text-[11px] px-2 py-1 border rounded font-semibold ${
            gridOn ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
          }`}
        >
          {gridOn ? 'All products in mail' : 'Insert all products'}
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <p className="text-xs text-muted-foreground">Add products first, then pick them here for the template.</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No products match “{q}”.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
          {filtered.map((p) => {
            const on = hasProductToken(body, p) || gridOn
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p)}
                className={`text-left rounded-lg border overflow-hidden transition-colors ${
                  on ? 'border-primary ring-2 ring-primary/30' : 'hover:border-foreground/30'
                }`}
                title={p.description || p.name}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-20 w-full object-cover bg-muted" />
                ) : (
                  <div className="h-20 bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                    No photo
                  </div>
                )}
                <div className="p-1.5 space-y-0.5">
                  <p className="text-[11px] font-semibold line-clamp-2 leading-tight">{p.name}</p>
                  <p className="text-[11px] text-primary font-bold">{formatMoney(p.unitPrice, p.currency)}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Click a product to add it to this template. Click again to remove it. Recipients see photo, name, price and description.
      </p>
    </div>
  )
}

// Builds the sample-substitution map used to render live previews. Token
// samples come from the server catalog; counsellor tokens are overridden with
// the actual signed-in user so admins see "as sent from me" rather than a
// generic placeholder.
function useSampleSubs(tokens: MailToken[]): Record<string, string> {
  const user = useAuthStore((s) => s.user)
  const subs: Record<string, string> = {}
  for (const t of tokens) subs[t.key] = t.sample
  if (user?.name) {
    subs.counsellorName = user.name
    subs.counsellorFirstName = user.name.split(/\s+/)[0]
  }
  if (user?.email) subs.counsellorEmail = user.email
  return subs
}

// ─── Templates Tab ────────────────────────────────────────────────────────────
// Exported so /app/mail can mount it as a tab.

export function TemplatesTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', subject: '', body: '' })
  // Only one row can be in edit mode at a time — a second Pencil click cancels
  // the current edit. Keeping a single "editId + editForm" pair (not a map)
  // keeps the state model obvious and the rerender scope small.
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ title: '', subject: '', body: '' })
  // Textarea refs so the TokenInsertBar can drop {{tokens}} at the cursor,
  // not at the end. One per editor; only one is mounted at a time.
  const addBodyRef = useRef<HTMLTextAreaElement>(null)
  const editBodyRef = useRef<HTMLTextAreaElement>(null)

  const { data: tokens = [] } = useMailTokens()
  const subs = useSampleSubs(tokens)

  const { data: templates = [], isLoading, isError, error, refetch } = useQuery<MailTemplate[]>({
    queryKey: ['mail-templates'],
    queryFn: communicationApi.templates,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mail-templates'] })
    qc.invalidateQueries({ queryKey: ['comm', 'templates'] })
  }

  const create = useMutation({
    mutationFn: () => communicationApi.createTemplate(addForm),
    onSuccess: () => {
      invalidate()
      setShowAdd(false)
      setAddForm({ title: '', subject: '', body: '' })
      toast.success('Template created')
    },
    onError: () => toast.error('Failed to create template'),
  })

  const update = useMutation({
    mutationFn: (id: number) => communicationApi.updateTemplate(id, editForm),
    onSuccess: () => {
      invalidate()
      setEditId(null)
      toast.success('Template updated')
    },
    onError: () => toast.error('Failed to update template'),
  })

  const del = useMutation({
    mutationFn: (id: number) => communicationApi.deleteTemplate(id),
    onSuccess: () => {
      invalidate()
      toast.success('Template deleted')
    },
    onError: () => toast.error('Failed to delete template'),
  })

  const startEdit = (t: MailTemplate) => {
    setEditId(t.id)
    setEditForm({ title: t.title, subject: t.subject, body: t.body })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Email Templates</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Template
        </button>
      </div>

      {showAdd && (
        <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Template Name</label>
            <input value={addForm.title} onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Welcome Email"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <input value={addForm.subject} onChange={(e) => setAddForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Email subject"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Body (HTML)</label>
              <ImageUploadButton onInsert={(tag) => setAddForm((f) => ({ ...f, body: `${f.body}\n${tag}` }))} />
            </div>
            <div className="mt-1 mb-1.5">
              <TokenInsertBar
                tokens={tokens}
                textareaRef={addBodyRef}
                value={addForm.body}
                onChange={(v) => setAddForm((f) => ({ ...f, body: v }))}
              />
              <ProductInsertBar body={addForm.body} onChange={(body) => setAddForm((f) => ({ ...f, body }))} />
            </div>
            {/* <textarea ref={addBodyRef} value={addForm.body} onChange={(e) => setAddForm((f) => ({ ...f, body: e.target.value }))}
              rows={8} placeholder="<p>Hi {{firstName}},</p>…"
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono" /> */}
            <RichTextEditor value={addForm.body} onChange={(body) => setAddForm((f) => ({ ...f, body }))}
              minHeight="220px" placeholder="Write your email here, then use the toolbar for basic formatting." />
            <p className="text-[11px] text-muted-foreground mt-1">
              Click a token above to insert it at your cursor. Preview below shows exactly how a recipient sees it.
            </p>
          </div>
          <HtmlPreview html={addForm.body} empty="Body is empty" subs={subs} />
          <div className="flex gap-2">
            <button onClick={() => create.mutate()} disabled={create.isPending || !addForm.title}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 flex items-center gap-2">
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </button>
            <button onClick={() => { setShowAdd(false); setAddForm({ title: '', subject: '', body: '' }) }} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex items-center justify-between gap-3">
          <span>Could not load templates: {(error as any)?.response?.data?.error || 'Please try again.'}</span>
          <button type="button" onClick={() => refetch()} className="shrink-0 px-3 py-1 border border-rose-300 rounded hover:bg-white">Retry</button>
        </div>
      ) : !templates.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">No templates yet. Create one above.</p>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const isEditing = editId === t.id
            return (
              <div key={t.id} className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.subject}</div>
                  </div>
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => startEdit(t)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-muted"
                        title="Edit template"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete template "${t.title}"?`)) del.mutate(t.id) }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-rose-700 hover:bg-rose-50 border border-rose-200"
                        title="Delete template"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="p-4 space-y-3 bg-muted/10">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Template Name</label>
                      <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Subject</label>
                      <input value={editForm.subject} onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))}
                        className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">Body (HTML)</label>
                        <ImageUploadButton onInsert={(tag) => setEditForm((f) => ({ ...f, body: `${f.body}\n${tag}` }))} />
                      </div>
                      <div className="mt-1 mb-1.5">
                        <TokenInsertBar
                          tokens={tokens}
                          textareaRef={editBodyRef}
                          value={editForm.body}
                          onChange={(v) => setEditForm((f) => ({ ...f, body: v }))}
                        />
                        <ProductInsertBar body={editForm.body} onChange={(body) => setEditForm((f) => ({ ...f, body }))} />
                      </div>
                      {/* <textarea ref={editBodyRef} value={editForm.body} onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))}
                        rows={10}
                        className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono" /> */}
                      <RichTextEditor value={editForm.body} onChange={(body) => setEditForm((f) => ({ ...f, body }))}
                        minHeight="260px" placeholder="Write your email here, then use the toolbar for basic formatting." />
                    </div>
                    <HtmlPreview html={editForm.body} empty="Body is empty" subs={subs} />
                    <div className="flex gap-2">
                      <button
                        onClick={() => update.mutate(t.id)}
                        disabled={update.isPending || !editForm.title}
                        className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 flex items-center gap-2"
                      >
                        {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted flex items-center gap-2"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <HtmlPreview html={t.body} empty="This template has no body yet — click Edit to add one." subs={subs} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Signatures Tab ───────────────────────────────────────────────────────────

export function SignaturesTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', content: '' })
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ title: '', content: '' })
  const addContentRef = useRef<HTMLTextAreaElement>(null)
  const editContentRef = useRef<HTMLTextAreaElement>(null)

  const { data: tokens = [] } = useMailTokens()
  const subs = useSampleSubs(tokens)

  const { data: signatures = [], isLoading } = useQuery<Signature[]>({
    queryKey: ['signatures'],
    queryFn: communicationApi.signatures,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['signatures'] })

  const create = useMutation({
    mutationFn: () => communicationApi.createSignature(addForm),
    onSuccess: () => {
      invalidate()
      setShowAdd(false)
      setAddForm({ title: '', content: '' })
      toast.success('Signature created')
    },
    onError: () => toast.error('Failed to create signature'),
  })

  const update = useMutation({
    mutationFn: (id: number) => communicationApi.updateSignature(id, editForm),
    onSuccess: () => {
      invalidate()
      setEditId(null)
      toast.success('Signature updated')
    },
    onError: () => toast.error('Failed to update signature'),
  })

  const del = useMutation({
    mutationFn: (id: number) => communicationApi.deleteSignature(id),
    onSuccess: () => {
      invalidate()
      toast.success('Signature deleted')
    },
    onError: () => toast.error('Failed to delete signature'),
  })

  const setDefault = useMutation({
    mutationFn: (id: number) => communicationApi.setDefaultSignature(id),
    onSuccess: () => {
      invalidate()
      toast.success('Default signature set')
    },
  })

  const startEdit = (s: Signature) => {
    setEditId(s.id)
    setEditForm({ title: s.title, content: s.content })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Email Signatures</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Signature
        </button>
      </div>

      {showAdd && (
        <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Signature Title</label>
            <input value={addForm.title} onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. My Default Signature"
              className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">HTML Content</label>
              <ImageUploadButton onInsert={(tag) => setAddForm((f) => ({ ...f, content: `${f.content}\n${tag}` }))} />
            </div>
            <div className="mt-1 mb-1.5">
              <TokenInsertBar
                tokens={tokens}
                textareaRef={addContentRef}
                value={addForm.content}
                onChange={(v) => setAddForm((f) => ({ ...f, content: v }))}
              />
            </div>
            <RichTextEditor
              value={addForm.content}
              onChange={(content) => setAddForm((f) => ({ ...f, content }))}
              minHeight="180px"
              placeholder="Write your signature, then use the toolbar for basic formatting."
            />
            <p className="text-[11px] text-muted-foreground mt-1">Accepts HTML — logos, links, colored text. Use <code>{'{{counsellorName}}'}</code> to auto-fill the sender's name.</p>
          </div>
          <HtmlPreview html={addForm.content} empty="Signature is empty" subs={subs} />
          <div className="flex gap-2">
            <button onClick={() => create.mutate()} disabled={create.isPending || !addForm.title || !addForm.content}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 flex items-center gap-2">
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </button>
            <button onClick={() => { setShowAdd(false); setAddForm({ title: '', content: '' }) }} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !signatures.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">No signatures configured</p>
      ) : (
        <div className="space-y-3">
          {signatures.map((s) => {
            const isEditing = editId === s.id
            return (
              <div key={s.id} className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{s.title}</span>
                    {s.isDefault === 1 && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wider">Default</span>
                    )}
                  </div>
                  {!isEditing && (
                    <>
                      {s.isDefault !== 1 && (
                        <button
                          onClick={() => setDefault.mutate(s.id)}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-muted"
                          title="Make default signature"
                        >
                          <Star className="h-3.5 w-3.5" /> Make default
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(s)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-muted"
                        title="Edit signature"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete signature "${s.title}"?`)) del.mutate(s.id) }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-rose-700 hover:bg-rose-50 border border-rose-200"
                        title="Delete signature"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </>
                  )}
                </div>

                {isEditing ? (
                  <div className="p-4 space-y-3 bg-muted/10">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Signature Title</label>
                      <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">HTML Content</label>
                        <ImageUploadButton onInsert={(tag) => setEditForm((f) => ({ ...f, content: `${f.content}\n${tag}` }))} />
                      </div>
                      <div className="mt-1 mb-1.5">
                        <TokenInsertBar
                          tokens={tokens}
                          textareaRef={editContentRef}
                          value={editForm.content}
                          onChange={(v) => setEditForm((f) => ({ ...f, content: v }))}
                        />
                      </div>
                      <RichTextEditor
                        value={editForm.content}
                        onChange={(content) => setEditForm((f) => ({ ...f, content }))}
                        minHeight="220px"
                        placeholder="Write your signature, then use the toolbar for basic formatting."
                      />
                    </div>
                    <HtmlPreview html={editForm.content} empty="Signature is empty" subs={subs} />
                    <div className="flex gap-2">
                      <button
                        onClick={() => update.mutate(s.id)}
                        disabled={update.isPending || !editForm.title || !editForm.content}
                        className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 flex items-center gap-2"
                      >
                        {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted flex items-center gap-2"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <HtmlPreview html={s.content} empty="This signature has no content yet — click Edit to add one." subs={subs} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
