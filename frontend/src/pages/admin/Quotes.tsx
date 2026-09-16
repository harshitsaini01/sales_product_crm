import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, FileText, Plus, Search, Send, Check, ArrowRight, Printer, Download, Link2, Copy,
  RefreshCw, Eye, Clock, AlertTriangle, Handshake, Building2, Pencil, X, Save, User, Receipt, FileSignature,
} from 'lucide-react'
import { quotesApi, contractsApi, QUOTE_STATUSES, type Quote } from '@/lib/sales-api'
import { commerceApi } from '@/lib/commerce-api'
import { accountsApi, contactsApi } from '@/lib/crm-api'
import { formatMoney, compactMoney } from '@/lib/deals-api'
import { usersApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { DocumentLines, StatusPill } from '@/components/crm/DocumentLines'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { SendQuoteModal, openQuoteDocument } from '@/components/crm/SendQuoteModal'
import { ChainBar } from '@/components/crm/ChainBar'
import { downloadBlob, cn } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

// ─── LIST ─────────────────────────────────────────────────────────────────────

/**
 * Quotes.
 *
 * Opens on the money that has been asked for and not yet answered — that is
 * the figure a sales lead actually manages — and the slice of it expiring this
 * week, which is the list of calls to make today. A quote past its validity is
 * shown expired whatever its stored status says.
 */
export default function Quotes() {
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const { data: summary } = useQuery({ queryKey: ['quotes', 'summary'], queryFn: quotesApi.summary })
  const { data: owners = [] } = useQuery({ queryKey: ['users', 'counsellors'], queryFn: usersApi.counsellors, enabled: isAdmin() })
  const { data, isLoading } = useQuery({
    queryKey: ['quotes', { search, status, ownerId, page }],
    queryFn: () => quotesApi.list({ search: search || undefined, status: status || undefined, ownerId: ownerId || undefined, page }),
  })

  const quotes = data?.data ?? []
  const s = summary

  const Tile = ({ label, value, sub, onClick, active, tone }: { label: string; value: string; sub: string; onClick?: () => void; active?: boolean; tone?: 'warn' | 'good' | 'accent' }) => (
    <button
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card p-4 text-left transition-colors',
        onClick && 'hover:border-primary/40',
        active && 'ring-2 ring-primary/40',
        tone === 'accent' && 'border-primary/40 bg-primary/5',
        tone === 'warn' && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-bold', tone === 'warn' && 'text-amber-700')}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quotes</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total</p>
        </div>
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New quote
        </button>
      </div>

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="Awaiting decision" value={compactMoney(s.awaiting.value)} sub={`${s.awaiting.count} sent, no answer yet`} tone="accent" onClick={() => { setStatus(status === 'sent,viewed' ? '' : 'sent,viewed'); setPage(1) }} active={status === 'sent,viewed'} />
          <Tile label="Expiring this week" value={String(s.expiringSoon.count)} sub={`${compactMoney(s.expiringSoon.value)} to chase`} tone={s.expiringSoon.count ? 'warn' : undefined} />
          <Tile label="Drafts" value={String(s.drafts.count)} sub={`${compactMoney(s.drafts.value)} not yet sent`} onClick={() => { setStatus(status === 'draft' ? '' : 'draft'); setPage(1) }} active={status === 'draft'} />
          <Tile label="Accepted this month" value={compactMoney(s.acceptedThisMonth.value)} sub={`${s.acceptedThisMonth.count} quote${s.acceptedThisMonth.count === 1 ? '' : 's'}`} tone="good" onClick={() => { setStatus(status === 'accepted' ? '' : 'accepted'); setPage(1) }} active={status === 'accepted'} />
          <Tile label="Accept rate" value={s.acceptRate == null ? '—' : `${s.acceptRate}%`} sub={`${s.expired.count} expired all-time`} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm" placeholder="Quote number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Any status</option>
          <option value="sent,viewed">Awaiting decision</option>
          {QUOTE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        {!!owners.length && (
          <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPage(1) }}>
            <option value="">Every owner</option>
            {owners.map((u: { id: number; name: string }) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !quotes.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No quotes here</p>
          <p className="mt-1 text-sm text-muted-foreground">A quote can also be raised straight from a deal, carrying its line items across.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {quotes.map((q) => <QuoteRow key={q.id} q={q} />)}
        </div>
      )}

      {(data?.totalPages ?? 1) > 1 && <Pager page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />}

      {creating && (
        <NewQuoteModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['quotes'] }) }}
        />
      )}
    </div>
  )
}

function QuoteRow({ q }: { q: Quote }) {
  const expired = q.expiredByDate || q.status === 'expired'
  const daysLeft = q.validUntil ? Math.ceil((new Date(q.validUntil).getTime() - Date.now()) / 86_400_000) : null
  const soon = !expired && ['sent', 'viewed'].includes(q.status) && daysLeft != null && daysLeft <= 7
  return (
    <Link to="/app/quotes/$quoteId" params={{ quoteId: String(q.id) }} className={cn('flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 hover:border-primary/40', soon && 'border-amber-200')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-semibold">{q.quoteNumber}</p>
          <StatusPill status={expired ? 'expired' : q.status} />
          {q.status === 'viewed' && !expired && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Eye className="h-3 w-3" /> opened</span>}
          {soon && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600"><Clock className="h-3 w-3" /> {daysLeft! <= 0 ? 'expires today' : `${daysLeft}d left`}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {q.account?.name ?? 'No account'} · {new Date(q.issueDate).toLocaleDateString('en-IN')}
          {q._count && ` · ${q._count.items} line${q._count.items === 1 ? '' : 's'}`}
          {q.owner && ` · ${q.owner.name}`}
        </p>
      </div>
      <span className="font-semibold">{formatMoney(Number(q.total), q.currency)}</span>
    </Link>
  )
}

export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Previous</button>
      <span className="text-sm text-muted-foreground">{page} of {totalPages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
    </div>
  )
}

function NewQuoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [accountId, setAccountId] = useState<number | null>(null)
  const [accountName, setAccountName] = useState('')
  const [contactId, setContactId] = useState<number | null>(null)
  const [accountSearch, setAccountSearch] = useState('')
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [paymentTerms, setPaymentTerms] = useState('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'picker', accountSearch],
    queryFn: () => accountsApi.list({ search: accountSearch || undefined, limit: 10 }),
    enabled: accountSearch.length > 1,
  })
  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'byAccount', accountId],
    queryFn: () => contactsApi.list({ accountId, limit: 50 }),
    enabled: !!accountId,
  })

  const create = useMutation({
    mutationFn: () => quotesApi.create({ accountId, contactId, validUntil: validUntil || null, paymentTerms: paymentTerms || null }),
    onSuccess: () => {
      toast.success('Quote created — add the line items next')
      onCreated()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">New quote</h2>
        <p className="mt-1 text-sm text-muted-foreground">Line items are added on the next screen. To quote a deal, start from the deal instead — its lines come across.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Account</label>
            {accountId ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span>{accountName || `#${accountId}`}</span>
                <button onClick={() => { setAccountId(null); setContactId(null) }} className="text-xs text-muted-foreground">change</button>
              </div>
            ) : (
              <>
                <input className={input} placeholder="Search companies…" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} autoFocus />
                {!!accounts?.data.length && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border">
                    {accounts.data.map((a) => (
                      <button key={a.id} onClick={() => { setAccountId(a.id); setAccountName(a.name); setAccountSearch('') }} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">{a.name}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {!!accountId && !!contacts?.data.length && (
            <div>
              <label className="mb-1 block text-sm font-medium">Addressed to</label>
              <select className={input} value={contactId ?? ''} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">The company</option>
                {contacts.data.map((c) => <option key={c.id} value={c.id}>{c.fullName}{c.email ? ` · ${c.email}` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Valid until</label>
              <input type="date" className={input} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Payment terms</label>
              <input className={input} placeholder="50% advance, 50% on delivery" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button onClick={() => create.mutate()} disabled={create.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Create</button>
        </div>
      </div>
    </div>
  )
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────

/**
 * One quote, from draft to decision.
 *
 * The stepper across the top is the lifecycle — drafted, sent, opened,
 * decided — with the real timestamps under each, so "did they even look at
 * it?" is answered by the page. Lines edit in place; the header (validity,
 * terms, who it is addressed to) edits in place; and every action the quote
 * can take next is a button, in the order it would be taken.
 */
export function QuoteDetail() {
  const { quoteId } = useParams({ from: '/app/quotes/$quoteId' })
  const id = Number(quoteId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)

  const { data: quote, isLoading } = useQuery({ queryKey: ['quotes', id], queryFn: () => quotesApi.get(id) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['deals'] })
  }

  const setStatus = useMutation({
    mutationFn: (s: string) => quotesApi.setStatus(id, s),
    onSuccess: refresh,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update'),
  })
  const addItem = useMutation({ mutationFn: (line: Record<string, unknown>) => quotesApi.addItem(id, line), onSuccess: refresh })
  const updateItem = useMutation({
    mutationFn: ({ lineId, patch }: { lineId: number; patch: Record<string, unknown> }) => quotesApi.updateItem(id, lineId, patch),
    onSuccess: refresh,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the line'),
  })
  const removeItem = useMutation({ mutationFn: (lineId: number) => quotesApi.removeItem(id, lineId), onSuccess: refresh })
  const convert = useMutation({
    mutationFn: () => quotesApi.convert(id),
    onSuccess: (order) => {
      toast.success(`Order ${order.orderNumber} created`)
      refresh()
      navigate({ to: '/app/orders/$orderId', params: { orderId: String(order.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not convert', { duration: 7000 }),
  })
  const revise = useMutation({
    mutationFn: () => quotesApi.revise(id),
    onSuccess: (q) => {
      toast.success(`${q.quoteNumber} drafted from this quote`)
      refresh()
      navigate({ to: '/app/quotes/$quoteId', params: { quoteId: String(q.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not revise'),
  })
  const drawContract = useMutation({
    mutationFn: () => contractsApi.fromQuote(id),
    onSuccess: (ct) => {
      toast.success(`Contract ${ct.contractNumber} drawn up from this quote`)
      refresh()
      navigate({ to: '/app/contracts/$contractId', params: { contractId: String(ct.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not draw up a contract'),
  })
  const pdf = useMutation({
    mutationFn: () => quotesApi.pdf(id),
    onSuccess: (blob) => downloadBlob(blob, `${quote?.quoteNumber ?? 'quote'}.pdf`),
    onError: () => toast.error('Could not build the PDF'),
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!quote) return <p className="py-12 text-center text-sm">Not found.</p>

  const expired = quote.expiredByDate || quote.status === 'expired'
  const decided = ['accepted', 'rejected'].includes(quote.status)
  const locked = decided || quote.status === 'expired'
  const awaiting = ['sent', 'viewed'].includes(quote.status) && !expired
  const daysLeft = quote.validUntil ? Math.ceil((new Date(quote.validUntil).getTime() - Date.now()) / 86_400_000) : null
  const noItems = !quote.items?.length

  const copyLink = async () => {
    if (!quote.publicUrl) return
    try {
      await navigator.clipboard.writeText(quote.publicUrl)
      toast.success('Link copied — the customer can view and accept from it')
    } catch {
      toast.error('Could not copy')
    }
  }

  const steps: { label: string; at: string | null; done: boolean; tone?: 'good' | 'bad' }[] = [
    { label: 'Drafted', at: quote.issueDate, done: true },
    { label: 'Sent', at: quote.sentAt, done: !!quote.sentAt },
    { label: 'Opened', at: quote.viewedAt, done: !!quote.viewedAt },
    {
      label: quote.status === 'rejected' ? 'Declined' : quote.status === 'accepted' ? 'Accepted' : expired ? 'Expired' : 'Decision',
      at: quote.decidedAt ?? (expired ? quote.validUntil : null),
      done: decided || expired,
      tone: quote.status === 'accepted' ? 'good' : quote.status === 'rejected' || expired ? 'bad' : undefined,
    },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/app/quotes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All quotes
      </Link>

      <ChainBar current={{ kind: 'quote', id }} />

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold">{quote.quoteNumber}</h1>
              <StatusPill status={expired && !decided ? 'expired' : quote.status} />
              {quote.version && quote.version > 1 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">v{quote.version}</span>
              )}
              {quote.approvalStatus === 'pending' && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Pending approval</span>
              )}
              {awaiting && daysLeft != null && daysLeft <= 7 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                  <Clock className="h-3 w-3" /> {daysLeft <= 0 ? 'expires today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {quote.account ? (
                <Link to="/app/accounts/$accountId" params={{ accountId: String(quote.account.id) }} className="inline-flex items-center gap-1 hover:text-primary"><Building2 className="h-3.5 w-3.5" /> {quote.account.name}</Link>
              ) : (
                <span>No account</span>
              )}
              {quote.contact && (
                <Link to="/app/contacts/$contactId" params={{ contactId: String(quote.contact.id) }} className="inline-flex items-center gap-1 hover:text-primary"><User className="h-3.5 w-3.5" /> {quote.contact.name}</Link>
              )}
              {quote.deal && (
                <Link to="/app/deals/$dealId" params={{ dealId: String(quote.deal.id) }} className="inline-flex items-center gap-1 hover:text-primary"><Handshake className="h-3.5 w-3.5" /> {quote.deal.name}</Link>
              )}
              <span>issued {new Date(quote.issueDate).toLocaleDateString('en-IN')}</span>
              {quote.validUntil && <span className={cn(expired && 'text-rose-600')}>valid to {new Date(quote.validUntil).toLocaleDateString('en-IN')}</span>}
              {quote.owner && <span>by {quote.owner.name}</span>}
            </div>
          </div>
          <p className="text-2xl font-bold">{formatMoney(Number(quote.total), quote.currency)}</p>
        </div>

        {/* Lifecycle */}
        <ol className="mt-4 grid gap-2 sm:grid-cols-4">
          {steps.map((st, i) => (
            <li
              key={i}
              className={cn(
                'rounded-lg border px-3 py-2',
                st.done && st.tone === 'good' && 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20',
                st.done && st.tone === 'bad' && 'border-rose-200 bg-rose-50/50 dark:bg-rose-950/20',
                st.done && !st.tone && 'border-primary/30 bg-primary/5',
                !st.done && 'opacity-60',
              )}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {st.done && <Check className={cn('h-3 w-3', st.tone === 'good' ? 'text-emerald-600' : st.tone === 'bad' ? 'text-rose-600' : 'text-primary')} />}
                {st.label}
              </p>
              <p className="mt-0.5 text-xs">{st.at ? new Date(st.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : st.done ? '' : '—'}</p>
            </li>
          ))}
        </ol>

        {/* Actions, in the order they are taken */}
        <div className="mt-4 flex flex-wrap gap-2">
          {['draft', 'sent', 'viewed'].includes(quote.status) && !expired && (
            <button
              onClick={() => setSending(true)}
              disabled={noItems}
              title={noItems ? 'Add line items first' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {quote.status === 'draft' ? 'Send to customer' : 'Send again'}
            </button>
          )}
          {quote.status === 'draft' && quote.approvalStatus !== 'pending' && (
            <button
              onClick={() =>
                commerceApi.requestApproval(id, { kind: 'discount', reason: 'Needs manager sign-off' })
                  .then(() => { toast.success('Sent for approval'); refresh() })
                  .catch((e: { response?: { data?: { error?: string } } }) => toast.error(e?.response?.data?.error || 'Could not request approval'))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Request approval
            </button>
          )}
          {awaiting && (
            <>
              <button onClick={() => setStatus.mutate('accepted')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"><Check className="h-3.5 w-3.5" /> Mark accepted</button>
              <button onClick={() => setStatus.mutate('rejected')} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent">Mark declined</button>
            </>
          )}
          {quote.status === 'accepted' && !quote.orders?.length && (
            <button onClick={() => convert.mutate()} disabled={convert.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              <ArrowRight className="h-3.5 w-3.5" /> Convert to order
            </button>
          )}
          {(quote.status === 'accepted' || awaiting) && (
            <button onClick={() => drawContract.mutate()} disabled={drawContract.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50" title="Title, value and terms come from this quote">
              <FileSignature className="h-3.5 w-3.5" /> Draw up contract
            </button>
          )}
          {(expired || quote.status === 'rejected' || awaiting) && !quote.orders?.length && (
            <button onClick={() => revise.mutate()} disabled={revise.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50" title="A fresh draft with the same lines; this one is marked superseded">
              <RefreshCw className="h-3.5 w-3.5" /> Revise
            </button>
          )}
          <button onClick={() => openQuoteDocument(quote.id)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"><Printer className="h-3.5 w-3.5" /> View / print</button>
          <button onClick={() => pdf.mutate()} disabled={pdf.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"><Download className="h-3.5 w-3.5" /> PDF</button>
          {quote.publicUrl ? (
            <button onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent" title={quote.publicUrl}>
              <Link2 className="h-3.5 w-3.5" /> Copy customer link
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs text-muted-foreground" title="Set APP_URL on the server to enable the no-login customer page"><Link2 className="h-3.5 w-3.5" /> Customer link needs APP_URL</span>
          )}
          <DeleteButton
            what="quote"
            label={quote.quoteNumber}
            showLabel
            note="Permanent — a quote is paperwork, not a financial record."
            onDelete={() => quotesApi.remove(quote.id)}
            onDeleted={() => navigate({ to: '/app/quotes' })}
          />
        </div>

        {!!quote.orders?.length && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            <Check className="h-4 w-4" /> Converted to order{' '}
            <Link to="/app/orders/$orderId" params={{ orderId: String(quote.orders[0].id) }} className="font-mono underline">{quote.orders[0].orderNumber}</Link> ({quote.orders[0].status}).
            {!!quote.invoices?.length && (
              <>
                <span>·</span>
                {quote.invoices.map((inv) => (
                  <Link key={inv.id} to="/app/invoices/$invoiceId" params={{ invoiceId: String(inv.id) }} className="inline-flex items-center gap-1 underline">
                    <Receipt className="h-3.5 w-3.5" /> {inv.invoiceNumber} · {inv.status}
                  </Link>
                ))}
              </>
            )}
            {quote.orders[0] && !quote.invoices?.length && (
              <span className="text-xs text-emerald-800/70">No invoice raised yet — do that from the order.</span>
            )}
          </div>
        )}
        {expired && !decided && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Past its validity date. Revise it to send fresh prices, or extend the date below.
          </p>
        )}
        {quote.status === 'viewed' && !decided && quote.viewedAt && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm">
            <Eye className="h-4 w-4 text-primary" /> The customer opened this quote {new Date(quote.viewedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Worth a call.
          </p>
        )}
      </div>

      {sending && (
        <SendQuoteModal quote={quote} defaultTo={quote.defaultRecipient} onClose={() => setSending(false)} onSent={() => { setSending(false); refresh() }} />
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className={cn('rounded-xl border bg-card p-5', locked && 'opacity-90')}>
          <h2 className="mb-4 font-semibold">Line items</h2>
          <DocumentLines
            lines={quote.items ?? []}
            totals={quote}
            // An accepted quote is what the customer agreed to. Editing it after
            // the fact would change the record of the agreement.
            readOnly={locked}
            onAdd={(l) => addItem.mutate(l)}
            onUpdate={(lineId, patch) => updateItem.mutate({ lineId, patch })}
            onRemove={(lineId) => removeItem.mutate(lineId)}
          />
          {locked && (
            <p className="mt-3 text-xs text-muted-foreground">
              This quote is {quote.status} — its lines are the record of what was {quote.status === 'accepted' ? 'agreed' : 'offered'} and can no longer change. Use Revise for new prices.
            </p>
          )}
          {!locked && quote.status !== 'draft' && (
            <p className="mt-3 text-xs text-muted-foreground">Changing lines on a sent quote? Send it again so the customer has the current version.</p>
          )}
        </div>

        <aside className="space-y-4">
          <TermsPanel quote={quote} editing={editing} setEditing={setEditing} locked={locked && !expired} onSaved={refresh} />
        </aside>
      </div>
    </div>
  )
}

function TermsPanel({ quote, editing, setEditing, locked, onSaved }: { quote: Quote; editing: boolean; setEditing: (v: boolean) => void; locked: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({
    validUntil: quote.validUntil ? quote.validUntil.slice(0, 10) : '',
    paymentTerms: quote.paymentTerms ?? '',
    deliveryTerms: quote.deliveryTerms ?? '',
    notes: quote.notes ?? '',
    contactId: quote.contactId,
  })
  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'byAccount', quote.accountId],
    queryFn: () => contactsApi.list({ accountId: quote.accountId, limit: 50 }),
    enabled: !!quote.accountId && editing,
  })
  const save = useMutation({
    mutationFn: () => quotesApi.update(quote.id, { validUntil: form.validUntil || null, paymentTerms: form.paymentTerms || null, deliveryTerms: form.deliveryTerms || null, notes: form.notes || null, contactId: form.contactId }),
    onSuccess: () => {
      toast.success('Saved')
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Terms & validity</h3>
        {!locked && (
          <button onClick={() => setEditing(!editing)} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent" title={editing ? 'Cancel' : 'Edit'}>
            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Valid until</label>
            <input type="date" className={input} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </div>
          {quote.accountId && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Addressed to</label>
              <select className={input} value={form.contactId ?? ''} onChange={(e) => setForm({ ...form, contactId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">The company</option>
                {(contacts?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.fullName}{c.email ? ` · ${c.email}` : ''}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Payment terms</label>
            <input className={input} placeholder="50% advance, balance on delivery" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Delivery terms</label>
            <input className={input} placeholder="Within 6 weeks of PO" value={form.deliveryTerms} onChange={(e) => setForm({ ...form, deliveryTerms: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes on the document</label>
            <textarea className={cn(input, 'min-h-[80px] resize-y')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> Save
          </button>
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Valid until</dt>
            <dd>{quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('en-IN') : <span className="text-amber-700">Not set — the customer has no deadline</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Addressed to</dt>
            <dd>{quote.contact?.name ?? quote.account?.name ?? '—'}{quote.contact?.email && <span className="text-xs text-muted-foreground"> · {quote.contact.email}</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Payment</dt>
            <dd>{quote.paymentTerms || <span className="text-muted-foreground">—</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Delivery</dt>
            <dd>{quote.deliveryTerms || <span className="text-muted-foreground">—</span>}</dd>
          </div>
          {quote.notes && (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap text-xs">{quote.notes}</dd>
            </div>
          )}
          {quote.publicUrl && (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer link</dt>
              <dd className="flex items-center gap-1 text-xs">
                <span className="truncate text-muted-foreground">{quote.publicUrl}</span>
                <button onClick={() => navigator.clipboard.writeText(quote.publicUrl!).then(() => toast.success('Copied'))} className="rounded p-0.5 hover:bg-accent" title="Copy"><Copy className="h-3 w-3" /></button>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
