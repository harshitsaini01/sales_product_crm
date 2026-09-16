import { prisma } from '../lib/prisma'

// Normalize a phone number per the CRM's storage rule:
//   - 10 digits  → keep as-is (local Indian number)
//   - 12 digits  → prepend "+" if not already present (e.g. country code + 10 digits)
//   - anything else (empty, already +-prefixed, odd length) → return unchanged
//
// We look at the digit count of the trimmed input. If the input already starts
// with "+", we never touch it — the caller is explicit about the format.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return raw ?? null
  const trimmed = String(raw).trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('+')) return trimmed

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 12) return `+${digits}`
  return digits
}

/**
 * Phone-first lead matching.
 *
 * The same person is frequently present in the CRM more than once — a re-import,
 * a second web enquiry, a manual add. Calls, follow-ups and status changes land
 * on whichever duplicate row the counsellor happened to open (or on whichever row
 * the number resolved to for a system-dialer call). Keying anything off leadId
 * alone therefore under-reports: the lead page shows fewer calls than were made,
 * and a calling task stays "pending" for a lead that was in fact called.
 *
 * These helpers key off the last 10 digits of the number instead, which is the
 * one thing every duplicate shares.
 */

/** Last 10 digits, or null when the value can't be a phone number. */
export function phoneKey(value?: string | null): string | null {
  if (!value) return null
  const digits = String(value).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

export function phoneKeysOf(...values: Array<string | null | undefined>): string[] {
  const keys = new Set<string>()
  for (const value of values) {
    const key = phoneKey(value)
    if (key) keys.add(key)
  }
  return [...keys]
}


/**
 * Every stored spelling of a 10-digit key we can generate cheaply. Used for the
 * fast (indexable, equality) duplicate lookup. `leads.mobile` in this database is
 * mostly plain-10 or +91-prefixed, with a small tail of hand-typed variants.
 */
export function phoneVariants(key: string): string[] {
  return [key, `0${key}`, `91${key}`, `+91${key}`, `91 ${key}`, `+91 ${key}`, `'+91${key}`, `+91-${key}`]
}

/** OR clause matching any lead row that carries one of these numbers (exact, slow-but-thorough LIKE). */
export function leadPhoneOr(keys: string[]) {
  return keys.flatMap((key) => [
    { mobile: { endsWith: key } },
    { mobile2: { endsWith: key } },
    { mobile3: { endsWith: key } },
  ])
}

/** OR clause matching any call placed to one of these numbers. */
export function callPhoneOr(keys: string[]) {
  return keys.map((key) => ({ phoneNumber: { endsWith: key } }))
}

export type LeadPhoneIndex = {
  /** Every phone key covered by the index. */
  keys: string[]
  /** Phone keys carried by this lead. */
  keysOf: (leadId: bigint | number | string) => string[]
  /** Every lead id sharing a number with this one, including itself. */
  siblingsOf: (leadId: bigint | number | string) => string[]
  /** The input lead ids plus every duplicate found for them. */
  allLeadIds: string[]
  /** phone key → the lead ids from the ORIGINAL input that carry it. */
  targetsForKey: (key: string) => string[]
}

const EMPTY_INDEX: LeadPhoneIndex = {
  keys: [],
  keysOf: () => [],
  siblingsOf: (leadId) => [String(leadId)],
  allLeadIds: [],
  targetsForKey: () => [],
}

// Above this many numbers, a LIKE-per-number scan gets expensive (measured:
// ~3.7 ms per pattern against 63k leads), so we switch to equality against the
// generated spellings, which the planner hashes into a single pass (~150 ms for
// 1 200 values). Small look-ups — one lead, one calling task — stay on LIKE,
// which catches every hand-typed format.
const LIKE_LOOKUP_LIMIT = 25

/**
 * Builds the duplicate map for a set of leads in two queries, regardless of how
 * many leads are passed. Callers that hydrate many records (for example every
 * calling task in one response) should build it ONCE and share it.
 */
export async function buildLeadPhoneIndex(leadIds: Array<bigint | number | string>): Promise<LeadPhoneIndex> {
  const ids = [...new Set(leadIds.map((id) => String(id)))]
  if (!ids.length) return EMPTY_INDEX

  const roots = await prisma.lead.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) } },
    select: { id: true, mobile: true, mobile2: true, mobile3: true },
  })
  const keysByLead = new Map<string, string[]>()
  const targetsByKey = new Map<string, Set<string>>()
  for (const lead of roots) {
    const leadKeys = phoneKeysOf(lead.mobile, lead.mobile2, lead.mobile3)
    keysByLead.set(lead.id.toString(), leadKeys)
    for (const key of leadKeys) {
      if (!targetsByKey.has(key)) targetsByKey.set(key, new Set())
      targetsByKey.get(key)!.add(lead.id.toString())
    }
  }
  const keys = [...targetsByKey.keys()]
  if (!keys.length) return { ...EMPTY_INDEX, allLeadIds: ids }

  // Duplicates include trashed rows on purpose: a call made before the duplicate
  // was binned is still a real call to this person.
  const where = keys.length <= LIKE_LOOKUP_LIMIT
    ? { OR: leadPhoneOr(keys) }
    : { mobile: { in: keys.flatMap(phoneVariants) } }
  const duplicates = await prisma.lead.findMany({
    where,
    select: { id: true, mobile: true, mobile2: true, mobile3: true },
  })

  const leadsByKey = new Map<string, Set<string>>()
  const register = (leadId: string, leadKeys: string[]) => {
    keysByLead.set(leadId, leadKeys)
    for (const key of leadKeys) {
      if (!targetsByKey.has(key)) continue // number belongs to some other lead entirely
      if (!leadsByKey.has(key)) leadsByKey.set(key, new Set())
      leadsByKey.get(key)!.add(leadId)
    }
  }
  for (const lead of roots) register(lead.id.toString(), keysByLead.get(lead.id.toString()) || [])
  for (const lead of duplicates) register(lead.id.toString(), phoneKeysOf(lead.mobile, lead.mobile2, lead.mobile3))

  const allLeadIds = new Set<string>(ids)
  for (const group of leadsByKey.values()) for (const id of group) allLeadIds.add(id)

  return {
    keys,
    allLeadIds: [...allLeadIds],
    keysOf: (leadId) => keysByLead.get(String(leadId)) || [],
    siblingsOf: (leadId) => {
      const out = new Set<string>([String(leadId)])
      for (const key of (keysByLead.get(String(leadId)) || [])) {
        for (const id of (leadsByKey.get(key) || [])) out.add(id)
      }
      return [...out]
    },
    targetsForKey: (key) => [...(targetsByKey.get(key) || [])],
  }
}
