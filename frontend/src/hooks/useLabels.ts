import { useMemo } from 'react'
import { useAuthStore } from '@/stores/auth.store'

/**
 * The catalogue defaults, mirroring backend/src/config/terminology.ts.
 *
 * Duplicated on purpose. The server always sends a complete resolved map, so
 * this is only ever used for the first paint before /auth/me lands — and a nav
 * that renders "Students" a moment early is far better than one that renders a
 * row of blanks, or worse, raw keys like "student.plural".
 *
 * If you add a term to the backend catalogue, add it here too. The two lists
 * drifting is harmless (the server's answer always wins once it arrives), which
 * is why this is a plain object and not a build-time import.
 */
const FALLBACK: Record<string, { singular: string; plural: string }> = {
  brand: { singular: 'Sales CRM', plural: 'Sales CRM' },
  lead: { singular: 'Lead', plural: 'Leads' },
  student: { singular: 'Customer', plural: 'Customers' },
  counsellor: { singular: 'Sales Rep', plural: 'Sales Reps' },
  course: { singular: 'Product', plural: 'Products' },
  university: { singular: 'Vendor', plural: 'Vendors' },
  subject: { singular: 'Subject', plural: 'Subjects' },
  budget: { singular: 'Budget', plural: 'Budgets' },
  followup: { singular: 'Follow-up', plural: 'Follow-ups' },
  branch: { singular: 'Branch', plural: 'Branches' },
  bucket: { singular: 'Bucket', plural: 'Buckets' },
  agent: { singular: 'Partner Agent', plural: 'Partner Agents' },
  account: { singular: 'Account', plural: 'Accounts' },
  contact: { singular: 'Contact', plural: 'Contacts' },
  deal: { singular: 'Deal', plural: 'Deals' },
}

/**
 * What this customer calls things.
 *
 * An education consultancy says "Student" and "Course"; an IT sales team says
 * "Client" and "Product". Same screens, same code — a super admin sets the words
 * per customer (Super Admin → Customer → Terminology), and every screen that
 * renders one of those nouns should go through this hook so they all agree.
 *
 * ```tsx
 * const t = useLabels()
 * <h1>{t.plural('student')}</h1>          // "Students" or "Clients"
 * <Button>Add {t('lead')}</Button>        // "Add Lead"
 * t.template('Add {lead:plural}')         // "Add Leads" or "Add Leads"
 * ```
 *
 * NOT an i18n layer. Only the ~14 nouns in the catalogue go through it; body
 * copy, error messages and button verbs stay written in English in the source.
 */
export function useLabels() {
  const labels = useAuthStore((s) => s.labels)

  return useMemo(() => {
    const singular = (key: string): string =>
      labels?.[key]?.singular ?? FALLBACK[key]?.singular ?? key

    const plural = (key: string): string =>
      labels?.[key]?.plural ?? FALLBACK[key]?.plural ?? key

    /** `t('student')` is the singular — the common case, so it is the default. */
    const t = Object.assign(singular, {
      singular,
      plural,
      /** `t.count(3, 'lead')` → "3 Leads"; `t.count(1, 'lead')` → "1 Lead". */
      count: (n: number, key: string): string => `${n} ${n === 1 ? singular(key) : plural(key)}`,
      /**
       * Substitute terms inside a longer string: `{lead}` for the singular,
       * `{lead:plural}` for the plural.
       *
       * For labels that are a noun plus other words — "Add Leads", "University
       * Mails" — where wrapping every one in JSX would be far noisier than a
       * placeholder. An unknown key is left exactly as written, so a typo shows
       * up as literal `{leed}` rather than silently vanishing.
       */
      template: (text: string): string =>
        text.replace(/\{([a-z_]+)(:plural)?\}/g, (whole, key: string, isPlural?: string) => {
          if (!(key in FALLBACK)) return whole
          return isPlural ? plural(key) : singular(key)
        }),
      /**
       * True when this customer has renamed nothing — the common case.
       *
       * Compared against the defaults rather than counting keys, because the
       * server always sends a complete map: a customer with no overrides still
       * gets all fourteen terms, just with the catalogue's wording.
       */
      isDefault: Object.entries(FALLBACK).every(
        ([key, def]) =>
          (labels?.[key]?.singular ?? def.singular) === def.singular &&
          (labels?.[key]?.plural ?? def.plural) === def.plural,
      ),
    })

    return t
  }, [labels])
}
