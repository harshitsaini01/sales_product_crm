import { useState, useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, notesApi, commentsApi, remindersApi, communicationApi, callsApi, followupsApi } from '@/lib/api'
import { Flag, LayoutGrid, SlidersHorizontal } from 'lucide-react'
import { formatDate, formatDateTime, maskPhone, normalizePhone } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import {
  Phone, Mail, MapPin, MessageSquare, CalendarDays, Loader2,
  StickyNote, Bell, FileText, Send, Info, Trash2, PhoneCall,
  Activity, ArrowRight, MessagesSquare,
} from 'lucide-react'
import type { Lead, LeadFollowup, LeadNote, Reminder } from '@/types'
import { StatusBadge } from '@/components/leads/StatusBadge'
import { QuickCallButton } from '@/components/leads/QuickCallButton'
import { WhatsappSendModal } from '@/components/leads/WhatsappSendModal'
import { PushToPhoneButton } from '@/components/leads/PushToPhoneButton'
import { LeadOverview } from '@/components/leads/LeadOverview'
import { LeadDocumentsTab } from '@/components/leads/LeadDocumentsTab'
import { RecordingPlayer } from '@/components/calls/RecordingPlayer'
import { useLeadFields } from '@/hooks/useLeadFields'
import { useLabels } from '@/hooks/useLabels'
import { CustomFieldsPanel } from '@/components/crm/CustomFieldsPanel'

type Tab = 'overview' | 'info' | 'fields' | 'followups' | 'timeline' | 'notes' | 'comments' | 'flags' | 'reminders' | 'email' | 'documents' | 'calls'

type TimelineEntry = {
  id: string
  type: 'status' | 'followup' | 'note' | 'call' | 'mail' | 'comment' | 'flag'
  at: string
  by: { id: number; name: string } | null
  summary: string
  meta: Record<string, unknown>
}

export function LeadDetail() {
  const { leadId } = useParams({ from: '/app/leads/$leadId' })
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const hasFeature = useAuthStore((s) => s.hasFeature)
  const t = useLabels()
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  // A B2B customer opens on the gathered view; an education customer has no
  // Overview tab at all, so their default is unchanged.
  const [tab, setTab] = useState<Tab>(
    useAuthStore.getState().hasFeature('accounts') ? 'overview' : 'followups',
  )
  const [isWappModalOpen, setIsWappModalOpen] = useState(false)

  const { data: lead, isLoading } = useQuery<Lead>({
    queryKey: ['lead', Number(leadId)],
    queryFn: () => leadsApi.get(Number(leadId)),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!lead) return <div className="text-center py-12 text-muted-foreground">Lead not found</div>

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'followups', label: 'Follow-ups', icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { id: 'timeline', label: 'Timeline', icon: <Activity className="h-3.5 w-3.5" /> },
    // Only for a customer with the accounts module. An education lead page is
    // exactly as it was.
    // Overview carries the company inline; a separate Company tab showed the
    // same blocks from the same endpoint.
    ...(hasFeature('accounts')
      ? [{ id: 'overview' as Tab, label: 'Overview', icon: <LayoutGrid className="h-3.5 w-3.5" /> }]
      : []),
    { id: 'info', label: 'Info', icon: <Info className="h-3.5 w-3.5" /> },
    // What THIS customer records on a lead, over and above the built-in fields.
    // Rows, not columns — so a customer selling something nobody has modelled
    // yet needs no migration against anybody else's database.
    ...(hasFeature('custom_fields')
      ? [{ id: 'fields' as Tab, label: 'Fields', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> }]
      : []),
    { id: 'notes', label: 'Notes', icon: <StickyNote className="h-3.5 w-3.5" /> },
    { id: 'comments', label: 'Comments', icon: <MessagesSquare className="h-3.5 w-3.5" /> },
    { id: 'flags', label: 'Flags', icon: <Flag className="h-3.5 w-3.5" /> },
    { id: 'reminders', label: 'Reminders', icon: <Bell className="h-3.5 w-3.5" /> },
    { id: 'email', label: 'Email', icon: <Send className="h-3.5 w-3.5" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'calls', label: 'Calls', icon: <PhoneCall className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Lead Header */}
      <div className="bg-card border rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{lead.name}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {lead.mobile && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {maskPhone(lead.mobile, canRevealPhone)}
                </span>
              )}
              {lead.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {lead.email}
                </span>
              )}
              {(lead.city || lead.state) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {[lead.city, lead.state, lead.country].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={lead.leadStatus} subStatus={lead.leadSubStatus} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Renders nothing unless the `accounts` module is on, so the
                  education panel is untouched. */}
              <QuickCallButton leadId={lead.id} mobile={lead.mobile} />
              {lead.mobile && (
                <PushToPhoneButton
                  leadId={lead.id}
                  counsellorId={lead.asign || undefined}
                />
              )}
              {lead.mobile && (
                <button
                  type="button"
                  onClick={() => setIsWappModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'followups' && <FollowupsTab lead={lead} qc={qc} />}
          {tab === 'timeline' && <TimelineTab leadId={lead.id} />}
          {tab === 'overview' && <LeadOverview lead={lead} onGoToTab={(x) => setTab(x as Tab)} />}
          {tab === 'info' && <InfoTab lead={lead} qc={qc} />}
          {tab === 'fields' && (
            <CustomFieldsPanel
              entityType="lead"
              entityId={lead.id}
              noun={t.plural('lead').toLowerCase()}
              onSaved={() => qc.invalidateQueries({ queryKey: ['lead', lead.id] })}
            />
          )}
          {tab === 'notes' && <NotesTab lead={lead} qc={qc} isAdmin={isAdmin()} />}
          {tab === 'comments' && <CommentsTab leadId={lead.id} qc={qc} isAdmin={isAdmin()} />}
          {tab === 'flags' && <FlagsTab leadId={lead.id} qc={qc} isAdmin={isAdmin()} />}
          {tab === 'reminders' && <RemindersTab leadId={lead.id} qc={qc} />}
          {tab === 'email' && <EmailTab lead={lead} />}
          {tab === 'documents' && <LeadDocumentsTab leadId={lead.id} />}
          {tab === 'calls' && <CallsTab leadId={lead.id} />}
        </div>
      </div>

      {isWappModalOpen && (
        <WhatsappSendModal
          isOpen={isWappModalOpen}
          onClose={() => setIsWappModalOpen(false)}
          lead={lead}
        />
      )}
    </div>
  )
}

// ─── Follow-ups Tab (Upgraded) ───────────────────────────────────────────────

function FollowupsTab({ lead, qc: _qc }: { lead: Lead; qc: ReturnType<typeof useQueryClient> }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        To add a new follow-up, use the <strong>Update Status</strong> button on the lead card.
      </p>

      <div className="border-t pt-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4" /> History ({lead.followups?.length || 0})
        </h3>
        {!lead.followups?.length ? (
          <p className="text-sm text-muted-foreground">No follow-ups yet</p>
        ) : (
          <div className="space-y-3">
            {lead.followups.map((f: LeadFollowup) => (
              <div key={f.id} className="flex gap-3 text-sm border-l-2 border-primary/30 pl-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {(f as any).leadStatus?.title && (
                      <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                        {(f as any).leadStatus.title}
                      </span>
                    )}
                    {(f as any).leadSubStatus?.subStatus && (
                      <span className="px-2 py-0.5 text-xs bg-muted rounded-full text-muted-foreground">
                        {(f as any).leadSubStatus.subStatus}
                      </span>
                    )}
                    {f.type && f.type !== 'followup' && (
                      <span className="px-2 py-0.5 text-xs bg-orange-50 text-orange-600 rounded-full">{f.type}</span>
                    )}
                  </div>
                  <p>{f.comment}</p>
                  {(f as any).description && <p className="text-xs text-muted-foreground mt-0.5">{(f as any).description}</p>}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="font-medium">{f.user?.name}</span>
                    <span>{formatDateTime(f.createdAt)}</span>
                    {f.followupDate && <span className="text-primary">Next: {formatDateTime(f.followupDate)}</span>}
                    {f.callAnsweredStatus != null && (
                      <span>{(['—','✓Called','✗No Ans','📵Busy','⚡Off'])[Number(f.callAnsweredStatus)]||''}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Info Tab ─────────────────────────────────────────────────────────────────

/**
 * The Lead Information form.
 *
 * `id` on each section must match the group ids in
 * backend/src/config/lead-fields.ts — that is what lets a super admin hide a
 * whole group (say UCAT, for a customer who does not do UK admissions) without
 * anything here changing. Hiding never deletes: the columns keep their values
 * and turning a group back on shows them again.
 */
const INFO_SECTIONS = [
  {
    id: 'personal',
    title: 'Personal Information',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'father', label: 'Secondary contact' },
      { key: 'mother', label: 'Secondary contact 2' },
      { key: 'email', label: 'Work Email' },
      { key: 'email2', label: 'Email 2' },
      { key: 'email3', label: 'Email 3' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'mobile2', label: 'Mobile 2' },
      { key: 'mobile3', label: 'Mobile 3' },
      { key: 'fatherMobile', label: 'Father Mobile' },
      { key: 'motherMobile', label: 'Mother Mobile' },
      { key: 'gender', label: 'Gender' },
      { key: 'dob', label: 'DOB' },
      { key: 'firstLanguage', label: 'First Language' },
      { key: 'maritalStatus', label: 'Marital Status' },
      { key: 'castCategory', label: 'Cast Category' },
      { key: 'nationality', label: 'Nationality' },
      { key: 'religion', label: 'Religion' },
      { key: 'passportNumber', label: 'Passport No.' },
      { key: 'passportExpiry', label: 'Passport Expiry' },
    ],
  },
  {
    id: 'address',
    title: 'Address Detail',
    fields: [
      { key: 'homeAddress', label: 'Home Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'country', label: 'Country' },
      { key: 'pincode', label: 'Pincode' },
      { key: 'homeContactNumber', label: 'Home Contact Number' },
    ],
  },
  {
    id: 'other',
    title: 'Deal details',
    fields: [
      { key: 'leadType', label: 'Lead Type' },
      { key: 'website', label: 'Website' },
      { key: 'source', label: 'Source' },
      { key: 'intrestedCourse', label: 'Product interest' },
      { key: 'intrestedSubject', label: 'Requirement' },
      { key: 'approximateBudget', label: 'Order value' },
    ],
  },
]

function InfoTab({ lead, qc }: { lead: Lead; qc: ReturnType<typeof useQueryClient> }) {
  const reveal = useAuthStore((s) => s.canRevealPhone())
  const { filterSections } = useLeadFields()
  const [editing, setEditing] = useState(false)

  // What this customer actually shows, and what they call it. Everything is
  // visible under its default name unless a super admin has changed it.
  //
  // Through the hook rather than re-implemented here: the hand-rolled version
  // this replaces read `hiddenFields` instead of the flattened
  // `hiddenFieldKeys`, so a field hidden by its GROUP still appeared, and it
  // applied no renames at all — which is why a B2B customer's Info tab read
  // "Father", "Interested Course" however carefully they had renamed them.
  const sections = useMemo(() => filterSections(INFO_SECTIONS), [filterSections])

  const [form, setForm] = useState(() => {
    const init: Record<string, any> = {}
    // Built from the FULL list, not the filtered one: a hidden field's value
    // must survive an edit untouched rather than being blanked on save.
    INFO_SECTIONS.forEach((s) => {
      s.fields.forEach((f) => {
        init[f.key] = (lead as any)[f.key] ?? (f.type === 'number' ? '' : '')
      })
    })
    init.comment = lead.comment || ''
    return init
  })

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, any> = { ...form }
      // Prisma's Int? columns (neetPassingYear, overallScore, ucat, dmat, sat)
      // reject "" — coerce empty numeric fields to null, parsed values to Number.
      INFO_SECTIONS.forEach((s) => {
        s.fields.forEach((f) => {
          if (f.type === 'number') {
            const v = payload[f.key]
            payload[f.key] = v === '' || v === null || v === undefined ? null : Number(v)
          }
        })
      })
      for (const k of ['mobile', 'mobile2', 'mobile3', 'fatherMobile', 'motherMobile', 'homeContactNumber']) {
        if (k in payload && payload[k]) payload[k] = normalizePhone(payload[k])
      }
      return leadsApi.update(lead.id, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      setEditing(false)
      toast.success('Lead updated')
    },
    onError: () => toast.error('Update failed'),
  })

  if (!editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-semibold text-lg">Lead Information</h3>
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Edit
          </button>
        </div>

        {sections.map((section, idx) => {
          return (
            <div key={idx} className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-4">{section.title}</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6">
                {section.fields.map((field) => {
                  let val = (lead as any)[field.key]
                  if (val === null || val === undefined || val === '') {
                    val = '—'
                  } else if (field.key.toLowerCase().includes('mobile')) {
                    val = maskPhone(String(val), reveal)
                  }
                  return <InfoRow key={field.key} label={field.label} value={String(val)} />
                })}
              </div>
            </div>
          )
        })}

        {lead.comment && (
          <div className="mt-3 p-3 bg-muted/50 rounded-md text-sm">
            <span className="font-medium">Comment: </span>{lead.comment}
          </div>
        )}
        <div className="mt-3 p-3 bg-muted/30 rounded-md grid grid-cols-2 text-sm">
          <InfoRow label="Created At" value={formatDate(lead.createdAt)} />
          <InfoRow label="Assigned To" value={lead.assignedTo?.[0]?.counsellor?.name || '—'} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b pb-2">
        <h3 className="font-semibold text-lg">Edit Lead</h3>
        <button onClick={() => setEditing(false)} className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>

      {sections.map((section, idx) => (
        <div key={idx} className="space-y-3 bg-muted/20 p-4 rounded-lg border">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{section.title}</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {section.fields.map((field) => (
              <div key={field.key}>
                <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={form[field.key]}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-muted/20 p-4 rounded-lg border space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Comment</h4>
        <textarea
          value={form.comment}
          onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
          rows={3}
          className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="px-6 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 font-medium"
        >
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Changes
        </button>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="font-medium text-sm">{value}</p>
    </div>
  )
}

// ─── Notes Tab ────────────────────────────────────────────────────────────────
// Unified "everything notes-like" view. Merges four streams so what the bucket
// surfaces in its Notes column is also visible here:
//   • leadNote rows ("Add Note" button below — only stream that's writable)
//   • leadComment rows (team comments — also their own tab)
//   • flagMessage rows (flag reasons — also their own tab)
//   • lead.comment (intake comment captured at lead creation)
// Inline delete only on rows the caller owns (LeadNote); other sources are
// managed from their own tabs.

type NoteRow = {
  key: string
  source: 'note' | 'comment' | 'flag' | 'intake'
  body: string
  createdAt: string
  user: { id: number; name: string } | null
  noteId?: number
  flagType?: 'send' | 'rcv'
}

function NotesTab({ lead, qc, isAdmin }: { lead: Lead; qc: ReturnType<typeof useQueryClient>; isAdmin: boolean }) {
  const leadId = lead.id
  const [note, setNote] = useState('')

  const { data: notes = [] } = useQuery<LeadNote[]>({
    queryKey: ['notes', leadId],
    queryFn: () => notesApi.list(leadId),
  })

  const { data: comments = [] } = useQuery<LeadCommentItem[]>({
    queryKey: ['comments', leadId],
    queryFn: () => commentsApi.list(leadId),
  })

  const { data: flagMessages = [] } = useQuery<FlagMessageItem[]>({
    queryKey: ['flag-messages', leadId],
    queryFn: () => leadsApi.flagMessages(leadId),
  })

  const rows: NoteRow[] = [
    ...notes.map((n) => ({
      key: `n-${n.id}`,
      source: 'note' as const,
      body: n.note,
      createdAt: n.createdAt,
      user: n.user ? { id: n.user.id, name: n.user.name } : null,
      noteId: n.id,
    })),
    ...comments.map((c) => ({
      key: `c-${c.id}`,
      source: 'comment' as const,
      body: c.comment,
      createdAt: c.createdAt,
      user: c.user ? { id: c.user.id, name: c.user.name } : null,
    })),
    ...flagMessages.map((f) => ({
      key: `f-${f.id}`,
      source: 'flag' as const,
      body: f.message,
      createdAt: f.createdAt,
      user: f.user ? { id: f.user.id, name: f.user.name } : null,
      flagType: f.type,
    })),
    ...(lead.comment?.trim()
      ? [{
          key: `intake-${leadId}`,
          source: 'intake' as const,
          body: lead.comment,
          createdAt: lead.createdAt,
          user: null,
        }]
      : []),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const addNote = useMutation({
    mutationFn: notesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', leadId] })
      setNote('')
      toast.success('Note added')
    },
  })

  const deleteNote = useMutation({
    mutationFn: notesApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', leadId] })
      toast.success('Note deleted')
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note or comment..."
          rows={3}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <button
          onClick={() => {
            if (!note.trim()) return
            addNote.mutate({ leadId, note: note.trim() })
          }}
          disabled={addNote.isPending || !note.trim()}
          className="mt-2 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          {addNote.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add Note
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => <NoteRowItem key={r.key} row={r} isAdmin={isAdmin} onDelete={(id) => deleteNote.mutate(id)} />)}
        </div>
      )}
    </div>
  )
}

function NoteRowItem({ row, isAdmin, onDelete }: {
  row: NoteRow
  isAdmin: boolean
  onDelete: (id: number) => void
}) {
  const Icon = row.source === 'flag'
    ? Flag
    : row.source === 'comment'
      ? MessagesSquare
      : FileText
  const iconColor = row.source === 'flag'
    ? 'text-amber-600'
    : 'text-muted-foreground'
  const bg = row.source === 'flag'
    ? 'bg-amber-50 border border-amber-200'
    : 'bg-muted/30'

  return (
    <div className={`flex gap-3 p-3 rounded-md text-sm group ${bg}`}>
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <p className="whitespace-pre-wrap break-words">{row.body}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
          <SourceTag source={row.source} flagType={row.flagType} />
          {row.user && <span className="font-medium">{row.user.name}</span>}
          <span>{formatDate(row.createdAt)}</span>
        </div>
      </div>
      {isAdmin && row.source === 'note' && row.noteId != null && (
        <button
          onClick={() => onDelete(row.noteId!)}
          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function SourceTag({ source, flagType }: { source: NoteRow['source']; flagType?: 'send' | 'rcv' }) {
  const map: Record<NoteRow['source'], { label: string; cls: string }> = {
    note:    { label: 'Note',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    comment: { label: 'Comment', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    flag:    { label: flagType === 'send' ? 'Flag (admin)' : 'Flag', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    intake:  { label: 'Intake',  cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  }
  const { label, cls } = map[source]
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

// ─── Comments Tab ─────────────────────────────────────────────────────────────

type LeadCommentItem = {
  id: number
  comment: string
  createdAt: string
  user?: { id: number; name: string; role?: string }
}

type PastCommentRow = {
  key: string
  id: number | null
  source: 'comment' | 'followup'
  comment: string
  createdAt: string
  user?: { id: number; name: string; role?: string }
}

function CommentsTab({ leadId, qc, isAdmin }: { leadId: number; qc: ReturnType<typeof useQueryClient>; isAdmin: boolean }) {
  const [text, setText] = useState('')

  const { data: comments = [] } = useQuery<LeadCommentItem[]>({
    queryKey: ['comments', leadId],
    queryFn: () => commentsApi.list(leadId),
  })

  // Pull followups too — the "Update Status" modal writes comments here, and
  // the user wants both streams visible in the past-comments history.
  const { data: followups = [] } = useQuery<Array<{ id: number; comment: string; createdAt: string; user?: { id: number; name: string } }>>({
    queryKey: ['followups', leadId],
    queryFn: () => followupsApi.list(leadId),
  })

  // Merge both streams, newest-first.
  const pastComments: PastCommentRow[] = [
    ...comments.map((c) => ({
      key: `c-${c.id}`,
      id: c.id,
      source: 'comment' as const,
      comment: c.comment,
      createdAt: c.createdAt,
      user: c.user,
    })),
    ...followups
      .filter((f) => f.comment && f.comment.trim())
      .map((f) => ({
        key: `f-${f.id}`,
        id: f.id,
        source: 'followup' as const,
        comment: f.comment,
        createdAt: f.createdAt,
        user: f.user,
      })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const addComment = useMutation({
    mutationFn: commentsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', leadId] })
      setText('')
      toast.success('Comment posted')
    },
  })

  const deleteComment = useMutation({
    mutationFn: commentsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', leadId] })
      toast.success('Comment deleted')
    },
  })

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        Past Comments ({pastComments.length})
      </p>
      {pastComments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet — start the discussion below.</p>
      ) : (
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {pastComments.map((c) => (
            <div key={c.key} className="flex gap-3 p-3 bg-muted/30 rounded-md text-sm group">
              <MessagesSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="whitespace-pre-wrap">{c.comment}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="font-medium">{c.user?.name || 'Unknown'}</span>
                  {c.source === 'followup' && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold">
                      Follow-up
                    </span>
                  )}
                  <span>{formatDate(c.createdAt)}</span>
                </div>
              </div>
              {isAdmin && c.source === 'comment' && c.id != null && (
                <button
                  onClick={() => deleteComment.mutate(c.id as number)}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a comment for the team..."
          rows={3}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <button
          onClick={() => {
            if (!text.trim()) return
            addComment.mutate({ leadId, comment: text.trim() })
          }}
          disabled={addComment.isPending || !text.trim()}
          className="mt-2 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          {addComment.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Post Comment
        </button>
      </div>
    </div>
  )
}

// ─── Flags Tab ────────────────────────────────────────────────────────────────

type FlagMessageItem = {
  id: number
  message: string
  type: 'send' | 'rcv'
  createdAt: string
  user?: { id: number; name: string } | null
}

function FlagsTab({ leadId, qc, isAdmin }: { leadId: number; qc: ReturnType<typeof useQueryClient>; isAdmin: boolean }) {
  const [comment, setComment] = useState('')
  // Direction is auto-derived from role to match old CRM (no UI for it):
  // admin/sub-admin flag "send", everyone else flags "rcv".
  const which: 'send' | 'rcv' = isAdmin ? 'send' : 'rcv'

  const { data: messages = [] } = useQuery<FlagMessageItem[]>({
    queryKey: ['flag-messages', leadId],
    queryFn: () => leadsApi.flagMessages(leadId),
  })

  const send = useMutation({
    mutationFn: () => leadsApi.toggleFlag(leadId, which, comment.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flag-messages', leadId] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      // Flagging unassigns + moves the lead into the shared Flag bucket.
      qc.invalidateQueries({ queryKey: ['leads'] })
      setComment('')
      toast.success('Flag sent')
    },
  })

  const clearAll = useMutation({
    mutationFn: () => leadsApi.clearFlags(leadId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flag-messages', leadId] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Flag cleared')
    },
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Left — comment form */}
      <div className="p-4 border rounded-md bg-muted/20">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add Comment"
          rows={6}
          required
          className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none mb-3"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => send.mutate()}
            disabled={send.isPending || !comment.trim()}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Flag className="h-3.5 w-3.5" />
            {send.isPending ? 'Saving…' : 'Send'}
          </button>
          <button
            onClick={() => {
              if (confirm('Clear all flags + flag history for this lead?')) clearAll.mutate()
            }}
            disabled={clearAll.isPending}
            className="px-4 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Right — timeline */}
      <div className="p-4 border rounded-md bg-card">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No Chat Yet.</p>
        ) : null}

        {messages.length > 0 && (
          <ul className="space-y-2 max-h-[400px] overflow-y-auto">
            {messages.map((m) => (
              <li
                key={m.id}
                className="flex gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm"
              >
                <Flag className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="whitespace-pre-wrap">{m.message}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="font-medium">{m.user?.name || 'Unknown'}</span>
                    <span>{formatDate(m.createdAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────

function RemindersTab({ leadId, qc }: { leadId: number; qc: ReturnType<typeof useQueryClient> }) {
  const [reminderDate, setReminderDate] = useState('')
  const [reminderTime, setReminderTime] = useState('09:00')
  const [note, setNote] = useState('')

  const { data: reminders = [] } = useQuery<Reminder[]>({
    queryKey: ['reminders', leadId],
    queryFn: () => remindersApi.list(leadId),
  })

  const addReminder = useMutation({
    mutationFn: remindersApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders', leadId] })
      setReminderDate('')
      setReminderTime('09:00')
      setNote('')
      toast.success('Reminder set')
    },
  })

  const deleteReminder = useMutation({
    mutationFn: remindersApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders', leadId] })
      toast.success('Reminder deleted')
    },
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Reminder Date</label>
          <input
            type="date"
            value={reminderDate}
            onChange={(e) => setReminderDate(e.target.value)}
            className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Time</label>
          <input
            type="time"
            value={reminderTime}
            onChange={(e) => setReminderTime(e.target.value)}
            className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Note</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note..."
            className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <button
        onClick={() => {
          if (!reminderDate) return
          // Combine date + time into an ISO local datetime string
          const reminderDateTime = `${reminderDate}T${reminderTime || '09:00'}:00`
          addReminder.mutate({ leadId, reminderDate: reminderDateTime, note: note || undefined })
        }}
        disabled={addReminder.isPending || !reminderDate}
        className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
      >
        {addReminder.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Set Reminder
      </button>

      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reminders set</p>
      ) : (
        <div className="space-y-2">
          {reminders.map((r: Reminder) => (
            <div key={r.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-md text-sm group">
              <div className="flex items-center gap-3">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">{formatDateTime(r.reminderDate)}</p>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                </div>
              </div>
              <button
                onClick={() => deleteReminder.mutate(r.id)}
                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Email Tab ────────────────────────────────────────────────────────────────

type MailHistoryRow = { id: number; subject: string; body: string; createdAt: string }

function EmailTab({ lead }: { lead: Lead }) {
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const { data: mails = [], isLoading: mailsLoading } = useQuery<MailHistoryRow[]>({
    queryKey: ['lead-mails', lead.id],
    queryFn: () => leadsApi.mails(lead.id),
  })

  const send = async () => {
    if (!lead.email) return toast.error('Lead has no email address')
    if (!subject.trim() || !body.trim()) return toast.error('Subject and body are required')
    setSending(true)
    try {
      await communicationApi.send({ toEmail: lead.email, subject, body, leadId: lead.id })
      toast.success('Email sent')
      setSubject('')
      setBody('')
      qc.invalidateQueries({ queryKey: ['lead-mails', lead.id] })
      qc.invalidateQueries({ queryKey: ['lead-timeline', lead.id] })
    } catch {
      toast.error('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      {!lead.email && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
          This lead has no email address on file.
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-muted-foreground">To</label>
        <input
          value={lead.email || ''}
          readOnly
          className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-muted/30"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject..."
          className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Compose your message..."
          rows={8}
          className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
      <button
        onClick={send}
        disabled={sending || !lead.email}
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
      >
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Send Email
      </button>

      {/* Sent History */}
      <div className="border-t pt-4 mt-2">
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <Mail className="h-4 w-4" /> Sent History ({mails.length})
        </h3>
        {mailsLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : mails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails sent yet</p>
        ) : (
          <ul className="space-y-2">
            {mails.map((m) => (
              <li key={m.id}>
                <details className="group border rounded-md overflow-hidden">
                  <summary className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent/40 text-sm">
                    <span className="font-medium truncate pr-3">{m.subject}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </summary>
                  <div
                    className="px-3 py-3 border-t bg-muted/20 text-sm prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: m.body }}
                  />
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

function TimelineTab({ leadId }: { leadId: number }) {
  const { data: entries = [], isLoading } = useQuery<TimelineEntry[]>({
    queryKey: ['lead-timeline', leadId],
    queryFn: () => leadsApi.timeline(leadId),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">No activity yet</p>
  }

  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-border" />
      <ul className="space-y-4">
        {entries.map((e) => {
          const dot = DOT_CLS[e.type]
          const Icon = ICON_FOR[e.type]
          return (
            <li key={e.id} className="relative">
              <span className={`absolute -left-5 top-1 h-3 w-3 rounded-full border-2 border-background ${dot}`} />
              <div className="flex items-start gap-2">
                <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="whitespace-pre-wrap">
                    {e.type === 'status' ? renderStatusSummary(e.summary) : e.summary}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="capitalize font-medium">{e.type}</span>
                    {e.by && <span>{e.by.name}</span>}
                    <span>{formatDate(e.at)}</span>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const DOT_CLS: Record<TimelineEntry['type'], string> = {
  status:   'bg-violet-500',
  followup: 'bg-amber-500',
  note:     'bg-blue-500',
  call:     'bg-emerald-500',
  mail:     'bg-pink-500',
  comment:  'bg-cyan-500',
  flag:     'bg-orange-500',
}

const ICON_FOR: Record<TimelineEntry['type'], typeof Activity> = {
  status:   Activity,
  followup: CalendarDays,
  note:     StickyNote,
  call:     PhoneCall,
  mail:     Send,
  comment:  MessageSquare,
  flag:     Flag,
}

/** Render "Status: Fresh → Contacted" with a nice arrow. */
function renderStatusSummary(summary: string) {
  const m = summary.match(/^Status: (.+?) → (.+)$/)
  if (!m) return summary
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">Status:</span>
      <span className="font-medium">{m[1]}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="font-medium">{m[2]}</span>
    </span>
  )
}

// ─── Calls Tab ────────────────────────────────────────────────────────────────

type CallRow = {
  id: number
  phoneNumber: string
  direction: 'OUTGOING' | 'INCOMING'
  status: string
  startedAt: string
  endedAt: string | null
  durationSec: number
  recordingPath: string | null
  simSlot: number | null
  simCarrier: string | null
  simNumber: string | null
  user: { id: number; name: string } | null
}

function formatSim(c: { simSlot: number | null; simCarrier: string | null; simNumber: string | null }) {
  if (c.simNumber) {
    return (
      <span>
        {c.simNumber}
        {c.simCarrier ? <span className="text-muted-foreground"> · {c.simCarrier}</span> : null}
      </span>
    )
  }
  if (c.simSlot != null || c.simCarrier) {
    const slot = c.simSlot != null ? `SIM ${c.simSlot}` : null
    return <span>{[slot, c.simCarrier].filter(Boolean).join(' · ')}</span>
  }
  return <span className="text-muted-foreground">—</span>
}

function CallsTab({ leadId }: { leadId: number }) {
  const { data, isLoading } = useQuery<{ data: CallRow[]; total: number }>({
    queryKey: ['calls', { leadId }],
    queryFn: () => callsApi.list({ leadId, limit: 100 }),
  })

  if (isLoading) return <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading calls…</div>
  const calls = data?.data ?? []
  if (calls.length === 0) return <div className="text-center py-8 text-muted-foreground">No calls logged for this lead yet.</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Sales Rep</th>
            <th className="px-3 py-2 font-medium">Direction</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Via SIM</th>
            <th className="px-3 py-2 font-medium">Recording</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id} className="border-b hover:bg-muted/40">
              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(c.startedAt)}</td>
              <td className="px-3 py-2">{c.user?.name ?? '—'}</td>
              <td className="px-3 py-2">{c.direction === 'OUTGOING' ? '→ Out' : '← In'}</td>
              <td className="px-3 py-2">{c.status}</td>
              <td className="px-3 py-2">{formatDuration(c.durationSec)}</td>
              <td className="px-3 py-2 text-xs">{formatSim(c)}</td>
              <td className="px-3 py-2">
                {c.recordingPath ? <RecordingPlayer callId={c.id} /> : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatDuration(sec: number): string {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
