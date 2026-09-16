import type { CustomFieldValue } from '@/lib/crm-api'

/**
 * One input per custom-field type.
 *
 * A single renderer used by every entity's form, so adding a field type is one
 * `case` here rather than a change in four forms that will quietly drift apart.
 *
 * VALUES ARE PATCHED, NEVER REPLACED. The parent collects changes into a
 * `{ key: value }` object and sends only what was touched — because
 * `appliesWhen` can hide fields, and a whole-object save would blank every
 * field the form never rendered. That failure is silent and permanent.
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: CustomFieldValue
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  const base =
    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  const str = value === null || value === undefined ? '' : String(value)

  switch (field.type) {
    case 'longtext':
      return (
        <textarea
          className={base}
          rows={3}
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'number':
    case 'currency':
    case 'percent':
      return (
        <input
          type="number"
          className={base}
          value={str}
          disabled={disabled}
          // Empty string rather than 0, so clearing a box clears the field
          // instead of silently recording a zero.
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          step={field.type === 'percent' ? '0.01' : 'any'}
        />
      )

    case 'date':
      return (
        <input
          type="date"
          className={base}
          value={str ? str.slice(0, 10) : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )

    case 'datetime':
      return (
        <input
          type="datetime-local"
          className={base}
          value={str ? str.slice(0, 16) : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )

    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-muted-foreground">Yes</span>
        </label>
      )

    case 'select':
      return (
        <select
          className={base}
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )

    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((o) => {
            const on = selected.includes(o)
            return (
              <button
                key={o}
                type="button"
                disabled={disabled}
                onClick={() => onChange(on ? selected.filter((s) => s !== o) : [...selected, o])}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input text-muted-foreground hover:border-primary/40'
                }`}
              >
                {o}
              </button>
            )
          })}
        </div>
      )
    }

    case 'file': {
      const url = str
      return (
        <div className="space-y-1.5">
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">
              Current file
            </a>
          )}
          <input
            type="file"
            className={base}
            disabled={disabled}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const fd = new FormData()
              fd.append('file', file)
              const { api } = await import('@/lib/api')
              const res = await api.post('/custom-fields/upload', fd)
              onChange(res.data.url)
            }}
          />
        </div>
      )
    }

    default:
      return (
        <input
          // The browser's own validation and keyboards for free — a phone field
          // should bring up a phone keypad on mobile.
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : 'text'}
          className={base}
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/**
 * Every custom field for a record, grouped under its section headings.
 *
 * Renders nothing at all when there are no definitions — an empty "Custom
 * Fields" panel on every account would be pure noise for a customer who has
 * defined none.
 */
export function CustomFieldsSection({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: CustomFieldValue[]
  values: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  disabled?: boolean
}) {
  if (!fields.length) return null

  const sections = new Map<string, CustomFieldValue[]>()
  for (const f of fields) {
    const key = f.section || ''
    if (!sections.has(key)) sections.set(key, [])
    sections.get(key)!.push(f)
  }

  return (
    <div className="space-y-6">
      {[...sections.entries()].map(([section, group]) => (
        <div key={section || 'default'}>
          {section && (
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {section}
            </h4>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {group.map((f) => (
              <div key={f.key}>
                <label className="mb-1.5 block text-sm font-medium">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-destructive">*</span>}
                </label>
                <CustomFieldInput
                  field={f}
                  // The draft wins while editing; the saved value is the
                  // fallback, so an untouched field still shows what it holds.
                  value={f.key in values ? values[f.key] : f.value}
                  onChange={(v) => onChange(f.key, v)}
                  disabled={disabled}
                />
                {f.helpText && (
                  <p className="mt-1 text-xs text-muted-foreground">{f.helpText}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Read-only rendering, for a detail page that is not in edit mode. */
export function formatCustomValue(field: CustomFieldValue, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'

  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'multiselect':
      return Array.isArray(value) && value.length ? (value as string[]).join(', ') : '—'
    case 'date':
      return new Date(String(value)).toLocaleDateString('en-IN')
    case 'datetime':
      return new Date(String(value)).toLocaleString('en-IN')
    case 'currency':
      return `₹${Number(value).toLocaleString('en-IN')}`
    case 'percent':
      return `${value}%`
    case 'file':
      return String(value)
    default:
      return String(value)
  }
}
