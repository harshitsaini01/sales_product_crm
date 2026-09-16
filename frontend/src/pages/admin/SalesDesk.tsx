import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FileText, FileSignature, Package2, Receipt, IndianRupee, AlertTriangle, Clock, CalendarDays, ArrowRight, Handshake, ChevronRight } from 'lucide-react'
import { salesChainApi, type Attention } from '@/lib/sales-api'
import { compactMoney, formatMoney } from '@/lib/deals-api'
import { cn } from '@/lib/utils'

/**
 * The Sales Desk — one landing for the whole document chain.
 *
 * Four list pages each answered one question; none answered "what is stuck
 * where?". This does: the funnel across the top (quoted → accepted →
 * contracted → ordered → invoiced → outstanding), then every document that is
 * waiting on somebody, grouped by the step it is stuck at. Every row opens the
 * document, whose chain bar carries the action.
 */
export default function SalesDesk() {
  const { data, isLoading } = useQuery({ queryKey: ['sales-chain', 'attention'], queryFn: salesChainApi.attention, refetchInterval: 120_000 })

  if (isLoading || !data) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  const f = data.funnel

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sales Desk</h1>
        <p className="text-sm text-muted-foreground">Quote → Contract → Order → Invoice → Paid, and everything stuck along the way.</p>
      </div>

      {/* Funnel */}
      <div className="flex flex-wrap items-stretch gap-1.5 rounded-xl border bg-card p-3">
        <Stage icon={FileText} label="Quoted (live)" value={f.quotedLive} to="/app/quotes" />
        <Arrow />
        <Stage icon={FileText} label="Accepted" value={f.accepted} to="/app/quotes" tone="good" />
        <Arrow />
        <Stage icon={FileSignature} label="Contracted" value={f.contracted} to="/app/contracts" />
        <Arrow />
        <Stage icon={Package2} label="Ordered" value={f.ordered} to="/app/orders" />
        <Arrow />
        <Stage icon={Receipt} label="Invoiced" value={f.invoiced} to="/app/invoices" />
        <Arrow />
        <Stage icon={IndianRupee} label="Outstanding" value={f.outstanding} sub={f.overdue > 0 ? `${compactMoney(f.overdue)} overdue` : 'nothing overdue'} to="/app/invoices" tone={f.overdue > 0 ? 'warn' : f.outstanding === 0 ? 'good' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bucket
          icon={AlertTriangle}
          title="Overdue invoices"
          hint="Money past its due date. Chase first."
          tone="warn"
          rows={data.invoicesOverdue.map((i) => ({ id: i.id, number: i.invoiceNumber, who: i.accountName, amount: i.balance, sub: i.dueDate ? `due ${new Date(i.dueDate).toLocaleDateString('en-IN')}` : undefined, to: '/app/invoices/$invoiceId', param: 'invoiceId' }))}
        />
        <Bucket
          icon={FileText}
          title="Accepted quotes, not yet orders"
          hint="The customer said yes. Convert them."
          tone="good"
          rows={data.quotesToConvert.map((q) => ({ id: q.id, number: q.quoteNumber, who: q.accountName, amount: q.total, sub: q.decidedAt ? `accepted ${new Date(q.decidedAt).toLocaleDateString('en-IN')}` : undefined, to: '/app/quotes/$quoteId', param: 'quoteId' }))}
        />
        <Bucket
          icon={FileSignature}
          title="Signed contracts without an order"
          hint="Signed, but nothing booked against them."
          tone="good"
          rows={data.contractsWithoutOrder.map((c) => ({ id: c.id, number: c.contractNumber, who: c.accountName, amount: c.value ?? 0, sub: c.title, to: '/app/contracts/$contractId', param: 'contractId' }))}
        />
        <Bucket
          icon={Package2}
          title="Orders not invoiced"
          hint="Delivered or not, nobody has been billed."
          rows={data.ordersToInvoice.map((o) => ({ id: o.id, number: o.orderNumber, who: o.accountName, amount: o.total, sub: `${o.status} · ${new Date(o.orderDate).toLocaleDateString('en-IN')}`, to: '/app/orders/$orderId', param: 'orderId' }))}
        />
        <Bucket
          icon={Receipt}
          title="Draft invoices"
          hint="Raised but never sent."
          rows={data.invoicesDraft.map((i) => ({ id: i.id, number: i.invoiceNumber, who: i.accountName, amount: i.total, to: '/app/invoices/$invoiceId', param: 'invoiceId' }))}
        />
        <Bucket
          icon={Clock}
          title="Quotes expiring this week"
          hint="Sent, undecided, and about to lapse."
          tone="warn"
          rows={data.quotesExpiring.map((q) => ({ id: q.id, number: q.quoteNumber, who: q.accountName, amount: q.total, sub: q.validUntil ? `until ${new Date(q.validUntil).toLocaleDateString('en-IN')}` : undefined, to: '/app/quotes/$quoteId', param: 'quoteId' }))}
        />
        <Bucket
          icon={Handshake}
          title="Quotes awaiting a decision"
          hint="Out with the customer."
          rows={data.quotesAwaiting.map((q) => ({ id: q.id, number: q.quoteNumber, who: q.accountName, amount: q.total, sub: `${q.status}${q.sentAt ? ` · sent ${new Date(q.sentAt).toLocaleDateString('en-IN')}` : ''}`, to: '/app/quotes/$quoteId', param: 'quoteId' }))}
        />
        <Bucket
          icon={CalendarDays}
          title="Contracts renewing in 90 days"
          hint="Start the renewal conversation."
          rows={data.contractsRenewing.map((c) => ({ id: c.id, number: c.contractNumber, who: c.accountName, amount: c.value ?? 0, sub: c.renewalDate ? `renews ${new Date(c.renewalDate).toLocaleDateString('en-IN')}` : undefined, to: '/app/contracts/$contractId', param: 'contractId' }))}
        />
      </div>
    </div>
  )
}

function Arrow() {
  return <ChevronRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground/60 md:block" />
}

function Stage({ icon: Icon, label, value, sub, to, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; sub?: string; to: string; tone?: 'good' | 'warn' }) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      className={cn(
        'min-w-[130px] flex-1 rounded-lg border p-3 transition-colors hover:border-primary/40',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20',
        tone === 'warn' && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20',
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={cn('mt-1 text-lg font-bold', tone === 'warn' && 'text-amber-700')}>{compactMoney(value)}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Link>
  )
}

function Bucket({
  icon: Icon,
  title,
  hint,
  tone,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint: string
  tone?: 'good' | 'warn'
  rows: { id: number; number: string; who: string | null; amount: number; sub?: string; to: string; param: string }[]
}) {
  const total = rows.reduce((t, r) => t + r.amount, 0)
  return (
    <div className={cn('rounded-xl border bg-card', !rows.length && 'opacity-70')}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className={cn('h-4 w-4', tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold">{rows.length}</p>
          {total > 0 && <p className="text-[11px] text-muted-foreground">{compactMoney(total)}</p>}
        </div>
      </div>
      {!rows.length ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                to={r.to as any}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                params={{ [r.param]: String(r.id) } as any}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/40"
              >
                <span className="font-mono text-xs font-semibold">{r.number}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.who ?? '—'}{r.sub ? ` · ${r.sub}` : ''}</span>
                <span className="font-semibold">{formatMoney(r.amount)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type { Attention }
