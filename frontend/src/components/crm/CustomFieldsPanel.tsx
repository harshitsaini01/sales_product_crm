import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { customFieldsApi, type CrmEntityType } from '@/lib/crm-api'
import { CustomFieldsSection } from '@/components/crm/CustomFieldRenderer'

/**
 * Custom fields for any record, on any panel.
 *
 * WHY THIS IS ONE COMPONENT AND NOT FOUR
 *
 * Every customer runs the same flow — a lead becomes a company becomes a deal —
 * but each sells something different, and so each needs different things
 * recorded against it. An admissions consultancy wants NEET rank; an IT sales
 * team wants seat count; a product seller wants SKU and margin. There is no
 * union of those that is not mostly blank columns.
 *
 * The alternative is adding a column per customer, and that is the one change
 * this codebase genuinely cannot absorb. All tenant schemas are migrated from
 * the same `schema.prisma`, and Prisma SELECTs every scalar it knows about — so
 * a column that exists for one customer and not another does not degrade, it
 * throws, on every query for everyone else. Fields have to be rows.
 *
 * So the panel is keyed by (entityType, entityId) and nothing else. A new record
 * type, or a fourth customer selling something nobody has thought of yet, needs
 * no schema change, no migration against the live education database, and no
 * code here.
 */
export function CustomFieldsPanel({
  entityType,
  entityId,
  onSaved,
  /** What these fields hang off, in the words a user would use. */
  noun,
}: {
  entityType: CrmEntityType
  entityId: number
  onSaved?: () => void
  noun: string
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({})

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['custom-fields', 'values', entityType, entityId],
    queryFn: () => customFieldsApi.values(entityType, entityId),
  })

  const save = useMutation({
    mutationFn: () => customFieldsApi.saveValues(entityType, entityId, draft),
    onSuccess: (r) => {
      // The server drops values it cannot parse rather than failing the whole
      // save. Saying so is the difference between a field that quietly never
      // sticks and one the user knows to re-enter.
      if (r.skipped?.length) {
        toast.warning(
          `Saved, but ${r.skipped.length} value${r.skipped.length === 1 ? '' : 's'} could not be read.`,
        )
      } else {
        toast.success('Saved')
      }
      setDraft({})
      onSaved?.()
    },
    onError: () => toast.error('Could not save those fields'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fields…
      </div>
    )
  }

  // Nothing defined yet is the normal state for a new customer, not an error —
  // so it points at where to define them rather than just saying "none".
  if (!fields.length) {
    return (
      <div className="rounded-xl border border-dashed py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No custom fields defined for {noun}.
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Add the ones your team actually records — they appear here for every{' '}
          {noun.replace(/s$/, '')} without any change to the rest of the CRM.
        </p>
        <Link
          to="/app/custom-fields"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Define some →
        </Link>
      </div>
    )
  }

  const dirty = Object.keys(draft).length

  return (
    <div className="space-y-5 rounded-xl border bg-card p-5">
      <CustomFieldsSection
        fields={fields}
        values={draft}
        onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
      />
      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {dirty ? `Save ${dirty} change${dirty > 1 ? 's' : ''}` : 'Saved'}
      </button>
    </div>
  )
}
