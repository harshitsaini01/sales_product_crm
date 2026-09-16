// Shared helpers for the "Exclude" filter mode.
//
// Every list that offers an Include/Exclude toggle over the Lead table routes
// its negation through here so the three call sites (the web Leads page, Bulk
// Management, the mobile lead list and the Students list) cannot drift apart —
// and so the NULL trap below is fixed in exactly one place.

// ─── Null-safe clause negation (exclude mode) ────────────────────────────────
// Prisma's `NOT` compiles to a plain SQL `NOT (…)`, and in SQL `NOT (city ILIKE
// '%Mumbai%')` is NULL — not TRUE — when `city IS NULL`. So a naive
// `{ NOT: clause }` silently drops every lead whose column is empty. That is
// what made "Exclude" look broken: excluding one city also wiped out the
// (usually large) set of leads with no city recorded at all.
//
// The user-facing meaning of Exclude is "leads that do NOT match this filter",
// and a lead with no city recorded does not match `city = Mumbai` — so it must
// come back. We therefore negate with SQL-NULL treated as FALSE, pushing the
// negation down through OR/AND via De Morgan so composite clauses (the search
// box, Event/Source, score ranges) stay correct:
//   NOT (a OR b)  →  NOT a AND NOT b
//   NOT (a AND b) →  NOT a OR  NOT b
//   NOT (field ⋯) →  NOT (field ⋯) OR field IS NULL   (nullable columns only)
//
// Columns that are NOT NULL in the schema skip the null branch — adding
// `website IS NULL` there would be dead weight in every query.
export const NULLABLE_LEAD_FILTER_FIELDS = new Set([
  'email', 'email2', 'mobile', 'mobile2', 'father', 'city', 'state', 'country',
  'intrestedCourse', 'event', 'source', 'leadSubStatus', 'leadStatusId',
  'leadSubStatusId', 'statusLeadTypeId', 'departmentId', 'followupDate',
  'commentDate', 'comment', 'enrolled',
])
// Relation filters (`assignedTo: { some: … }`) have no NULL semantics — `NOT
// { assignedTo: { some: X } }` already means "no active assignment matching X".
const LEAD_RELATION_FIELDS = new Set(['assignedTo', 'followups', 'comments', 'notes'])

export function negateLeadClause(clause: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(clause)
  if (entries.length === 0) return {}
  // Multi-key object = implicit AND → De Morgan into an OR of negations.
  if (entries.length > 1) {
    return { OR: entries.map(([k, v]) => negateLeadClause({ [k]: v })) }
  }
  const [key, value] = entries[0]
  if (key === 'OR' && Array.isArray(value)) {
    return { AND: value.map((sub) => negateLeadClause(sub as Record<string, unknown>)) }
  }
  if (key === 'AND' && Array.isArray(value)) {
    return { OR: value.map((sub) => negateLeadClause(sub as Record<string, unknown>)) }
  }
  if (key === 'NOT') {
    // Double negation — hand back the inner clause as-is.
    return value as Record<string, unknown>
  }
  const negated: Record<string, unknown> = { NOT: { [key]: value } }
  if (LEAD_RELATION_FIELDS.has(key) || !NULLABLE_LEAD_FILTER_FIELDS.has(key)) return negated
  // `{ field: null }` is already a null test; negating it must NOT re-add the
  // null branch or the clause becomes a tautology.
  if (value === null) return negated
  return { OR: [negated, { [key]: null }] }
}

// Filter keys that describe WHERE THE USER IS, not what they picked, and so are
// never inverted by Exclude mode:
//   ids               — the Leads page was opened scoped to a Calling Task batch
// `departmentId` / `statusLeadTypeId` are nav scope on the Leads page but real
// user-picked filters in Bulk Management, so they are not hard-coded here —
// callers declare intent through `excludeFields` (see below).
export const NEVER_INVERTED_KEYS = new Set(['ids'])

// Parse a query-string id without throwing. Anything non-numeric (a stale
// bookmark, a hand-edited URL, 'undefined' from a client bug) used to reach
// BigInt() raw and 500 the whole leads list; now the clause is simply dropped.
export function safeBigInt(value: string | undefined): bigint | null {
  const trimmed = value?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return null
  try { return BigInt(trimmed) } catch { return null }
}
