import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, X } from 'lucide-react'
import { crmApi } from '@/lib/crm-api'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { useLabels } from '@/hooks/useLabels'

/**
 * Lead → Account + Contact.
 *
 * The seam between the two CRM cores. The lead is NOT consumed: it keeps its
 * row, its UTM attribution and its own timeline, and the account starts life
 * with a copy of that history behind it. So this is safe to click — it adds a
 * company, it does not remove an enquiry.
 *
 * Renders nothing unless the `accounts` module is on, which the education
 * vertical leaves off.
 */
export function ConvertToAccountButton({
  leadId,
  leadName,
  /** Stay put and refresh in place, instead of navigating to the new account. */
  stayOnPage,
  onConverted,
}: {
  leadId: number
  leadName: string
  stayOnPage?: boolean
  onConverted?: () => void
}) {
  const hasFeature = useAuthStore((s) => s.hasFeature)
  const navigate = useNavigate()
  const t = useLabels()
  const [open, setOpen] = useState(false)
  const [accountName, setAccountName] = useState(leadName)
  const [accountTypeId, setAccountTypeId] = useState('')
  const [industryId, setIndustryId] = useState('')

  /**
   * Is this lead already a company?
   *
   * Without this the button sat on the lead header forever, offering to convert
   * something that had been converted weeks ago — and converting twice is
   * refused by the API, so the only thing it could produce was an error.
   */
  const { data: business } = useQuery({
    queryKey: ['lead-business', leadId],
    queryFn: () => api.get(`/lead-business/${leadId}`).then((r) => r.data as {
      converted: boolean
      account: { id: number; name: string } | null
    }),
    enabled: hasFeature('accounts'),
  })

  const { data: types = [] } = useQuery({
    queryKey: ['crm', 'account-types'],
    queryFn: crmApi.accountTypes,
    enabled: open,
  })
  const { data: industries = [] } = useQuery({
    queryKey: ['crm', 'industries'],
    queryFn: crmApi.industries,
    enabled: open,
  })

  const convert = useMutation({
    mutationFn: () =>
      crmApi.convertLead(leadId, {
        accountName: accountName.trim() || undefined,
        accountTypeId: accountTypeId ? Number(accountTypeId) : null,
        industryId: industryId ? Number(industryId) : null,
      }),
    onSuccess: (r) => {
      toast.success(`${t('account')} created`)
      setOpen(false)
      onConverted?.()
      // From the lead's own company panel the rep wants to stay where they are
      // and watch it fill in, not be thrown onto a different screen.
      if (!stayOnPage) {
        navigate({ to: '/app/accounts/$accountId', params: { accountId: String(r.account.id) } })
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not convert'),
  })

  if (!hasFeature('accounts')) return null

  // Already a company: offer the way in, not the way to make a second one.
  if (business?.converted && business.account) {
    return (
      <Link
        to="/app/accounts/$accountId"
        params={{ accountId: String(business.account.id) }}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <Building2 className="h-4 w-4" /> {business.account.name}
      </Link>
    )
  }

  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <Building2 className="h-4 w-4" /> Convert to {t('account').toLowerCase()}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Convert to {t('account').toLowerCase()}</h2>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-4 text-sm text-muted-foreground">
              Creates a company and a contact from this {t('lead').toLowerCase()}, and
              copies its history across. The {t('lead').toLowerCase()} itself stays
              exactly where it is.
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Company name *</label>
                <input
                  className={input}
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Defaults to the {t('lead').toLowerCase()}&rsquo;s own name, which is
                  right when somebody is buying for themselves.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Type</label>
                  <select className={input} value={accountTypeId} onChange={(e) => setAccountTypeId(e.target.value)}>
                    <option value="">—</option>
                    {types.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Industry</label>
                  <select className={input} value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
                    <option value="">—</option>
                    {industries.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">
                Cancel
              </button>
              <button
                onClick={() => convert.mutate()}
                disabled={!accountName.trim() || convert.isPending}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {convert.isPending ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
