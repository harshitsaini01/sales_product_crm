import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Mail, Phone, Save, MessageSquare } from 'lucide-react'
import {
  contactsApi,
  CONTACT_ROLES, RELATIONSHIP_STRENGTHS, type Contact,
} from '@/lib/crm-api'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { ActivityTimeline } from '@/components/crm/ActivityTimeline'
import { CustomFieldsPanel } from '@/components/crm/CustomFieldsPanel'
import { NotesTab } from './AccountDetail'
import { cn } from '@/lib/utils'

type Tab = 'details' | 'notes' | 'fields'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

export default function ContactDetail() {
  const { contactId } = useParams({ from: '/app/contacts/$contactId' })
  const id = Number(contactId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('details')

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contacts', id],
    queryFn: () => contactsApi.get(id),
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!contact) return <p className="py-12 text-center text-sm">Not found.</p>

  const refresh = () => qc.invalidateQueries({ queryKey: ['contacts', id] })

  return (
    <div className="space-y-6">
      <Link
        to="/app/contacts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All contacts
      </Link>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-bold text-muted-foreground">
            {contact.firstName.slice(0, 1).toUpperCase()}
            {contact.lastName?.slice(0, 1).toUpperCase() ?? ''}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{contact.fullName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[contact.jobTitle, contact.department].filter(Boolean).join(' · ') || 'No title'}
            </p>
            {contact.account && (
              <Link
                to="/app/accounts/$accountId"
                params={{ accountId: String(contact.account.id) }}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Building2 className="h-3.5 w-3.5" /> {contact.account.name}
              </Link>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Mail className="h-3.5 w-3.5" /> {contact.email}
                </a>
              )}
              {contact.mobile && (
                <a href={`tel:${contact.mobile}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="h-3.5 w-3.5" /> {contact.mobile}
                </a>
              )}
              {contact.whatsapp && (
                <a
                  href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-right text-xs text-muted-foreground">
            <p className="font-medium uppercase tracking-wide">
              {CONTACT_ROLES.find((r) => r.value === contact.role)?.label ?? contact.role}
            </p>
            <p>
              {RELATIONSHIP_STRENGTHS.find((r) => r.value === contact.relationshipStrength)?.label}
            </p>
            <DeleteButton
              what="contact"
              label={contact.fullName}
              showLabel
              note="Moves to the trash. Anything they are named on keeps working."
              onDelete={() => contactsApi.remove(contact.id)}
              onDeleted={() => navigate({ to: '/app/contacts' })}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 border-b">
            {(['details', 'notes', 'fields'] as Tab[]).map((x) => (
              <button
                key={x}
                onClick={() => setTab(x)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors',
                  tab === x
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {x === 'fields' ? 'Custom Fields' : x}
              </button>
            ))}
          </div>

          {tab === 'details' && <DetailsTab contact={contact} onSaved={refresh} />}
          {tab === 'notes' && <NotesTab entityType="contact" entityId={id} />}
          {tab === 'fields' && <CustomFieldsPanel entityType="contact" entityId={id} noun="contacts" onSaved={refresh} />}
        </div>

        <aside className="min-w-0">
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold">Activity</h3>
            <ActivityTimeline entityType="contact" entityId={id} />
          </div>
        </aside>
      </div>
    </div>
  )
}

function DetailsTab({ contact, onSaved }: { contact: Contact; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, unknown>>({})
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const val = (k: keyof Contact) => (k in form ? form[k as string] : contact[k]) ?? ''

  const save = useMutation({
    mutationFn: () => contactsApi.update(contact.id, form),
    onSuccess: () => {
      toast.success('Saved')
      setForm({})
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const dirty = Object.keys(form).length > 0

  return (
    <div className="space-y-5 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <input className={input} value={String(val('firstName'))} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field label="Last name">
          <input className={input} value={String(val('lastName'))} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
        <Field label="Job title">
          <input className={input} value={String(val('jobTitle'))} onChange={(e) => set('jobTitle', e.target.value)} />
        </Field>
        <Field label="Department">
          <input className={input} value={String(val('department'))} onChange={(e) => set('department', e.target.value)} />
        </Field>
        <Field label="Role in the deal">
          <select className={input} value={String(val('role'))} onChange={(e) => set('role', e.target.value)}>
            {CONTACT_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Relationship">
          <select
            className={input}
            value={String(val('relationshipStrength'))}
            onChange={(e) => set('relationshipStrength', e.target.value)}
          >
            {RELATIONSHIP_STRENGTHS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work email">
          <input className={input} value={String(val('email'))} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Personal email">
          <input
            className={input}
            value={String(val('personalEmail'))}
            onChange={(e) => set('personalEmail', e.target.value)}
          />
        </Field>
        <Field label="Mobile">
          <input className={input} value={String(val('mobile'))} onChange={(e) => set('mobile', e.target.value)} />
        </Field>
        <Field label="WhatsApp">
          <input className={input} value={String(val('whatsapp'))} onChange={(e) => set('whatsapp', e.target.value)} />
        </Field>
        <Field label="Office phone">
          <input className={input} value={String(val('officePhone'))} onChange={(e) => set('officePhone', e.target.value)} />
        </Field>
        <Field label="LinkedIn">
          <input className={input} value={String(val('linkedin'))} onChange={(e) => set('linkedin', e.target.value)} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea className={input} rows={3} value={String(val('notes'))} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {dirty ? 'Save changes' : 'No changes'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}
