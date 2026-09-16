import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { platformApi } from '@/lib/api'
import {
  PageHeader, Panel, StatTile, Pill, Loading, Empty,
  TableWrap, thClass, trClass, tdClass, btnGhost, btnPrimary,
} from './ui'
import { cn } from '@/lib/utils'
import { Database, RefreshCw, CheckCircle2, AlertCircle, Layers, Plug, HardDrive } from 'lucide-react'

interface HealthRow {
  id: number
  slug: string
  companyName: string
  schemaName: string
  provisioningStatus: string
  sizeMb: number
  poolOpen: boolean
  poolIdleMs: number | null
}

export default function SuperSystemHealth() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<{ tenants: HealthRow[]; openConnections: number }>({
    queryKey: ['platform', 'health'],
    queryFn: platformApi.health,
    refetchInterval: 30_000,
  })

  const migrateAll = useMutation({
    mutationFn: platformApi.migrateAll,
    onSuccess: (res: any) => {
      const failed = (res?.results ?? []).filter((r: any) => !r.ok)
      if (failed.length) toast.error(`${failed.length} customer(s) failed — see the audit log.`)
      else toast.success('Every customer is up to date.')
      queryClient.invalidateQueries({ queryKey: ['platform'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Migration sweep failed'),
  })

  const snapshot = useMutation({
    mutationFn: platformApi.snapshotUsage,
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Usage captured')
      queryClient.invalidateQueries({ queryKey: ['platform'] })
    },
  })

  if (isLoading) return <Loading label="Checking system health…" />
  if (!data) return <Empty>Could not read system health.</Empty>

  const totalMb = data.tenants.reduce((sum, t) => sum + t.sizeMb, 0)
  const notReady = data.tenants.filter((t) => t.provisioningStatus !== 'ready').length
  const anyFailed = data.tenants.some((t) => t.provisioningStatus === 'failed')

  return (
    <>
      <PageHeader
        title="System health"
        description="One Postgres schema per customer, with a small connection pool opened on demand and closed again when idle."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Customer schemas" value={data.tenants.length} icon={Layers} />
        <StatTile
          label="Open pools"
          value={data.openConnections}
          hint="opened lazily, closed when idle"
          icon={Plug}
        />
        <StatTile label="Total data" value={`${totalMb.toLocaleString()} MB`} icon={HardDrive} />
        <StatTile
          label="Not ready"
          value={notReady}
          tone={anyFailed ? 'danger' : notReady ? 'warn' : 'default'}
          hint={anyFailed ? 'one or more failed' : notReady ? 'still provisioning' : 'all healthy'}
          icon={AlertCircle}
        />
      </div>

      <div className="mt-5">
        <Panel
          title="Maintenance"
          description="Run the migration sweep after every change to prisma/schema.prisma — a new column only reaches a customer once it has been applied to their schema."
        >
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => migrateAll.mutate()}
              disabled={migrateAll.isPending}
              className={btnPrimary}
            >
              <RefreshCw className={cn('h-4 w-4', migrateAll.isPending && 'animate-spin')} />
              Migrate all customers
            </button>
            <button onClick={() => snapshot.mutate()} disabled={snapshot.isPending} className={btnGhost}>
              <Database className={cn('h-4 w-4', snapshot.isPending && 'animate-pulse')} /> Recount usage
              now
            </button>
          </div>
          {migrateAll.isPending && (
            <p className="mt-3 text-xs text-slate-500">
              Migrations run one customer at a time and can take a while. Leave this page open.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Schemas">
          <TableWrap minWidth={680}>
            <thead className="bg-slate-50/80">
              <tr>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Schema</th>
                <th className={thClass}>Size</th>
                <th className={thClass}>Pool</th>
                <th className={thClass}>State</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => (
                <tr key={t.id} className={trClass}>
                  <td className={`${tdClass} font-medium text-slate-900`}>{t.companyName}</td>
                  <td className={`${tdClass} font-mono text-xs text-slate-600`}>{t.schemaName}</td>
                  <td className={`${tdClass} tabular-nums text-slate-700`}>
                    {t.sizeMb.toLocaleString()} MB
                  </td>
                  <td className={tdClass}>
                    {t.poolOpen ? (
                      <Pill className="bg-emerald-50 text-emerald-700">
                        open · idle {Math.round((t.poolIdleMs ?? 0) / 1000)}s
                      </Pill>
                    ) : (
                      <span className="text-xs text-slate-400">closed</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    {t.provisioningStatus === 'ready' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          t.provisioningStatus === 'failed' ? 'text-red-600' : 'text-amber-600',
                        )}
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        {t.provisioningStatus.replace(/_/g, ' ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      </div>
    </>
  )
}
