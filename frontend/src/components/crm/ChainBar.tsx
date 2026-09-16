import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Handshake, FileText, FileSignature, Package2, Receipt, IndianRupee, ChevronRight, ArrowRight, Loader2 } from 'lucide-react'
import { salesChainApi, quotesApi, ordersApi, contractsApi, type SalesChainData, type ChainNext } from '@/lib/sales-api'
import { compactMoney } from '@/lib/deals-api'
import { StatusPill } from './DocumentLines'
import { cn } from '@/lib/utils'

/**
 * The chain bar — the same strip at the top of every document page.
 *
 *   Deal › Quote › Contract › Order › Invoice › Paid
 *
 * Each node lists the documents of that kind in this family, links to them,
 * and shows the money at that step. The node you are standing on is
 * highlighted. Under it, the one thing the chain is waiting for, with a button
 * that does it — the rule for "what next" lives on the server, so this bar,
 * the deal page and the Sales Desk always agree.
 */

export type ChainKind = 'deal' | 'quote' | 'contract' | 'order' | 'invoice'

export function ChainBar({
  current,
}: {
  /** Which document this page is. Resolves the family from it. */
  current: { kind: ChainKind; id: number }
}) {
  const ref = { [current.kind]: current.id } as Record<ChainKind, number>
  const { data: chain, isLoading } = useQuery({
    queryKey: ['sales-chain', current.kind, current.id],
    queryFn: () => salesChainApi.get(ref),
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the chain…
      </div>
    )
  }
  if (!chain) return null

  return <ChainStrip chain={chain} current={current} />
}

export function ChainStrip({ chain, current, hideNext }: { chain: SalesChainData; current?: { kind: ChainKind; id: number }; hideNext?: boolean }) {
  const t = chain.totals
  const paidUp = t.invoiced > 0 && t.outstanding <= 0

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-stretch gap-1.5">
        <Node
          icon={Handshake}
          label="Deal"
          active={current?.kind === 'deal'}
          amount={chain.deal?.value != null ? compactMoney(chain.deal.value, chain.deal.currency) : null}
          items={
            chain.deal
              ? [{ id: chain.deal.id, number: chain.deal.dealNumber ?? chain.deal.name, status: chain.deal.stage.name, to: '/app/deals/$dealId', param: 'dealId', tone: chain.deal.stage.isWon ? 'good' : chain.deal.stage.isLost ? 'bad' : undefined }]
              : []
          }
          empty={chain.account ? chain.account.name : 'No deal'}
          emptyTo={chain.account ? { to: '/app/accounts/$accountId', params: { accountId: String(chain.account.id) } } : undefined}
        />
        <Sep />
        <Node
          icon={FileText}
          label="Quote"
          active={current?.kind === 'quote'}
          amount={t.quoted ? compactMoney(t.quoted) : null}
          items={chain.quotes.map((q) => ({ id: q.id, number: q.quoteNumber, status: q.expiredByDate ? 'expired' : q.status, to: '/app/quotes/$quoteId', param: 'quoteId' }))}
          currentId={current?.kind === 'quote' ? current.id : undefined}
          empty="Not quoted"
        />
        <Sep />
        <Node
          icon={FileSignature}
          label="Contract"
          active={current?.kind === 'contract'}
          amount={t.contracted ? compactMoney(t.contracted) : null}
          items={chain.contracts.map((c) => ({ id: c.id, number: c.contractNumber, status: c.status, to: '/app/contracts/$contractId', param: 'contractId' }))}
          currentId={current?.kind === 'contract' ? current.id : undefined}
          empty="No contract"
          optional
        />
        <Sep />
        <Node
          icon={Package2}
          label="Order"
          active={current?.kind === 'order'}
          amount={t.ordered ? compactMoney(t.ordered) : null}
          items={chain.orders.map((o) => ({ id: o.id, number: o.orderNumber, status: o.status, to: '/app/orders/$orderId', param: 'orderId' }))}
          currentId={current?.kind === 'order' ? current.id : undefined}
          empty="Not ordered"
        />
        <Sep />
        <Node
          icon={Receipt}
          label="Invoice"
          active={current?.kind === 'invoice'}
          amount={t.invoiced ? compactMoney(t.invoiced) : null}
          items={chain.invoices.map((i) => ({ id: i.id, number: i.invoiceNumber, status: i.status, overdue: i.overdue, to: '/app/invoices/$invoiceId', param: 'invoiceId' }))}
          currentId={current?.kind === 'invoice' ? current.id : undefined}
          empty="Not invoiced"
        />
        <Sep />
        <div className={cn('min-w-[120px] flex-1 rounded-lg border p-2.5', paidUp ? 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20' : t.overdue > 0 ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : '')}>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <IndianRupee className="h-3.5 w-3.5" /> Paid
          </p>
          <p className={cn('mt-1 text-sm font-bold', t.overdue > 0 && 'text-amber-700')}>
            {t.invoiced ? `${compactMoney(t.received)}${paidUp ? '' : ` / ${compactMoney(t.invoiced)}`}` : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {paidUp ? 'All settled' : t.overdue > 0 ? `${compactMoney(t.overdue)} overdue` : t.outstanding > 0 ? `${compactMoney(t.outstanding)} to come` : chain.payments.length ? `${chain.payments.length} payments` : 'Nothing due'}
          </p>
        </div>
      </div>

      {!hideNext && <NextAction chain={chain} />}
    </div>
  )
}

function Sep() {
  return <ChevronRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground/60 md:block" />
}

function Node({
  icon: Icon,
  label,
  amount,
  items,
  currentId,
  active,
  empty,
  emptyTo,
  optional,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  amount: string | null
  items: { id: number; number: string; status: string; overdue?: boolean; to: string; param: string; tone?: 'good' | 'bad' }[]
  currentId?: number
  active?: boolean
  empty: string
  emptyTo?: { to: string; params: Record<string, string> }
  optional?: boolean
}) {
  const shown = items.slice(0, 3)
  return (
    <div className={cn('min-w-[130px] flex-1 rounded-lg border p-2.5', active && 'border-primary bg-primary/5', !items.length && optional && 'border-dashed')}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', active && 'text-primary')} /> {label}
        {amount && <span className="ml-auto font-bold normal-case tracking-normal text-foreground">{amount}</span>}
      </p>
      {items.length ? (
        <ul className="mt-1.5 space-y-1">
          {shown.map((it) => (
            <li key={it.id}>
              <Link
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                to={it.to as any}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                params={{ [it.param]: String(it.id) } as any}
                className={cn('flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent', currentId === it.id && 'bg-primary/10 font-semibold')}
              >
                <span className="truncate font-mono">{it.number}</span>
                <StatusPill status={it.status} overdue={it.overdue} />
              </Link>
            </li>
          ))}
          {items.length > shown.length && <li className="px-1 text-[10px] text-muted-foreground">+{items.length - shown.length} more</li>}
        </ul>
      ) : emptyTo ? (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Link to={emptyTo.to as any} params={emptyTo.params as any} className="mt-1.5 block truncate text-xs text-muted-foreground hover:text-primary">
          {empty}
        </Link>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

/**
 * The server's `next`, made into a button. Actions that only need one call
 * (convert, invoice, contract) run here; the rest navigate to the document.
 */
export function NextAction({ chain, compact }: { chain: SalesChainData; compact?: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const next: ChainNext = chain.next

  const refresh = () => {
    for (const k of ['sales-chain', 'deals', 'quotes', 'orders', 'invoices', 'contracts', 'lead-business']) qc.invalidateQueries({ queryKey: [k] })
  }

  const convert = useMutation({
    mutationFn: (id: number) => quotesApi.convert(id),
    onSuccess: (o) => {
      toast.success(`Order ${o.orderNumber} raised`)
      refresh()
      navigate({ to: '/app/orders/$orderId', params: { orderId: String(o.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not convert'),
  })
  const invoice = useMutation({
    mutationFn: (id: number) => ordersApi.invoice(id),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoiceNumber} raised`)
      refresh()
      navigate({ to: '/app/invoices/$invoiceId', params: { invoiceId: String(inv.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not raise an invoice'),
  })
  const orderFromContract = useMutation({
    mutationFn: (contractId: number) => ordersApi.create({ contractId }),
    onSuccess: (o) => {
      toast.success(`Order ${o.orderNumber} raised under the contract`)
      refresh()
      navigate({ to: '/app/orders/$orderId', params: { orderId: String(o.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not raise the order'),
  })
  const contractFromQuote = useMutation({
    mutationFn: (quoteId: number) => contractsApi.fromQuote(quoteId),
    onSuccess: (ct) => {
      toast.success(`Contract ${ct.contractNumber} drawn up`)
      refresh()
      navigate({ to: '/app/contracts/$contractId', params: { contractId: String(ct.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not draw up a contract'),
  })

  const pending = convert.isPending || invoice.isPending || orderFromContract.isPending || contractFromQuote.isPending
  const target = next.target
  if (next.key === 'none' && !next.hint) return null

  const act = () => {
    if (!target) return
    if (next.key === 'convert_quote') return convert.mutate(target.id)
    if (next.key === 'raise_invoice') return invoice.mutate(target.id)
    if (next.key === 'raise_order' && target.kind === 'contract') return orderFromContract.mutate(target.id)
    if (next.key === 'draw_contract') return contractFromQuote.mutate(target.id)
    const path =
      target.kind === 'deal' ? '/app/deals/$dealId'
        : target.kind === 'quote' ? '/app/quotes/$quoteId'
          : target.kind === 'contract' ? '/app/contracts/$contractId'
            : target.kind === 'order' ? '/app/orders/$orderId'
              : '/app/invoices/$invoiceId'
    const param = target.kind === 'deal' ? 'dealId' : `${target.kind}Id`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: path as any, params: { [param]: String(target.id) } as any })
  }

  const oneClick = ['convert_quote', 'raise_invoice', 'raise_order', 'draw_contract'].includes(next.key)

  return (
    <div
      className={cn(
        'mt-2.5 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
        next.tone === 'good' && 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20',
        next.tone === 'warn' && 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20',
        next.tone === 'primary' && 'border-primary/30 bg-primary/5',
        next.tone === 'muted' && 'border-dashed',
        compact && 'py-1.5',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Next</p>
        <p className="text-sm">
          <span className="font-medium">{next.label}</span>
          {next.hint && <span className="text-muted-foreground"> — {next.hint}</span>}
        </p>
      </div>
      {target && (
        <button
          onClick={act}
          disabled={pending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50',
            next.tone === 'good' ? 'bg-emerald-600' : next.tone === 'warn' ? 'bg-amber-600' : 'bg-primary',
          )}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {oneClick ? next.label : 'Open'}
        </button>
      )}
    </div>
  )
}
