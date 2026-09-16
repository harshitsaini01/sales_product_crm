import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Handshake, Plus } from 'lucide-react'
import { dealsApi, pipelinesApi, formatMoney, type Deal } from '@/lib/deals-api'
import { NewDealModal } from '@/pages/admin/Deals'
import { StatusPill } from '@/components/crm/DocumentLines'

export function LeadDealsPanel({ leadId, leadName }: { leadId: number; leadName: string }) {
  const [creating, setCreating] = useState(false)
  const { data: pipelines = [] } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list })
  const { data, refetch } = useQuery({
    queryKey: ['deals', 'lead', leadId],
    queryFn: () => dealsApi.list({ leadId, limit: 20 }),
  })
  const deals = (data?.data ?? []) as Deal[]

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Handshake className="h-4 w-4 text-muted-foreground" /> Deals
        </h3>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Start deal
        </button>
      </div>
      {!deals.length ? (
        <p className="text-sm text-muted-foreground">No deal yet. Start one from the catalog you sent, or pick products.</p>
      ) : (
        <ul className="space-y-2">
          {deals.map((d) => (
            <li key={d.id}>
              <Link
                to="/app/deals/$dealId"
                params={{ dealId: String(d.id) }}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="min-w-0 truncate font-medium">{d.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {d.stage && <StatusPill status={d.stage.name} />}
                  <span className="font-semibold">{formatMoney(d.value, d.currency)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewDealModal
          pipelines={pipelines}
          defaults={{ leadId, leadName, name: `${leadName} — order` }}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            refetch()
          }}
        />
      )}
    </div>
  )
}
