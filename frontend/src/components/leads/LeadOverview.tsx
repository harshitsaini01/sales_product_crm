import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Building2, Users, Handshake, FileText, Receipt, CalendarDays, Package2,
  MessageSquare, Phone, Mail, Plus, Pencil, Check, X, ExternalLink, History, Target, Globe, Info,
} from 'lucide-react'
import { api, followupsApi, commentsApi } from '@/lib/api'
import { formatMoney, compactMoney } from '@/lib/deals-api'
import { StatusPill } from '@/components/crm/DocumentLines'
import { Block, SectionHead, RecordRow, RecordList, EmptyNote } from '@/components/crm/panels'
import { AccountSummary } from '@/components/crm/AccountSummary'
import { ActivityTimeline } from '@/components/crm/ActivityTimeline'
import { LeadProjects, CompanyPulse } from '@/components/projects/LeadProjects'
import { SalesChain } from '@/components/crm/SalesChain'
import { useAuthStore } from '@/stores/auth.store'
import { useLabels } from '@/hooks/useLabels'
import { cn } from '@/lib/utils'

/**
 * Everything about a lead, on one screen.
 *
 * This replaces the separate Company tab, which showed almost exactly the same
 * blocks from the same endpoint — two files, 780 lines, one job. The company
 * details are editable inline here, so nothing was lost by folding it in.
 *
 * EVERY BLOCK HIDES ITSELF WHEN EMPTY. A fresh enquiry shows a company prompt
 * and a comment box, not eight blank panels. The remaining tabs hold the full
 * lists; this is the summary.
 *
 * Rendered only when the `accounts` module is on, so an education customer's
 * lead page is untouched.
 */
export function LeadOverview({
  lead,
  onGoToTab,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lead: any
  onGoToTab: (tab: string) => void
}) {
  const t = useLabels()
  const qc = useQueryClient()
  const hasFeature = useAuthStore((s) => s.hasFeature)

  const { data: biz, isLoading } = useQuery({
    queryKey: ['lead-business', lead.id],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => api.get(`/lead-business/${lead.id}`).then((r) => r.data as any),
  })

  const { data: followups = [] } = useQuery({
    queryKey: ['followups', lead.id],
    queryFn: () => followupsApi.list(lead.id),
  })

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', lead.id],
    queryFn: () => commentsApi.list(lead.id),
  })

  if (isLoading) {
    return <Block><p className="text-sm text-muted-foreground">Loading…</p></Block>
  }

  const converted = biz?.converted && biz.account
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead-business', lead.id] })

  return (
    <div className="space-y-4">
      {/*
        The pulse: the five facts a rep wants before reading anything else —
        when we last spoke, what is due next, what is open with the team, what
        the client is sitting on, and what is owed. Plus the actions those
        facts lead to. This is the "company dashboard" of the lead page.
      */}
      <CompanyPulse
        lead={lead}
        biz={biz}
        followups={followups}
        onGoToTab={onGoToTab}
        projectsOn={hasFeature('projects')}
      />

      {converted ? (
        <>
          <CompanyIdentity account={biz.account} />
          <ProjectBrief leadId={lead.id} business={biz?.business} onSaved={refresh} />
          {/*
            The account page's own summary, not a smaller copy of it. Last
            contact, open pipeline, what is owed, who to call — the four things
            a rep opens a record to find out, in the order they ask them.
          */}
          <AccountSummary account={biz.account} />
          {/*
            Quoted → ordered → invoiced → received, with the one action the
            chain is waiting for. The same strip the deal page shows, fed from
            the same rows, so the lead and the deal never disagree on where the
            money stands.
          */}
          {hasFeature('sales_docs') && (biz.quotes?.length || biz.orders?.length || biz.invoices?.length) ? (
            <Block>
              <SectionHead icon={Receipt} title="Sales chain" />
              <div className="mt-3">
                <SalesChain
                  compact
                  chain={{
                    quotes: biz.quotes ?? [],
                    orders: biz.orders ?? [],
                    invoices: biz.invoices ?? [],
                    quoted: biz.money?.quoted ?? 0,
                    ordered: biz.money?.ordered ?? 0,
                    invoiced: biz.money?.invoiced ?? 0,
                    received: biz.money?.received ?? 0,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    acceptedQuoteId: (biz.quotes ?? []).find((q: any) => q.status === 'accepted' && !(biz.orders ?? []).some((o: any) => o.quoteId === q.id))?.id ?? null,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    uninvoicedOrderId: (biz.orders ?? []).find((o: any) => o.status !== 'cancelled' && !(biz.invoices ?? []).some((i: any) => i.orderId === o.id))?.id ?? null,
                  }}
                  onChanged={refresh}
                />
              </div>
            </Block>
          ) : null}
        </>
      ) : (
        <>
          <CompanyForm lead={lead} business={biz?.business} onSaved={refresh} />
          <ProjectBrief leadId={lead.id} business={biz?.business} onSaved={refresh} />
        </>
      )}

      {/*
        Everything else known about the enquiry, in one glance — status,
        source, who has it, where they are — so the overview really is the
        whole picture and not a pointer to the Info tab.
      */}
      <LeadFacts lead={lead} business={biz?.business} />

      {/*
        The projects opened from this enquiry — the brief handed to a team, the
        proposal, the client's replies. Where the brief above goes next.
      */}
      {hasFeature('projects') && (
        <LeadProjects lead={lead} biz={biz} onChanged={refresh} />
      )}

      {/*
        Only when nobody has a role tagged. AccountSummary already lists the
        people worth ringing; showing both leaves two overlapping lists of the
        same names, and showing neither leaves a converted lead with no way to
        reach anyone.
      */}
      {(!converted || !biz.account?.keyContacts?.length) && (
      <RecordList
        icon={Users}
        title="People"
        items={biz?.contacts}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render={(ct: any) => (
          <RecordRow
            key={ct.id}
            to="/app/contacts/$contactId"
            params={{ contactId: String(ct.id) }}
            title={ct.fullName}
            sub={
              <span className="capitalize">
                {[ct.jobTitle, ct.role !== 'unknown' ? ct.role.replace(/_/g, ' ') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            }
            right={
              <span className="flex gap-1">
                {ct.mobile && (
                  <a
                    href={`tel:${ct.mobile}`}
                    onClick={(e) => e.stopPropagation()}
                    title={ct.mobile}
                    className="rounded border p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Phone className="h-3 w-3" />
                  </a>
                )}
                {ct.email && (
                  <a
                    href={`mailto:${ct.email}`}
                    onClick={(e) => e.stopPropagation()}
                    title={ct.email}
                    className="rounded border p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Mail className="h-3 w-3" />
                  </a>
                )}
              </span>
            }
          />
        )}
      />
      )}

      <RecordList
        icon={Handshake}
        title={t.plural('deal')}
        items={biz?.deals}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render={(d: any) => (
          <RecordRow
            key={d.id}
            to="/app/deals/$dealId"
            params={{ dealId: String(d.id) }}
            title={d.name}
            sub={
              <span>
                {d.stage?.name}
                {d.expectedCloseDate &&
                  ` · closes ${new Date(d.expectedCloseDate).toLocaleDateString('en-IN')}`}
              </span>
            }
            right={<span className="font-semibold">{compactMoney(d.value, d.currency)}</span>}
          />
        )}
      />

      <DocumentTable
        icon={FileText}
        title="Quotes"
        items={biz?.quotes}
        columns={['Quote', 'Issued', 'Valid to', 'Status', 'Amount']}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row={(q: any) => ({
          to: '/app/quotes/$quoteId',
          params: { quoteId: String(q.id) },
          cells: [
            <span className="font-mono text-xs font-semibold">{q.quoteNumber}</span>,
            new Date(q.issueDate).toLocaleDateString('en-IN'),
            q.validUntil ? new Date(q.validUntil).toLocaleDateString('en-IN') : '—',
            <StatusPill status={q.status} />,
            <span className="font-semibold">{formatMoney(Number(q.total), q.currency)}</span>,
          ],
        })}
      />

      <DocumentTable
        icon={Package2}
        title="Orders"
        items={biz?.orders}
        columns={['Order', 'Date', 'Delivery', 'Status', 'Amount']}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row={(o: any) => ({
          to: '/app/orders/$orderId',
          params: { orderId: String(o.id) },
          cells: [
            <span className="font-mono text-xs font-semibold">{o.orderNumber}</span>,
            new Date(o.orderDate).toLocaleDateString('en-IN'),
            o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString('en-IN') : '—',
            <StatusPill status={o.status} />,
            <span className="font-semibold">{formatMoney(Number(o.total), o.currency)}</span>,
          ],
        })}
      />

      <DocumentTable
        icon={Receipt}
        title="Invoices"
        items={biz?.invoices}
        columns={['Invoice', 'Due', 'Status', 'Outstanding', 'Total']}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row={(i: any) => ({
          to: '/app/invoices/$invoiceId',
          params: { invoiceId: String(i.id) },
          cells: [
            <span className="font-mono text-xs font-semibold">{i.invoiceNumber}</span>,
            i.dueDate ? new Date(i.dueDate).toLocaleDateString('en-IN') : '—',
            <StatusPill status={i.status} overdue={i.overdue} />,
            i.balance > 0 ? (
              <span className={cn('font-medium', i.overdue && 'text-amber-700')}>
                {formatMoney(i.balance)}
              </span>
            ) : (
              <span className="text-emerald-600">Settled</span>
            ),
            <span className="font-semibold">{formatMoney(Number(i.total), i.currency)}</span>,
          ],
        })}
      />

      {/*
        Every block above hides when it has nothing in it, which is right — a row
        of zeros looks like data. But hiding ALL of them leaves a converted
        company with no sales section at all, and no way to tell "nothing sold
        yet" apart from "this page is broken". One line, once, covers that.
      */}
      {converted && !biz?.deals?.length && !biz?.quotes?.length && !biz?.orders?.length && !biz?.invoices?.length && (
        <Block>
          <SectionHead icon={Handshake} title={t.plural('deal')} />
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing sold yet. Open a {t.singular('deal').toLowerCase()} on{' '}
            <Link
              to="/app/accounts/$accountId"
              params={{ accountId: String(biz.account.id) }}
              className="font-medium text-primary hover:underline"
            >
              {biz.account.name}
            </Link>{' '}
            and its quotes and invoices appear here as you raise them.
          </p>
        </Block>
      )}

      <FollowupsBlock followups={followups} onMore={() => onGoToTab('followups')} />

      <CommentsBlock
        leadId={lead.id}
        comments={comments}
        onMore={() => onGoToTab('comments')}
        onAdded={() => qc.invalidateQueries({ queryKey: ['comments', lead.id] })}
      />

      {/*
        The same feed the account shows, because it is the same feed — a call
        logged after conversion is still this lead's call, and a rep should not
        have to open two pages to see the whole thread.
      */}
      <Block>
        <SectionHead icon={History} title="Activity" />
        <div className="mt-3">
          <ActivityTimeline entityType="lead" entityId={Number(lead.id)} />
        </div>
      </Block>
    </div>
  )
}

// ─── Company ──────────────────────────────────────────────────────────────────

/**
 * What they want built.
 *
 * The single most useful thing on an IT sales lead and the last thing this page
 * learned to hold. A company name says who called; this says whether there is
 * anything worth quoting, and it is the first question anybody picking the lead
 * up cold will ask.
 *
 * Renders nothing at all when unset rather than an empty panel — the form
 * directly above is already the place to fill it in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ProjectBrief({ leadId, business, onSaved }: { leadId: number; business: any; onSaved: () => void }) {
  const has = !!(business?.projectTitle || business?.projectDescription)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () => api.patch(`/lead-business/${leadId}`, form).then((r) => r.data),
    onSuccess: () => {
      toast.success('Saved')
      setForm({})
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const val = (k: 'projectTitle' | 'projectDescription') =>
    k in form ? form[k] : (business?.[k] ?? '')
  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

  if (!has && !editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-dashed px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">What is the project?</span> — the enquiry itself, so
          anyone picking this up knows what they are quoting for.
        </span>
      </button>
    )
  }

  return (
    <Block className="border-primary/25 bg-primary/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              The project
            </p>

            {editing ? (
              <div className="mt-2 space-y-3">
                <input
                  className={input}
                  placeholder="Inventory and POS rollout across 40 stores"
                  value={val('projectTitle')}
                  onChange={(e) => setForm((f) => ({ ...f, projectTitle: e.target.value }))}
                  autoFocus
                />
                <textarea
                  className={cn(input, 'min-h-[110px] resize-y')}
                  rows={5}
                  placeholder="Scope, stack, integrations, timeline, budget — whatever they told you."
                  value={val('projectDescription')}
                  onChange={(e) => setForm((f) => ({ ...f, projectDescription: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => save.mutate()}
                    disabled={!Object.keys(form).length || save.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Save
                  </button>
                  <button
                    onClick={() => {
                      setForm({})
                      setEditing(false)
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    <X className="h-3.5 w-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {business.projectTitle && (
                  <h3 className="mt-0.5 font-semibold leading-snug">{business.projectTitle}</h3>
                )}
                {business.projectDescription && (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {business.projectDescription}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
            title="Edit the brief"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </Block>
  )
}

/**
 * Who this is, and nothing else.
 *
 * The header used to also carry "last contact" and a line of money totals.
 * Both are cards now, and a figure that appears twice on one screen is a figure
 * a reader has to stop and reconcile. This says the name, what kind of company
 * it is, and where to open it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CompanyIdentity({ account }: { account: any }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {String(account.name).slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <Link
            to="/app/accounts/$accountId"
            params={{ accountId: String(account.id) }}
            className="inline-flex items-center gap-1.5 font-semibold hover:text-primary"
          >
            <span className="truncate">{account.name}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {[account.accountType?.name, account.industry?.name, account.accountNumber]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        {account.owner && (
          <span className="text-muted-foreground">{account.owner.name}</span>
        )}
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
          {account.status}
        </span>
      </div>
    </div>
  )
}


/**
 * The enquiry's own facts — status, source, who is working it, where they are,
 * what they are asking about — laid out as a card rather than left on the Info
 * tab. Empty facts are dropped, and the whole card goes if nothing is known.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LeadFacts({ lead, business }: { lead: any; business: any }) {
  const t = useLabels()
  const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
  const facts: [string, React.ReactNode][] = (
    [
      ['Status', [lead.leadStatus, lead.leadSubStatus].filter(Boolean).join(' · ') || null],
      ['Type', lead.leadType ?? null],
      ['Source', [lead.source, lead.website, lead.utmSource].filter(Boolean).join(' · ') || null],
      ['Assigned to', lead.counsellor?.name ?? lead.assignedTo?.name ?? lead.counsellorName ?? null],
      ['Department', lead.department?.name ?? lead.departmentName ?? null],
      ['Company', business?.companyName ?? null],
      ['Their role', business?.designation ?? null],
      [
        'Website',
        business?.website ? (
          <a href={/^https?:/.test(business.website) ? business.website : `https://${business.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <Globe className="h-3 w-3" /> {business.website}
          </a>
        ) : null,
      ],
      [t('course'), lead.intrestedCourse ?? lead.course ?? null],
      [t('subject'), lead.intrestedSubject ?? null],
      [t('budget'), lead.approximateBudget ? formatMoney(Number(lead.approximateBudget)) : null],
      ['Location', [lead.city, lead.state, lead.country].filter(Boolean).join(', ') || null],
      ['Phone', [lead.mobile, lead.mobile2, lead.mobile3].filter(Boolean).join(' · ') || null],
      ['Email', [lead.email, lead.email2].filter(Boolean).join(' · ') || null],
      ['Created', fmt(lead.createdAt)],
      ['Last updated', fmt(lead.updatedAt)],
    ] as [string, React.ReactNode][]
  ).filter(([, v]) => v !== null && v !== undefined && v !== '')

  if (!facts.length) return null

  return (
    <Block>
      <SectionHead icon={Info} title="About this enquiry" />
      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="truncate text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Block>
  )
}

function CompanyForm({
  lead,
  business,
  onSaved,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lead: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  business: any
  onSaved: () => void
}) {
  const t = useLabels()
  const [editing, setEditing] = useState(!business?.companyName)
  const [form, setForm] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () => api.patch(`/lead-business/${lead.id}`, form).then((r) => r.data),
    onSuccess: () => {
      toast.success('Saved')
      setForm({})
      setEditing(false)
      onSaved()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save'),
  })

  const val = (k: 'companyName' | 'designation' | 'website') =>
    k in form ? form[k] : (business?.[k] ?? '')
  const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm'

  return (
    <Block>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="font-semibold">
              {business?.companyName || `Not yet ${t('account').toLowerCase() === 'account' ? 'an' : 'a'} ${t('account').toLowerCase()}`}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {business?.designation
                ? `${lead.name} · ${business.designation}`
                : 'Record who this enquiry is from, then convert it.'}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
              title="Edit company details"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Company name</label>
              <input
                className={input}
                placeholder="Nimbus Retail Pvt Ltd"
                value={val('companyName')}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Their designation
              </label>
              <input
                className={input}
                placeholder="Head of Operations"
                value={val('designation')}
                onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={!Object.keys(form).length || save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Save
            </button>
            {business?.companyName && (
              <button
                onClick={() => {
                  setForm({})
                  setEditing(false)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </Block>
  )
}

function DocumentTable<T>({
  icon,
  title,
  items,
  columns,
  row,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  items: T[] | undefined
  columns: string[]
  row: (item: T) => { to: string; params: Record<string, string>; cells: React.ReactNode[] }
}) {
  if (!items?.length) return null

  return (
    <Block>
      <SectionHead icon={icon} title={title} count={items.length} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c}
                  className={cn(
                    'pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
                    i === columns.length - 1 ? 'text-right' : 'text-left',
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const r = row(item)
              return (
                <tr key={idx} className="border-t transition-colors hover:bg-accent/40">
                  {r.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={cn('py-2 pr-3', i === r.cells.length - 1 && 'pr-0 text-right')}
                    >
                      {i === 0 ? (
                        <Link
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          to={r.to as any}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          params={r.params as any}
                          className="hover:text-primary"
                        >
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Block>
  )
}

// ─── Follow-ups & comments ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FollowupsBlock({ followups, onMore }: { followups: any[]; onMore: () => void }) {
  const next = [...followups]
    .filter((f) => f.followupDate)
    .sort((a, b) => +new Date(a.followupDate) - +new Date(b.followupDate))[0]

  return (
    <Block>
      <SectionHead
        icon={CalendarDays}
        title="Follow-ups"
        count={followups.length}
        action={followups.length ? { label: 'See all', onClick: onMore } : undefined}
      />
      {!followups.length ? (
        <EmptyNote>Nothing scheduled.</EmptyNote>
      ) : (
        <div className="mt-2 space-y-1.5">
          {next && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-sm">
              <span className="font-medium">Next: </span>
              {new Date(next.followupDate).toLocaleDateString('en-IN')}
              {next.fStatus && <span className="text-muted-foreground"> · {next.fStatus}</span>}
            </div>
          )}
          {followups.slice(0, 3).map((f) => (
            <div key={f.id} className="rounded-lg border p-2.5 text-sm">
              <p className="whitespace-pre-wrap">{f.comment}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {f.fStatus ?? f.type ?? 'note'}
                {f.createdAt && ` · ${new Date(f.createdAt).toLocaleDateString('en-IN')}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </Block>
  )
}

function CommentsBlock({
  leadId,
  comments,
  onMore,
  onAdded,
}: {
  leadId: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  comments: any[]
  onMore: () => void
  onAdded: () => void
}) {
  const [text, setText] = useState('')

  const add = useMutation({
    mutationFn: () => commentsApi.create({ leadId, comment: text }),
    onSuccess: () => {
      setText('')
      onAdded()
    },
    onError: () => toast.error('Could not add that comment'),
  })

  return (
    <Block>
      <SectionHead
        icon={MessageSquare}
        title="Comments"
        count={comments.length}
        action={comments.length > 4 ? { label: 'See all', onClick: onMore } : undefined}
      />

      {/* Writable here, because not leaving this screen is the whole point. */}
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
          placeholder="Add a comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && add.mutate()}
        />
        <button
          onClick={() => add.mutate()}
          disabled={!text.trim() || add.isPending}
          className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {!comments.length ? (
        <EmptyNote>No comments yet.</EmptyNote>
      ) : (
        <div className="mt-2 space-y-1.5">
          {comments.slice(0, 4).map((c) => (
            <div key={c.id} className="rounded-lg border p-2.5 text-sm">
              <p className="whitespace-pre-wrap">{c.comment}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.user?.name ?? 'Someone'}
                {c.createdAt && ` · ${new Date(c.createdAt).toLocaleString('en-IN')}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </Block>
  )
}
