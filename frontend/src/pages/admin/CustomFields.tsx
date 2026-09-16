import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, EyeOff, Eye, Settings2, X } from 'lucide-react'
import { customFieldsApi, type CustomFieldDef, type CrmEntityType } from '@/lib/crm-api'
import { cn } from '@/lib/utils'

const ENTITIES: { key: CrmEntityType; label: string }[] = [
  { key: 'account', label: 'Accounts' },
  { key: 'contact', label: 'Contacts' },
  { key: 'lead', label: 'Leads' },
]

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percentage',
  date: 'Date',
  datetime: 'Date & time',
  select: 'Dropdown',
  multiselect: 'Multi-select',
  boolean: 'Yes / No',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  file: 'File / document',
}

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * Custom field definitions.
 *
 * This is what stops the CRM growing a column every time a new kind of customer
 * arrives: "Rooms" for a hotel, "Beds" for a hospital, "Campuses" for a school
 * — all the same Account table.
 */
export default function CustomFields() {
  const qc = useQueryClient()
  const [entityType, setEntityType] = useState<CrmEntityType>('account')
  const [creating, setCreating] = useState(false)

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () => customFieldsApi.list(entityType, true),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['custom-fields'] })

  const toggle = useMutation({
    mutationFn: (f: CustomFieldDef) => customFieldsApi.update(f.id, { active: !f.active }),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: ({ id, force }: { id: number; force: boolean }) => customFieldsApi.remove(id, force),
    onSuccess: () => {
      toast.success('Field deleted')
      refresh()
    },
    onError: (e: unknown) => {
      // The server refuses when values exist and returns the count, so the
      // person can make an informed choice rather than a blind second attempt.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (e as any)?.response?.data
      if (data?.valueCount) toast.error(data.error, { duration: 8000 })
      else toast.error(data?.error || 'Could not delete')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Custom Fields</h1>
          <p className="text-sm text-muted-foreground">
            Extra fields on your records, without a schema change.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {entityType === 'lead' && (
            <button
              onClick={() =>
                customFieldsApi.seedCommercial()
                  .then((r) => {
                    toast.success(r.created.length ? `Seeded ${r.created.length} commercial fields` : 'Commercial fields already present')
                    refresh()
                  })
                  .catch(() => toast.error('Could not seed'))
              }
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Seed commercial fields
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New field
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            onClick={() => setEntityType(e.key)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              entityType === e.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !fields.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Settings2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No custom fields on {entityType}s yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add the things your business actually tracks — rooms for a hotel, beds
            for a hospital, seats for a SaaS deal.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {fields.map((f) => (
            <div
              key={f.id}
              className={cn('flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4', !f.active && 'opacity-60')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{f.label}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                    {TYPE_LABELS[f.type] ?? f.type}
                  </span>
                  {f.required && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                      Required
                    </span>
                  )}
                  {!f.active && (
                    <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                      Retired
                    </span>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{f.key}</p>
                {f.appliesWhen && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only shown when{' '}
                    {Object.entries(f.appliesWhen)
                      .map(([k, v]) => `${k} is ${v.join(' or ')}`)
                      .join(', ')}
                  </p>
                )}
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() => toggle.mutate(f)}
                  title={f.active ? 'Retire (keeps every value)' : 'Bring back'}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                >
                  {f.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => remove.mutate({ id: f.id, force: false })}
                  title="Delete permanently"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Retiring a field hides it everywhere and keeps every value already
        collected — turn it back on and the data is still there. Deleting is the
        only action that loses anything.
      </p>

      {creating && (
        <NewFieldModal
          entityType={entityType}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function NewFieldModal({
  entityType,
  onClose,
  onCreated,
}: {
  entityType: CrmEntityType
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<Record<string, unknown>>({ type: 'text', label: '' })
  const [optionsText, setOptionsText] = useState('')

  const create = useMutation({
    mutationFn: () =>
      customFieldsApi.create({
        ...form,
        entityType,
        options:
          form.type === 'select' || form.type === 'multiselect'
            ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
            : undefined,
      }),
    onSuccess: () => {
      toast.success('Field created')
      onCreated()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const needsOptions = form.type === 'select' || form.type === 'multiselect'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">New field on {entityType}s</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Label *</label>
            <input
              className={input}
              placeholder="Number of Rooms"
              value={String(form.label ?? '')}
              onChange={(e) => set('label', e.target.value)}
              autoFocus
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The key is generated from this and can never change afterwards —
              every stored value is joined on it.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Type *</label>
            <select className={input} value={String(form.type)} onChange={(e) => set('type', e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {needsOptions && (
            <div>
              <label className="mb-1 block text-sm font-medium">Options *</label>
              <textarea
                className={input}
                rows={4}
                placeholder={'One per line\nYes\nNo'}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Section</label>
              <input
                className={input}
                placeholder="Property Details"
                value={String(form.section ?? '')}
                onChange={(e) => set('section', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Order</label>
              <input
                type="number"
                className={input}
                value={String(form.sortOrder ?? 0)}
                onChange={(e) => set('sortOrder', Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Help text</label>
            <input
              className={input}
              value={String(form.helpText ?? '')}
              onChange={(e) => set('helpText', e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.required === true}
              onChange={(e) => set('required', e.target.checked)}
            />
            Required
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={
              !String(form.label ?? '').trim() ||
              (needsOptions && !optionsText.trim()) ||
              create.isPending
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
