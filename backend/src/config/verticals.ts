// ─────────────────────────────────────────────────────────────────────────────
// What kind of business a customer runs, expressed as a preset.
//
// WHY THIS EXISTS
//
// Onboarding an IT-sales customer used to mean flipping ~30 feature toggles and
// ~40 lead-field toggles by hand, in the right combination, from memory. A
// vertical is that combination, named once and applied in one click.
//
// A PRESET IS A DEFAULT, NOT A LOCK
//
// Provisioning copies the preset into the tenant's own `features`, `leadFields`
// and `labels` columns. From that moment the customer's stored values are
// authoritative and the super admin can change any of them individually — the
// preset is never consulted again unless somebody explicitly re-applies it.
//
// That is deliberate. A preset that kept overriding stored values would make
// every manual tweak mysteriously revert, and re-applying is a destructive act
// that belongs behind a confirmation, not behind a page load.
//
// THE EDUCATION PRESET IS EMPTY ON PURPOSE
//
// Empty means "no deviation from the catalogue defaults", which is byte-for-byte
// what every existing customer already has. Shipping this file therefore cannot
// change anything for Tutelage.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeadFieldConfig } from './lead-fields'
import type { TermOverride } from './terminology'

export type VerticalKey = 'education' | 'b2b_sales' | 'product_sales'

export const DEFAULT_VERTICAL: VerticalKey = 'product_sales'

/** The baseline pipeline a freshly provisioned customer is seeded with. */
export interface VerticalSeed {
  departments: { name: string; slug: string; priority: number }[]
  lifecycle: { slug: string; title: string; priority: number }[]
  leadTypes: { slug: string; title: string; priority: number }[]
  followupStatuses: { status: string; shortnote: string }[]
  /**
   * The sales pipeline a B2B customer starts with. `probability` drives the
   * weighted forecast; exactly one stage should carry isWon and one isLost.
   */
  pipelines?: {
    name: string
    stages: { name: string; probability: number; isWon?: boolean; isLost?: boolean }[]
  }[]
  lostReasons?: string[]
  /**
   * B2B config tables. Absent for education, which has no accounts module.
   *
   * A STARTING VOCABULARY, not a fixed list — both are database rows precisely
   * so an admin can add "Cloud Kitchen" without a migration. Seeded only so a
   * new customer's first account form is not two empty dropdowns.
   */
  accountTypes?: { name: string; priority: number }[]
  industries?: { name: string; priority: number }[]
  /**
   * Departments a project can be handed to. Only the verticals with the
   * `projects` module carry any; renameable rows, like everything above.
   */
  teams?: { name: string; priority: number; color?: string }[]
}

export interface VerticalPreset {
  key: VerticalKey
  label: string
  /** Shown in the super admin wizard, so whoever picks knows what they get. */
  description: string
  /** Deviations from config/features.ts `defaultEnabled`. */
  features: Record<string, boolean>
  /** Deviations from "every lead field visible". */
  leadFields: LeadFieldConfig
  /** Deviations from config/terminology.ts defaults. */
  labels: Record<string, TermOverride>
  seed: VerticalSeed
}

// ── The pipeline every customer got before verticals existed. Kept here rather
//    than in tenant-seed.service.ts so both presets are described in one place;
//    the seed service now reads it from the preset.
const EDUCATION_SEED: VerticalSeed = {
  departments: [
    { name: 'General', slug: 'general', priority: 10 },
    { name: 'Admissions', slug: 'admissions', priority: 20 },
  ],
  lifecycle: [
    { slug: 'new', title: 'New', priority: 10 },
    { slug: 'contacted', title: 'Contacted', priority: 20 },
    { slug: 'follow-up', title: 'Follow-up', priority: 30 },
    { slug: 'not-interested', title: 'Not Interested', priority: 80 },
    { slug: 'converted', title: 'Converted', priority: 90 },
    { slug: 'closed', title: 'Closed', priority: 99 },
  ],
  leadTypes: [
    { slug: 'new', title: 'New', priority: 10 },
    { slug: 'qualified-leads', title: 'Qualified', priority: 20 },
    { slug: 'future-leads', title: 'Future Leads', priority: 30 },
    { slug: 'not-interested', title: 'Not Interested', priority: 90 },
  ],
  followupStatuses: [
    { status: 'Call Back', shortnote: 'Lead asked to be called again later' },
    { status: 'Not Reachable', shortnote: 'Phone off, busy or unanswered' },
    { status: 'Interested', shortnote: 'Positive response, moving forward' },
    { status: 'Not Interested', shortnote: 'Declined' },
    { status: 'Wrong Number', shortnote: 'Contact details are invalid' },
  ],
}

const B2B_SALES_SEED: VerticalSeed = {
  departments: [
    { name: 'Sales', slug: 'sales', priority: 10 },
    { name: 'Pre-Sales', slug: 'pre-sales', priority: 20 },
  ],
  // A real B2B software pipeline. Renameable per customer afterwards, and
  // superseded by configurable Pipelines when Phase 2 lands — these stages keep
  // the lead-centric screens usable in the meantime.
  lifecycle: [
    { slug: 'new', title: 'New', priority: 10 },
    { slug: 'contacted', title: 'Contacted', priority: 20 },
    { slug: 'qualified', title: 'Qualified', priority: 30 },
    { slug: 'demo-scheduled', title: 'Demo Scheduled', priority: 40 },
    { slug: 'proposal-sent', title: 'Proposal Sent', priority: 50 },
    { slug: 'negotiation', title: 'Negotiation', priority: 60 },
    { slug: 'won', title: 'Won', priority: 90 },
    { slug: 'lost', title: 'Lost', priority: 99 },
  ],
  leadTypes: [
    { slug: 'inbound', title: 'Inbound', priority: 10 },
    { slug: 'outbound', title: 'Outbound', priority: 20 },
    { slug: 'referral', title: 'Referral', priority: 30 },
    { slug: 'partner', title: 'Partner', priority: 40 },
    { slug: 'existing-customer', title: 'Existing Customer', priority: 50 },
    { slug: 'not-interested', title: 'Not Interested', priority: 90 },
  ],
  pipelines: [
    {
      name: 'Sales Pipeline',
      stages: [
        { name: 'New', probability: 5 },
        { name: 'Contacted', probability: 10 },
        { name: 'Qualified', probability: 25 },
        { name: 'Demo Scheduled', probability: 40 },
        { name: 'Proposal Sent', probability: 60 },
        { name: 'Negotiation', probability: 80 },
        { name: 'Won', probability: 100, isWon: true },
        { name: 'Lost', probability: 0, isLost: true },
      ],
    },
  ],
  lostReasons: [
    'Price too high',
    'Lost to competitor',
    'No budget',
    'No decision / went quiet',
    'Bad timing',
    'Not a fit',
    'Built in-house',
  ],
  accountTypes: [
    { name: 'Company', priority: 10 },
    { name: 'IT Company', priority: 20 },
    { name: 'Startup', priority: 30 },
    { name: 'Agency', priority: 40 },
    { name: 'Consultancy', priority: 50 },
    { name: 'Hotel', priority: 60 },
    { name: 'Restaurant', priority: 70 },
    { name: 'Hospital', priority: 80 },
    { name: 'Clinic', priority: 90 },
    { name: 'School', priority: 100 },
    { name: 'College', priority: 110 },
    { name: 'University', priority: 120 },
    { name: 'Coaching Institute', priority: 130 },
    { name: 'Manufacturer', priority: 140 },
    { name: 'Distributor', priority: 150 },
    { name: 'Retailer', priority: 160 },
    { name: 'Wholesaler', priority: 170 },
    { name: 'Real Estate', priority: 180 },
    { name: 'Bank', priority: 190 },
    { name: 'Financial Institution', priority: 200 },
    { name: 'Government Organization', priority: 210 },
    { name: 'NGO', priority: 220 },
    { name: 'Vendor', priority: 230 },
    { name: 'Partner', priority: 240 },
    { name: 'Freelancer', priority: 250 },
    { name: 'Individual', priority: 260 },
    { name: 'Other', priority: 999 },
  ],
  industries: [
    { name: 'Information Technology', priority: 10 },
    { name: 'Software & SaaS', priority: 20 },
    { name: 'E-commerce', priority: 30 },
    { name: 'Hospitality', priority: 40 },
    { name: 'Healthcare', priority: 50 },
    { name: 'Education', priority: 60 },
    { name: 'Real Estate', priority: 70 },
    { name: 'Manufacturing', priority: 80 },
    { name: 'Retail', priority: 90 },
    { name: 'Logistics', priority: 100 },
    { name: 'Banking & Finance', priority: 110 },
    { name: 'Insurance', priority: 120 },
    { name: 'Media & Entertainment', priority: 130 },
    { name: 'Travel & Tourism', priority: 140 },
    { name: 'Automotive', priority: 150 },
    { name: 'Construction', priority: 160 },
    { name: 'Agriculture', priority: 170 },
    { name: 'Telecom', priority: 180 },
    { name: 'Professional Services', priority: 190 },
    { name: 'Non-Profit', priority: 200 },
    { name: 'Government', priority: 210 },
    { name: 'Other', priority: 999 },
  ],
  teams: [
    { name: 'IT / Software', priority: 10, color: '#2563eb' },
    { name: 'Digital Marketing', priority: 20, color: '#db2777' },
    { name: 'Design', priority: 30, color: '#9333ea' },
    { name: 'Sales', priority: 40, color: '#059669' },
    { name: 'Support', priority: 50, color: '#d97706' },
  ],
  followupStatuses: [
    { status: 'Call Back', shortnote: 'Asked to be called again later' },
    { status: 'Not Reachable', shortnote: 'Phone off, busy or unanswered' },
    { status: 'Gatekeeper', shortnote: 'Blocked before reaching the decision maker' },
    { status: 'Demo Booked', shortnote: 'Demo or discovery call scheduled' },
    { status: 'Proposal Requested', shortnote: 'Asked for pricing or a proposal' },
    { status: 'Interested', shortnote: 'Positive response, moving forward' },
    { status: 'Not Interested', shortnote: 'Declined' },
    { status: 'Wrong Number', shortnote: 'Contact details are invalid' },
  ],
}

export const VERTICALS: VerticalPreset[] = [
  {
    key: 'education',
    label: 'Education Consultancy',
    description:
      'Student admissions: leads become students, with exam scores, academic history, ' +
      'university applications and fee tracking. This is the original Tutelage setup.',
    // Empty across the board — see the header. Education IS the catalogue default.
    features: {},
    leadFields: { hiddenGroups: [], hiddenFields: [] },
    labels: {},
    seed: EDUCATION_SEED,
  },
  {
    key: 'b2b_sales',
    label: 'B2B / IT Sales',
    description:
      'Selling to businesses: a company-and-deal pipeline instead of an admissions ' +
      'funnel. Turns off the admissions modules and every exam-score field, and ' +
      'renames the CRM around accounts, deals and products.',
    features: {
      // The B2B core: this is what makes it a sales CRM rather than a funnel.
      accounts: true,
      deals: true,
      sales_docs: true,
      custom_fields: true,
      projects: true,
      // Admissions-shaped modules make no sense here.
      students: false,
      university_apps: false,
      // Everything a sales floor actually runs on.
      financial: true,
      branches: true,
      tasks: true,
      campaigns: true,
      inbox: true,
      whatsapp: true,
      auto_dialer: true,
      b2b: true,
      mobile_app: true,
      call_recording: true,
      bulk_ops: true,
      lead_work: true,
      public_api: true,
      // Off until asked for: field-staff tracking and batch import review are
      // both workflows a new customer should opt into, not inherit.
      location_tracking: false,
      lead_staging: false,
    },
    leadFields: {
      // Eight groups of admissions data that a B2B seller will never fill in.
      hiddenGroups: ['neet', 'ucat', 'dmat', 'sat', 'english', 'academics', 'education'],
      // Family and immigration detail, inside the otherwise-useful Personal group.
      hiddenFields: [
        'father',
        'mother',
        'fatherMobile',
        'motherMobile',
        'passportNumber',
        'passportExpiry',
        'religion',
        'castCategory',
        'maritalStatus',
        'firstLanguage',
        'gender',
        'dob',
        // "Other Settings" is a locked GROUP, but individual fields inside it
        // can still be switched off — and a B2B lead has no university.
        'intrestedUniversity',
      ],
      labels: {
        // The forms hardcode education wording as their fallback — "Student
        // Name", "Email 2 (Father)". Renaming here is what replaces it, and it
        // is also what makes the placeholder follow (see Field in AddLead).
        name: 'Contact Name',
        email: 'Work Email',
        mobile: 'Mobile',
        intrestedCourse: 'Product / Service Interest',
        intrestedSubject: 'Requirement',
        approximateBudget: 'Deal Value',
        email2: 'Email 2 (Work)',
        email3: 'Email 3 (Other)',
        mobile2: 'Mobile 2 (Alt)',
        mobile3: 'Mobile 3 (Office)',
        homeAddress: 'Address',
        homeContactNumber: 'Office Number',
      },
      groupLabels: {
        personal: 'Contact Information',
        address: 'Address',
        other: 'Deal Details',
      },
    },
    labels: {
      student: { singular: 'Client', plural: 'Clients' },
      counsellor: { singular: 'Sales Rep', plural: 'Sales Reps' },
      course: { singular: 'Product', plural: 'Products' },
      university: { singular: 'Vendor', plural: 'Vendors' },
      subject: { singular: 'Requirement', plural: 'Requirements' },
      budget: { singular: 'Deal Value', plural: 'Deal Values' },
      agent: { singular: 'Channel Partner', plural: 'Channel Partners' },
    },
    seed: B2B_SALES_SEED,
  },
  {
    key: 'product_sales',
    label: 'Product + Stock Sales',
    description:
      'Leads, catalog send, deal board, then won → order + GST invoice and Packed / Out for delivery / Delivered.',
    features: {
      accounts: false,
      deals: true,
      sales_docs: true,
      custom_fields: false,
      projects: false,
      students: false,
      university_apps: false,
      financial: false,
      branches: true,
      tasks: true,
      campaigns: true,
      inbox: true,
      whatsapp: true,
      auto_dialer: true,
      b2b: false,
      mobile_app: true,
      call_recording: true,
      bulk_ops: true,
      lead_work: true,
      public_api: true,
      location_tracking: true,
      lead_staging: false,
      agents: true,
      activity_tracking: true,
      daily_reports: true,
      remarks: true,
      chat: true,
    },
    leadFields: {
      hiddenGroups: ['neet', 'ucat', 'dmat', 'sat', 'english', 'academics', 'education'],
      hiddenFields: [
        'father', 'mother', 'fatherMobile', 'motherMobile',
        'passportNumber', 'passportExpiry', 'religion', 'castCategory',
        'maritalStatus', 'firstLanguage', 'gender', 'dob', 'intrestedUniversity',
      ],
      labels: {
        name: 'Contact Name',
        email: 'Work Email',
        mobile: 'Mobile',
        intrestedCourse: 'Product interest',
        intrestedSubject: 'Requirement',
        approximateBudget: 'Budget',
        email2: 'Email 2',
        email3: 'Email 3',
        mobile2: 'Mobile 2',
        mobile3: 'Office number',
        homeAddress: 'Billing address',
        homeContactNumber: 'Office number',
      },
      groupLabels: {
        personal: 'Contact',
        address: 'Address',
        other: 'Details',
      },
    },
    labels: {
      student: { singular: 'Customer', plural: 'Customers' },
      counsellor: { singular: 'Sales Rep', plural: 'Sales Reps' },
      course: { singular: 'Product', plural: 'Products' },
      university: { singular: 'Vendor', plural: 'Vendors' },
      subject: { singular: 'Requirement', plural: 'Requirements' },
      budget: { singular: 'Budget', plural: 'Budgets' },
      agent: { singular: 'Partner', plural: 'Partners' },
    },
    seed: {
      departments: [{ name: 'Sales', slug: 'sales', priority: 10 }],
      lifecycle: [
        { slug: 'new', title: 'New', priority: 10 },
        { slug: 'contacted', title: 'Contacted', priority: 20 },
        { slug: 'catalog-sent', title: 'Catalog Sent', priority: 30 },
        { slug: 'confirmed', title: 'Confirmed', priority: 80 },
        { slug: 'lost', title: 'Lost', priority: 99 },
      ],
      leadTypes: [
        { slug: 'new', title: 'New', priority: 10 },
        { slug: 'qualified-leads', title: 'Qualified', priority: 20 },
        { slug: 'not-interested', title: 'Not Interested', priority: 90 },
      ],
      followupStatuses: EDUCATION_SEED.followupStatuses,
      lostReasons: ['Price', 'Not interested', 'Went elsewhere', 'No response', 'Other'],
      pipelines: [
        {
          name: 'Product Sales',
          stages: [
            { name: 'Enquiry', probability: 10 },
            { name: 'Follow-up', probability: 50 },
            { name: 'Confirmed', probability: 100, isWon: true },
            { name: 'Dropped', probability: 0, isLost: true },
          ],
        },
      ],
    },
  },
]

export const VERTICAL_KEYS = VERTICALS.map((v) => v.key)

const BY_KEY = new Map(VERTICALS.map((v) => [v.key, v]))

export function isVerticalKey(value: unknown): value is VerticalKey {
  return typeof value === 'string' && BY_KEY.has(value as VerticalKey)
}

/**
 * Unknown or missing verticals fall back to product_sales — this CRM sells
 * catalog products, not admissions.
 */
export function getVertical(key: unknown): VerticalPreset {
  return (isVerticalKey(key) ? BY_KEY.get(key) : undefined) ?? BY_KEY.get('product_sales')!
}
