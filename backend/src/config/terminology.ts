// ─────────────────────────────────────────────────────────────────────────────
// The nouns the UI says out loud, and what each customer calls them.
//
// An education consultancy calls a person a "Student" and a product a "Course".
// An IT sales team calls them a "Client" and a "Product". Same screens, same
// code — different words.
//
// SAME SHAPE AS features.ts AND lead-fields.ts
//
// This is a catalogue with defaults, and a tenant stores only its DEVIATIONS.
// An empty stored map means every default below, which is exactly today's
// wording — so this file changes nothing for any existing customer.
//
// WHAT BELONGS HERE
//
// Only nouns that genuinely differ between verticals, and only ones the UI
// actually renders. This is not an i18n layer: do not run body copy, error
// messages or button verbs through it. If you find yourself adding a term to
// translate one sentence, write the sentence differently instead.
// ─────────────────────────────────────────────────────────────────────────────

export interface TermDef {
  /** Stable id used in the stored config — never change it once shipped. */
  key: string
  /** What the education vertical calls it: today's wording, unchanged. */
  singular: string
  plural: string
  /** Where it appears, so the super admin editing it knows what they are renaming. */
  description: string
}

export const TERMS: TermDef[] = [
  {
    key: 'brand',
    // Defaults to today's wording so the original install is untouched. Every
    // customer provisioned since verticals shipped gets their own company name
    // written here at creation time — see createTenant() — so a new customer
    // never sees somebody else's brand.
    singular: 'Sales CRM',
    plural: 'Sales CRM',
    description: 'The product name in the sidebar header and the app download card.',
  },
  {
    key: 'lead',
    singular: 'Lead',
    plural: 'Leads',
    description: 'An enquiry that has not been qualified yet. Nav, page titles, buttons.',
  },
  {
    key: 'student',
    singular: 'Customer',
    plural: 'Customers',
    description: 'A converted lead / buying company.',
  },
  {
    key: 'counsellor',
    singular: 'Sales Rep',
    plural: 'Sales Reps',
    description: 'The staff role that works leads. Assignment dropdowns, reports, the mobile app.',
  },
  {
    key: 'course',
    singular: 'Product',
    plural: 'Products',
    description: 'What the lead is interested in buying.',
  },
  {
    key: 'university',
    singular: 'Vendor',
    plural: 'Vendors',
    description: 'A supplier or partner, not an admissions university.',
  },
  {
    key: 'subject',
    singular: 'Subject',
    plural: 'Subjects',
    description: 'The finer-grained interest inside a course.',
  },
  {
    key: 'budget',
    singular: 'Budget',
    plural: 'Budgets',
    description: 'How much the lead is willing to spend.',
  },
  {
    key: 'followup',
    singular: 'Follow-up',
    plural: 'Follow-ups',
    description: 'A scheduled next contact. Nav, the calendar and the mobile home screen.',
  },
  {
    key: 'branch',
    singular: 'Branch',
    plural: 'Branches',
    description: 'A physical office.',
  },
  {
    key: 'bucket',
    singular: 'Bucket',
    plural: 'Buckets',
    description: 'The unworked-lead queue a counsellor pulls from.',
  },
  {
    key: 'agent',
    singular: 'Partner Agent',
    plural: 'Partner Agents',
    description: 'An outside party that refers leads.',
  },

  // ── The B2B core. Rendered only when the vertical exposes those modules, but
  //    kept here so the catalogue is one list rather than two.
  {
    key: 'account',
    singular: 'Account',
    plural: 'Accounts',
    description: 'An organisation. The B2B core entity.',
  },
  {
    key: 'contact',
    singular: 'Contact',
    plural: 'Contacts',
    description: 'A person inside an account.',
  },
  {
    key: 'deal',
    singular: 'Deal',
    plural: 'Deals',
    description: 'One sales opportunity against an account.',
  },
]

/**
 * What a tenant may override for a single term. Both halves are optional.
 *
 * A type alias rather than an interface on purpose: only aliases of object
 * literal types get TypeScript's implicit index signature, which is what lets
 * a map of these be written straight into a Prisma `Json` column.
 */
export type TermOverride = {
  singular?: string
  plural?: string
}

export interface ResolvedTerm {
  singular: string
  plural: string
}

export const TERM_KEYS = TERMS.map((t) => t.key)

const BY_KEY = new Map(TERMS.map((t) => [t.key, t]))

export function getTerm(key: string): TermDef | undefined {
  return BY_KEY.get(key)
}

/**
 * Drop unknown keys and anything that is not a usable string, so a bad payload
 * from the super admin panel cannot stuff junk into the column.
 *
 * A blank override is dropped rather than stored, because an empty string would
 * render as an empty nav item — worse than the default it replaced.
 */
export function sanitizeLabelMap(input: unknown): Record<string, TermOverride> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Record<string, TermOverride> = {}

  for (const term of TERMS) {
    const entry = raw[term.key]
    if (!entry || typeof entry !== 'object') continue

    const { singular, plural } = entry as Record<string, unknown>
    const override: TermOverride = {}

    if (typeof singular === 'string' && singular.trim()) {
      override.singular = singular.trim().slice(0, 40)
    }
    if (typeof plural === 'string' && plural.trim()) {
      override.plural = plural.trim().slice(0, 40)
    }

    if (override.singular || override.plural) out[term.key] = override
  }

  return out
}

/**
 * Resolve a tenant's (possibly partial) overrides into a complete term map.
 *
 * Overriding only the singular is normal — "Student" → "Client" implies
 * "Clients" — so a missing plural falls back to the catalogue default rather
 * than being guessed at. English pluralisation by rule is wrong often enough
 * ("Universities", "Companies") that guessing would be worse than a default.
 */
export function resolveTerms(stored: unknown): Record<string, ResolvedTerm> {
  const overrides = sanitizeLabelMap(stored)
  const out: Record<string, ResolvedTerm> = {}

  for (const term of TERMS) {
    const o = overrides[term.key]
    out[term.key] = {
      singular: o?.singular ?? term.singular,
      plural: o?.plural ?? term.plural,
    }
  }

  return out
}
