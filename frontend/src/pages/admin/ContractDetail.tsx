import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Handshake, FileText, Package2, Pencil, X, Save, Check, ExternalLink, CalendarDays, PenLine, AlertTriangle, Send, Download, Printer } from 'lucide-react'
import { contractsApi, ordersApi, CONTRACT_STATUSES, type Contract } from '@/lib/sales-api'
import { formatMoney } from '@/lib/deals-api'
import { StatusPill } from '@/components/crm/DocumentLines'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { ChainBar } from '@/components/crm/ChainBar'
import { SendDocumentModal, openDocument } from '@/components/crm/SendDocumentModal'
import { cn, downloadBlob } from '@/lib/utils'

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

/**
 * One contract.
 *
 * A contract was an edit modal off a list. This gives it a page: the lifecycle
 * as a rail (draft → sent → under review → signed → active), the signature
 * recorded with a name and a date, the quote it came from and the orders raised
 * under it one click away, and renewal shown as the date that matters.
 */
export default function ContractDetail() {
  const { contractId } = useParams({ from: '/app/contracts/$contractId' })
  const id = Number(contractId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signedBy, setSignedBy] = useState('')
  const [sending, setSending] = useState(false)

  const { data: contract, isLoading } = useQuery({ queryKey: ['contracts', id], queryFn: () => contractsApi.get(id) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contracts'] })
    qc.invalidateQueries({ queryKey: ['sales-chain'] })
    qc.invalidateQueries({ queryKey: ['deals'] })
  }

  const setStatus = useMutation({
    mutationFn: ({ status, by }: { status: string; by?: string | null }) => contractsApi.setStatus(id, status, by),
    onSuccess: () => {
      setSigning(false)
      refresh()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update'),
  })
  const pdf = useMutation({
    mutationFn: () => contractsApi.pdf(id),
    onSuccess: (blob) => downloadBlob(blob, `${contract?.contractNumber ?? 'contract'}.pdf`),
    onError: () => toast.error('Could not build the PDF'),
  })
  const raiseOrder = useMutation({
    mutationFn: () => ordersApi.create({ contractId: id }),
    onSuccess: (o) => {
      toast.success(`Order ${o.orderNumber} raised under this contract`)
      refresh()
      navigate({ to: '/app/orders/$orderId', params: { orderId: String(o.id) } })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not raise the order'),
  })

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (!contract) return <p className="py-12 text-center text-sm">Not found.</p>

  const rail = ['draft', 'sent', 'under_review', 'signed', 'active']
  const idx = rail.indexOf(contract.status)
  const ended = ['expired', 'terminated'].includes(contract.status)
  const signed = ['signed', 'active'].includes(contract.status)
  const renewSoon = contract.renewalDate && new Date(contract.renewalDate).getTime() - Date.now() < 90 * 86_400_000 && new Date(contract.renewalDate) >= new Date()
  const endSoon = contract.endDate && new Date(contract.endDate) < new Date() && !ended

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/app/contracts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All contracts
      </Link>

      <ChainBar current={{ kind: 'contract', id }} />

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted-foreground">{contract.contractNumber}</span>
              <StatusPill status={contract.status} />
              {contract.type && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">{contract.type}</span>}
            </div>
            <h1 className="mt-1 text-2xl font-bold leading-tight">{contract.title}</h1>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {contract.account && (
                <Link to="/app/accounts/$accountId" params={{ accountId: String(contract.account.id) }} className="inline-flex items-center gap-1 hover:text-primary"><Building2 className="h-3.5 w-3.5" /> {contract.account.name}</Link>
              )}
              {contract.deal && (
                <Link to="/app/deals/$dealId" params={{ dealId: String(contract.deal.id) }} className="inline-flex items-center gap-1 hover:text-primary"><Handshake className="h-3.5 w-3.5" /> {contract.deal.name}</Link>
              )}
              {contract.quote && (
                <Link to="/app/quotes/$quoteId" params={{ quoteId: String(contract.quote.id) }} className="inline-flex items-center gap-1 hover:text-primary"><FileText className="h-3.5 w-3.5" /> from {contract.quote.quoteNumber}</Link>
              )}
              {contract.owner && <span>owner {contract.owner.name}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{contract.value != null ? formatMoney(Number(contract.value), contract.currency) : '—'}</p>
            {contract.signedAt && <p className="text-xs text-emerald-600">signed {new Date(contract.signedAt).toLocaleDateString('en-IN')}{contract.signedBy ? ` by ${contract.signedBy}` : ''}</p>}
          </div>
        </div>

        {/* Lifecycle rail */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {rail.map((s, i) => (
            <button
              key={s}
              onClick={() => {
                if (s === contract.status) return
                if (s === 'signed') return setSigning(true)
                setStatus.mutate({ status: s })
              }}
              disabled={setStatus.isPending || ended}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                s === contract.status ? (signed ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground') : i < idx ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
          <div className="ml-auto flex gap-1.5">
            {!ended && (
              <button onClick={() => setStatus.mutate({ status: 'terminated' })} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">Terminate</button>
            )}
            {ended && <button onClick={() => setStatus.mutate({ status: 'active' })} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent">Reinstate</button>}
          </div>
        </div>

        {signing && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border bg-emerald-50/50 p-3 dark:bg-emerald-950/20">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Signed by (name on the document)</label>
              <input autoFocus className={input} placeholder="Priya Sharma, Director" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setStatus.mutate({ status: 'signed', by: signedBy || null })} />
            </div>
            <button onClick={() => setStatus.mutate({ status: 'signed', by: signedBy || null })} disabled={setStatus.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><PenLine className="h-3.5 w-3.5" /> Record signature</button>
            <button onClick={() => setSigning(false)} className="rounded-lg border px-3 py-2 text-sm hover:bg-accent">Cancel</button>
          </div>
        )}

        {/* What this leads to */}
        <div className="mt-4 flex flex-wrap gap-2">
          {!ended && !signed && (
            <button onClick={() => setSending(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              <Send className="h-3.5 w-3.5" /> {contract.status === 'draft' ? 'Send for signature' : 'Send again'}
            </button>
          )}
          <button onClick={() => openDocument(`/contracts/${id}/document`)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            <Printer className="h-3.5 w-3.5" /> View / print
          </button>
          <button onClick={() => pdf.mutate()} disabled={pdf.isPending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
          {signed && !contract.orders?.length && (
            <button onClick={() => raiseOrder.mutate()} disabled={raiseOrder.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Package2 className="h-3.5 w-3.5" /> Raise the order{contract.quote ? ` (lines from ${contract.quote.quoteNumber})` : ''}
            </button>
          )}
          {contract.documentUrl && (
            <a href={contract.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"><ExternalLink className="h-3.5 w-3.5" /> Open the document</a>
          )}
          <DeleteButton what="contract" label={contract.title} showLabel onDelete={() => contractsApi.remove(id)} onDeleted={() => navigate({ to: '/app/contracts' })} />
        </div>

        {!!contract.orders?.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {contract.orders.map((o) => (
              <Link key={o.id} to="/app/orders/$orderId" params={{ orderId: String(o.id) }} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">
                <Package2 className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-mono">{o.orderNumber}</span><StatusPill status={o.status} /><span className="text-xs">{formatMoney(Number(o.total))}</span>
              </Link>
            ))}
          </div>
        )}
        {renewSoon && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800"><CalendarDays className="h-4 w-4" /> Renewal conversation due by {new Date(contract.renewalDate!).toLocaleDateString('en-IN')}.</p>
        )}
        {endSoon && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700"><AlertTriangle className="h-4 w-4" /> Past its end date and still marked {contract.status.replace(/_/g, ' ')}.</p>
        )}
      </div>

      <TermsPanel contract={contract} editing={editing} setEditing={setEditing} onSaved={refresh} />

      {sending && (
        <SendDocumentModal
          kind="contract"
          id={id}
          number={contract.contractNumber}
          defaultTo={contract.account?.email}
          defaultSubject={`${contract.type || 'Agreement'} ${contract.contractNumber}: ${contract.title}`}
          onClose={() => setSending(false)}
          onSent={() => {
            setSending(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function TermsPanel({ contract, editing, setEditing, onSaved }: { contract: Contract; editing: boolean; setEditing: (v: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: contract.title,
    type: contract.type ?? '',
    startDate: contract.startDate?.slice(0, 10) ?? '',
    endDate: contract.endDate?.slice(0, 10) ?? '',
    renewalDate: contract.renewalDate?.slice(0, 10) ?? '',
    value: contract.value ?? ('' as number | ''),
    paymentTerms: contract.paymentTerms ?? '',
    signedBy: contract.signedBy ?? '',
    documentUrl: contract.documentUrl ?? '',
    notes: contract.notes ?? '',
  })
  const save = useMutation({
    mutationFn: () =>
      contractsApi.update(contract.id, {
        title: form.title,
        type: form.type || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        renewalDate: form.renewalDate || null,
        value: form.value === '' ? null : Number(form.value),
        paymentTerms: form.paymentTerms || null,
        signedBy: form.signedBy || null,
        documentUrl: form.documentUrl || null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      toast.success('Saved')
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })
  const d = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-IN') : null)

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Terms</h2>
        <button onClick={() => setEditing(!editing)} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent">{editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}</button>
      </div>
      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label><input className={input} placeholder="MSA, SOW, AMC…" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Value (₹)</label><input type="number" className={input} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value === '' ? '' : Number(e.target.value) })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Start</label><input type="date" className={input} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">End</label><input type="date" className={input} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Renewal reminder</label><input type="date" className={input} value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Signed by</label><input className={input} value={form.signedBy} onChange={(e) => setForm({ ...form, signedBy: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-muted-foreground">Payment terms</label><input className={input} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-muted-foreground">Signed document URL</label><input className={input} placeholder="https://…" value={form.documentUrl} onChange={(e) => setForm({ ...form, documentUrl: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label><textarea className={cn(input, 'min-h-[80px]')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <button onClick={() => save.mutate()} disabled={!form.title.trim() || save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Save</button>
        </div>
      ) : (
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Term</dt><dd>{d(contract.startDate) ?? '—'} → {d(contract.endDate) ?? 'open'}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Renewal reminder</dt><dd>{d(contract.renewalDate) ?? <span className="text-muted-foreground">Not set</span>}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Payment terms</dt><dd>{contract.paymentTerms || '—'}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Signed</dt><dd>{contract.signedAt ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-emerald-600" /> {d(contract.signedAt)}{contract.signedBy ? ` · ${contract.signedBy}` : ''}</span> : <span className="text-muted-foreground">Not yet</span>}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Document</dt><dd>{contract.documentUrl ? <a href={contract.documentUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a> : <span className="text-muted-foreground">None attached</span>}</dd></div>
          {contract.notes && <div className="sm:col-span-2 lg:col-span-3"><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap text-xs">{contract.notes}</dd></div>}
        </dl>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">Statuses: {CONTRACT_STATUSES.map((s) => s.replace(/_/g, ' ')).join(' → ')}.</p>
    </div>
  )
}
