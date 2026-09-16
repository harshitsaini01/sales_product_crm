// Partner Lead Sources — admin-only page to manage external integrations
// like Sulekha that push leads INTO the CRM. Per-partner Bearer keys are
// generated, hashed in DB, and shown to the user ONCE on create/rotate.
import { useState, useMemo } from 'react'
import { useLeadFields } from '@/hooks/useLeadFields'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { leadSourcesApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Copy, RefreshCw, Trash2, ExternalLink, Activity, Eye, EyeOff, X, ShieldCheck, AlertCircle, Search, BookOpen } from 'lucide-react'

type Source = {
  id: number
  slug: string
  name: string
  active: boolean
  ipAllowlist: string[]
  defaultDepartmentId: number | null
  defaultLeadStatus: string | null
  totalLeads: number
  lastUsedAt: string | null
  createdAt: string
  hasHmac: boolean
}

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`))
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (created: any) => void }) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [ips, setIps] = useState('')
  const [defaultLeadStatus, setDefaultLeadStatus] = useState('Fresh')
  const [generateHmacSecret, setGenerateHmacSecret] = useState(false)
  const qc = useQueryClient()

  const slugValid = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug.trim())
  const slugError =
    !slug.trim() ? null
    : slug.trim().length < 3 ? 'Slug must be at least 3 characters'
    : slug.trim().length > 60 ? 'Slug must be at most 60 characters'
    : /^[^a-z0-9]/.test(slug.trim()) ? 'Slug must start with a letter or digit'
    : /[^a-z0-9]$/.test(slug.trim()) ? 'Slug must end with a letter or digit (not a hyphen)'
    : !slugValid ? 'Slug may only contain lowercase letters, digits, and hyphens'
    : null

  const mut = useMutation({
    mutationFn: () => leadSourcesApi.create({
      slug: slug.trim().toLowerCase(),
      name: name.trim(),
      ipAllowlist: ips.split(',').map((s) => s.trim()).filter(Boolean),
      defaultLeadStatus: defaultLeadStatus || undefined,
      generateHmacSecret,
    }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['lead-sources'] })
      onCreated(created)
    },
    onError: (e: any) => {
      const data = e.response?.data?.error
      const msg =
        typeof data === 'string' ? data
        : data?.issues?.[0]?.message ? `${data.issues[0].path?.join('.') || 'field'}: ${data.issues[0].message}`
        : 'Failed to create partner'
      toast.error(msg)
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg">New Lead Source</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="sulekha"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background"
            />
            <p className="text-[10px] text-muted-foreground mt-1">URL segment. Lowercase, hyphens allowed. 3–60 chars, must start and end with a letter/digit. Used in <code>/api/v1/inbound/{'<slug>'}/lead</code></p>
            {slugError && <p className="text-[10px] text-red-600 mt-1 font-semibold">{slugError}</p>}
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Display Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sulekha" className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">IP Allowlist (optional)</label>
            <input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="1.2.3.4, 5.6.7.8" className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" />
            <p className="text-[10px] text-muted-foreground mt-1">Comma-separated. Empty = any IP allowed.</p>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Default Lead Status</label>
            <input value={defaultLeadStatus} onChange={(e) => setDefaultLeadStatus(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-background" />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
            <input type="checkbox" checked={generateHmacSecret} onChange={(e) => setGenerateHmacSecret(e.target.checked)} />
            Also generate HMAC signing secret (stronger — partner must sign each request)
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-accent">Cancel</button>
          <button
            disabled={mut.isPending || !slugValid || !name.trim()}
            onClick={() => mut.mutate()}
            className="px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
          >
            {mut.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SecretsModal({ created, onClose }: { created: { slug: string; apiKey: string; webhookSecret: string | null; endpoint: string }; onClose: () => void }) {
  const [showKey, setShowKey] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Save these now</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>This is the ONLY time the API key will be shown. Copy it now and store it securely. If lost, you must rotate the key.</span>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Endpoint</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 px-3 py-2 bg-muted rounded-lg text-xs break-all">{created.endpoint}</code>
              <button onClick={() => copy(created.endpoint, 'Endpoint')} className="p-2 hover:bg-accent rounded-lg" title="Copy"><Copy className="h-4 w-4" /></button>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Key</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 px-3 py-2 bg-muted rounded-lg text-xs break-all font-mono">{showKey ? created.apiKey : '•'.repeat(48)}</code>
              <button onClick={() => setShowKey(!showKey)} className="p-2 hover:bg-accent rounded-lg" title="Toggle visibility">{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              <button onClick={() => copy(created.apiKey, 'API key')} className="p-2 hover:bg-accent rounded-lg" title="Copy"><Copy className="h-4 w-4" /></button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Partner sends: <code>Authorization: Bearer &lt;this-key&gt;</code></p>
          </div>
          {created.webhookSecret && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">HMAC Webhook Secret</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 px-3 py-2 bg-muted rounded-lg text-xs break-all font-mono">{created.webhookSecret}</code>
                <button onClick={() => copy(created.webhookSecret!, 'HMAC secret')} className="p-2 hover:bg-accent rounded-lg" title="Copy"><Copy className="h-4 w-4" /></button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Partner must send: <code>X-Signature: sha256=&lt;hmac-sha256-of-body&gt;</code></p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg">I've saved them</button>
        </div>
      </div>
    </div>
  )
}

function LogsModal({ source, onClose }: { source: Source; onClose: () => void }) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const limit = 50

  const { data: logsData, isLoading } = useQuery<{
    logs: any[]
    total: number
    page: number
    limit: number
    totalPages: number
  }>({
    queryKey: ['lead-source-logs', source.id, page, search],
    queryFn: () => leadSourcesApi.logs(source.id, page, limit, search),
  })

  const logs = logsData?.logs || []
  const totalPages = logsData?.totalPages || 1
  const totalLogs = logsData?.total || 0

  const { data: stats } = useQuery<{ total: number; byStatus: Array<{ status: string; count: number }> }>({
    queryKey: ['lead-source-stats', source.id],
    queryFn: () => leadSourcesApi.stats(source.id),
  })

  const seedMutation = useMutation({
    mutationFn: (logId: number | string) => leadSourcesApi.seedLog(logId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['lead-source-logs', source.id] })
      qc.invalidateQueries({ queryKey: ['lead-sources'] })
      toast.success(`Duplicate lead #${data.lead?.id} has been seeded into CRM!`)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to seed lead into CRM')
    },
  })

  const handleSeedClick = (log: any) => {
    const nameStr = log.leadName ? `"${log.leadName}"` : 'this lead'
    if (confirm(`Do you want to seed past duplicate lead ${nameStr} into your CRM now?`)) {
      seedMutation.mutate(log.id)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg">Ingestion Logs — {source.name}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-bold">Last 30 days: {stats?.total ?? 0}</span>
            {(stats?.byStatus || []).map((s) => (
              <span key={s.status} className={`px-2 py-0.5 rounded-full font-semibold ${
                s.status === 'created' ? 'bg-emerald-100 text-emerald-700' :
                s.status === 'duplicate' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>{s.status}: {s.count}</span>
            ))}
          </div>

          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by name, ID, IP, phone..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr className="text-left">
                <th className="px-4 py-2 font-bold">When</th>
                <th className="px-4 py-2 font-bold">Status</th>
                <th className="px-4 py-2 font-bold">IP</th>
                <th className="px-4 py-2 font-bold">Lead Name</th>
                <th className="px-4 py-2 font-bold">Lead ID</th>
                <th className="px-4 py-2 font-bold">Error</th>
                <th className="px-4 py-2 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading logs…</td></tr>
              )}
              {!isLoading && logs.map((l) => (
                <tr key={l.id} className="border-t hover:bg-muted/20">
                  <td className="px-4 py-2 text-muted-foreground">{new Date(l.receivedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-bold">{l.status}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">{l.ip || '—'}</td>
                  <td className="px-4 py-2 font-medium">{l.leadName || '—'}</td>
                  <td className="px-4 py-2">{l.leadId ?? '—'}</td>
                  <td className="px-4 py-2 text-red-600">{l.errorMsg || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {l.status === 'duplicate' && !l.isSeeded ? (
                      <button
                        onClick={() => handleSeedClick(l)}
                        disabled={seedMutation.isPending}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold text-[11px] shadow-sm transition-colors"
                        title="Approve and seed this past duplicate lead into CRM"
                      >
                        Seed to CRM
                      </button>
                    ) : l.status === 'duplicate' && l.isSeeded ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold text-[10px]">
                        Seeded
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && logs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No requests yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t bg-muted/20 flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">
            Showing Page <strong className="text-foreground">{page}</strong> of <strong className="text-foreground">{totalPages}</strong> ({totalLogs.toLocaleString()} total entries)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="px-3 py-1.5 border rounded-lg font-bold bg-background hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="px-3 py-1.5 border rounded-lg font-bold bg-background hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Integration Guide (theory + partner field reference) ─────────────────────
// SOURCE OF TRUTH for this table lives in
//   backend/src/routes/inbound.routes.ts → extractOptionalLeadFields()
// If you add a new column or alias there, mirror it here so partners and new
// developers see the same picture. Only "accepted from partners" columns are
// listed — internal state (leadStatus, followupDate, called, etc.) is set by
// the CRM and MUST NOT appear here.

type FieldDoc = {
  col: string          // canonical Lead schema column name
  aliases: string[]    // every payload key we accept for it
  type: 'string' | 'int' | 'flag' | 'phone'
  max?: number         // capped to this many chars for string/phone
  note?: string
}

const FIELD_GROUPS: Array<{ title: string; blurb: string; fields: FieldDoc[] }> = [
  {
    title: 'Required — must be present on every request',
    blurb: 'The partner MUST send `name`, plus at least one of `email` or `mobile`. If neither contact is present the request is rejected with 400.',
    fields: [
      { col: 'name',   aliases: ['name'],   type: 'string', max: 200, note: 'REQUIRED' },
      { col: 'email',  aliases: ['email'],  type: 'string', max: 200, note: 'email OR mobile required' },
      { col: 'mobile', aliases: ['mobile'], type: 'phone',  max: 20,  note: 'digits/+ only; email OR mobile required' },
    ],
  },
  {
    title: 'Personal info',
    blurb: 'Everything about the student themselves — parents, IDs, background.',
    fields: [
      { col: 'father',         aliases: ['father', 'father_name', 'fatherName'], type: 'string', max: 100 },
      { col: 'mother',         aliases: ['mother', 'mother_name', 'motherName'], type: 'string', max: 100 },
      { col: 'fatherMobile',   aliases: ['fatherMobile', 'father_mobile', 'father_phone'], type: 'phone', max: 20 },
      { col: 'motherMobile',   aliases: ['motherMobile', 'mother_mobile', 'mother_phone'], type: 'phone', max: 20 },
      { col: 'dob',            aliases: ['dob', 'date_of_birth', 'dateOfBirth', 'birthDate'], type: 'string', max: 100 },
      { col: 'gender',         aliases: ['gender', 'sex'], type: 'string', max: 10 },
      { col: 'castCategory',   aliases: ['castCategory', 'cast_category', 'category', 'caste', 'casteCategory'], type: 'string', max: 100 },
      { col: 'nationality',    aliases: ['nationality'], type: 'string', max: 50 },
      { col: 'religion',       aliases: ['religion'], type: 'string', max: 100 },
      { col: 'passportNumber', aliases: ['passportNumber', 'passport_number', 'passport'], type: 'string', max: 100 },
      { col: 'passportExpiry', aliases: ['passportExpiry', 'passport_expiry'], type: 'string', max: 100 },
      { col: 'firstLanguage',  aliases: ['firstLanguage', 'first_language', 'motherTongue', 'mother_tongue'], type: 'string', max: 100 },
      { col: 'maritalStatus',  aliases: ['maritalStatus', 'marital_status'], type: 'string', max: 50 },
    ],
  },
  {
    title: 'Secondary contacts',
    blurb: 'Extra emails and phone numbers besides the primary ones.',
    fields: [
      { col: 'email2',  aliases: ['email2', 'secondary_email', 'secondaryEmail', 'altEmail', 'alt_email'], type: 'string', max: 100 },
      { col: 'email3',  aliases: ['email3', 'tertiary_email', 'tertiaryEmail'], type: 'string', max: 100 },
      { col: 'mobile2', aliases: ['mobile2', 'phone2', 'secondary_mobile', 'secondaryMobile', 'altMobile', 'alt_mobile', 'whatsapp'], type: 'phone', max: 20 },
      { col: 'mobile3', aliases: ['mobile3', 'phone3', 'tertiary_mobile', 'tertiaryMobile'], type: 'phone', max: 20 },
    ],
  },
  {
    title: 'Address',
    blurb: 'Where the lead lives / can be contacted.',
    fields: [
      { col: 'city',              aliases: ['city'], type: 'string', max: 100 },
      { col: 'state',             aliases: ['state'], type: 'string', max: 50 },
      { col: 'country',           aliases: ['country'], type: 'string', max: 100 },
      { col: 'pincode',           aliases: ['pincode', 'pin_code', 'postal_code', 'postalCode', 'zip', 'zipCode', 'zip_code'], type: 'string', max: 20 },
      { col: 'homeAddress',       aliases: ['homeAddress', 'home_address', 'address', 'residentialAddress', 'residential_address'], type: 'string', max: 4000 },
      { col: 'homeContactNumber', aliases: ['homeContactNumber', 'home_contact_number', 'landline', 'home_phone', 'homePhone'], type: 'phone', max: 50 },
    ],
  },
  {
    title: 'Product interest',
    blurb: 'What the lead wants to buy and roughly how much they will spend.',
    fields: [
      { col: 'intrestedCourse',      aliases: ['intrestedCourse', 'interestedCourse', 'interested_course', 'course', 'product', 'sku'], type: 'string', max: 100 },
      { col: 'intrestedSubject',     aliases: ['intrestedSubject', 'interested_subject', 'interestedSubject', 'subject', 'requirement'], type: 'string', max: 100 },
      { col: 'approximateBudget',    aliases: ['approximateBudget', 'approximate_budget', 'budget'], type: 'string', max: 100 },
    ],
  },
  {
    title: 'Marketing / tracking',
    blurb: 'Where the lead came from, so we can attribute conversions.',
    fields: [
      { col: 'source',    aliases: ['source', 'utm_source', 'utmSource'], type: 'string', max: 100 },
      { col: 'sourceUrl', aliases: ['sourceUrl', 'source_url', 'landingUrl', 'landing_url', 'pageUrl', 'page_url'], type: 'string', max: 255 },
      { col: 'event',     aliases: ['event'], type: 'string', max: 50 },
      { col: 'campaign',  aliases: ['campaign', 'utm_campaign', 'utmCampaign'], type: 'string', max: 255 },
      { col: 'keyword',   aliases: ['keyword', 'utm_term', 'utmTerm', 'keywords'], type: 'string', max: 255 },
      { col: 'comment',   aliases: ['comment', 'question', 'message', 'inquiry_message', 'inquiryMessage', 'notes'], type: 'string', max: 2000, note: 'Free-text enquiry from the lead.' },
    ],
  },
]

// Columns exposed in the Lead schema that partners MUST NOT set. Kept here so
// developers can see explicitly what is forbidden and why — the backend
// silently ignores them anyway, but showing them prevents "why is it not
// working?" support requests.
const BLOCKED_FIELDS: Array<{ col: string; why: string }> = [
  { col: 'password',                                                                    why: 'Auth credentials never come from a partner.' },
  { col: 'imgpath / imgname',                                                           why: 'Image URLs from an untrusted source can be a phishing / malware vector.' },
  { col: 'website',                                                                     why: 'Forced to the source slug so partner A cannot impersonate partner B.' },
  { col: 'departmentId',                                                                why: 'Set from the source config in this portal, not by the partner.' },
  { col: 'leadStatus / leadSubStatus / leadStatusId / leadSubStatusId / leadFollowStatus / statusLeadTypeId', why: 'Workflow state — moved by sales reps as they work the lead.' },
  { col: 'userId',                                                                      why: 'Auto-assignment logic picks the sales rep.' },
  { col: 'leadType',                                                                    why: 'Always "new" for a freshly-ingested lead.' },
  { col: 'called / wapp / callAnsweredStatus / flagSend / flagRcv / leadScore',         why: 'Engagement counters written by CRM activity.' },
  { col: 'followupDate / commentDate / reminderDate',                                   why: 'Set by sales reps from inside the CRM.' },
  { col: 'enrolled / course (financial) / totalFees / totalDepositFees / balanceFees',  why: 'Legacy conversion/fee columns — not used in this product CRM.' },
  { col: 'asign / trash / status / isDuplicate / duplicateOfId / bucketExcluded',       why: 'Internal system flags managed by the CRM itself.' },
]

function IntegrationGuide() {
  const { visible } = useLeadFields()

  // This page tells partners what to send, so it must not advertise a field the
  // customer has switched off — nobody should build an integration against a
  // column they will never see.
  //
  // Note this is documentation only. The ingestion endpoint itself still ACCEPTS
  // every field (see extractOptionalLeadFields in inbound.routes.ts): hiding a
  // field must never silently drop data a partner is already sending.
  const visibleFieldGroups = useMemo(
    () =>
      FIELD_GROUPS.map((group) => ({
        ...group,
        fields: group.fields.filter((f) => visible(f.col)),
      })).filter((group) => group.fields.length > 0),
    [visible],
  )

  return (
    <details className="bg-card border rounded-xl group">
      <summary className="p-4 cursor-pointer flex items-center gap-2 select-none list-none">
        <BookOpen className="h-4 w-4 text-primary" />
        <span className="font-bold">Integration Guide — how a partner sends leads &amp; which fields we accept</span>
        <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Click to expand</span>
        <span className="ml-auto text-xs text-muted-foreground hidden group-open:inline">Click to collapse</span>
      </summary>

      <div className="border-t p-5 space-y-8 text-sm">
        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="font-black text-base">How this works (for new developers)</h3>
          <p>
            Every partner (Sulekha, our own websites, campus fairs, etc.) posts leads to a single endpoint:
            <br />
            <code className="bg-muted px-2 py-1 rounded inline-block mt-1">POST /api/v1/inbound/&lt;slug&gt;/lead</code>
          </p>
          <p>The endpoint runs 6 checks in order. If any one fails the request is rejected and logged:</p>
          <ol className="list-decimal ml-6 space-y-1">
            <li><strong>Slug lookup</strong> — must match an <em>active</em> row in <code>lead_sources</code>.</li>
            <li><strong>IP allowlist</strong> — if configured, the caller IP must be on the list.</li>
            <li><strong>Bearer key</strong> — <code>Authorization: Bearer &lt;api-key&gt;</code>, compared against a bcrypt hash.</li>
            <li><strong>HMAC signature</strong> — if the partner has a webhook secret, <code>X-Signature: sha256=&lt;hex&gt;</code> must verify against the raw body.</li>
            <li><strong>Rate limit</strong> — 60 req/min per partner (in-memory token bucket).</li>
            <li><strong>Validation</strong> — <code>name</code> + (<code>email</code> OR <code>mobile</code>) are the only required fields.</li>
          </ol>
          <p>
            After that we pick every known field out of the JSON body (see the table below), dedupe the lead
            by email/mobile against the existing <code>leads</code> table (a match creates a duplicate row
            linked to the original, it does NOT drop the request), auto-assign to any counsellor with
            <code> automatic_asign_lead=1</code>, and store the FULL raw payload in
            <code> lead_ingestion_logs.payload</code> — so nothing a partner sends is ever lost, even if we
            haven't mapped it to a column yet.
          </p>
        </section>

        {/* ── cURL example ─────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="font-black text-base">Example request (for the partner integrator)</h3>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">{`curl -X POST https://YOUR-CRM-HOST/api/v1/inbound/<slug>/lead \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <your-api-key>" \\
  -d '{
    "name": "Rahul Sharma",
    "email": "rahul@example.com",
    "mobile": "9999999999",
    "city": "Delhi",
    "intrestedCourse": "Cotton socks 3-pack",
    "approximateBudget": "25000",
    "utm_source": "google-ads",
    "utm_campaign": "catalog-sep"
  }'`}</pre>
          <p className="text-xs text-muted-foreground">
            Every key in the request is optional except <code>name</code> and one of <code>email</code>/<code>mobile</code>.
            Send as much or as little as you have — missing fields simply stay empty on the lead row.
          </p>
        </section>

        {/* ── Field reference table ────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="font-black text-base">Accepted fields (payload key → column on the lead)</h3>
          <p className="text-xs text-muted-foreground">
            For each column, you may send the payload key under <strong>any</strong> of the listed aliases —
            the first non-empty one wins. Values are trimmed and capped to the max length shown so an
            oversized string never breaks the insert.
          </p>
          <div className="space-y-6 mt-3">
            {visibleFieldGroups.map((group) => (
              <div key={group.title}>
                <div className="font-bold text-sm">{group.title}</div>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{group.blurb}</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-bold">Lead column</th>
                        <th className="px-3 py-2 font-bold">Payload keys (any of)</th>
                        <th className="px-3 py-2 font-bold">Type</th>
                        <th className="px-3 py-2 font-bold">Max</th>
                        <th className="px-3 py-2 font-bold">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.fields.map((f) => (
                        <tr key={f.col} className="border-t align-top">
                          <td className="px-3 py-1.5 font-mono font-bold">{f.col}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {f.aliases.map((a) => (
                                <code key={a} className="px-1.5 py-0.5 bg-muted rounded text-[11px]">{a}</code>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{f.type}</td>
                          <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{f.max ?? '—'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{f.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Blocked fields ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="font-black text-base">Fields we IGNORE (do not send)</h3>
          <p className="text-xs text-muted-foreground">
            These columns exist on <code>leads</code> but are set by the CRM, not the partner. If a partner
            sends them, the endpoint silently drops them — but here's the full list so nobody has to guess.
          </p>
          <div className="border rounded-lg overflow-hidden mt-2">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-bold">Column(s)</th>
                  <th className="px-3 py-2 font-bold">Why blocked</th>
                </tr>
              </thead>
              <tbody>
                {BLOCKED_FIELDS.map((b) => (
                  <tr key={b.col} className="border-t align-top">
                    <td className="px-3 py-1.5 font-mono">{b.col}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{b.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Response shape ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="font-black text-base">Response</h3>
          <p className="text-xs">On success (HTTP 201):</p>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">{`{ "success": true, "id": 12345, "duplicate": false }`}</pre>
          <p className="text-xs">On failure — 400 (bad payload), 401 (auth), 429 (rate limit). See the "Ingestion Logs" button per partner for the exact reason.</p>
        </section>

        {/* ── Where to change things ───────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="font-black text-base">Where in the code (for developers)</h3>
          <ul className="list-disc ml-6 text-xs space-y-1">
            <li>Endpoint handler + field pickers → <code>backend/src/routes/inbound.routes.ts</code></li>
            <li>Canonical column list → <code>backend/prisma/schema.prisma</code> (model <code>Lead</code>)</li>
            <li>Per-partner config, keys, IP allowlist → <code>lead_sources</code> table (managed from this page)</li>
            <li>Full raw payload archive → <code>lead_ingestion_logs</code> table (Activity button per partner)</li>
            <li>To add a new alias for an existing column: append it to the array inside <code>extractOptionalLeadFields()</code> in <code>inbound.routes.ts</code>, then mirror it in <code>FIELD_GROUPS</code> on this page.</li>
          </ul>
        </section>
      </div>
    </details>
  )
}

export function LeadSources() {
  const qc = useQueryClient()
  const { data: sources = [], isLoading } = useQuery<Source[]>({
    queryKey: ['lead-sources'],
    queryFn: leadSourcesApi.list,
  })
  const [showCreate, setShowCreate] = useState(false)
  const [createdSecrets, setCreatedSecrets] = useState<any | null>(null)
  const [logsFor, setLogsFor] = useState<Source | null>(null)

  const toggleActive = useMutation({
    mutationFn: (s: Source) => leadSourcesApi.patch(s.id, { active: !s.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-sources'] }),
  })
  const rotate = useMutation({
    mutationFn: (id: number) => leadSourcesApi.rotateKey(id),
    onSuccess: (data, id) => {
      const src = sources.find((s) => s.id === id)
      setCreatedSecrets({
        slug: src?.slug,
        apiKey: data.apiKey,
        webhookSecret: null,
        endpoint: `/api/v1/inbound/${src?.slug}/lead`,
      })
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => leadSourcesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-sources'] })
      toast.success('Lead source permanently deleted')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Lead Sources</h1>
          <p className="text-sm text-muted-foreground mt-1">External partners that push leads into the CRM via secure per-partner API keys.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Partner
        </button>
      </div>

      <IntegrationGuide />

      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="px-4 py-3 font-bold">Partner</th>
              <th className="px-4 py-3 font-bold">Endpoint</th>
              <th className="px-4 py-3 font-bold">Leads</th>
              <th className="px-4 py-3 font-bold">Last Used</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && sources.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                <p className="font-semibold">No partners yet</p>
                <p className="text-xs mt-1">Click "Add Partner" to onboard another lead source.</p>
              </td></tr>
            )}
            {sources.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-3">
                  <div className="font-bold">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.slug}{s.hasHmac && <span className="ml-2 px-1.5 py-0 bg-emerald-100 text-emerald-700 rounded text-[9px] font-black">HMAC</span>}</div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs bg-muted px-2 py-1 rounded">/api/v1/inbound/{s.slug}/lead</code>
                </td>
                <td className="px-4 py-3 font-bold tabular-nums">{s.totalLeads.toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive.mutate(s)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${s.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
                  >
                    {s.active ? 'ACTIVE' : 'INACTIVE'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link to={('/app/leads?website=' + encodeURIComponent(s.slug)) as string} className="p-2 hover:bg-accent rounded-lg" title="View leads from this source">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <button onClick={() => setLogsFor(s)} className="p-2 hover:bg-accent rounded-lg" title="View ingestion logs">
                      <Activity className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Rotate API key for ${s.name}? The old key will stop working immediately.`)) rotate.mutate(s.id) }}
                      className="p-2 hover:bg-accent rounded-lg"
                      title="Rotate API key"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Permanently delete ${s.name}? This action cannot be undone.`)) remove.mutate(s.id) }}
                      className="p-2 hover:bg-accent rounded-lg text-red-600"
                      title="Permanently Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(data) => {
            setShowCreate(false)
            setCreatedSecrets(data)
          }}
        />
      )}

      {createdSecrets && <SecretsModal created={createdSecrets} onClose={() => setCreatedSecrets(null)} />}
      {logsFor && <LogsModal source={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  )
}
