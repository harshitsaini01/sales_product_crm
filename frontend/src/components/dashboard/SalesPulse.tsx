import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FileText, FileSignature, Package2, Receipt, IndianRupee, AlertTriangle, FolderKanban, Handshake, ArrowRight, ChevronRight, Inbox } from 'lucide-react'
import { salesChainApi } from '@/lib/sales-api'
import { projectsApi } from '@/lib/projects-api'
import { dealsApi, compactMoney } from '@/lib/deals-api'
import { useAuthStore } from '@/stores/auth.store'
import { StatusBadge } from '@/components/projects/bits'
import { cn } from '@/lib/utils'

/**
 * The B2B half of the landing dashboard.
 *
 * The dashboard was built around leads; a sales floor lands on it and sees
 * nothing about the deals, quotes and invoices that are its actual day. This
 * puts the funnel and the pile of things waiting on you at the top, and links
 * every figure to the page that acts on it. Renders only the modules the
 * customer has.
 */
export function SalesPulse() {
  const hasFeature = useAuthStore((s) => s.hasFeature)
  const sales = hasFeature('sales_docs')
  const deals = hasFeature('deals')
  const projects = hasFeature('projects')

  const { data: attn } = useQuery({ queryKey: ['sales-chain', 'attention'], queryFn: salesChainApi.attention, enabled: sales, refetchInterval: 120_000 })
  const { data: forecast } = useQuery({ queryKey: ['deals', 'forecast', undefined], queryFn: () => dealsApi.forecast(), enabled: deals, retry: false })
  const { data: waiting = [] } = useQuery({ queryKey: ['projects', 'waiting'], queryFn: projectsApi.waiting, enabled: projects, refetchInterval: 60_000 })
  const { data: summary } = useQuery({ queryKey: ['projects', 'summary'], queryFn: projectsApi.summary, enabled: projects })

  if (!sales && !projects) return null
  const f = attn?.funnel

  const stuck = attn
    ? [
        { label: 'Overdue invoices', n: attn.invoicesOverdue.length, value: attn.invoicesOverdue.reduce((t, i) => t + i.balance, 0), to: '/app/sales', tone: 'warn' as const },
        { label: 'Accepted quotes to convert', n: attn.quotesToConvert.length, value: attn.quotesToConvert.reduce((t, q) => t + q.total, 0), to: '/app/sales', tone: 'good' as const },
        { label: 'Signed contracts without an order', n: attn.contractsWithoutOrder.length, value: attn.contractsWithoutOrder.reduce((t, c) => t + (c.value ?? 0), 0), to: '/app/sales', tone: 'good' as const },
        { label: 'Orders not invoiced', n: attn.ordersToInvoice.length, value: attn.ordersToInvoice.reduce((t, o) => t + o.total, 0), to: '/app/sales' },
        { label: 'Quotes expiring this week', n: attn.quotesExpiring.length, value: attn.quotesExpiring.reduce((t, q) => t + q.total, 0), to: '/app/quotes', tone: 'warn' as const },
        { label: 'Contracts renewing', n: attn.contractsRenewing.length, value: attn.contractsRenewing.reduce((t, c) => t + (c.value ?? 0), 0), to: '/app/contracts' },
      ].filter((x) => x.n > 0)
    : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Handshake className="h-5 w-5 text-primary" /> Sales</h2>
        {sales && <Link to="/app/sales" className="text-sm font-medium text-primary hover:underline">Sales Desk →</Link>}
      </div>

      {/* Funnel */}
      {(f || forecast) && (
        <div className="flex flex-wrap items-stretch gap-1.5 rounded-xl border bg-card p-3">
          {forecast && (
            <>
              <Stage icon={Handshake} label="Open pipeline" value={compactMoney(forecast.openValue)} sub={`${forecast.openCount} deals · ${compactMoney(forecast.weightedValue)} weighted`} to="/app/deals" />
              <Sep />
            </>
          )}
          {f && (
            <>
              <Stage icon={FileText} label="Quoted (live)" value={compactMoney(f.quotedLive)} to="/app/quotes" />
              <Sep />
              <Stage icon={FileSignature} label="Contracted" value={compactMoney(f.contracted)} to="/app/contracts" />
              <Sep />
              <Stage icon={Package2} label="Ordered" value={compactMoney(f.ordered)} to="/app/orders" />
              <Sep />
              <Stage icon={Receipt} label="Invoiced" value={compactMoney(f.invoiced)} to="/app/invoices" />
              <Sep />
              <Stage icon={f.overdue > 0 ? AlertTriangle : IndianRupee} label="Outstanding" value={compactMoney(f.outstanding)} sub={f.overdue > 0 ? `${compactMoney(f.overdue)} overdue` : 'nothing overdue'} to="/app/invoices" tone={f.overdue > 0 ? 'warn' : f.outstanding === 0 ? 'good' : undefined} />
            </>
          )}
        </div>
      )}

      <div className={cn('grid gap-4', projects && sales ? 'lg:grid-cols-2' : '')}>
        {sales && (
          <div className="rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Stuck in the chain</h3>
              <span className="ml-auto text-xs text-muted-foreground">{stuck.reduce((t, s) => t + s.n, 0)} items</span>
            </div>
            {!stuck.length ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">Nothing is stuck. Every document is where it should be.</p>
            ) : (
              <ul className="divide-y">
                {stuck.map((s) => (
                  <li key={s.label}>
                    <Link to={s.to} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/40">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', s.tone === 'warn' ? 'bg-amber-500' : s.tone === 'good' ? 'bg-emerald-500' : 'bg-primary')} />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="text-xs text-muted-foreground">{s.n}</span>
                      <span className="font-semibold">{compactMoney(s.value)}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {projects && (
          <div className="rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Projects waiting on you</h3>
              <span className="ml-auto text-xs text-muted-foreground">
                {summary ? `${summary.open} open · ${summary.awaitingClient} with clients` : ''}
              </span>
            </div>
            {!waiting.length ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                Nothing is waiting on you. <Link to="/app/projects" className="text-primary hover:underline">All projects →</Link>
              </p>
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto">
                {waiting.slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <Link to="/app/projects/$projectId" params={{ projectId: String(p.id) }} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/40">
                      <span className="font-mono text-[10px] font-semibold text-muted-foreground">{p.projectNumber}</span>
                      <span className="min-w-0 flex-1 truncate">{p.title}{p.clientName ? <span className="text-muted-foreground"> · {p.clientName}</span> : null}</span>
                      <StatusBadge status={p.status} />
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
                {waiting.length > 8 && (
                  <li className="px-4 py-2 text-xs text-muted-foreground"><Link to="/app/projects" className="text-primary hover:underline">+{waiting.length - 8} more</Link></li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Sep() {
  return <ChevronRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground/60 md:block" />
}

function Stage({ icon: Icon, label, value, sub, to, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; to: string; tone?: 'good' | 'warn' }) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      className={cn(
        'min-w-[120px] flex-1 rounded-lg border p-2.5 transition-colors hover:border-primary/40',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20',
        tone === 'warn' && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20',
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={cn('mt-1 text-base font-bold', tone === 'warn' && 'text-amber-700')}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </Link>
  )
}
