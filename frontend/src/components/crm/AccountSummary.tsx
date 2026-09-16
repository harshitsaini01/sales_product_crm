import { Link } from '@tanstack/react-router'
import {
  Phone, Mail, MapPin, AlertTriangle, TrendingUp,
  Clock, CheckSquare, ArrowRight, Sparkles,
} from 'lucide-react'
import type { Account, Contact, CustomFieldValue } from '@/lib/crm-api'
import { CONTACT_ROLES, RELATIONSHIP_STRENGTHS } from '@/lib/crm-api'
import { formatMoney, compactMoney } from '@/lib/deals-api'
import { formatCustomValue } from '@/components/crm/CustomFieldRenderer'
import { Block } from '@/components/crm/panels'
import { cn } from '@/lib/utils'

/**
 * What the account page leads with.
 *
 * The page used to open on an edit form — twelve inputs, and no answer to any
 * question a rep actually arrives with: is this worth money, when did we last
 * speak, who do I call, do they owe us anything. This answers those four before
 * anything else on the page.
 *
 * Every block hides itself when it has nothing to say. An account with no deals
 * shows no deal card, rather than a row of confident zeros — and a customer
 * whose Deals module is off gets `stats.deals === null`, which is a different
 * thing from zero and is rendered as nothing at all.
 */
export function AccountSummary({ account }: { account: Account }) {
  const s = account.stats
  if (!s) return null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RelationshipCard account={account} />
        {s.deals && <PipelineCard deals={s.deals} />}
        {s.invoices && <MoneyCard invoices={s.invoices} />}
        {s.commerce && <CommerceCard commerce={s.commerce} />}
        <ReachCard account={account} />
      </div>

      {(s.deals?.nextStep || (s.openTasks ?? 0) > 0) && <NextStep account={account} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <KeyPeople contacts={account.keyContacts ?? []} />
        <AtAGlance account={account} />
      </div>
    </div>
  )
}

// ─── Cards ────────────────────────────────────────────────────────────────────

/** A labelled panel. Tone is applied by the shared Block. */
function Card({
  label,
  children,
  tone,
}: {
  label: string
  children: React.ReactNode
  tone?: 'warn' | 'good'
}) {
  return (
    <Block
      className={cn(
        'p-4',
        tone === 'warn' && 'border-amber-300 bg-amber-50/50',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/40',
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </Block>
  )
}

/**
 * Days since anybody touched this account.
 *
 * Deliberately the first card. A stale account is the most actionable fact on
 * the page and the easiest one to miss in a timeline you have to scroll.
 */
function RelationshipCard({ account }: { account: Account }) {
  const s = account.stats!
  const days = s.daysSinceContact

  const stale = days !== null && days >= 14
  const label =
    days === null ? 'Never contacted' : days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`

  return (
    <Card label="Last contact" tone={stale || days === null ? 'warn' : undefined}>
      <p className={cn('mt-1 text-xl font-bold', (stale || days === null) && 'text-amber-700')}>{label}</p>
      {s.lastActivity ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={s.lastActivity.subject ?? ''}>
          {s.lastActivity.kind} · {s.lastActivity.subject ?? '—'}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground">Nothing logged yet</p>
      )}
    </Card>
  )
}

function PipelineCard({ deals }: { deals: NonNullable<Account['stats']>['deals'] }) {
  if (!deals) return null
  return (
    <Card label="Open pipeline">
      <p className="mt-1 text-xl font-bold">{compactMoney(deals.openValue)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {deals.open} open · {compactMoney(deals.weightedValue)} weighted
      </p>
      {deals.won > 0 && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
          <TrendingUp className="h-3 w-3" /> {compactMoney(deals.wonValue)} won
        </p>
      )}
    </Card>
  )
}

function MoneyCard({ invoices }: { invoices: NonNullable<Account['stats']>['invoices'] }) {
  if (!invoices) return null

  // Overdue money is the one number worth shouting about.
  if (invoices.overdue > 0) {
    return (
      <Card label="Owed" tone="warn">
        <p className="mt-1 text-xl font-bold text-amber-700">{compactMoney(invoices.overdueValue)}</p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          {invoices.overdue} invoice{invoices.overdue === 1 ? '' : 's'} overdue
        </p>
      </Card>
    )
  }

  return (
    <Card label="Owed" tone={invoices.outstanding === 0 && invoices.paidValue > 0 ? 'good' : undefined}>
      <p className="mt-1 text-xl font-bold">{compactMoney(invoices.outstandingValue)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {invoices.outstanding === 0
          ? invoices.paidValue > 0
            ? `All settled · ${compactMoney(invoices.paidValue)} paid`
            : 'Nothing invoiced'
          : `${invoices.outstanding} outstanding`}
      </p>
    </Card>
  )
}

function CommerceCard({ commerce }: { commerce: NonNullable<Account['stats']>['commerce'] }) {
  if (!commerce) return null
  const due = commerce.replenishDue ? new Date(commerce.replenishDue) : null
  const dueSoon = due && due.getTime() <= Date.now() + 14 * 86_400_000
  return (
    <Card label="Customer 360" tone={commerce.health === 'red' ? 'warn' : commerce.health === 'green' ? 'good' : dueSoon ? 'warn' : undefined}>
      <p className="mt-1 text-xl font-bold">{compactMoney(commerce.ltv)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Lifetime · {commerce.openQuotes} open quote{commerce.openQuotes === 1 ? '' : 's'}
        {commerce.health ? ` · ${commerce.health}` : ''}
      </p>
      {commerce.favouriteSkus[0] && (
        <p className="mt-1 truncate text-xs text-muted-foreground">Top SKU {commerce.favouriteSkus[0].name}</p>
      )}
      {commerce.nextBest?.[0] && (
        <p className="mt-1 truncate text-xs text-muted-foreground">Next: {commerce.nextBest[0].name}</p>
      )}
      {due && (
        <p className="mt-1 text-xs text-muted-foreground">
          Replenish {due.toLocaleDateString('en-IN')}
        </p>
      )}
    </Card>
  )
}

function ReachCard({ account }: { account: Account }) {
  const s = account.stats!
  const loc = account.primaryLocation

  return (
    <Card label="Reach">
      <p className="mt-1 text-xl font-bold">
        {s.contacts} <span className="text-sm font-normal text-muted-foreground">contacts</span>
      </p>
      {loc ? (
        <p className="mt-0.5 inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          {[loc.city, loc.state].filter(Boolean).join(', ') || loc.name}
          {s.locations > 1 && ` +${s.locations - 1}`}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground">No address on file</p>
      )}
    </Card>
  )
}

/** The one thing that has to happen next, pulled out of the deal that says so. */
function NextStep({ account }: { account: Account }) {
  const s = account.stats!
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
      <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        {s.deals?.nextStep && <p className="text-sm font-medium">{s.deals.nextStep}</p>}
        <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {s.deals?.nextCloseDate && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Closes {new Date(s.deals.nextCloseDate).toLocaleDateString('en-IN')}
            </span>
          )}
          {s.openTasks > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckSquare className="h-3 w-3" />
              {s.openTasks} open task{s.openTasks === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Decision maker, finance, technical — with the phone number already a link. */
function KeyPeople({ contacts }: { contacts: Contact[] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Who to call</h3>

      {!contacts.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nobody has a role set yet. Tag someone as decision maker or finance on the
          Contacts tab and they will show here.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {contacts.map((ct) => {
            const role = CONTACT_ROLES.find((r) => r.value === ct.role)
            const strength = RELATIONSHIP_STRENGTHS.find((r) => r.value === ct.relationshipStrength)
            return (
              <div key={ct.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    to="/app/contacts/$contactId"
                    params={{ contactId: String(ct.id) }}
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    {ct.fullName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {role?.label ?? ct.role}
                    {ct.jobTitle && ` · ${ct.jobTitle}`}
                    {strength && strength.value !== 'unknown' && ` · ${strength.label}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  {ct.mobile && (
                    <a
                      href={`tel:${ct.mobile}`}
                      title={ct.mobile}
                      className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {ct.email && (
                    <a
                      href={`mailto:${ct.email}`}
                      title={ct.email}
                      className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The facts worth reading, including whichever custom fields are filled in.
 *
 * Empty custom fields are skipped: a hotel that has not recorded its room count
 * should not push its industry and revenue off the panel with a dash.
 */
function AtAGlance({ account }: { account: Account }) {
  const filled = (account.customFields ?? []).filter(
    (f: CustomFieldValue) =>
      f.value !== null && f.value !== undefined && f.value !== '' &&
      !(Array.isArray(f.value) && f.value.length === 0),
  )

  const facts: [string, string | null][] = [
    ['Type', account.accountType?.name ?? null],
    ['Industry', account.industry?.name ?? null],
    ['Business model', account.businessModel?.toUpperCase() ?? null],
    ['Employees', account.employeeCount ? account.employeeCount.toLocaleString('en-IN') : null],
    ['Annual revenue', account.annualRevenue ? formatMoney(account.annualRevenue) : null],
    ['Founded', account.foundedYear ? String(account.foundedYear) : null],
    ['GSTIN', account.gstin ?? null],
    ['Owner', account.owner?.name ?? null],
    ['Customer since', new Date(account.createdAt).toLocaleDateString('en-IN', {
      month: 'short', year: 'numeric',
    })],
  ]

  const shown = facts.filter(([, v]) => v)

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">At a glance</h3>

      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {shown.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="truncate text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {!!filled.length && (
        <>
          <div className="mt-4 flex items-center gap-1.5 border-t pt-3">
            <Sparkles className="h-3 w-3 text-muted-foreground" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              This customer&rsquo;s own fields
            </h4>
          </div>
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {filled.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                <dd className="truncate text-sm font-medium">{formatCustomValue(f, f.value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  )
}
