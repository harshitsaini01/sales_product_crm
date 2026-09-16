import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { platformApi, type TermPayload } from '@/lib/api'
import {
  Panel, Pill, Loading, Callout, Field, TableWrap,
  thClass, trClass, tdClass, inputClass, btnPrimary, btnGhost, btnDanger,
} from './ui'
import { cn } from '@/lib/utils'

type TenantDetail = Awaited<ReturnType<typeof platformApi.getTenant>>

/**
 * Vertical & Wording.
 *
 * Two related but very different controls, on one tab because they answer the
 * same question — what kind of business is this customer?
 *
 *   • Switching the VERTICAL re-applies a preset. That is destructive: it
 *     overwrites modules, lead fields and wording, discarding manual tweaks.
 *     Hence the typed confirmation.
 *   • Editing the WORDING is additive and reversible. Clear a box and the term
 *     falls back to the default shown as its placeholder.
 */
export function SetupTab({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const { data: verticals } = useQuery({
    queryKey: ['platform', 'verticals'],
    queryFn: platformApi.verticals,
    staleTime: 60 * 60_000,
  })

  const { data: terms } = useQuery({
    queryKey: ['platform', 'tenant', tenant.id, 'terms'],
    queryFn: () => platformApi.terms(tenant.id),
  })

  // ── Vertical
  const [pending, setPending] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const switchVertical = useMutation({
    mutationFn: (key: string) => platformApi.setVertical(tenant.id, key, true),
    onSuccess: () => {
      toast.success('Preset applied. Modules, lead fields and wording were reset to it.')
      setPending(null)
      setConfirmText('')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not switch vertical'),
  })

  // ── Terminology
  //
  // Held as the complete override map rather than a diff, because the endpoint
  // REPLACES rather than merges — a term the person cleared has to arrive as an
  // absence, not survive by being missing from a partial payload.
  const [draft, setDraft] = useState<Record<string, Partial<TermPayload>>>({})

  useEffect(() => {
    if (!terms) return
    const next: Record<string, Partial<TermPayload>> = {}
    for (const term of terms) {
      const override: Partial<TermPayload> = {}
      if (term.singular !== term.defaultSingular) override.singular = term.singular
      if (term.plural !== term.defaultPlural) override.plural = term.plural
      if (override.singular || override.plural) next[term.key] = override
    }
    setDraft(next)
  }, [terms])

  const saveTerms = useMutation({
    mutationFn: () => platformApi.updateTerms(tenant.id, draft),
    onSuccess: () => {
      toast.success('Wording saved. Staff see it on their next page load.')
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save wording'),
  })

  const setTerm = (key: string, half: 'singular' | 'plural', value: string) =>
    setDraft((d) => {
      const entry = { ...d[key], [half]: value }
      if (!value.trim()) delete entry[half]
      const next = { ...d }
      if (entry.singular || entry.plural) next[key] = entry
      else delete next[key]
      return next
    })

  const renamedCount = Object.keys(draft).length

  return (
    <div className="space-y-6">
      <Panel
        title="Vertical"
        description="The preset this customer was built from. Switching re-applies it."
      >
        {!verticals ? (
          <Loading label="Loading presets…" />
        ) : (
          <div className="space-y-3">
            {verticals.map((v) => {
              const current = v.key === tenant.vertical
              return (
                <div
                  key={v.key}
                  className={cn(
                    'rounded-xl border p-4',
                    current ? 'border-slate-900 bg-slate-50' : 'border-slate-200',
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{v.label}</p>
                        {current && <Pill>Current</Pill>}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{v.description}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        Switches off {v.disabledFeatureCount} module
                        {v.disabledFeatureCount === 1 ? '' : 's'} and {v.hiddenGroupCount}{' '}
                        lead-field group{v.hiddenGroupCount === 1 ? '' : 's'}.
                      </p>
                    </div>
                    {!current && (
                      <button
                        onClick={() => {
                          setPending(v.key)
                          setConfirmText('')
                        }}
                        className={btnGhost}
                      >
                        Switch
                      </button>
                    )}
                  </div>

                  {pending === v.key && (
                    <div className="mt-4 space-y-3 border-t pt-4">
                      <Callout tone="danger" title="This overwrites their current setup">
                        Applying the <strong>{v.label}</strong> preset replaces{' '}
                        {tenant.companyName}&rsquo;s modules, lead-field visibility and wording with
                        the preset&rsquo;s values. Anything set by hand on the Modules, Lead Fields
                        or Wording tabs is discarded. Leads, users and the seeded pipeline are not
                        touched.
                      </Callout>
                      <Field
                        label={`Type ${tenant.slug} to confirm`}
                        hint="Deliberately awkward — there is no undo."
                      >
                        <input
                          className={inputClass}
                          value={confirmText}
                          onChange={(e) => setConfirmText(e.target.value)}
                          placeholder={tenant.slug}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <button
                          onClick={() => switchVertical.mutate(v.key)}
                          disabled={confirmText !== tenant.slug || switchVertical.isPending}
                          className={btnDanger}
                        >
                          Apply the {v.label} preset
                        </button>
                        <button onClick={() => setPending(null)} className={btnGhost}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Wording"
        description="What this customer calls things. Clear a box to fall back to the default."
        actions={
          <button
            onClick={() => saveTerms.mutate()}
            disabled={saveTerms.isPending}
            className={btnPrimary}
          >
            <Save className="h-4 w-4" /> Save wording
          </button>
        }
      >
        {!terms ? (
          <Loading label="Loading wording…" />
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              {renamedCount === 0
                ? 'Nothing renamed — this customer sees the standard wording.'
                : `${renamedCount} term${renamedCount === 1 ? '' : 's'} renamed.`}{' '}
              Renaming is presentation only: no column, API field or export header changes.
            </p>
            <TableWrap>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thClass}>Term</th>
                    <th className={thClass}>Singular</th>
                    <th className={thClass}>Plural</th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map((term) => (
                    <tr key={term.key} className={trClass}>
                      <td className={cn(tdClass, 'align-top')}>
                        <p className="font-medium text-slate-900">{term.defaultSingular}</p>
                        <p className="mt-0.5 max-w-xs text-xs text-slate-400">{term.description}</p>
                      </td>
                      <td className={cn(tdClass, 'align-top')}>
                        <input
                          className={inputClass}
                          value={draft[term.key]?.singular ?? ''}
                          onChange={(e) => setTerm(term.key, 'singular', e.target.value)}
                          placeholder={term.defaultSingular}
                        />
                      </td>
                      <td className={cn(tdClass, 'align-top')}>
                        <input
                          className={inputClass}
                          value={draft[term.key]?.plural ?? ''}
                          onChange={(e) => setTerm(term.key, 'plural', e.target.value)}
                          placeholder={term.defaultPlural}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Panel>
    </div>
  )
}
