import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileText, Package2, Receipt, IndianRupee, ArrowRight, Plus, Check, Send, AlertTriangle } from 'lucide-react'
import { formatMoney, compactMoney } from '@/lib/deals-api'
import { quotesApi, ordersApi } from '@/lib/sales-api'
import { StatusPill } from './DocumentLines'
import { cn } from '@/lib/utils'

/**
 * Quote → Order → Invoice → Paid, as one strip with the next action on it.
 *
 * The chain existed as four separate list pages, which is why a rep had to
 * remember that an accepted quote wants converting and a delivered order wants
 * invoicing. This puts the four figures side by side and offers exactly the
 * one action the chain is waiting for.
 *
 * Used by the deal page and the lead's company panel; both pass the same
 * `chain` shape the deal endpoint returns.
 */
export interface ChainInput {
  quotes: { id: number; quoteNumber: string; status: string; total: number; currency?: string; validUntil?: string | null }[]
  orders: { id: number; orderNumber: string; status: string; total: number; currency?: string }[]
  invoices: { id: number; invoiceNumber: string; status: string; total: number; amountPaid: number; balance?: number; overdue?: boolean; dueDate?: string | null }[]
  quoted: number
  ordered: number
  invoiced: number
  received: number
  acceptedQuoteId?: number | null
  uninvoicedOrderId?: number | null
}

export function SalesChain({
  chain,
  onNewQuote,
  onChanged,
  compact,
}: {
  chain: ChainInput
  /** Offered when there is nothing quoted yet, or the last quote was declined. */
  onNewQuote?: () => void
  onChanged?: () => void
  compact?: boolean
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deals'] })
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['lead-business'] })
    onChanged?.()
  }

  const convert = useMutation({
    mutationFn: (quoteId: number) => quotesApi.convert(quoteId),
    onSuccess: (o) => {
      toast.success(`Order ${o.orderNumber} raised`)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not convert'),
  })
  const invoice = useMutation({
    mutationFn: (orderId: number) => ordersApi.invoice(orderId),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoiceNumber} raised`)
      refresh()
      navigate({ to: '/app/invoices/$invoiceId', params: { invoiceId: String(inv.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not raise an invoice'),
  })

  const liveQuotes = chain.quotes.filter((q) => !['rejected', 'expired'].includes(q.status))
  const awaiting = liveQuotes.filter((q) => ['sent', 'viewed'].includes(q.status))
  const drafts = liveQuotes.filter((q) => q.status === 'draft')
  const outstanding = Math.round((chain.invoiced - chain.received) * 100) / 100
  const overdue = chain.invoices.filter((i) => i.overdue)
  const openInvoices = chain.invoices.filter((i) => !['paid', 'draft', 'cancelled'].includes(i.status))

  // The one thing the chain is waiting for, in order of the chain itself.
  let next: { label: string; hint: string; tone: 'primary' | 'good' | 'warn'; onClick?: () => void; to?: { path: string; params: Record<string, string> } } | null = null
  if (chain.acceptedQuoteId) {
    next = { label: 'Convert accepted quote to order', hint: 'The customer said yes — book it.', tone: 'good', onClick: () => convert.mutate(chain.acceptedQuoteId!) }
  } else if (chain.uninvoicedOrderId) {
    next = { label: 'Raise invoice for the order', hint: 'Delivered or not, the order has no invoice yet.', tone: 'primary', onClick: () => invoice.mutate(chain.uninvoicedOrderId!) }
  } else if (overdue.length) {
    next = { label: `Chase ${formatMoney(overdue.reduce((t, i) => t + (i.balance ?? i.total - i.amountPaid), 0))} overdue`, hint: `${overdue.length} invoice${overdue.length === 1 ? '' : 's'} past due.`, tone: 'warn', to: { path: '/app/invoices/$invoiceId', params: { invoiceId: String(overdue[0].id) } } }
  } else if (openInvoices.length) {
    next = { label: 'Record a payment', hint: `${formatMoney(outstanding)} still to come in.`, tone: 'primary', to: { path: '/app/invoices/$invoiceId', params: { invoiceId: String(openInvoices[0].id) } } }
  } else if (drafts.length) {
    next = { label: `Send ${drafts[0].quoteNumber}`, hint: 'A draft quote is not an offer until it leaves.', tone: 'primary', to: { path: '/app/quotes/$quoteId', params: { quoteId: String(drafts[0].id) } } }
  } else if (awaiting.length) {
    next = { label: `Follow up on ${awaiting[0].quoteNumber}`, hint: 'Sent, no decision yet.', tone: 'primary', to: { path: '/app/quotes/$quoteId', params: { quoteId: String(awaiting[0].id) } } }
  } else if (!chain.quotes.length && onNewQuote) {
    next = { label: 'Raise the first quote', hint: 'Nothing has been priced for this yet.', tone: 'primary', onClick: onNewQuote }
  } else if (chain.quotes.length && !liveQuotes.length && onNewQuote) {
    next = { label: 'Raise a fresh quote', hint: 'Every quote so far was declined or expired.', tone: 'primary', onClick: onNewQuote }
  }

  const Step = ({
    icon: Icon,
    label,
    value,
    sub,
    done,
    active,
    warn,
  }: {
    icon: React.ComponentType<{ className?: string }>
    label: string
    value: string
    sub?: string
    done?: boolean
    active?: boolean
    warn?: boolean
  }) => (
    <div
      className={cn(
        'min-w-0 flex-1 rounded-lg border p-3',
        done && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20',
        active && !done && 'border-primary/40 bg-primary/5',
        warn && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', done && 'text-emerald-600', warn && 'text-amber-600')} /> {label}
        {done && <Check className="ml-auto h-3 w-3 text-emerald-600" />}
        {warn && <AlertTriangle className="ml-auto h-3 w-3 text-amber-600" />}
      </div>
      <p className={cn('mt-1 truncate font-bold', compact ? 'text-sm' : 'text-lg', warn && 'text-amber-700')}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )

  const paidUp = chain.invoiced > 0 && outstanding <= 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-stretch gap-2">
        <Step
          icon={FileText}
          label="Quoted"
          value={chain.quoted ? compactMoney(chain.quoted) : '—'}
          sub={
            chain.quotes.length
              ? `${liveQuotes.length} live${awaiting.length ? ` · ${awaiting.length} awaiting decision` : ''}${chain.quotes.length - liveQuotes.length ? ` · ${chain.quotes.length - liveQuotes.length} closed` : ''}`
              : 'No quote yet'
          }
          done={chain.quotes.some((q) => q.status === 'accepted')}
          active={!!liveQuotes.length}
        />
        <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block" />
        <Step
          icon={Package2}
          label="Ordered"
          value={chain.ordered ? compactMoney(chain.ordered) : '—'}
          sub={chain.orders.length ? chain.orders.map((o) => `${o.orderNumber} ${o.status}`).slice(0, 2).join(' · ') : chain.acceptedQuoteId ? 'Accepted quote waiting' : 'No order yet'}
          done={chain.orders.some((o) => o.status !== 'cancelled')}
          active={!!chain.acceptedQuoteId}
        />
        <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block" />
        <Step
          icon={Receipt}
          label="Invoiced"
          value={chain.invoiced ? compactMoney(chain.invoiced) : '—'}
          sub={chain.invoices.length ? `${openInvoices.length} open${overdue.length ? ` · ${overdue.length} overdue` : ''}` : chain.uninvoicedOrderId ? 'Order not invoiced' : 'No invoice yet'}
          done={chain.invoiced > 0}
          active={!!chain.uninvoicedOrderId}
          warn={!!overdue.length}
        />
        <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block" />
        <Step
          icon={IndianRupee}
          label={paidUp ? 'Received' : 'Received / owed'}
          value={chain.invoiced ? `${compactMoney(chain.received)}${paidUp ? '' : ` / ${compactMoney(outstanding)}`}` : '—'}
          sub={paidUp ? 'All settled' : chain.invoiced ? `${Math.round((chain.received / chain.invoiced) * 100)}% collected` : 'Nothing due'}
          done={paidUp}
          warn={!!overdue.length}
        />
      </div>

      {next && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5',
            next.tone === 'good' && 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20',
            next.tone === 'warn' && 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20',
            next.tone === 'primary' && 'border-primary/30 bg-primary/5',
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Next in the chain</p>
            <p className="text-sm">{next.hint}</p>
          </div>
          {next.to ? (
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              to={next.to.path as any}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              params={next.to.params as any}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Send className="h-3.5 w-3.5" /> {next.label}
            </Link>
          ) : (
            <button
              onClick={next.onClick}
              disabled={convert.isPending || invoice.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50',
                next.tone === 'good' ? 'bg-emerald-600' : 'bg-primary',
              )}
            >
              {next.tone === 'good' ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {next.label}
            </button>
          )}
        </div>
      )}

      {!compact && (chain.quotes.length > 0 || chain.orders.length > 0 || chain.invoices.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-3">
          <DocList
            title="Quotes"
            items={chain.quotes.map((q) => ({ id: q.id, number: q.quoteNumber, status: q.status, total: q.total, path: '/app/quotes/$quoteId', param: 'quoteId', sub: q.validUntil ? `valid to ${new Date(q.validUntil).toLocaleDateString('en-IN')}` : undefined }))}
          />
          <DocList
            title="Orders"
            items={chain.orders.map((o) => ({ id: o.id, number: o.orderNumber, status: o.status, total: o.total, path: '/app/orders/$orderId', param: 'orderId' }))}
          />
          <DocList
            title="Invoices"
            items={chain.invoices.map((i) => ({ id: i.id, number: i.invoiceNumber, status: i.status, overdue: i.overdue, total: i.total, path: '/app/invoices/$invoiceId', param: 'invoiceId', sub: (i.balance ?? i.total - i.amountPaid) > 0 ? `${formatMoney(i.balance ?? i.total - i.amountPaid)} due${i.dueDate ? ` ${new Date(i.dueDate).toLocaleDateString('en-IN')}` : ''}` : 'settled' }))}
          />
        </div>
      )}
    </div>
  )
}

function DocList({
  title,
  items,
}: {
  title: string
  items: { id: number; number: string; status: string; overdue?: boolean; total: number; path: string; param: string | null; sub?: string }[]
}) {
  if (!items.length) return null
  return (
    <div className="rounded-lg border p-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title} · {items.length}</p>
      <div className="space-y-1">
        {items.slice(0, 5).map((d) => {
          const inner = (
            <>
              <span className="font-mono text-xs font-semibold">{d.number}</span>
              <StatusPill status={d.status} overdue={d.overdue} />
              <span className="ml-auto text-xs font-semibold">{formatMoney(d.total)}</span>
            </>
          )
          const cls = 'flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent'
          return d.param ? (
            <Link
              key={d.id}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              to={d.path as any}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              params={{ [d.param]: String(d.id) } as any}
              className={cls}
              title={d.sub}
            >
              {inner}
            </Link>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Link key={d.id} to={d.path as any} className={cls} title={d.sub}>
              {inner}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
