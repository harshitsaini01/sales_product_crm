// ─────────────────────────────────────────────────────────────────────────────
// BigInt → number on the way out.
//
// Prisma returns BigInt for every id and JSON.stringify throws on it, so every
// response has to be converted. The existing route files each carry their own
// copy of this; the B2B routes share one so the account, contact and location
// shapes are defined in exactly one place and cannot drift between the list
// endpoint and the detail endpoint.
//
// Decimal columns (annualRevenue, latitude) come back as Prisma.Decimal and go
// out as plain numbers. That is lossy above 2^53, which annual revenue in
// rupees could genuinely reach — so anything that must be exact belongs in a
// string field, not here.
// ─────────────────────────────────────────────────────────────────────────────

/** Recursive BigInt/Date/Decimal fixer, for shapes with no dedicated mapper. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bigintFix(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj)
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(bigintFix)
  // Prisma.Decimal and anything else with a toNumber().
  if (typeof obj === 'object') {
    if (typeof obj.toNumber === 'function' && typeof obj.toFixed === 'function') {
      return obj.toNumber()
    }
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = bigintFix(obj[k])
    return out
  }
  return obj
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeAccount(a: any) {
  return {
    ...bigintFix(a),
    id: Number(a.id),
    accountTypeId: num(a.accountTypeId),
    industryId: num(a.industryId),
    ownerId: num(a.ownerId),
    branchId: num(a.branchId),
    createdById: num(a.createdById),
    priceListId: num(a.priceListId),
    annualRevenue: a.annualRevenue == null ? null : Number(a.annualRevenue),
    creditLimit: a.creditLimit == null ? null : Number(a.creditLimit),
    contactCount: a._count?.contacts ?? undefined,
    locationCount: a._count?.locations ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeContact(ct: any) {
  return {
    ...bigintFix(ct),
    id: Number(ct.id),
    accountId: num(ct.accountId),
    locationId: num(ct.locationId),
    ownerId: num(ct.ownerId),
    /** Built here so every screen shows a person's name the same way. */
    fullName: [ct.firstName, ct.lastName].filter(Boolean).join(' '),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeLocation(l: any) {
  return {
    ...bigintFix(l),
    id: Number(l.id),
    accountId: num(l.accountId),
    latitude: l.latitude == null ? null : Number(l.latitude),
    longitude: l.longitude == null ? null : Number(l.longitude),
  }
}
