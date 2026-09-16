// ─────────────────────────────────────────────────────────────────────────────
// Deal maths and serialization.
//
// The line-total formula lives here rather than inline in the route because
// quotes, orders and invoices (Phase 3) must produce the SAME number from the
// same line. Two copies of this that drift by a rounding rule is how a customer
// ends up with a quote and an invoice that disagree by ₹3.
// ─────────────────────────────────────────────────────────────────────────────

import { bigintFix } from './serialize'

export interface LineInput {
  quantity: number
  unitPrice: number
  discountPercent: number
  taxPercent: number
}

/**
 * quantity × price, less discount, plus tax — rounded to paise once, at the end.
 *
 * Rounding once at the end rather than after each step is deliberate: rounding
 * the discounted subtotal and then the tax compounds the error, and on a
 * hundred-line order that is visible money.
 */
export function lineTotal(line: LineInput): number {
  const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
  const afterDiscount = gross * (1 - (Number(line.discountPercent) || 0) / 100)
  const withTax = afterDiscount * (1 + (Number(line.taxPercent) || 0) / 100)
  return Math.round(withTax * 100) / 100
}

/** The subtotal, tax and total a quote or invoice header shows. */
export function summarize(lines: LineInput[]) {
  let subtotal = 0
  let discount = 0
  let tax = 0

  for (const l of lines) {
    const gross = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
    const afterDiscount = gross * (1 - (Number(l.discountPercent) || 0) / 100)
    subtotal += gross
    discount += gross - afterDiscount
    tax += afterDiscount * ((Number(l.taxPercent) || 0) / 100)
  }

  const round = (n: number) => Math.round(n * 100) / 100
  return {
    subtotal: round(subtotal),
    discount: round(discount),
    tax: round(tax),
    total: round(subtotal - discount + tax),
  }
}

/**
 * The wire shape of a deal.
 *
 * `account` is passed in rather than included, because `Deal` has no Prisma
 * relation to `Account` — the foreign key is there, but the relation was left
 * off to keep the Account model's back-reference list short. Callers do one
 * batched lookup and hand the row in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeDeal(d: any, account?: { id: bigint | number; name: string } | null) {
  const stageProbability = d.stage?.probability ?? 0
  const value = d.value == null ? null : Number(d.value)
  // A deal's own probability wins over its stage's — a rep who has set one
  // knows something the stage default does not.
  const probability = d.probability ?? stageProbability

  return {
    ...bigintFix(d),
    id: Number(d.id),
    accountId: d.accountId == null ? null : Number(d.accountId),
    primaryContactId: d.primaryContactId == null ? null : Number(d.primaryContactId),
    pipelineId: Number(d.pipelineId),
    stageId: Number(d.stageId),
    ownerId: d.ownerId == null ? null : Number(d.ownerId),
    lostReasonId: d.lostReasonId == null ? null : Number(d.lostReasonId),
    leadId: d.leadId == null ? null : Number(d.leadId),
    value,
    probability,
    weightedValue: value == null ? null : Math.round((value * probability) / 100),
    account: account ? { id: Number(account.id), name: account.name } : null,
  }
}
