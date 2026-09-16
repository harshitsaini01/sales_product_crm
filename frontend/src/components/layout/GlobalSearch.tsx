import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Building2, User, Users, Handshake, FileText, FileSignature, Package2, Receipt, FolderKanban, Loader2 } from 'lucide-react'
import { crmApi } from '@/lib/crm-api'
import { compactMoney } from '@/lib/deals-api'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'

/**
 * One search box across everything a B2B customer has: accounts, contacts,
 * leads, deals, quotes, contracts, orders, invoices, projects. Numbers match
 * by prefix ("QUO-42", "PRJ-000012"), names by substring. Ctrl+K / "/" opens
 * it. Rendered only when the accounts module is on.
 */
export function GlobalSearch() {
  const hasFeature = useAuthStore((s) => s.hasFeature)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const enabled = hasFeature('accounts')
  const { data, isFetching } = useQuery({
    queryKey: ['global-search', q],
    queryFn: () => crmApi.search(q),
    enabled: enabled && q.trim().length >= 2,
    staleTime: 15_000,
  })

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      } else if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      } else if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!enabled) return null

  type Row = { key: string; icon: React.ComponentType<{ className?: string }>; title: string; sub?: string; to: string; params?: Record<string, string>; group: string }
  const rows: Row[] = []
  if (data) {
    for (const a of data.accounts) rows.push({ key: `a${a.id}`, icon: Building2, title: a.name, sub: [a.accountNumber, a.phone].filter(Boolean).join(' · '), to: '/app/accounts/$accountId', params: { accountId: String(a.id) }, group: 'Accounts' })
    for (const c of data.contacts) rows.push({ key: `c${c.id}`, icon: User, title: c.fullName, sub: [c.jobTitle, c.account?.name].filter(Boolean).join(' · '), to: '/app/contacts/$contactId', params: { contactId: String(c.id) }, group: 'Contacts' })
    for (const d of data.deals ?? []) rows.push({ key: `d${d.id}`, icon: Handshake, title: d.name, sub: [d.dealNumber, d.stage, d.value != null ? compactMoney(d.value) : null].filter(Boolean).join(' · '), to: '/app/deals/$dealId', params: { dealId: String(d.id) }, group: 'Deals' })
    for (const p of data.projects ?? []) rows.push({ key: `p${p.id}`, icon: FolderKanban, title: p.title, sub: `${p.projectNumber ?? ''} · ${p.status.replace(/_/g, ' ')}`, to: '/app/projects/$projectId', params: { projectId: String(p.id) }, group: 'Projects' })
    for (const x of data.quotes ?? []) rows.push({ key: `q${x.id}`, icon: FileText, title: x.quoteNumber, sub: `${x.status} · ${compactMoney(x.total)}`, to: '/app/quotes/$quoteId', params: { quoteId: String(x.id) }, group: 'Quotes' })
    for (const x of data.contracts ?? []) rows.push({ key: `ct${x.id}`, icon: FileSignature, title: x.contractNumber, sub: `${x.title} · ${x.status.replace(/_/g, ' ')}`, to: '/app/contracts/$contractId', params: { contractId: String(x.id) }, group: 'Contracts' })
    for (const x of data.orders ?? []) rows.push({ key: `o${x.id}`, icon: Package2, title: x.orderNumber, sub: `${x.status} · ${compactMoney(x.total)}`, to: '/app/orders/$orderId', params: { orderId: String(x.id) }, group: 'Orders' })
    for (const x of data.invoices ?? []) rows.push({ key: `i${x.id}`, icon: Receipt, title: x.invoiceNumber, sub: `${x.status} · ${compactMoney(x.total)}`, to: '/app/invoices/$invoiceId', params: { invoiceId: String(x.id) }, group: 'Invoices' })
    for (const l of data.leads) rows.push({ key: `l${l.id}`, icon: Users, title: l.name, sub: [l.email, l.mobile].filter(Boolean).join(' · '), to: '/app/leads/$leadId', params: { leadId: String(l.id) }, group: 'Leads' })
  }

  const go = (r: Row) => {
    setOpen(false)
    setQ('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: r.to as any, params: r.params as any })
  }

  let lastGroup = ''

  return (
    <div ref={ref} className="relative hidden md:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(rows.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && rows[active]) go(rows[active])
        }}
        placeholder="Search accounts, deals, quotes, projects…  (Ctrl+K)"
        className="w-72 rounded-lg border bg-background py-1.5 pl-9 pr-3 text-sm focus:w-96 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all lg:w-80"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-[28rem] overflow-y-auto rounded-xl border bg-card shadow-xl">
          {isFetching && !data ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
          ) : !rows.length ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Nothing matches “{q}”.</p>
          ) : (
            <ul className="py-1">
              {rows.map((r, i) => {
                const header = r.group !== lastGroup
                lastGroup = r.group
                return (
                  <li key={r.key}>
                    {header && <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.group}</p>}
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm', i === active ? 'bg-accent' : 'hover:bg-accent/60')}
                    >
                      <r.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.title}</span>
                        {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
