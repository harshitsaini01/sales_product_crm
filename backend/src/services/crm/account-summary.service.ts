// ─────────────────────────────────────────────────────────────────────────────
// The numbers an account page leads with.
//
// WHY THIS IS ONE SERVICE AND NOT SIX QUERIES IN THE ROUTE
//
// The account page used to open on an edit form: twelve inputs and no answer to
// any question a sales rep actually arrives with — is this account worth money,
// when did we last speak, who do I call, do they owe us anything. Those answers
// live in four different tables, and fetching them from the client would be
// four round trips before the page said anything useful.
//
// EVERY BLOCK IS FEATURE-GATED. A customer with Deals switched off gets
// `deals: null`, not zeros — because "0 open deals" and "this customer does not
// use deals" are different statements, and showing the first when the second is
// true makes the page lie.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import { hasFeature } from '../../lib/tenant-context'
import * as customFields from './custom-fields.service'
import { serializeAccount, serializeContact, bigintFix } from './serialize'
import { nextBestSkus } from './pricing.service'

export interface AccountStats {
  contacts: number
  locations: number
  /** Null when the Deals module is off for this customer. */
  deals: {
    open: number
    openValue: number
    weightedValue: number
    won: number
    wonValue: number
    lost: number
    /** Soonest expected close among open deals — what a manager scans for. */
    nextCloseDate: string | null
    /** The next concrete action anybody wrote down on a deal. */
    nextStep: string | null
  } | null
  /** Null when the sales-documents module is off. */
  invoices: {
    outstanding: number
    outstandingValue: number
    overdue: number
    overdueValue: number
    paidValue: number
  } | null
  commerce?: {
    lastOrderedAt: string | null
    replenishDue: string | null
    health: string | null
    favouriteSkus: { name: string; qty: number }[]
    nextBest?: { productId: number; name: string; sku: string | null; unitPrice: number; reason: string }[]
    openQuotes: number
    ltv: number
  } | null
  /** Null when nothing has ever happened on this account. */
  lastActivity: {
    kind: string
    subject: string | null
    occurredAt: string
    actorName: string | null
  } | null
  /** Days since the last activity. The single most useful number on the page. */
  daysSinceContact: number | null
  openTasks: number
}

/**
 * Everything the Account 360 header renders, assembled once.
 *
 * Two pages need this shape: the account page itself, and the overview on a
 * lead that has been converted. That overview used to build its own smaller
 * version, which meant "last contact" and the money on a lead could disagree
 * with the same numbers one click away on the account. A relationship should
 * not have two sets of figures depending on which door you came in through.
 *
 * Returns null when the account is gone — callers report that honestly rather
 * than painting a half-empty panel.
 */
export async function accountDetail(id: bigint) {
  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      accountType: { select: { id: true, name: true, slug: true } },
      industry: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { contacts: true, locations: true } },
    },
  })
  if (!account) return null

  const [fields, stats, primaryLocation, keyContacts] = await Promise.all([
    // Custom fields are resolved against the account's own type, so a hotel's
    // fields do not appear on a hospital.
    customFields.valuesFor('account', id, {
      accountType: account.accountType?.slug ?? '',
      status: account.status,
    }),
    accountStats(id),
    prisma.crmLocation.findFirst({
      where: { accountId: id },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      select: { id: true, name: true, city: true, state: true, country: true, phone: true },
    }),
    // The people a rep would actually ring, not the whole list — that is what
    // the Contacts tab is for.
    prisma.contact.findMany({
      where: {
        accountId: id,
        trash: 0,
        role: { in: ['decision_maker', 'finance', 'technical', 'procurement'] },
      },
      orderBy: { role: 'asc' },
      take: 4,
      select: {
        id: true, firstName: true, lastName: true, jobTitle: true,
        email: true, mobile: true, role: true, relationshipStrength: true,
      },
    }),
  ])

  return {
    ...serializeAccount(account),
    customFields: bigintFix(fields),
    stats,
    primaryLocation: bigintFix(primaryLocation),
    keyContacts: keyContacts.map(serializeContact),
  }
}

export async function accountStats(accountId: bigint): Promise<AccountStats> {
  const [contacts, locations, lastActivity, openTasks] = await Promise.all([
    prisma.contact.count({ where: { accountId, trash: 0 } }),
    prisma.crmLocation.count({ where: { accountId } }),
    prisma.activity.findFirst({
      where: { entityType: 'account', entityId: accountId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      include: { actor: { select: { name: true } } },
    }),
    prisma.task.count({
      where: { entityType: 'account', entityId: accountId, status: 0 },
    }),
  ])

  const stats: AccountStats = {
    contacts,
    locations,
    deals: null,
    invoices: null,
    commerce: null,
    lastActivity: lastActivity
      ? {
          kind: lastActivity.kind,
          subject: lastActivity.subject,
          occurredAt: lastActivity.occurredAt.toISOString(),
          actorName: lastActivity.actor?.name ?? null,
        }
      : null,
    daysSinceContact: lastActivity
      ? Math.floor((Date.now() - lastActivity.occurredAt.getTime()) / 86_400_000)
      : null,
    openTasks,
  }

  if (hasFeature('deals')) {
    const rows = await prisma.deal.findMany({
      where: { accountId, trash: 0 },
      select: {
        value: true,
        probability: true,
        expectedCloseDate: true,
        nextStep: true,
        stage: { select: { probability: true, isWon: true, isLost: true } },
      },
    })

    const open = rows.filter((d) => !d.stage.isWon && !d.stage.isLost)
    const won = rows.filter((d) => d.stage.isWon)
    const val = (v: unknown) => (v == null ? 0 : Number(v))

    // Soonest close first; a deal with no date sorts last rather than blocking
    // the ones that do have one.
    const dated = open
      .filter((d) => d.expectedCloseDate)
      .sort((a, b) => a.expectedCloseDate!.getTime() - b.expectedCloseDate!.getTime())

    stats.deals = {
      open: open.length,
      openValue: round(open.reduce((s, d) => s + val(d.value), 0)),
      weightedValue: round(
        open.reduce((s, d) => s + (val(d.value) * (d.probability ?? d.stage.probability)) / 100, 0),
      ),
      won: won.length,
      wonValue: round(won.reduce((s, d) => s + val(d.value), 0)),
      lost: rows.filter((d) => d.stage.isLost).length,
      nextCloseDate: dated[0]?.expectedCloseDate?.toISOString() ?? null,
      nextStep: dated.find((d) => d.nextStep)?.nextStep ?? open.find((d) => d.nextStep)?.nextStep ?? null,
    }
  }

  if (hasFeature('sales_docs')) {
    const invoices = await prisma.crmInvoice.findMany({
      where: { accountId, status: { notIn: ['draft', 'cancelled'] } },
      select: { total: true, amountPaid: true, dueDate: true, status: true },
    })

    let outstanding = 0
    let outstandingValue = 0
    let overdue = 0
    let overdueValue = 0
    let paidValue = 0

    for (const inv of invoices) {
      const balance = Number(inv.total) - Number(inv.amountPaid)
      paidValue += Number(inv.amountPaid)
      if (balance <= 0) continue

      outstanding++
      outstandingValue += balance
      // Derived here, not stored — the same rule the invoice list filters on.
      if (inv.dueDate && inv.dueDate.getTime() < Date.now()) {
        overdue++
        overdueValue += balance
      }
    }

    stats.invoices = {
      outstanding,
      outstandingValue: round(outstandingValue),
      overdue,
      overdueValue: round(overdueValue),
      paidValue: round(paidValue),
    }
  }

  if (hasFeature('sales_docs')) {
    const [acct, openQuotes, lines] = await Promise.all([
      prisma.account.findUnique({
        where: { id: accountId },
        select: { lastOrderedAt: true, replenishDays: true, health: true },
      }),
      prisma.quote.count({ where: { accountId, status: { in: ['sent', 'viewed', 'draft', 'pending_approval', 'countered'] } } }),
      prisma.orderItem.findMany({
        where: { order: { accountId, status: { not: 'cancelled' } } },
        select: { name: true, quantity: true, total: true },
      }),
    ])
    const fav = new Map<string, number>()
    let ltv = 0
    for (const l of lines) {
      fav.set(l.name, (fav.get(l.name) ?? 0) + Number(l.quantity))
      ltv += Number(l.total)
    }
    const favouriteSkus = [...fav.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }))
    const nextBest = await nextBestSkus(accountId)
    const replenishDue =
      acct?.lastOrderedAt && acct.replenishDays
        ? new Date(acct.lastOrderedAt.getTime() + acct.replenishDays * 86_400_000).toISOString()
        : null
    stats.commerce = {
      lastOrderedAt: acct?.lastOrderedAt?.toISOString() ?? null,
      replenishDue,
      health: acct?.health ?? null,
      favouriteSkus,
      nextBest,
      openQuotes,
      ltv: round(ltv),
    }
  }

  return stats
}

const round = (n: number) => Math.round(n * 100) / 100
