// ─────────────────────────────────────────────────────────────────────────────
// Assemble everything a quote document needs, from the database.
//
// Used by the rep's preview, the email, the PDF and the customer-facing public
// page — one builder so all four say the same thing. Moved out of
// sales.routes.ts the day the public page needed it too.
//
// The customer's own company details come from their SystemSetting rows — this
// is their letterhead, not the platform's, and a quote from Britannica must not
// carry Tutelage's name on it.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import { currentTenant } from '../../lib/tenant-context'
import type { QuoteDocInput } from './quote-document'

export async function buildQuoteDoc(quoteId: bigint): Promise<QuoteDocInput | null> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { sortOrder: 'asc' } }, owner: { select: { name: true } } },
  })
  if (!quote) return null

  const [account, contact, settings] = await Promise.all([
    quote.accountId
      ? prisma.account.findUnique({
          where: { id: quote.accountId },
          select: { name: true, email: true, gstin: true },
        })
      : null,
    quote.contactId
      ? prisma.contact.findUnique({
          where: { id: quote.contactId },
          select: { firstName: true, lastName: true, email: true },
        })
      : null,
    prisma.systemSetting.findMany({
      where: { key: { in: ['company_name', 'company_email', 'company_phone', 'company_gstin'] } },
    }),
  ])

  const setting = (k: string) => settings.find((r) => r.key === k)?.value || null
  const ctx = currentTenant()

  const location = quote.accountId
    ? await prisma.crmLocation.findFirst({
        where: { accountId: quote.accountId },
        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
        select: { address: true, city: true, state: true, pincode: true },
      })
    : null

  return {
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    currency: quote.currency,
    subtotal: quote.subtotal,
    discount: quote.discount,
    tax: quote.tax,
    total: quote.total,
    paymentTerms: quote.paymentTerms,
    deliveryTerms: quote.deliveryTerms,
    notes: quote.notes,
    items: quote.items,
    from: {
      name: setting('company_name') || ctx?.companyName || 'Our Company',
      email: setting('company_email'),
      phone: setting('company_phone'),
      gstin: setting('company_gstin'),
    },
    to: {
      name: account?.name || 'Customer',
      contactName: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null,
      email: contact?.email || account?.email || null,
      gstin: account?.gstin || null,
      address: location
        ? [location.address, location.city, location.state, location.pincode].filter(Boolean).join(', ')
        : null,
    },
    preparedBy: quote.owner?.name ?? null,
  }
}

/**
 * A quote past its validity date is expired whether or not anybody set the
 * status — derived on read, like an invoice's overdue flag, so it can never be
 * a stale stored value waiting on a nightly job.
 */
export function isQuoteExpired(q: { status: string; validUntil: Date | string | null }): boolean {
  if (!q.validUntil) return false
  if (!['draft', 'sent', 'viewed'].includes(q.status)) return false
  const end = new Date(q.validUntil)
  end.setHours(23, 59, 59, 999)
  return end.getTime() < Date.now()
}
