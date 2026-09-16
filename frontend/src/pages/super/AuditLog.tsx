import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { platformApi } from '@/lib/api'
import { PageHeader, Panel, Loading, Empty, inputClass, btnGhost } from './ui'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const ACTIONS = [
  'tenant.create', 'tenant.update', 'tenant.limits', 'tenant.features',
  'tenant.suspend', 'tenant.resume', 'tenant.extend', 'tenant.delete',
  'tenant.impersonate', 'tenant.migrate', 'tenant.user.reset_password',
  'tenant.apikey.create', 'tenant.apikey.revoke',
  'platform.user.create', 'platform.user.update', 'platform.migrate_all',
]

/** Actions worth making visually obvious in a long list. */
const HIGH_IMPACT = new Set(['tenant.delete', 'tenant.impersonate', 'tenant.suspend'])

export default function SuperAuditLog() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [tenantId, setTenantId] = useState('')

  const { data: tenants } = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: platformApi.listTenants,
    staleTime: 5 * 60_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'audit', page, action, tenantId],
    queryFn: () =>
      platformApi.audit({
        page,
        limit: 50,
        action: action || undefined,
        tenantId: tenantId ? Number(tenantId) : undefined,
      }),
  })

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every action taken in this panel, including who took it and from where."
      />

      <Panel>
        <div className="mb-4 flex flex-wrap gap-2">
          <select
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value)
              setPage(1)
            }}
            className={`${inputClass} w-auto`}
          >
            <option value="">All customers</option>
            {(tenants ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.companyName}
              </option>
            ))}
          </select>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setPage(1)
            }}
            className={`${inputClass} w-auto`}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {(action || tenantId) && (
            <button
              onClick={() => {
                setAction('')
                setTenantId('')
                setPage(1)
              }}
              className={btnGhost}
            >
              Clear filters
            </button>
          )}
        </div>

        {isLoading ? (
          <Loading />
        ) : !data?.data.length ? (
          <Empty>Nothing recorded for that filter.</Empty>
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-slate-100 border-t border-slate-100">
              {data.data.map((row) => {
                const high = HIGH_IMPACT.has(row.action)
                return (
                  <li
                    key={row.id}
                    className={cn(
                      'flex gap-3 px-5 py-3 transition-colors hover:bg-slate-50/70',
                      high && 'border-l-2 border-l-red-400',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-900">{row.summary}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[10px]',
                            high ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600',
                          )}
                        >
                          {row.action}
                        </span>
                        <span>{row.actorName}</span>
                        {row.tenant && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span>{row.tenant.companyName}</span>
                          </>
                        )}
                        {row.ip && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="font-mono">{row.ip}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <time className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                      {new Date(row.createdAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </li>
                )
              })}
            </ul>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {data.page} of {data.totalPages || 1} · {data.total.toLocaleString()} entries
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className={`${btnGhost} px-2 py-1.5`}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= (data.totalPages || 1)}
                  className={`${btnGhost} px-2 py-1.5`}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  )
}
