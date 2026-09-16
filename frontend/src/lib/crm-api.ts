// ─────────────────────────────────────────────────────────────────────────────
// The B2B core's API surface and types.
//
// Its own file rather than more of `api.ts`, which is already long, and because
// every export here is reachable only when the `accounts` / `custom_fields`
// modules are on. The education vertical leaves both off and the API mounts are
// gated the same way, so a Tutelage session cannot reach any of it.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from './api'
import type { PaginatedResult } from '@/types'

/**
 * What a polymorphic satellite can hang off. Mirrors LIVE_ENTITY_TYPES in
 * backend/src/config/crm-entities.ts — `quote` and `order` land in Phase 3.
 */
export type CrmEntityType = 'lead' | 'account' | 'contact' | 'deal'

export interface CrmRef {
  id: number
  name: string
}

export interface Account {
  id: number
  accountNumber: string | null
  name: string
  legalName: string | null
  accountTypeId: number | null
  industryId: number | null
  status: string
  businessModel: string | null
  employeeCount: number | null
  annualRevenue: number | null
  foundedYear: number | null
  website: string | null
  linkedin: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  logoUrl: string | null
  gstin: string | null
  pan: string | null
  cin: string | null
  legalStructure: string | null
  billingState?: string | null
  creditLimit?: number | null
  creditDays?: number | null
  priceListId?: number | null
  replenishDays?: number | null
  ownerId: number | null
  branchId: number | null
  notes: string | null
  createdAt: string
  accountType?: (CrmRef & { slug?: string }) | null
  industry?: CrmRef | null
  owner?: CrmRef | null
  createdBy?: CrmRef | null
  contactCount?: number
  locationCount?: number
  customFields?: CustomFieldValue[]

  // ── Only on the detail endpoint. Computed server-side in one round trip,
  //    because the page needs all of it before it can say anything useful.
  stats?: AccountStats
  primaryLocation?: {
    id: number
    name: string
    city: string | null
    state: string | null
    country: string | null
    phone: string | null
  } | null
  /** Decision maker / finance / technical / procurement only — not everyone. */
  keyContacts?: Contact[]
}

/**
 * The numbers the account page leads with.
 *
 * `deals` and `invoices` are NULL — not zeroed — when the customer does not
 * have that module. "0 open deals" and "this customer does not use deals" are
 * different statements and the UI must not confuse them.
 */
export interface AccountStats {
  contacts: number
  locations: number
  deals: {
    open: number
    openValue: number
    weightedValue: number
    won: number
    wonValue: number
    lost: number
    nextCloseDate: string | null
    nextStep: string | null
  } | null
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
  lastActivity: {
    kind: string
    subject: string | null
    occurredAt: string
    actorName: string | null
  } | null
  /** Days since anyone touched this account. The most actionable number here. */
  daysSinceContact: number | null
  openTasks: number
}

export interface Contact {
  id: number
  accountId: number | null
  locationId: number | null
  firstName: string
  lastName: string | null
  /** Built server-side so every screen shows a person's name the same way. */
  fullName: string
  jobTitle: string | null
  department: string | null
  seniority: string | null
  email: string | null
  personalEmail: string | null
  mobile: string | null
  whatsapp: string | null
  officePhone: string | null
  linkedin: string | null
  preferredChannel: string | null
  language: string | null
  role: string
  relationshipStrength: string
  status: string
  ownerId: number | null
  notes: string | null
  createdAt: string
  account?: CrmRef | null
  owner?: CrmRef | null
  location?: (CrmRef & { city?: string | null }) | null
  customFields?: CustomFieldValue[]
}

export interface CrmLocation {
  id: number
  accountId: number
  name: string
  type: string
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  isPrimary: boolean
}

export interface ActivityItem {
  id: number
  kind: string
  subject: string | null
  body: string | null
  occurredAt: string
  meta: Record<string, unknown> | null
  actor: CrmRef | null
}

export interface CrmNote {
  id: number
  entityType: string
  entityId: number
  kind: string
  body: string
  pinned: boolean
  createdAt: string
  user?: CrmRef
}

export interface CrmTag {
  id: number
  name: string
  slug: string
  color: string | null
  usageCount?: number
}

export interface CustomFieldDef {
  id: number
  entityType: string
  key: string
  label: string
  type: string
  options: string[] | null
  required: boolean
  appliesWhen: Record<string, string[]> | null
  section: string | null
  helpText: string | null
  sortOrder: number
  active: boolean
}

/** A definition plus this record's current value — what a form renders from. */
export interface CustomFieldValue {
  id: number
  key: string
  label: string
  type: string
  options: string[] | null
  required: boolean
  section: string | null
  helpText: string | null
  sortOrder: number
  value: unknown
}

// ── Display vocabularies. Kept beside the types so a label is defined once and
//    the list page, the detail header and the form dropdown cannot disagree.

export const ACCOUNT_STATUSES = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'active', label: 'Active Customer' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'churned', label: 'Churned' },
]

export const BUSINESS_MODELS = [
  'b2b', 'b2c', 'b2b2c', 'd2c', 'marketplace',
  'saas', 'services', 'manufacturing', 'retail', 'wholesale', 'subscription',
]

export const LEGAL_STRUCTURES = [
  'Private Limited', 'Public Limited', 'LLP', 'Partnership',
  'Proprietorship', 'Trust', 'Society', 'Government', 'Non-Profit', 'Other',
]

export const LOCATION_TYPES = [
  { value: 'head_office', label: 'Head Office' },
  { value: 'branch', label: 'Branch' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'factory', label: 'Factory' },
  { value: 'store', label: 'Store' },
  { value: 'property', label: 'Property' },
  { value: 'registered', label: 'Registered Office' },
  { value: 'billing', label: 'Billing Address' },
  { value: 'shipping', label: 'Shipping Address' },
]

export const CONTACT_ROLES = [
  { value: 'decision_maker', label: 'Decision Maker' },
  { value: 'influencer', label: 'Influencer' },
  { value: 'approver', label: 'Approver' },
  { value: 'buyer', label: 'Buyer' },
  { value: 'user', label: 'User' },
  { value: 'finance', label: 'Finance Contact' },
  { value: 'technical', label: 'Technical Contact' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'gatekeeper', label: 'Gatekeeper' },
  { value: 'unknown', label: 'Unknown' },
]

export const RELATIONSHIP_STRENGTHS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'new', label: 'New' },
  { value: 'weak', label: 'Weak' },
  { value: 'good', label: 'Good' },
  { value: 'strong', label: 'Strong' },
  { value: 'champion', label: 'Champion' },
]

export const NOTE_KINDS = [
  { value: 'general', label: 'General' },
  { value: 'sales', label: 'Sales' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'financial', label: 'Financial' },
  { value: 'internal', label: 'Internal' },
]

// ── Clients

export const accountsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/accounts', { params }).then((r) => r.data as PaginatedResult<Account>),
  get: (id: number) => api.get(`/accounts/${id}`).then((r) => r.data as Account),
  create: (body: Record<string, unknown>) => api.post('/accounts', body).then((r) => r.data as Account),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/accounts/${id}`, body).then((r) => r.data as Account),
  remove: (id: number) => api.delete(`/accounts/${id}`).then((r) => r.data),
  restore: (id: number) => api.post(`/accounts/${id}/restore`).then((r) => r.data),

  contacts: (id: number) => api.get(`/accounts/${id}/contacts`).then((r) => r.data as Contact[]),
  locations: (id: number) => api.get(`/accounts/${id}/locations`).then((r) => r.data as CrmLocation[]),
  addLocation: (id: number, body: Record<string, unknown>) =>
    api.post(`/accounts/${id}/locations`, body).then((r) => r.data as CrmLocation),
  updateLocation: (accountId: number, locationId: number, body: Record<string, unknown>) =>
    api
      .patch(`/accounts/${accountId}/locations/${locationId}`, body)
      .then((r) => r.data as CrmLocation),
  removeLocation: (accountId: number, locationId: number) =>
    api.delete(`/accounts/${accountId}/locations/${locationId}`).then((r) => r.data),
}

export const contactsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/contacts', { params }).then((r) => r.data as PaginatedResult<Contact>),
  get: (id: number) => api.get(`/contacts/${id}`).then((r) => r.data as Contact),
  create: (body: Record<string, unknown>) => api.post('/contacts', body).then((r) => r.data as Contact),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/contacts/${id}`, body).then((r) => r.data as Contact),
  remove: (id: number) => api.delete(`/contacts/${id}`).then((r) => r.data),
}

export const crmApi = {
  /** Newest first, keyset-paginated — pass a previous `nextCursor` as `before`. */
  timeline: (entityType: CrmEntityType, entityId: number, params?: Record<string, unknown>) =>
    api
      .get(`/crm/timeline/${entityType}/${entityId}`, { params })
      .then((r) => r.data as { items: ActivityItem[]; nextCursor: number | null }),
  logActivity: (
    entityType: CrmEntityType,
    entityId: number,
    body: { kind: string; subject?: string | null; body?: string | null; occurredAt?: string },
  ) => api.post(`/crm/timeline/${entityType}/${entityId}`, body).then((r) => r.data),

  notes: (entityType: CrmEntityType, entityId: number) =>
    api.get(`/crm/notes/${entityType}/${entityId}`).then((r) => r.data as CrmNote[]),
  addNote: (
    entityType: CrmEntityType,
    entityId: number,
    body: { body: string; kind?: string; pinned?: boolean },
  ) => api.post(`/crm/notes/${entityType}/${entityId}`, body).then((r) => r.data as CrmNote),
  updateNote: (id: number, body: { body?: string; pinned?: boolean }) =>
    api.patch(`/crm/notes/${id}`, body).then((r) => r.data as CrmNote),
  removeNote: (id: number) => api.delete(`/crm/notes/${id}`).then((r) => r.data),

  tags: () => api.get('/crm/tags').then((r) => r.data as CrmTag[]),
  createTag: (name: string, color?: string) =>
    api.post('/crm/tags', { name, color }).then((r) => r.data as CrmTag),
  tagsFor: (entityType: CrmEntityType, entityId: number) =>
    api.get(`/crm/tags/${entityType}/${entityId}`).then((r) => r.data as CrmTag[]),
  /** Replaces the whole set — send every tag the record should end up with. */
  setTags: (entityType: CrmEntityType, entityId: number, tagIds: number[]) =>
    api.put(`/crm/tags/${entityType}/${entityId}`, { tagIds }).then((r) => r.data),

  accountTypes: () => api.get('/crm/account-types').then((r) => r.data as CrmRef[]),
  createAccountType: (name: string) =>
    api.post('/crm/account-types', { name }).then((r) => r.data as CrmRef),
  industries: () => api.get('/crm/industries').then((r) => r.data as CrmRef[]),
  createIndustry: (name: string) => api.post('/crm/industries', { name }).then((r) => r.data as CrmRef),

  search: (q: string) =>
    api.get('/crm/search', { params: { q } }).then(
      (r) =>
        r.data as {
          accounts: { id: number; name: string; accountNumber: string | null; phone: string | null }[]
          contacts: Contact[]
          leads: { id: number; name: string; email: string | null; mobile: string | null }[]
          deals?: { id: number; name: string; dealNumber: string | null; value: number | null; stage: string }[]
          quotes?: { id: number; quoteNumber: string; status: string; total: number }[]
          orders?: { id: number; orderNumber: string; status: string; total: number }[]
          invoices?: { id: number; invoiceNumber: string; status: string; total: number }[]
          contracts?: { id: number; contractNumber: string; title: string; status: string }[]
          projects?: { id: number; projectNumber: string | null; title: string; status: string }[]
        },
    ),

  convertLead: (
    leadId: number,
    body: {
      accountName?: string
      accountTypeId?: number | null
      industryId?: number | null
      existingAccountId?: number | null
    },
  ) =>
    api
      .post(`/crm/convert/lead/${leadId}`, body)
      .then((r) => r.data as { account: Account; contact: Contact }),
}

export const customFieldsApi = {
  list: (entityType: CrmEntityType, all = false) =>
    api
      .get('/custom-fields', { params: { entityType, all: all ? 1 : undefined } })
      .then((r) => r.data as CustomFieldDef[]),
  types: () => api.get('/custom-fields/types').then((r) => r.data as string[]),
  create: (body: Record<string, unknown>) =>
    api.post('/custom-fields', body).then((r) => r.data as CustomFieldDef),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/custom-fields/${id}`, body).then((r) => r.data as CustomFieldDef),
  /** Refuses when values exist unless `force`; the error carries the count. */
  remove: (id: number, force = false) =>
    api
      .delete(`/custom-fields/${id}`, { params: { force: force ? 1 : undefined } })
      .then((r) => r.data),

  values: (entityType: CrmEntityType, entityId: number) =>
    api
      .get(`/custom-fields/values/${entityType}/${entityId}`)
      .then((r) => r.data as CustomFieldValue[]),
  /** A PATCH: keys absent from `patch` keep whatever they had. */
  saveValues: (entityType: CrmEntityType, entityId: number, patch: Record<string, unknown>) =>
    api
      .patch(`/custom-fields/values/${entityType}/${entityId}`, patch)
      .then((r) => r.data as { saved: string[]; skipped: string[] }),
  seedCommercial: () =>
    api.post('/custom-fields/seed-commercial').then((r) => r.data as { created: string[] }),
}
