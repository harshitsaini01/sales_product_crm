import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, CheckCircle2, XCircle, Mail, Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { campaignsApi } from '@/lib/api'

// The standalone /app/campaign-groups page is retired — Email Accounts now live
// inside /app/mail. Kept as a redirect so any bookmarked link keeps working.
export default function CampaignGroups() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate({ to: '/app/mail', search: { tab: 'accounts' }, replace: true } as never)
  }, [navigate])
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Redirecting to Email Accounts…
    </div>
  )
}

export interface EmailAccount {
  id: number
  name: string
  fromName: string
  fromEmail: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpSecure: boolean
  imapHost: string | null
  imapPort: number | null
  imapUser: string | null
  imapSecure: boolean
  hourlyCap: number
  authorityScore: number
  isActive: boolean
  bouncesThisHour: number
  sentThisHour: number
  notes?: string | null
}

const DEFAULT_FORM = {
  name: '',
  fromName: '',
  fromEmail: '',
  smtpHost: '',
  smtpPort: 465,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: true,
  imapHost: '',
  imapPort: 993,
  imapUser: '',
  imapPass: '',
  imapSecure: true,
  hourlyCap: 50,
  authorityScore: 5,
  isActive: true,
  notes: '',
}

// ─── Email Accounts tab (embedded in /app/mail) ──────────────────────────────
// Manages the SMTP/IMAP creds used to send and receive campaign mail. Each row
// is one sender account: outgoing SMTP is mandatory, inbound IMAP is optional
// (only needed to detect replies). Governance fields (hourly cap + authority
// score) are collapsed by default because you only need them if you're doing
// scheduled multi-account campaigns.

export function EmailAccountsTab() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<EmailAccount | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [form, setForm] = useState(DEFAULT_FORM)

  const { data: groups = [], isLoading } = useQuery<EmailAccount[]>({
    queryKey: ['campaigns', 'groups'],
    queryFn: campaignsApi.groups,
  })

  const createM = useMutation({
    mutationFn: (data: typeof DEFAULT_FORM) => campaignsApi.createGroup(data),
    onSuccess: () => {
      toast.success('Email account added')
      qc.invalidateQueries({ queryKey: ['campaigns', 'groups'] })
      resetForm()
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Add failed')
    },
  })

  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<typeof DEFAULT_FORM> }) =>
      campaignsApi.updateGroup(id, data),
    onSuccess: () => {
      toast.success('Email account updated')
      qc.invalidateQueries({ queryKey: ['campaigns', 'groups'] })
      resetForm()
    },
    onError: () => toast.error('Update failed'),
  })

  const deleteM = useMutation({
    mutationFn: (id: number) => campaignsApi.deleteGroup(id),
    onSuccess: () => {
      toast.success('Deleted')
      qc.invalidateQueries({ queryKey: ['campaigns', 'groups'] })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Delete failed')
    },
  })

  const testM = useMutation({
    mutationFn: (id: number) => campaignsApi.testGroup(id),
    onSuccess: (r: { ok: boolean; error?: string }) => {
      if (r.ok) toast.success('SMTP connection OK')
      else toast.error(`SMTP failed: ${r.error || 'unknown'}`)
    },
    onError: () => toast.error('SMTP test crashed'),
  })

  const resetForm = () => {
    setShowForm(false)
    setEditing(null)
    setForm(DEFAULT_FORM)
    setShowAdvanced(false)
  }

  const startEdit = (g: EmailAccount) => {
    setEditing(g)
    setForm({
      name: g.name,
      fromName: g.fromName,
      fromEmail: g.fromEmail,
      smtpHost: g.smtpHost,
      smtpPort: g.smtpPort,
      smtpUser: g.smtpUser,
      smtpPass: '', // empty = keep existing
      smtpSecure: g.smtpSecure,
      imapHost: g.imapHost ?? '',
      imapPort: g.imapPort ?? 993,
      imapUser: g.imapUser ?? '',
      imapPass: '',
      imapSecure: g.imapSecure,
      hourlyCap: g.hourlyCap,
      authorityScore: g.authorityScore,
      isActive: g.isActive,
      notes: g.notes ?? '',
    })
    setShowForm(true)
  }

  const submit = () => {
    if (!form.name || !form.fromEmail || !form.smtpHost) {
      toast.error('Name, From-Email and SMTP host are required')
      return
    }
    if (editing) {
      const data: Partial<typeof DEFAULT_FORM> = { ...form }
      // Empty password = don't change on the server side.
      if (!data.smtpPass) delete data.smtpPass
      if (!data.imapPass) delete data.imapPass
      updateM.mutate({ id: editing.id, data })
    } else {
      createM.mutate(form)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Email Accounts</h3>
          <p className="text-xs text-muted-foreground">
            SMTP for sending. IMAP (optional) for detecting replies. Every account here is a candidate "Send from" on Compose.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setEditing(null); setForm(DEFAULT_FORM); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold"
          >
            <Plus className="h-4 w-4" /> Add email
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-card border rounded-xl p-5 space-y-4">
          <h4 className="font-semibold">{editing ? `Edit: ${editing.name}` : 'Add email account'}</h4>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Account</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account label (internal)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Admissions inbox" />
              <Field label="From name (shown to recipient)" value={form.fromName} onChange={(v) => setForm({ ...form, fromName: v })} placeholder="e.g. Sales team" />
              <Field label="From email" value={form.fromEmail} onChange={(v) => setForm({ ...form, fromEmail: v })} placeholder="admissions@…" type="email" />
              <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="Optional" />
              <CheckField label="Active — usable on Compose + campaigns" value={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Outgoing (SMTP) — required</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="SMTP host" value={form.smtpHost} onChange={(v) => setForm({ ...form, smtpHost: v })} placeholder="smtp.example.com" />
              <NumField label="Port" value={form.smtpPort} onChange={(v) => setForm({ ...form, smtpPort: v })} />
              <CheckField label="Secure (TLS/SSL)" value={form.smtpSecure} onChange={(v) => setForm({ ...form, smtpSecure: v })} />
              <Field label="SMTP username" value={form.smtpUser} onChange={(v) => setForm({ ...form, smtpUser: v })} />
              <Field
                label={editing ? 'SMTP password (blank = keep)' : 'SMTP password'}
                value={form.smtpPass}
                onChange={(v) => setForm({ ...form, smtpPass: v })}
                type="password"
              />
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Incoming (IMAP) — optional</div>
            <p className="text-[11px] text-muted-foreground mb-2">Leave blank to skip reply tracking. If set, the poller pulls new messages into the Inbox every 60 s and links replies back to their campaigns.</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="IMAP host" value={form.imapHost} onChange={(v) => setForm({ ...form, imapHost: v })} placeholder="imap.example.com" />
              <NumField label="Port" value={form.imapPort} onChange={(v) => setForm({ ...form, imapPort: v })} />
              <CheckField label="Secure" value={form.imapSecure} onChange={(v) => setForm({ ...form, imapSecure: v })} />
              <Field label="IMAP username" value={form.imapUser} onChange={(v) => setForm({ ...form, imapUser: v })} />
              <Field
                label={editing ? 'IMAP password (blank = keep)' : 'IMAP password'}
                value={form.imapPass}
                onChange={(v) => setForm({ ...form, imapPass: v })}
                type="password"
              />
            </div>
          </div>

          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Advanced (governance — only used by scheduled campaigns)
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <NumField label="Hourly cap (max sends per hour)" value={form.hourlyCap} onChange={(v) => setForm({ ...form, hourlyCap: v })} />
                <NumField
                  label="Authority score (1–10)"
                  value={form.authorityScore}
                  onChange={(v) => setForm({ ...form, authorityScore: Math.min(10, Math.max(1, v)) })}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t pt-3">
            <button
              onClick={submit}
              disabled={createM.isPending || updateM.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            >
              {(createM.isPending || updateM.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Add email'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No email accounts yet. Click <strong>Add email</strong> to configure your first SMTP/IMAP account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground bg-muted/30 text-xs">
                  <th className="px-3 py-2 font-medium">Account / From</th>
                  <th className="px-3 py-2 font-medium">SMTP</th>
                  <th className="px-3 py-2 font-medium">IMAP</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Sent this hr</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{g.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        <span>{g.fromName ? `${g.fromName} <${g.fromEmail}>` : g.fromEmail}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{g.smtpHost}:{g.smtpPort}{g.smtpSecure ? ' · TLS' : ''}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{g.imapHost ? `${g.imapHost}:${g.imapPort}` : <span className="italic">not set</span>}</td>
                    <td className="px-3 py-2">
                      {g.isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold"><CheckCircle2 className="h-3 w-3" /> Active</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 text-xs font-semibold"><XCircle className="h-3 w-3" /> Disabled</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {g.sentThisHour}/{g.hourlyCap}
                      {g.bouncesThisHour > 0 && <div className="text-rose-600">{g.bouncesThisHour} bounces</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => testM.mutate(g.id)}
                          disabled={testM.isPending}
                          className="px-2 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50"
                          title="Verify SMTP connection"
                        >
                          Test
                        </button>
                        <button
                          onClick={() => startEdit(g)}
                          className="p-1 hover:bg-muted rounded"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete "${g.name}"?`)) deleteM.mutate(g.id) }}
                          className="p-1 hover:bg-rose-50 text-rose-600 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
      />
    </label>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
      />
    </label>
  )
}

function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 mt-5">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      <span className="text-sm">{label}</span>
    </label>
  )
}
