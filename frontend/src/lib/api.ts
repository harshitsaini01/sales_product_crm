import axios from 'axios'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth.store'
import type { CounsellorRemark } from '@/types'

/** One row of the bulk status/department change preview. */
export interface BulkStatusPreviewRow {
  id: number
  name: string
  mobile: string | null
  fromDepartmentId: number | null
  fromDepartment: string | null
  toDepartmentId: number | null
  toDepartment: string | null
  fromStatus: string | null
  toStatus: string | null
  fromSubStatus: string | null
  toSubStatus: string | null
  /** Department actually changes for this lead. */
  moving: boolean
  /** Pipeline guard will refuse this lead — it is skipped on apply. */
  blocked: boolean
  blockReason: string | null
}

export interface BulkStatusPreviewResponse {
  data: BulkStatusPreviewRow[]
  page: number
  limit: number
  total: number
  totalPages: number
  movingCount: number
  blockedCount: number
  fromDepartments: string[]
  toDepartment: string | null
  toStatus: string | null
  toSubStatus: string | null
}

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Once a 401 fires we kick the user to /login, but the redirect is async —
// without this guard, mutations + cache invalidations queued in the same tick
// would race ahead with no token and surface "Missing or invalid authorization
// header" toasts on top of the real session-expiry message.
let sessionTerminated = false

// Attach JWT on every request. If there's no token (e.g. logout already ran)
// short-circuit before hitting the server so the user gets a clean redirect
// instead of a confusing 401 from the backend.
api.interceptors.request.use((config) => {
  // The instance defaults to application/json. FormData must go out as
  // multipart with a browser-generated boundary, or multer never sees the file
  // and product / mail image uploads 400 with "No image uploaded".
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type')
  }

  const url: string = config.url || ''
  const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/forgot-password')
    || url.includes('/auth/verify-otp') || url.includes('/auth/reset-password')

  if (isAuthEndpoint) return config

  const token = useAuthStore.getState().token
  if (!token || sessionTerminated) {
    if (!sessionTerminated) {
      sessionTerminated = true
      useAuthStore.getState().logout()
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(new axios.Cancel('No active session'))
  }
  config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

// Handle 401 — clear auth and redirect to login. The login endpoint itself
// returns 401 on bad credentials; don't treat that as a session expiry.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isCancel(err)) return Promise.reject(err)
    if (err.response?.status === 401) {
      const url: string = err.config?.url || ''
      const isLoginAttempt = url.includes('/auth/login')
      if (!isLoginAttempt && !sessionTerminated) {
        sessionTerminated = true
        const reason = err.response?.data?.reason
        if (reason === 'session_invalidated') {
          toast.error('Signed in elsewhere — you have been logged out.')
        } else {
          toast.error('Your session has expired — please sign in again.')
        }
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

// ─── Typed API helpers ────────────────────────────────────────────────────────

export const authApi = {
  login: (data: { loginid: string; password: string }) =>
    api.post('/auth/login', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', data).then((r) => r.data),
  forgotPassword: (data: { email: string }) =>
    api.post('/auth/forgot-password', data).then((r) => r.data),
  verifyOtp: (data: { email: string; otp: string }) =>
    api.post('/auth/verify-otp', data).then((r) => r.data as { resetToken: string }),
  resetPassword: (data: { resetToken: string; newPassword: string }) =>
    api.post('/auth/reset-password', data).then((r) => r.data),
  impersonate: (userId: number) =>
    api.post(`/auth/impersonate/${userId}`).then((r) => r.data as { token: string; user: any }),
}

// ─── Super Admin (control plane) ──────────────────────────────────────────────
//
// Everything under /api/platform. These endpoints are guarded by a separate JWT
// secret, so a customer's token cannot reach any of them — see
// backend/src/middleware/platform-auth.ts.

export type TenantStatus = 'active' | 'suspended' | 'expired'
export type ProvisioningStatus =
  | 'pending' | 'creating_schema' | 'migrating' | 'seeding' | 'ready' | 'failed'

export interface TenantLimits {
  maxUsers: number | null
  maxCounsellors: number | null
  maxSubAdmins: number | null
  maxBranches: number | null
  maxLeads: number | null
  maxLeadsPerMonth: number | null
  maxStorageMb: number | null
}

export interface Tenant extends TenantLimits {
  id: number
  slug: string
  schemaName: string
  companyName: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  status: TenantStatus
  suspendedReason: string | null
  planName: string
  planStartsAt: string | null
  planExpiresAt: string | null
  provisioningStatus: ProvisioningStatus
  provisioningStep: string | null
  provisioningError: string | null
  features: Record<string, boolean>
  leadFields?: LeadFieldConfigPayload
  /** 'education' | 'b2b_sales' — which preset built this customer. */
  vertical: string
  /** Only the customer's overrides, not the resolved map. */
  labels?: Record<string, Partial<TermPayload>>
  isPrimary: boolean
  createdAt: string
  usage?: { users: number; leads: number; storageMb: number; capturedOn: string } | null
}

export interface TenantUsage {
  users: number
  counsellors: number
  subAdmins: number
  branches: number
  leads: number
  leadsThisMonth: number
  students: number
  storageMb: number
}

export interface UsageWarning {
  key: keyof TenantLimits
  label: string
  used: number
  limit: number
  pct: number
}

/**
 * The detail endpoint counts usage live inside the customer's schema, so its
 * `usage` is richer than the list endpoint's nightly snapshot.
 */
export interface TenantDetail extends Omit<Tenant, 'usage'> {
  usage: { usage: TenantUsage; limits: TenantLimits; warnings: UsageWarning[] } | null
}

export interface LeadFieldDef {
  key: string
  /** What this customer calls it — already renamed by the server. */
  label: string
  /** The catalogue wording, so the super admin panel can show what was changed. */
  defaultLabel?: string
  type?: 'number'
  /** Always shown, whatever the config says (e.g. the lead's name). */
  locked: boolean
  visible: boolean
}

export interface LeadFieldGroup {
  id: string
  title: string
  defaultTitle?: string
  /** Groups the CRM itself depends on — not hideable. */
  locked: boolean
  visible: boolean
  fields: LeadFieldDef[]
}

export interface LeadFieldConfigPayload {
  hiddenGroups: string[]
  hiddenFields: string[]
  /** Per-customer field renames: { intrestedCourse: 'Product / Service' }. */
  labels?: Record<string, string>
  /** Per-customer group-heading renames: { other: 'Deal Details' }. */
  groupLabels?: Record<string, string>
}

/** One noun the UI says, as this customer says it. */
export interface TermPayload {
  singular: string
  plural: string
}

/** The catalogue entry behind a term, for the super admin editing screen. */
export interface TermDefPayload extends TermPayload {
  key: string
  description: string
  /** The wording before any override — what "reset" restores. */
  defaultSingular: string
  defaultPlural: string
}

export interface VerticalPayload {
  key: string
  label: string
  description: string
  /** How many lead-field groups and modules the preset switches off. */
  hiddenGroupCount: number
  disabledFeatureCount: number
  /** The preset's deviations, so the wizard can pre-set its grids from them. */
  features: Record<string, boolean>
  leadFields: LeadFieldConfigPayload
}

export interface SchemaDrift {
  schemaName: string
  /** SQL that would bring the schema in line with prisma/schema.prisma. */
  sql: string
  hasDrift: boolean
  /** True when closing the drift would drop a table or column. */
  destructive: boolean
}

export interface FeatureDef {
  key: string
  label: string
  group: string
  description: string
  defaultEnabled: boolean
  /** Load-bearing: switchable, but switching it OFF asks for confirmation. */
  critical?: boolean
  /** What breaks if it is switched off. Shown at that moment. */
  criticalWarning?: string
}

export interface PlatformOverview {
  metrics: {
    totalCustomers: number
    activeCustomers: number
    suspendedCustomers: number
    expiredCustomers: number
    expiringSoon: number
    provisioning: number
    failedProvisioning: number
    totalUsers: number
    totalLeads: number
  }
  expiringSoon: { id: number; slug: string; companyName: string; planExpiresAt: string }[]
  nearingLimits: { slug: string; companyName: string; label: string; used: number; limit: number; pct: number }[]
  provisioningJobs: {
    id: number; slug: string; companyName: string
    status: ProvisioningStatus; step: string | null; error: string | null
  }[]
  recentActivity: {
    id: number; action: string; summary: string; actorName: string; at: string
    tenant: { slug: string; name: string } | null
  }[]
}

export interface AuditEntry {
  id: number
  action: string
  summary: string
  actorName: string
  createdAt: string
  ip: string | null
  detail: unknown
  tenant: { slug: string; companyName: string } | null
}

export interface TenantDirectoryUser {
  id: number
  userId: number
  name: string
  email: string
  loginid: string
  role: string
  status: number
}

export const platformApi = {
  me: () => api.get('/platform/me').then((r) => r.data),
  logout: () => api.post('/platform/logout').then((r) => r.data),
  overview: () => api.get('/platform/overview').then((r) => r.data as PlatformOverview),
  features: () => api.get('/platform/features').then((r) => r.data as FeatureDef[]),
  /** The full Lead Information catalogue, for the toggle grid. */
  leadFieldCatalogue: () =>
    api.get('/platform/lead-fields').then((r) => r.data as LeadFieldGroup[]),
  updateLeadFields: (id: number, body: LeadFieldConfigPayload) =>
    api.patch(`/platform/tenants/${id}/lead-fields`, body).then((r) => r.data),

  /** The vertical presets a customer can be built from. */
  verticals: () => api.get('/platform/verticals').then((r) => r.data as VerticalPayload[]),
  /** This customer's terminology, resolved, with the defaults alongside. */
  terms: (id: number) =>
    api.get(`/platform/tenants/${id}/terms`).then((r) => r.data as TermDefPayload[]),
  /** Whole-map replace: send every term, so a cleared one is actually cleared. */
  updateTerms: (id: number, labels: Record<string, Partial<TermPayload>>) =>
    api.patch(`/platform/tenants/${id}/terms`, { labels }).then((r) => r.data),
  /**
   * Switch verticals. With `applyPreset` this OVERWRITES modules, lead fields
   * and terminology — confirm before calling it.
   */
  setVertical: (id: number, vertical: string, applyPreset: boolean) =>
    api.post(`/platform/tenants/${id}/vertical`, { vertical, applyPreset }).then((r) => r.data as Tenant),

  listTenants: () => api.get('/platform/tenants').then((r) => r.data as Tenant[]),
  getTenant: (id: number) => api.get(`/platform/tenants/${id}`).then((r) => r.data as TenantDetail),
  createTenant: (body: unknown) => api.post('/platform/tenants', body).then((r) => r.data as Tenant),
  updateTenant: (id: number, body: unknown) =>
    api.patch(`/platform/tenants/${id}`, body).then((r) => r.data as Tenant),
  updateLimits: (id: number, body: Partial<TenantLimits>) =>
    api.patch(`/platform/tenants/${id}/limits`, body).then((r) => r.data as Tenant),
  updateFeatures: (id: number, features: Record<string, boolean>) =>
    api.patch(`/platform/tenants/${id}/features`, { features }).then((r) => r.data as Tenant),
  suspend: (id: number, reason?: string) =>
    api.post(`/platform/tenants/${id}/suspend`, { reason }).then((r) => r.data),
  resume: (id: number) => api.post(`/platform/tenants/${id}/resume`).then((r) => r.data),
  extend: (id: number, months: number) =>
    api.post(`/platform/tenants/${id}/extend`, { months }).then((r) => r.data),
  deleteTenant: (id: number, confirm: string) =>
    api.delete(`/platform/tenants/${id}`, { data: { confirm } }).then((r) => r.data),
  migrateTenant: (id: number) => api.post(`/platform/tenants/${id}/migrate`).then((r) => r.data),

  /** Read-only: does this customer's schema still match prisma/schema.prisma? */
  drift: (id: number) =>
    api.get(`/platform/tenants/${id}/drift`).then((r) => r.data as SchemaDrift),
  /** Apply the difference. Refuses anything destructive. */
  reconcile: (id: number) =>
    api
      .post(`/platform/tenants/${id}/reconcile`)
      .then((r) => r.data as { message: string; applied: boolean }),

  tenantUsers: (id: number) =>
    api.get(`/platform/tenants/${id}/users`).then((r) => r.data as TenantDirectoryUser[]),
  resetUserPassword: (tenantId: number, userId: number) =>
    api
      .post(`/platform/tenants/${tenantId}/users/${userId}/reset-password`)
      .then((r) => r.data as { password: string; user: { name: string } }),
  rebuildDirectory: (id: number) =>
    api.post(`/platform/tenants/${id}/directory/rebuild`).then((r) => r.data),

  impersonate: (id: number) =>
    api.post(`/platform/tenants/${id}/impersonate`).then(
      (r) =>
        r.data as {
          token: string
          expiresInMinutes: number
          tenant: { id: number; slug: string; name: string }
          user: any
        },
    ),

  apiKeys: (id: number) => api.get(`/platform/tenants/${id}/api-keys`).then((r) => r.data),
  createApiKey: (id: number, name: string) =>
    api.post(`/platform/tenants/${id}/api-keys`, { name }).then((r) => r.data as { key: string }),
  revokeApiKey: (tenantId: number, keyId: number) =>
    api.delete(`/platform/tenants/${tenantId}/api-keys/${keyId}`).then((r) => r.data),

  platformUsers: () => api.get('/platform/users').then((r) => r.data),
  createPlatformUser: (body: { name: string; email: string; password: string }) =>
    api.post('/platform/users', body).then((r) => r.data),
  updatePlatformUser: (id: number, body: { status?: number; name?: string }) =>
    api.patch(`/platform/users/${id}`, body).then((r) => r.data),
  changeOwnPassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post('/platform/change-password', body).then((r) => r.data),

  audit: (params: { page?: number; limit?: number; tenantId?: number; action?: string } = {}) =>
    api.get('/platform/audit', { params }).then(
      (r) => r.data as { data: AuditEntry[]; total: number; page: number; totalPages: number },
    ),

  health: () => api.get('/platform/health').then((r) => r.data),
  migrateAll: () => api.post('/platform/health/migrate-all').then((r) => r.data),
  snapshotUsage: () => api.post('/platform/health/snapshot-usage').then((r) => r.data),
}

// ─── The customer's own view of their plan ────────────────────────────────────

export interface PlanResponse {
  tenant: { name: string; slug: string; planName: string; planExpiresAt: string | null; status: TenantStatus }
  features: Record<string, boolean>
  limits: TenantLimits
  usage: TenantUsage | null
  warnings: UsageWarning[]
}

export const planApi = {
  get: () => api.get('/settings/plan').then((r) => r.data as PlanResponse),
}

export type FilterOptionsResponse = {
  statusIds: string[]
  hasFresh: boolean
  subStatusIds: string[]
  websites: string[]
  states: string[]
  cities: string[]
  courses: string[]
  countries: string[]
  events: string[]
  sources: string[]
  maxLeadScore: number
}

export interface CatalogSendItem {
  id: number
  productId: number | null
  name: string
  description: string | null
  unitPrice: number
  imageUrl: string | null
}

export interface CatalogSend {
  id: number
  channel: 'email' | 'whatsapp'
  note: string | null
  createdAt: string
  items: CatalogSendItem[]
  sentBy?: { id: number; name: string } | null
}

export interface CatalogSendResult {
  send: CatalogSend
  channel: 'email' | 'whatsapp'
  email?: { status: 'sent' | 'failed'; error?: string }
  waUrl?: string
  text?: string
}

export const leadsApi = {
  list: (params?: Record<string, string>) =>
    api.get('/leads', { params }).then((r) => r.data),
  get: (id: number) => api.get(`/leads/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post('/leads', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/leads/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/leads/${id}`).then((r) => r.data),
  deletePermanent: (id: number) => api.delete(`/leads/${id}/permanent`).then((r) => r.data),
  restore: (id: number) => api.post(`/leads/${id}/restore`).then((r) => r.data),
  resetStatus: (id: number) => api.post(`/leads/${id}/reset-status`).then((r) => r.data),
  assign: (id: number, counsellorId: number) =>
    api.post(`/leads/${id}/assign`, { counsellorId }).then((r) => r.data),
  unassign: (id: number, counsellorId: number) =>
    api.delete(`/leads/${id}/assign/${counsellorId}`).then((r) => r.data),
  bulkAssign: (data: { leadIds: number[]; counsellorId: number }) =>
    api.post('/leads/bulk-assign', data).then((r) => r.data),
  bulkUnassign: (data: { leadIds: number[]; counsellorId?: number }) =>
    api.post('/leads/bulk-unassign', data).then((r) => r.data),
  bulkAssignees: (leadIds: number[]) =>
    api.post<{ assignees: Array<{ id: number; name: string; role: string | null; email: string | null; count: number }> }>(
      '/leads/bulk-assignees',
      { leadIds },
    ).then((r) => r.data),
  bulkStatus: (data: {
    leadIds: number[]
    leadStatusId?: number
    leadSubStatusId?: number
    departmentId?: number
    /** Subset ticked in the preview screen. Omit to apply to every leadId. */
    approvedIds?: number[]
  }) => api.post('/leads/bulk-status', data).then((r) => r.data),
  /** Dry run for bulk-status — the exact per-lead From → To the apply will do. */
  bulkStatusPreview: (data: {
    leadIds: number[]
    leadStatusId?: number
    leadSubStatusId?: number
    departmentId?: number
    page?: number
    limit?: number
  }): Promise<BulkStatusPreviewResponse> =>
    api.post('/leads/bulk-status/preview', data).then((r) => r.data),
  bulkUpdate: (data: { leadIds: number[]; data: Record<string, unknown> }) =>
    api.post('/leads/bulk-update', data).then((r) => r.data),
  bulkDelete: (leadIds: number[]) =>
    api.post('/leads/bulk-delete', { leadIds }).then((r) => r.data),
  bulkMove: (data: { leadIds: number[]; departmentId: number; statusLeadTypeId?: number }) =>
    api.post('/leads/bulk-move', data).then((r) => r.data),
  bulkRestore: (leadIds: number[]) =>
    api.post('/leads/bulk-restore', { leadIds }).then((r) => r.data),
  bulkPermanentDelete: (leadIds: number[]) =>
    api.post('/leads/bulk-permanent-delete', { leadIds }).then((r) => r.data),
  sendCatalog: (id: number, data: { productIds: number[]; channel: 'email' | 'whatsapp'; note?: string; templateId?: number }) =>
    api.post(`/leads/${id}/send-catalog`, data).then((r) => r.data as CatalogSendResult),
  catalogSends: (id: number) =>
    api.get(`/leads/${id}/catalog-sends`).then((r) => r.data as CatalogSend[]),
  emptyTrash: () =>
    api.post('/leads/empty-trash').then((r) => r.data as { message: string; deleted: number }),
  fieldUpdate: (data: { field: string; oldValues: string[]; newValue: string; approvedLeadIds?: number[] }) =>
    api.post('/leads/field-update', data).then((r) => r.data as { message: string; count: number; operationId: number }),
  fieldValues: <T extends boolean = false>(field: string, withCount?: T) =>
    api.get('/leads/field-values', { params: { field, withCount } }).then((r) => r.data as T extends true ? { value: string; count: number }[] : string[]),
  fieldPreview: (params: {
    field?: string
    filterField?: string
    writeField?: string
    oldValues: string[]
    newValue: string
    page?: number
    limit?: number
  }) =>
    api.get('/leads/field-preview', {
      params: {
        field: params.field,
        filterField: params.filterField,
        writeField: params.writeField,
        oldValues: params.oldValues.join(','),
        newValue: params.newValue,
        page: params.page ?? 1,
        limit: params.limit ?? 100,
      },
    }).then((r) => r.data as {
      data: Array<{ id: number; name: string; oldValue: string | null; filterValue: string | null; newValue: string }>
      total: number
      page: number
      limit: number
      totalPages: number
    }),
  filterOptions: (params?: Record<string, string>) =>
    api.get<FilterOptionsResponse>('/leads/filter-options', { params }).then((r) => r.data),
  bucketList: (params?: Record<string, string>) =>
    api.get('/leads/bucket', { params }).then((r) => r.data),
  bucketFacets: (params?: Record<string, string>) =>
    api.get('/leads/bucket/facets', { params }).then((r) => r.data),
  bucketClaim: (leadIds: number[]) =>
    api.post('/leads/bucket/claim', { leadIds }).then((r) => r.data),
  assignAll: (data: { counsellorId: number; fromDate?: string; toDate?: string }) =>
    api.post('/leads/assign-all', data).then((r) => r.data),
  unassignAll: (data: { counsellorId: number; fromDate?: string; toDate?: string }) =>
    api.post('/leads/unassign-all', data).then((r) => r.data),
  duplicates: (limit?: number, sortOrder?: string, search?: string) =>
    api.get('/leads/duplicates', { params: { ...(limit ? { limit } : {}), ...(sortOrder ? { sortOrder } : {}), ...(search ? { search } : {}) } }).then((r) => r.data),
  mergeLeads: (data: { keepId: number; mergeIds: number[] }) =>
    api.post('/leads/merge', data).then((r) => r.data),
  import: (leads: Record<string, string>[]) =>
    api.post('/leads/import', { leads }).then((r) => r.data),
  stats: (id: number) => api.get(`/leads/${id}/stats`).then((r) => r.data),
  exportCsv: (params?: Record<string, string>) =>
    api.get('/leads/export/csv', { params, responseType: 'blob' }).then((r) => r.data),
  exportSelected: (leadIds: number[]) =>
    api.post('/leads/export-selected', { leadIds }, { responseType: 'blob' }).then((r) => r.data),
  toggleCalled: (id: number) => api.post(`/leads/${id}/called`).then((r) => r.data),
  toggleWapp: (id: number) => api.post(`/leads/${id}/wapp`).then((r) => r.data),
  toggleFlag: (id: number, which?: 'send' | 'rcv', message?: string) =>
    api
      .post(
        `/leads/${id}/flag`,
        message ? { message } : {},
        { params: which ? { which } : {} },
      )
      .then((r) => r.data),
  flagMessages: (id: number, which?: 'send' | 'rcv') =>
    api
      .get(`/leads/${id}/flags`, { params: which ? { which } : {} })
      .then((r) => r.data),
  clearFlags: (id: number, which?: 'send' | 'rcv') =>
    api
      .delete(`/leads/${id}/flags`, { params: which ? { which } : {} })
      .then((r) => r.data),
  deleteFlagMessage: (msgId: number) =>
    api.delete(`/leads/flag-messages/${msgId}`).then((r) => r.data),
  flagged: () => api.get('/leads/flagged').then((r) => r.data),
  tabCounts: (params?: Record<string, string>) =>
    api.get('/leads/tab-counts', { params }).then((r) => r.data),
  departmentCounts: (params?: Record<string, string>) =>
    api.get('/leads/department-counts', { params }).then((r) => r.data),
  logCall: (
    id: number,
    data: {
      outcome: 'answered' | 'not_answered' | 'declined' | 'busy' | 'wrong_number' | 'switched_off'
      durationSeconds?: number
      notes?: string
    },
  ) => api.post(`/leads/${id}/call`, data).then((r) => r.data),
  calls: (id: number) => api.get(`/leads/${id}/calls`).then((r) => r.data),
  history: (id: number) => api.get(`/leads/${id}/history`).then((r) => r.data),
  timeline: (id: number) => api.get(`/leads/${id}/timeline`).then((r) => r.data),
  mails: (id: number) => api.get(`/leads/${id}/mails`).then((r) => r.data),
  documents: (id: number) => api.get(`/leads/${id}/documents`).then((r) => r.data),
  uploadDocument: (id: number, file: File, title?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post(`/leads/${id}/documents`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: title ? { title } : {},
    }).then((r) => r.data)
  },
  deleteDocument: (id: number, docId: number) =>
    api.delete(`/leads/${id}/documents/${docId}`).then((r) => r.data),
}


export const universityMailApi = {
  getHistory: (studentId: number) =>
    api.get(`/students/${studentId}/university-mail`).then((r) => r.data),
  getAll: (params?: {
    search?: string
    status?: string
    sentByUserId?: string
    universityName?: string
    startDate?: string
    endDate?: string
    page?: number
    limit?: number
  }) => api.get('/university-mails', { params }).then((r) => r.data),
  toggleOpened: (id: number) =>
    api.post(`/university-mails/${id}/toggle-opened`).then((r) => r.data),
  send: (
    studentId: number,
    data: {
      toEmail: string
      cc?: string
      greeting?: string
      recipientName?: string
      senderName?: string
      signatureId?: number | null
      program?: string
      universityName?: string
      subject?: string
      body: string
      selectedDocIds: number[]
    }
  ) => api.post(`/students/${studentId}/university-mail`, data).then((r) => r.data),
}

export const notesApi = {
  list: (leadId: number) => api.get('/notes', { params: { leadId } }).then((r) => r.data),
  create: (data: { leadId: number; note: string }) =>
    api.post('/notes', data).then((r) => r.data),
  delete: (id: number) => api.delete(`/notes/${id}`).then((r) => r.data),
}

export const notificationsApi = {
  feed: () => api.get('/notifications').then((r) => r.data),
  markRead: () => api.patch('/notifications/mark-read').then((r) => r.data),
}

export const commentsApi = {
  list: (leadId: number) => api.get('/comments', { params: { leadId } }).then((r) => r.data),
  last: (leadId: number) => api.get('/comments/last', { params: { leadId } }).then((r) => r.data),
  create: (data: { leadId: number; comment: string }) =>
    api.post('/comments', data).then((r) => r.data),
  bulk: (data: { leadIds: number[]; comment: string }) =>
    api.post('/comments/bulk', data).then((r) => r.data),
  delete: (id: number) => api.delete(`/comments/${id}`).then((r) => r.data),
}

export const inboxApi = {
  list: (params?: { leadId?: number; campaignId?: number; groupId?: number; unreadOnly?: 0 | 1; page?: number; limit?: number }) =>
    api.get('/inbox', { params }).then((r) => r.data),
  get: (id: number) => api.get(`/inbox/${id}`).then((r) => r.data),
  markRead: (id: number) => api.post(`/inbox/${id}/read`).then((r) => r.data),
  remove: (id: number) => api.delete(`/inbox/${id}`).then((r) => r.data),
  unreadCount: () => api.get('/inbox/counts/unread').then((r) => r.data),
  // Reply to an inbound mail — server threads via In-Reply-To/References and
  // sends via the account that originally received it.
  reply: (id: number, data: { subject: string; body: string; signatureId?: number | null; cc?: string; bcc?: string }) =>
    api.post(`/inbox/${id}/reply`, data).then((r) => r.data),
}

export const campaignsApi = {
  // Sender groups (admin)
  groups: () => api.get('/campaigns/groups').then((r) => r.data),
  createGroup: (data: Record<string, unknown>) => api.post('/campaigns/groups', data).then((r) => r.data),
  updateGroup: (id: number, data: Record<string, unknown>) =>
    api.patch(`/campaigns/groups/${id}`, data).then((r) => r.data),
  deleteGroup: (id: number) => api.delete(`/campaigns/groups/${id}`).then((r) => r.data),
  testGroup: (id: number) => api.post(`/campaigns/groups/${id}/test`).then((r) => r.data),

  // Campaigns
  preview: (data: Record<string, unknown>) => api.post('/campaigns/preview', data).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post('/campaigns', data).then((r) => r.data),
  list: () => api.get('/campaigns').then((r) => r.data),
  get: (id: number) => api.get(`/campaigns/${id}`).then((r) => r.data),
  pause: (id: number) => api.post(`/campaigns/${id}/pause`).then((r) => r.data),
  resume: (id: number) => api.post(`/campaigns/${id}/resume`).then((r) => r.data),
  cancel: (id: number) => api.post(`/campaigns/${id}/cancel`).then((r) => r.data),
}

export const remindersApi = {
  list: (leadId?: number) =>
    api.get('/reminders', { params: leadId ? { leadId } : {} }).then((r) => r.data),
  upcoming: () => api.get('/reminders/upcoming').then((r) => r.data),
  create: (data: { leadId: number; reminderDate: string; note?: string }) =>
    api.post('/reminders', data).then((r) => r.data),
  delete: (id: number) => api.delete(`/reminders/${id}`).then((r) => r.data),
}

export const leadConfigApi = {
  /** This customer's OWN lead types, seeded from their vertical. */
  types: () =>
    api.get('/lead-config/types').then(
      (r) => r.data as { id: number; slug: string; title: string; departmentId: number | null }[],
    ),
  createType: (data: Record<string, unknown>) => api.post('/lead-config/types', data).then((r) => r.data),
  updateType: (id: number, data: Record<string, unknown>) => api.patch(`/lead-config/types/${id}`, data).then((r) => r.data),
  deleteType: (id: number) => api.delete(`/lead-config/types/${id}`).then((r) => r.data),

  statuses: () => api.get('/lead-config/statuses').then((r) => r.data),
  createStatus: (data: Record<string, unknown>) => api.post('/lead-config/statuses', data).then((r) => r.data),
  updateStatus: (id: number, data: Record<string, unknown>) => api.patch(`/lead-config/statuses/${id}`, data).then((r) => r.data),
  deleteStatus: (id: number) => api.delete(`/lead-config/statuses/${id}`).then((r) => r.data),

  subStatuses: (statusId?: number) =>
    api.get('/lead-config/sub-statuses', { params: statusId ? { statusId } : {} }).then((r) => r.data),
  createSubStatus: (data: Record<string, unknown>) => api.post('/lead-config/sub-statuses', data).then((r) => r.data),
  updateSubStatus: (id: number, data: Record<string, unknown>) => api.patch(`/lead-config/sub-statuses/${id}`, data).then((r) => r.data),
  deleteSubStatus: (id: number) => api.delete(`/lead-config/sub-statuses/${id}`).then((r) => r.data),

  followupStatuses: () => api.get('/lead-config/followup-statuses').then((r) => r.data),
  createFollowupStatus: (data: Record<string, unknown>) => api.post('/lead-config/followup-statuses', data).then((r) => r.data),
  updateFollowupStatus: (id: number, data: Record<string, unknown>) => api.patch(`/lead-config/followup-statuses/${id}`, data).then((r) => r.data),
  deleteFollowupStatus: (id: number) => api.delete(`/lead-config/followup-statuses/${id}`).then((r) => r.data),

  workflow: () => api.get('/lead-config/workflow').then((r) => r.data),
  reorderDepartments: (items: { id: number; priority: number }[]) =>
    api.put('/lead-config/departments/reorder', { items }).then((r) => r.data),
  reorderTypes: (items: { id: number; priority: number }[]) =>
    api.put('/lead-config/types/reorder', { items }).then((r) => r.data),
  reorderStatuses: (items: { id: number; priority: number }[]) =>
    api.put('/lead-config/statuses/reorder', { items }).then((r) => r.data),
  departments: () => api.get('/lead-config/departments').then((r) => r.data),
  createDepartment: (data: Record<string, unknown>) => api.post('/lead-config/departments', data).then((r) => r.data),
  updateDepartment: (id: number, data: Record<string, unknown>) => api.patch(`/lead-config/departments/${id}`, data).then((r) => r.data),
  deleteDepartment: (id: number) => api.delete(`/lead-config/departments/${id}`).then((r) => r.data),
}

export const branchesApi = {
  list: () => api.get('/branches').then((r) => r.data),
  create: (data: { name: string; city?: string; state?: string; country?: string }) =>
    api.post('/branches', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/branches/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/branches/${id}`).then((r) => r.data),
}

export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  setPageLimit: (limit: number) => api.patch('/settings/page-limit', { limit }).then((r) => r.data),
  setLetterhead: (body: Record<string, string>) => api.patch('/settings', body).then((r) => r.data as Record<string, string>),
}

export interface InactivityStatus {
  enabled: boolean
  stage: 'ok' | 'warning' | 'alert' | 'halfday'
  inactiveSeconds: number
  thresholds: { warning: number; alert: number; halfday: number }
  lastActivityAt: string | null
  lastActivitySource: 'web' | 'mobile' | null
  onCall: boolean
  onCallSince: string | null
  pendingEvent: { id: number; kind: 'alert' | 'halfday'; raisedAt: string } | null
}

export interface InactivityMeEvent {
  id: number
  kind: 'warning' | 'alert' | 'halfday'
  raisedAt: string
  ackAt: string | null
  inactiveSeconds: number
}

export interface InactivityMe {
  enabled: boolean
  config: { warningMinutes: number; alertMinutes: number; halfdayMinutes: number }
  status: InactivityStatus
  todayCounts: { warning: number; alert: number; halfday: number }
  todayEvents: InactivityMeEvent[]
  recentEvents: InactivityMeEvent[]
}

export interface InactivityConfig {
  enabled: boolean
  warningMinutes: number
  alertMinutes: number
  halfdayMinutes: number
}

export interface InactivitySummaryRow {
  userId: number
  name: string
  email: string
  mobile: string | null
  role: string
  branchId: number | null
  lastActivityAt: string | null
  lastActivitySource: 'web' | 'mobile' | null
  inactiveSeconds: number | null
  currentStage: 'ok' | 'warning' | 'alert' | 'halfday' | 'unknown'
  onCall: boolean
  onCallSince: string | null
  counts: { warning: number; alert: number; halfday: number }
  total: number
}

export interface InactivitySummary {
  from: string
  to: string
  enabled: boolean
  thresholds: { warning: number; alert: number; halfday: number }
  rows: InactivitySummaryRow[]
}

export interface InactivityEventRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  kind: 'warning' | 'alert' | 'halfday'
  raisedAt: string
  ackAt: string | null
  inactiveSeconds: number
}

export interface LoginLogRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  userRole: string
  ip: string | null
  browser: string | null
  os: string | null
  createdAt: string
}

export const activityApi = {
  status: () => api.get('/activity/status').then((r) => r.data as InactivityStatus),
  ping: () => api.post('/activity/ping').then((r) => r.data),
  ack: () => api.post('/activity/ack').then((r) => r.data as { acknowledged: number }),
  config: () => api.get('/activity/config').then((r) => r.data as InactivityConfig),
  saveConfig: (data: Partial<InactivityConfig>) =>
    api.patch('/activity/config', data).then((r) => r.data as InactivityConfig),
  summary: (params?: { from?: string; to?: string; branchId?: number }) =>
    api.get('/activity/summary', { params }).then((r) => r.data as InactivitySummary),
  events: (params?: {
    userId?: number
    kind?: string
    limit?: number
    from?: string
    to?: string
  }) => api.get('/activity/events', { params }).then((r) => r.data as InactivityEventRow[]),
  me: () => api.get('/activity/me').then((r) => r.data as InactivityMe),
  loginLogs: (params?: {
    userId?: number
    role?: string
    q?: string
    from?: string
    to?: string
    page?: number
    limit?: number
    adminOnly?: boolean
  }) =>
    api.get('/activity/login-logs', { params }).then((r) => r.data as {
      data: LoginLogRow[]
      total: number
      page: number
      limit: number
      totalPages: number
      stats?: {
        totalLogins: number
        uniqueUsers: number
        webLogins: number
        appLogins: number
      }
    }),
  loginLogUsers: () =>
    api.get('/activity/login-log-users').then((r) => r.data as Array<{
      id: number
      name: string
      email: string
      role: string
    }>),
}

export interface SuperAdminOverview {
  metrics: { totalUsers: number; activeUsers: number; totalBranches: number; activeBranches: number; totalLeads: number; todayLeads: number; overdueFollowups: number; enrolledStudents: number }
  staffByRole: Array<{ role: string; count: number }>
  branches: Array<{ id: number; name: string; city: string | null; activeUsers: number }>
  recentLogins: Array<{ at: string; ip: string | null; user: { id: number; name: string; role: string; branch: string | null } }>
}

export const dashboardApi = {
  superAdmin: () => api.get('/dashboard/super-admin').then((r) => r.data as SuperAdminOverview),
  stats: () => api.get('/dashboard/stats').then((r) => r.data),
  leadsByStatus: () => api.get('/dashboard/leads-by-status').then((r) => r.data),
  leadsBySource: () => api.get('/dashboard/leads-by-source').then((r) => r.data),
  todayBySource: () => api.get('/dashboard/today-by-source').then((r) => r.data),
  leadsTrend: (period?: string) =>
    api.get('/dashboard/leads-trend', { params: { period } }).then((r) => r.data),
  leadsTrendByWebsite: (period?: string, top?: number) =>
    api.get('/dashboard/leads-trend-by-website', { params: { period, top } }).then((r) => r.data),
  monthWise: (website?: string) =>
    api.get('/dashboard/month-wise', { params: website ? { website } : {} }).then((r) => r.data),
  sourceBreakdown: (website?: string) =>
    api.get('/dashboard/source-breakdown', { params: website ? { website } : {} }).then((r) => r.data),
  websiteBreakdown: () => api.get('/dashboard/website-breakdown').then((r) => r.data),
  yearComparison: (params?: { years?: string; website?: string }) =>
    api.get('/dashboard/year-comparison', { params }).then((r) => r.data),
  assignedToday: (params?: { limit?: number }) =>
    api.get('/dashboard/assigned-today', { params }).then((r) => r.data as {
      total: number
      data: Array<{
        id: number
        name: string
        mobile: string | null
        email: string | null
        city: string | null
        followupDate: string | null
        called?: number
        wapp?: number
        leadStatus: string | null
        leadSubStatus: string | null
        assignedAt: string
        counsellor?: { id: number; name: string }
      }>
    }),
}

export interface FollowupLead {
  id: number
  name: string
  mobile?: string | null
  email?: string | null
  leadStatus?: string | null
  leadSubStatus?: string | null
  followupDate?: string | null
  lastComment?: string | null
  lastNote?: string | null
}
export interface PaginatedFollowups {
  data: FollowupLead[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export const followupsApi = {
  list: (leadId: number) =>
    api.get('/followups', { params: { leadId } }).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post('/followups', data).then((r) => r.data),
  today: (params?: { page?: number; limit?: number; userId?: number; date?: string }) =>
    api.get('/followups/today', { params }).then((r) => r.data as PaginatedFollowups),
  overdue: (params?: { page?: number; limit?: number; userId?: number; date?: string }) =>
    api.get('/followups/overdue', { params }).then((r) => r.data as PaginatedFollowups),
  upcoming: (params?: { page?: number; limit?: number; userId?: number; date?: string }) =>
    api.get('/followups/upcoming', { params }).then((r) => r.data as PaginatedFollowups),
  pendingCounts: (userId?: number) =>
    api.get('/followups/pending-counts', { params: { userId } }).then((r) => r.data as { overdue: number; today: number; upcoming: number }),
  range: (from: string, to: string, counsellorId?: number) =>
    api.get('/followups/range', { params: { from, to, counsellorId } }).then((r) => r.data),
  bulk: (data: {
    leadIds: number[]
    comment: string
    followupDate?: string
    leadStatusId?: number
    leadSubStatusId?: number
  }) => api.post('/followups/bulk', data).then((r) => r.data),
}

export const usersApi = {
  list: (params?: { role?: string; includeInactive?: 0 | 1 }) =>
    api.get('/users', { params }).then((r) => r.data),
  counsellors: () => api.get('/users/counsellors').then((r) => r.data),
  // Same list plus deactivated staff, each tagged with `active` — used by the
  // lead-assignment screen so a counsellor who has left is visible, not missing.
  counsellorsWithInactive: () => api.get('/users/counsellors', { params: { includeInactive: 1 } }).then((r) => r.data),
  get: (id: number) => api.get(`/users/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post('/users', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/users/${id}`, data).then((r) => r.data),
  deactivate: (id: number) => api.delete(`/users/${id}`).then((r) => r.data),
  toggleStatus: (id: number) =>
    api.patch(`/users/${id}/toggle-status`).then((r) => r.data),
  changeRole: (id: number, role: string) =>
    api.patch(`/users/${id}/role`, { role }).then((r) => r.data as { id: number; role: string }),
  resetPassword: (id: number, password: string) =>
    api.patch(`/users/${id}/password`, { password }).then((r) => r.data),
  leadCount: (id: number) =>
    api.get(`/users/${id}/lead-count`).then((r) => r.data as { total: number; today: number; thisMonth: number }),
  // Branch access for branch-scoped managers (sub-admin / sales-head).
  branchAccess: (id: number) =>
    api.get(`/users/${id}/branch-access`).then((r) => r.data as number[]),
  setBranchAccess: (id: number, branchIds: number[]) =>
    api.put(`/users/${id}/branch-access`, { branchIds }).then((r) => r.data as { userId: number; branchIds: number[] }),
  uploadPhoto: (id: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api
      .post(`/users/${id}/photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data as { id: number; imgpath: string | null })
  },
  removePhoto: (id: number) =>
    api.delete(`/users/${id}/photo`).then((r) => r.data),
  activity: (id: number, date?: string) =>
    api.get(`/users/${id}/activity`, { params: { date } }).then((r) => r.data as UserActivity),
  locations: (id: number, params?: { before?: string; date?: string; limit?: number }) =>
    api.get(`/locations/users/${id}`, { params }).then((r) => r.data as UserLocationTimeline),
  locationStatus: () =>
    api.get('/locations/status').then((r) => r.data as { counsellors: CounsellorLocationStatus[] }),
}

export interface UserLocationPoint {
  id: number
  latitude: number
  longitude: number
  accuracyM: number | null
  altitudeM: number | null
  speedMps: number | null
  bearingDeg: number | null
  recordedAt: string
}

export interface UserLocationTimeline {
  points: UserLocationPoint[]
  nextBefore: string | null
}

export interface CounsellorLocationStatus {
  id: number
  name: string
  role: string
  locationRequired: boolean
  state: 'live' | 'stale' | 'never'
  lastSeenAt: string | null
  lastLatitude: number | null
  lastLongitude: number | null
  lastBearingDeg: number | null
  blockReason: string | null
  permissions: CounsellorDevicePermissions | null
}

export interface CounsellorDevicePermissions {
  location: boolean
  backgroundLocation: boolean
  gps: boolean
  battery: boolean
  callPhone: boolean
  phoneState: boolean
  callLog: boolean
  recordAudio: boolean
  notifications: boolean
  reportedAt: string
}

export interface UserActivityTimelineItem {
  type: 'call' | 'followup' | 'note' | 'comment' | 'status'
  at: string
  leadId: number | null
  leadName: string | null
  summary: string
  source: 'web' | 'app' | null
  // call-only (set when there's no matching lead)
  phoneNumber?: string | null
  // followup-only
  oldFollowupDate?: string | null
  newFollowupDate?: string | null
  description?: string | null
  followupType?: string | null
  // status-only
  fromStatus?: string | null
  toStatus?: string | null
  fromSubStatus?: string | null
  toSubStatus?: string | null
  reason?: string | null
}

export interface UserActivity {
  date: string
  backlog: { overdue: number; dueToday: number; upcoming: number }
  device: {
    platform: string
    appVersion: string | null
    deviceId: string
    lastSeenAt: string
  } | null
  lastLoginWeb: { ip: string | null; browser: string | null; createdAt: string } | null
  lastLoginApp: { ip: string | null; os: string | null; createdAt: string } | null
  timeline: UserActivityTimelineItem[]
}

export const dailyReportsApi = {
  list: (params?: { userId?: number; fromDate?: string; toDate?: string }) =>
    api.get('/daily-reports', { params }).then((r) => r.data),
  today: () => api.get('/daily-reports/today').then((r) => r.data),
  upsert: (data: {
    summary: string
    challenges?: string
    tomorrowPlan?: string
    leadsContacted?: number
    callsMade?: number
    meetingsHeld?: number
    enrollments?: number
    reportDate?: string
  }) => api.post('/daily-reports', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/daily-reports/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/daily-reports/${id}`).then((r) => r.data),
  teamSummary: (date?: string) =>
    api.get('/daily-reports/team-summary', { params: { date } }).then((r) => r.data as TeamActivitySummary),
}

export interface TeamActivitySummaryRow {
  userId: number
  name: string
  designation: string | null
  role: string
  pipeline?: {
    active: number
    enrolled: number
    convRate: string
    stale: number
  }
  backlog: { overdue: number; dueToday: number; upcoming: number }
  activity?: {
    newLeads: number
    followupsDone: number
    statusChanges: number
  }
  calls?: {
    total: number
    answered: number
    unanswered: number
    talkSec: number
    talkTimeFormatted: string
  }
  callsToday: number
  followupsToday: number
  statusChangesToday: number
}

export interface TeamActivitySummary {
  date: string
  rows: TeamActivitySummaryRow[]
}

export const communicationApi = {
  // Brand
  brand: (): Promise<{ letterhead: string }> => api.get('/communication/brand').then((r) => r.data),
  // Aggregate quick-send stats for the Reports tab (parallel to campaigns.list)
  quickSendStats: (): Promise<{ total: number; sent: number; failed: number; pending: number; opened: number; replied: number }> =>
    api.get('/communication/quick-send-stats').then((r) => r.data),
  // Unified mail funnel — combines scheduled campaigns and quick sends into
  // one row of totals so the Reports tab shows a single pipeline.
  mailReportsSummary: (): Promise<{
    total: number; queued: number; pending: number; sent: number;
    opened: number; replied: number; failed: number; bounced: number;
  }> => api.get('/communication/mail-reports/summary').then((r) => r.data),
  // Drill-down list for a funnel tile — merged across both sources.
  mailReportsDrilldown: (bucket: 'total' | 'queued' | 'pending' | 'sent' | 'opened' | 'replied' | 'failed' | 'bounced', limit = 200): Promise<{
    bucket: string
    rows: {
      source: 'quick' | 'campaign'
      id: number
      leadId: number | null
      toEmail: string
      toName: string | null
      subject: string
      status: string | null
      sentAt: string | null
      openedAt: string | null
      repliedAt: string | null
      errorMessage: string | null
      createdAt: string
      campaignId: number | null
      campaignName: string | null
      group: { id: number; name: string; fromEmail: string } | null
    }[]
  }> => api.get('/communication/mail-reports/drilldown', { params: { bucket, limit } }).then((r) => r.data),
  // Token catalog for the template/signature editors
  tokens: (): Promise<{ key: string; label: string; sample: string }[]> =>
    api.get('/communication/tokens').then((r) => r.data),
  // Image upload — used by the template/signature editor to insert <img> tags
  uploadImage: (file: File): Promise<{ url: string; filename: string }> => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/communication/upload-image', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  // Templates
  templates: () => api.get('/communication/templates').then((r) => r.data),
  createTemplate: (data: Record<string, unknown>) =>
    api.post('/communication/templates', data).then((r) => r.data),
  updateTemplate: (id: number, data: Record<string, unknown>) =>
    api.patch(`/communication/templates/${id}`, data).then((r) => r.data),
  deleteTemplate: (id: number) =>
    api.delete(`/communication/templates/${id}`).then((r) => r.data),
  // Send
  send: (data: Record<string, unknown>) =>
    api.post('/communication/send', data).then((r) => r.data),
  sendBulk: (data: Record<string, unknown>) =>
    api.post('/communication/send-bulk', data).then((r) => r.data),
  sendBulkByFilter: (data: {
    subject: string
    body: string
    signatureId?: number
    groupId?: number
    departmentId?: number
    leadStatusId?: number
    leadSubStatusId?: number
    statusLeadTypeId?: number
    website?: string
    source?: string
    country?: string
    city?: string
    intrestedCourse?: string
    fromDate?: string
    toDate?: string
    search?: string
    all?: boolean
    cc?: string
    bcc?: string
  }) => api.post('/communication/send-bulk-by-filter', data).then((r) => r.data),
  // Signatures
  signatures: () => api.get('/communication/signatures').then((r) => r.data),
  createSignature: (data: { title: string; content: string }) =>
    api.post('/communication/signatures', data).then((r) => r.data),
  updateSignature: (id: number, data: { title?: string; content?: string }) =>
    api.patch(`/communication/signatures/${id}`, data).then((r) => r.data),
  deleteSignature: (id: number) =>
    api.delete(`/communication/signatures/${id}`).then((r) => r.data),
  setDefaultSignature: (id: number) =>
    api.post(`/communication/signatures/${id}/set-default`).then((r) => r.data),
  // Email Headers (Sender emails)
  headers: () => api.get('/communication/headers').then((r) => r.data),
  createHeader: (data: { name: string; email: string }) =>
    api.post('/communication/headers', data).then((r) => r.data),
  updateHeader: (id: number, data: { name?: string; email?: string }) =>
    api.patch(`/communication/headers/${id}`, data).then((r) => r.data),
  deleteHeader: (id: number) =>
    api.delete(`/communication/headers/${id}`).then((r) => r.data),
  setDefaultHeader: (id: number) =>
    api.post(`/communication/headers/${id}/set-default`).then((r) => r.data),
  // Sent history
  sent: (params?: { leadId?: number; page?: number; limit?: number; search?: string; source?: 'direct' | 'campaign' }) =>
    api.get('/communication/sent', { params }).then((r) => r.data),
  sentExport: (params?: { search?: string; source?: 'direct' | 'campaign' }) =>
    api.get('/communication/sent/export', { params, responseType: 'blob' }).then((r) => r.data as Blob),
  // Inbox (IMAP)
  folders: () => api.get('/communication/folders').then((r) => r.data),
  inbox: (params?: { folder?: string; page?: number; limit?: number }) =>
    api.get('/communication/inbox', { params }).then((r) => r.data),
  inboxMessage: (uid: number, folder = 'INBOX') =>
    api.get(`/communication/inbox/${uid}`, { params: { folder } }).then((r) => r.data),
  inboxMarkSeen: (uid: number, seen: boolean, folder = 'INBOX') =>
    api.patch(`/communication/inbox/${uid}/seen`, { seen }, { params: { folder } }).then((r) => r.data),
  inboxDelete: (uid: number, folder = 'INBOX') =>
    api.delete(`/communication/inbox/${uid}`, { params: { folder } }).then((r) => r.data),
}

export const tasksApi = {
  list: () => api.get('/tasks').then((r) => r.data),
  create: (data: { title: string; description?: string; assignedToId: number; dueDate?: string; priority?: string }) =>
    api.post('/tasks', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/tasks/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/tasks/${id}`).then((r) => r.data),
}

export const leadWorkApi = {
  workboard: (date: string) => api.get('/lead-work/workboard', { params: { date } }).then((r) => r.data),
  // Cohort for a date window, or — with no from/to — every lead, newest first
  // and capped server-side. Backs the task builder's presets and All-time view.
  // `days` (comma-separated) is the "Add date" selection and wins over from/to.
  cohort: (params: { days?: string; from?: string; to?: string; limit?: number }) =>
    api.get('/lead-work/cohort', { params }).then((r) => r.data),
  history: (date: string, days = 14) => api.get('/lead-work/history', { params: { date, days } }).then((r) => r.data),
  callQuality: (date: string) => api.get('/lead-work/call-quality', { params: { date } }).then((r) => r.data),
  batches: () => api.get('/lead-work/batches').then((r) => r.data),
  // Per-counsellor load for ONE work date. Far cheaper than batches(), which
  // hydrates every task that has ever existed.
  workload: (date: string) => api.get('/lead-work/workload', { params: { date } }).then((r) => r.data),
  // `leadDate` is only sent by the task builder, where every lead comes from one
  // created-date cohort. Hand-picked tasks from the leads list omit it.
  createBatch: (data: { leadIds: number[]; assignedToId: number; leadDate?: string; workDate?: string; dueDate?: string; title?: string; priority?: string; workType?: 'INITIAL_CALL' | 'FOLLOWUP'; notes?: string; keepExistingOwners?: boolean }) => api.post('/lead-work/batches', data).then((r) => r.data),
  assignOwner: (data: { leadId: number; counsellorId: number }) => api.post('/lead-work/assign-owner', data).then((r) => r.data),
  deleteBatch: (id: number) => api.delete(`/lead-work/batches/${id}`).then((r) => r.data),
  // Manual completion for a single task item. Reason writes a real CallLog row
  // so the mark shows on the lead and in the performance report — not a hidden flag.
  markItemDone: (itemId: number, data: { reason: 'answered' | 'no_answer' | 'busy' | 'wrong_number' | 'dnd' | 'switched_off' | 'other'; notes?: string }) =>
    api.post(`/lead-work/items/${itemId}/mark-done`, data).then((r) => r.data),
  undoItemDone: (itemId: number) => api.post(`/lead-work/items/${itemId}/undo-done`).then((r) => r.data),
  // "Why isn't this marked?" — snapshot of every call, follow-up and status
  // change the auto-derivation considered, with a short list of reasons.
  diagnoseItem: (itemId: number) => api.get(`/lead-work/items/${itemId}/diagnose`).then((r) => r.data),
}

export const leavesApi = {
  list: () => api.get('/leaves').then((r) => r.data),
  create: (data: { fromDate: string; toDate: string; reason: string }) =>
    api.post('/leaves', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/leaves/${id}`, data).then((r) => r.data),
  review: (id: number, data: { status: 'approved' | 'rejected'; approvalNote?: string }) =>
    api.patch(`/leaves/${id}/review`, data).then((r) => r.data),
}

export interface AnnouncementDto {
  id: number
  title: string
  description: string
  createdAt: string
  updatedAt: string
  createdBy?: { id: number; name: string }
  readByMe: boolean
  readAt: string | null
}

export const announcementsApi = {
  list: (): Promise<AnnouncementDto[]> => api.get('/announcements').then((r) => r.data),
  create: (data: { title: string; description: string }) =>
    api.post('/announcements', data).then((r) => r.data),
  update: (id: number, data: { title?: string; description?: string }) =>
    api.patch(`/announcements/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/announcements/${id}`).then((r) => r.data),
  markRead: (id: number): Promise<{ readAt: string }> =>
    api.post(`/announcements/${id}/read`).then((r) => r.data),
}

export const chatApi = {
  users: () => api.get('/chat/users').then((r) => r.data),
  messages: (withUserId: number) =>
    api.get('/chat/messages', { params: { withUserId } }).then((r) => r.data),
  send: (data: { toId: number; message: string }) =>
    api.post('/chat/messages', data).then((r) => r.data),
  markSeen: (fromId: number) =>
    api.patch('/chat/messages/seen', { fromId }).then((r) => r.data),
  toggleLock: (id: number) =>
    api.patch(`/chat/messages/${id}/lock`).then((r) => r.data),
  unreadCount: () =>
    api.get('/chat/unread-count').then((r) => r.data as { count: number }),
}

export const agentsApi = {
  list: () => api.get('/agents').then((r) => r.data),
  get: (id: number) => api.get(`/agents/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post('/agents', data).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/agents/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/agents/${id}`).then((r) => r.data),
}

export const eventsApi = {
  list: (params?: { from?: string; to?: string; counsellorId?: number }) =>
    api.get('/events', { params }).then((r) => r.data),
  create: (data: { title: string; startDate: string; description?: string }) =>
    api.post('/events', data).then((r) => r.data),
  delete: (id: number) => api.delete(`/events/${id}`).then((r) => r.data),
}

export const financialApi = {
  invoices: (params?: { studentId?: number; status?: string }) =>
    api.get('/financial/invoices', { params }).then((r) => r.data),
  getInvoice: (id: number) => api.get(`/financial/invoices/${id}`).then((r) => r.data),
  createInvoice: (data: Record<string, unknown>) =>
    api.post('/financial/invoices', data).then((r) => r.data),
  updateInvoice: (id: number, data: Record<string, unknown>) =>
    api.patch(`/financial/invoices/${id}`, data).then((r) => r.data),
  deleteInvoice: (id: number) => api.delete(`/financial/invoices/${id}`).then((r) => r.data),
  invoicePdf: (id: number) =>
    api.get(`/financial/invoices/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
  createPayment: (data: { invoiceId: number; amount: number; method?: string; note?: string }) =>
    api.post('/financial/payments', data).then((r) => r.data),
  deletePayment: (id: number) => api.delete(`/financial/payments/${id}`).then((r) => r.data),
}

export const studentsApi = {
  list: (params?: Record<string, string>) =>
    api.get('/students', { params }).then((r) => r.data),
  get: (id: number) => api.get(`/students/${id}`).then((r) => r.data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/students/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/students/${id}`).then((r) => r.data),
  updateInfo: (id: number, data: Record<string, unknown>) =>
    api.patch(`/students/${id}/info`, data).then((r) => r.data),
  updatePersonal: (id: number, data: Record<string, unknown>) =>
    api.patch(`/students/${id}/personal`, data).then((r) => r.data),
  updateEducation: (id: number, data: Record<string, unknown>) =>
    api.patch(`/students/${id}/education`, data).then((r) => r.data),
  documents: (id: number) => api.get(`/students/${id}/documents`).then((r) => r.data),
  uploadDocument: (id: number, file: File, title?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (title) fd.append('title', title)
    return api.post(`/students/${id}/documents`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
  deleteDocument: (id: number, docId: number) =>
    api.delete(`/students/${id}/documents/${docId}`).then((r) => r.data),
  enroll: (leadId: number, data?: Record<string, unknown>) =>
    api.post(`/students/enroll/${leadId}`, data || {}).then((r) => r.data),
  invoices: (id: number) => api.get(`/students/${id}/invoices`).then((r) => r.data),

  // School history
  schoolHistory: (id: number) =>
    api.get(`/students/${id}/school`).then((r) => r.data),
  addSchool: (id: number, data: Record<string, unknown>) =>
    api.post(`/students/${id}/school`, data).then((r) => r.data),
  updateSchool: (id: number, rowId: number, data: Record<string, unknown>) =>
    api.patch(`/students/${id}/school/${rowId}`, data).then((r) => r.data),
  deleteSchool: (id: number, rowId: number) =>
    api.delete(`/students/${id}/school/${rowId}`).then((r) => r.data),

  // Exams (single record per student → upsert via PUT)
  ucat: (id: number) => api.get(`/students/${id}/ucat`).then((r) => r.data),
  saveUcat: (id: number, data: Record<string, unknown>) =>
    api.put(`/students/${id}/ucat`, data).then((r) => r.data),
  deleteUcat: (id: number) => api.delete(`/students/${id}/ucat`).then((r) => r.data),

  dmat: (id: number) => api.get(`/students/${id}/dmat`).then((r) => r.data),
  saveDmat: (id: number, data: Record<string, unknown>) =>
    api.put(`/students/${id}/dmat`, data).then((r) => r.data),
  deleteDmat: (id: number) => api.delete(`/students/${id}/dmat`).then((r) => r.data),

  sat: (id: number) => api.get(`/students/${id}/sat`).then((r) => r.data),
  saveSat: (id: number, data: Record<string, unknown>) =>
    api.put(`/students/${id}/sat`, data).then((r) => r.data),
  deleteSat: (id: number) => api.delete(`/students/${id}/sat`).then((r) => r.data),

  // Feedback (multi-record)
  feedback: (id: number) => api.get(`/students/${id}/feedback`).then((r) => r.data),
  addFeedback: (id: number, data: { feedback: string; rating?: number }) =>
    api.post(`/students/${id}/feedback`, data).then((r) => r.data),
  updateFeedback: (id: number, fbId: number, data: { feedback?: string; rating?: number | null }) =>
    api.patch(`/students/${id}/feedback/${fbId}`, data).then((r) => r.data),
  deleteFeedback: (id: number, fbId: number) =>
    api.delete(`/students/${id}/feedback/${fbId}`).then((r) => r.data),
}

export interface SourceCallMetric {
  source: string
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  talkTimeSec: number
}

export interface DepartmentCallMetric {
  departmentName: string
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  talkTimeSec: number
}

export const reportsApi = {
  overview: (params?: { fromDate?: string; toDate?: string; intrestedCourse?: string }) =>
    api.get('/reports/overview', { params }).then((r) => r.data),
  counsellorStats: () =>
    api.get('/reports/counsellor-stats').then((r) => r.data),
  counsellorPerformance: (params: { range: string; fromDate?: string; toDate?: string }) =>
    api.get('/reports/counsellor-performance', { params }).then((r) => r.data),
  counsellorPerformanceDetail: (id: number, date?: string) =>
    api.get(`/reports/counsellor/${id}/performance-detail`, { params: { date } }).then((r) => r.data),
  bySource: (website: string) =>
    api.get(`/reports/by-source/${encodeURIComponent(website)}`).then((r) => r.data),
  sourceDetail: (params?: { website?: string; event?: string; fromDate?: string; toDate?: string; intrestedCourse?: string }) =>
    api.get('/reports/source-detail', { params }).then((r) => r.data),
  /** Pipeline by stage and rep, quotes sent vs accepted, invoiced vs collected. B2B only. */
  b2b: (months = 6) => api.get('/reports/b2b', { params: { months } }).then((r) => r.data),
}

export const callsApi = {
  list: (params?: { leadId?: number; userId?: number; status?: string; direction?: string; source?: string; departmentId?: number; leadStatus?: string; q?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }) =>
    api.get('/calls', { params }).then((r) => r.data),
  summary: (params?: { userId?: number; status?: string; direction?: string; source?: string; departmentId?: number; leadStatus?: string; q?: string; fromDate?: string; toDate?: string }) =>
    api.get('/calls/summary', { params }).then((r) => r.data),
  trigger: (data: { leadId: number; counsellorId?: number }) =>
    api.post('/calls/trigger', data).then((r) => r.data),
  recordingUrl: (id: number) => {
    const token = useAuthStore.getState().token
    return `/api/calls/${id}/recording${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
}

export const appReleasesApi = {
  list: () => api.get('/app-releases').then((r) => r.data),
  latest: () => api.get('/app-releases/latest').then((r) => r.data),
  upload: (data: { apk: File; versionCode: number; versionName: string; releaseNotes?: string; isMandatory?: boolean }) => {
    const fd = new FormData()
    fd.append('apk', data.apk)
    fd.append('versionCode', String(data.versionCode))
    fd.append('versionName', data.versionName)
    if (data.releaseNotes) fd.append('releaseNotes', data.releaseNotes)
    fd.append('isMandatory', data.isMandatory ? 'true' : 'false')
    return api.post('/app-releases', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  delete: (id: number) => api.delete(`/app-releases/${id}`).then((r) => r.data),
  publish: (id: number, isPublished: boolean) =>
    api.patch(`/app-releases/${id}/publish`, { isPublished }).then((r) => r.data),
  /**
   * Fetched as a blob so the JWT rides in the Authorization header like every
   * other call. The old downloadUrl() put the raw session token in the query
   * string, which lands it in nginx access logs, browser history and any
   * Referer — a full admin token, sitting in plaintext in several places.
   */
  download: (id: number) =>
    api.get(`/app-releases/${id}/download`, { responseType: 'blob' }).then((r) => r.data as Blob),
}

export const leadSourcesApi = {
  list: () => api.get('/lead-sources').then((r) => r.data),
  create: (data: { slug: string; name: string; ipAllowlist?: string[]; defaultDepartmentId?: number; defaultLeadStatus?: string; generateHmacSecret?: boolean }) =>
    api.post('/lead-sources', data).then((r) => r.data),
  patch: (id: number, data: Record<string, unknown>) =>
    api.patch(`/lead-sources/${id}`, data).then((r) => r.data),
  rotateKey: (id: number) =>
    api.post(`/lead-sources/${id}/rotate-key`).then((r) => r.data),
  delete: (id: number) => api.delete(`/lead-sources/${id}`).then((r) => r.data),
  logs: (id: number, page = 1, limit = 50, search = '') =>
    api.get(`/lead-sources/${id}/logs`, { params: { page, limit, search } }).then((r) => r.data),
  seedLog: (logId: number | string) =>
    api.post(`/lead-sources/logs/${logId}/seed`).then((r) => r.data),
  stats: (id: number) => api.get(`/lead-sources/${id}/stats`).then((r) => r.data),
}

// ─── Lead Staging (Filter Leads) ───────────────────────────────────────────
export interface LeadStagingItem {
  id: number
  batchId: number
  name: string
  email: string | null
  phone: string | null
  father: string | null
  mother: string | null
  email2: string | null
  email3: string | null
  mobile2: string | null
  mobile3: string | null
  fatherMobile: string | null
  motherMobile: string | null
  city: string | null
  state: string | null
  country: string | null
  pincode: string | null
  dob: string | null
  gender: string | null
  nationality: string | null
  intrestedCourse: string | null
  intrestedUniversity: string | null
  event: string | null
  source: string | null
  leadType: string | null
  leadComment: string | null
  verified: boolean | null
  callNotAnswered: boolean
  comments: string | null
  // Author attribution — set when a counsellor adds a comment or marks the
  // verification state. After seeding, the lead is assigned only to the
  // verifier, so the UI surfaces "by <name>" to make ownership visible.
  commentedBy?: { id: number; name: string } | null
  verifiedBy?: { id: number; name: string } | null
  seeded: boolean
  leadId: number | null
  createdAt: string
  updatedAt: string
}
export interface LeadStagingUploadRow {
  name: string
  email?: string
  phone?: string
  father?: string
  mother?: string
  email2?: string
  email3?: string
  mobile2?: string
  mobile3?: string
  fatherMobile?: string
  motherMobile?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  dob?: string
  gender?: string
  nationality?: string
  intrestedCourse?: string
  intrestedUniversity?: string
  event?: string
  source?: string
  leadType?: string
  leadComment?: string
}
export interface LeadStagingAssignee { id: number; name: string }

export interface LeadStagingBatch {
  id: number
  name: string
  fileName: string | null
  totalCount: number
  verifiedCount: number
  rejectedCount: number
  callNotAnsweredCount: number
  seededCount: number
  uploadedById: number
  assignees: LeadStagingAssignee[]
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  items?: LeadStagingItem[]
}

export const leadStagingApi = {
  list: (params?: { trash?: boolean }): Promise<LeadStagingBatch[]> =>
    api
      .get('/lead-staging', { params: params?.trash ? { trash: 1 } : undefined })
      .then((r) => r.data),
  get: (id: number): Promise<LeadStagingBatch> =>
    api.get(`/lead-staging/${id}`).then((r) => r.data),
  create: (data: { name: string; fileName?: string; items: LeadStagingUploadRow[] }): Promise<LeadStagingBatch> =>
    api.post('/lead-staging', data).then((r) => r.data),
  appendItems: (id: number, items: LeadStagingUploadRow[]): Promise<{ added: number; batch: LeadStagingBatch }> =>
    api.post(`/lead-staging/${id}/items`, { items }).then((r) => r.data),
  updateItem: (
    itemId: number,
    data: { verified?: boolean | null; callNotAnswered?: boolean; comments?: string },
  ): Promise<LeadStagingItem> =>
    api.patch(`/lead-staging/items/${itemId}`, data).then((r) => r.data),
  seed: (batchId: number): Promise<{ seeded: number; batch: LeadStagingBatch }> =>
    api.post(`/lead-staging/${batchId}/seed`).then((r) => r.data),
  // Soft delete — moves the batch to the Trash tab (does NOT wipe rows).
  delete: (id: number) => api.delete(`/lead-staging/${id}`).then((r) => r.data),
  // Restore a trashed batch back to the active list.
  restore: (id: number) => api.post(`/lead-staging/${id}/restore`).then((r) => r.data),
  // Hard delete — only allowed on batches already in trash.
  permanentDelete: (id: number) => api.delete(`/lead-staging/${id}/permanent`).then((r) => r.data),
  // Pass the FULL desired assignee list — backend replaces atomically.
  // Pass an empty array to clear all assignments.
  assign: (id: number, userIds: number[]): Promise<LeadStagingBatch> =>
    api.patch(`/lead-staging/${id}/assign`, { userIds }).then((r) => r.data),
}



// ─── B2B Contacts ───────────────────────────────────────────────────────────
export interface B2bContact {
  id: number
  name: string
  email: string | null
  phone: string
  state: string | null
  uploadBatch: string
  source: string
  uploadedBy: number
  dndFlag: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  _count?: { campaignContacts: number }
}

export const b2bApi = {
  list: (params?: Record<string, string | undefined>) =>
    api.get('/b2b/contacts', { params }).then((r) => r.data as { data: B2bContact[]; total: number; page: number; limit: number; totalPages: number }),
  stats: () => api.get('/b2b/stats').then((r) => r.data),
  states: (): Promise<string[]> => api.get('/b2b/states').then((r) => r.data),
  import: (data: { source: 'csv' | 'xlsx' | 'api'; contacts: { name: string; email?: string; phone: string; state?: string }[] }) =>
    api.post('/b2b/import', data).then((r) => r.data as { inserted: number; skipped: number; uploadBatch: string }),
  delete: (id: number) => api.delete(`/b2b/contacts/${id}`).then((r) => r.data),
  deleteBatch: (batch: string) => api.delete(`/b2b/batches/${batch}`).then((r) => r.data),
  toggleDnd: (id: number, dnd: boolean) =>
    api.patch(`/b2b/contacts/${id}/dnd`, { dnd }).then((r) => r.data),
  downloadTemplate: () =>
    api.get('/b2b/template.csv', { responseType: 'blob' }).then((r) => r.data as Blob),
}

// ─── Auto Dialer ────────────────────────────────────────────────────────────
export interface AutoDialerRecording {
  id: number
  name: string
  filePath: string
  durationSec: number
  sizeBytes: number
  mimeType: string
  uploadedBy: number
  archivedAt: string | null
  createdAt: string
}

export interface AutoDialerCampaign {
  id: number
  name: string
  description: string | null
  type: 'B2B' | 'B2C'
  recordingId: number | null
  callGapSec: number
  status: 'draft' | 'active' | 'paused' | 'completed'
  totalContacts: number
  createdBy: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  recording?: { id: number; name: string; durationSec: number } | null
  _count?: { contacts: number; assignments: number }
}

export interface AutoDialerCampaignContact {
  id: number
  campaignId: number
  b2bContactId: number
  assignedToUserId: number | null
  status: 'pending' | 'dialing' | 'connected' | 'no_answer' | 'busy' | 'declined' | 'failed' | 'completed' | 'skipped'
  attemptCount: number
  lastAttemptAt: string | null
  mobileCallId: number | null
  notes: string | null
  b2bContact: B2bContact
}

export interface AutoDialerStats {
  totalContacts: number
  dialed: number
  pending: number
  connected: number
  noAnswer: number
  busy: number
  declined: number
  failed: number
  skipped: number
  completed: number
  totalCallDurationSec: number
  avgTalkTimeSec: number
  progressPct: number
  callsLogged: number
  perCounsellor?: Array<{ counsellorId: number } & Record<string, number>>
}

export const autoDialerApi = {
  // Recordings
  recordings: (): Promise<AutoDialerRecording[]> =>
    api.get('/auto-dialer/recordings').then((r) => r.data),
  uploadRecording: (file: File, name?: string, durationSec?: number) => {
    const fd = new FormData()
    fd.append('file', file)
    if (name) fd.append('name', name)
    if (durationSec != null) fd.append('durationSec', String(durationSec))
    return api.post('/auto-dialer/recordings', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data as AutoDialerRecording)
  },
  recordingStreamUrl: (id: number) => `/api/auto-dialer/recordings/${id}/stream`,
  deleteRecording: (id: number) =>
    api.delete(`/auto-dialer/recordings/${id}`).then((r) => r.data),

  // Campaigns
  list: (params?: Record<string, string | undefined>) =>
    api.get('/auto-dialer/campaigns', { params }).then((r) => r.data as { data: AutoDialerCampaign[]; total: number; page: number; limit: number; totalPages: number }),
  get: (id: number) =>
    api.get(`/auto-dialer/campaigns/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; type: 'B2B' | 'B2C'; recordingId?: number; callGapSec: number }) =>
    api.post('/auto-dialer/campaigns', data).then((r) => r.data as AutoDialerCampaign),
  attachContacts: (id: number, b2bContactIds: number[]) =>
    api.post(`/auto-dialer/campaigns/${id}/contacts`, { b2bContactIds }).then((r) => r.data),
  detachContact: (id: number, contactId: number) =>
    api.delete(`/auto-dialer/campaigns/${id}/contacts/${contactId}`).then((r) => r.data),
  contacts: (id: number, params?: Record<string, string | undefined>) =>
    api.get(`/auto-dialer/campaigns/${id}/contacts`, { params }).then((r) => r.data),
  assign: (id: number, counsellorIds: number[], rebalance?: boolean) =>
    api.post(`/auto-dialer/campaigns/${id}/assign`, { counsellorIds, rebalance }).then((r) => r.data),
  unassign: (id: number, counsellorId: number) =>
    api.delete(`/auto-dialer/campaigns/${id}/assign/${counsellorId}`).then((r) => r.data),
  start: (id: number) =>
    api.post(`/auto-dialer/campaigns/${id}/start`).then((r) => r.data as AutoDialerCampaign),
  pause: (id: number) =>
    api.post(`/auto-dialer/campaigns/${id}/pause`).then((r) => r.data as AutoDialerCampaign),
  resume: (id: number) =>
    api.post(`/auto-dialer/campaigns/${id}/resume`).then((r) => r.data as AutoDialerCampaign),
  complete: (id: number) =>
    api.post(`/auto-dialer/campaigns/${id}/complete`).then((r) => r.data as AutoDialerCampaign),
  stats: (id: number): Promise<AutoDialerStats> =>
    api.get(`/auto-dialer/campaigns/${id}/stats`).then((r) => r.data),
}

// ─── BULK OPERATIONS ──────────────────────────────────────────────────────────
// New advanced bulk-management surface. Drives:
//   • Recipe-style multi-step bulk apply (filter → preview → execute)
//   • Saved presets
//   • Operation log + per-op undo
//   • Paste-of-ids/mobiles import resolver
//   • CSV export of current selection
// All endpoints are admin-only on the server. The page should be hidden from
// counsellor sidebars; existing useAuthStore().isAdmin() already enforces that.

export type BulkStep =
  | { type: 'assign'; counsellorId: number }
  | { type: 'unassign'; counsellorId?: number }
  | { type: 'move'; departmentId: number; leadStatusId?: number; leadSubStatusId?: number }
  | { type: 'status'; leadStatusId?: number; leadSubStatusId?: number; departmentId?: number }
  | { type: 'reset-status' }
  | { type: 'field-update'; field: string; value: string | number | null }
  | { type: 'trash' }
  | { type: 'restore' }
  | { type: 'permanent-delete' }
  | { type: 'note'; note: string }
  | { type: 'comment'; comment: string }
  | { type: 'reminder'; reminderDate: string; note?: string }
  | { type: 'followup'; comment: string; followupDate?: string; followupNA?: boolean; leadStatusId?: number; leadSubStatusId?: number }
  | { type: 'call-status'; called?: 0 | 1; wapp?: 0 | 1 }
  | { type: 'tag'; field: 'event' | 'source' | 'website'; value: string }

export interface BulkRunResult {
  operationId: number
  status: 'completed' | 'partial' | 'failed' | 'preview'
  total: number
  succeeded: number
  failed: number
  skipped: number
  failures: Array<{ leadId: number; step: string; error: string }>
  sample?: Array<{ id: number; name: string; mobile: string | null; email: string | null }>
  message?: string
}

export interface BulkOperationSummary {
  id: number
  actorId: number
  actor: { id: number; name: string }
  kind: string
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'undone'
  source: 'web' | 'api' | 'cron'
  dryRun: boolean
  filter: Record<string, unknown> | null
  recipe: BulkStep[]
  total: number
  processed: number
  succeeded: number
  failed: number
  message: string | null
  undoneAt: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface BulkPreset {
  id: number
  ownerId: number
  name: string
  filter: Record<string, unknown>
  recipe: BulkStep[]
  createdAt: string
  updatedAt: string
}

export interface BulkImportResolution {
  matched: Array<{ id: number; name: string; mobile: string | null; email: string | null; trash: number }>
  missing: string[]
}

export const bulkApi = {
  selectIds: (filter: Record<string, string>) =>
    api.post('/bulk/select-ids', { filter }).then((r) => r.data as { total: number; ids: number[] }),

  resolveImport: (tokens: string[]) =>
    api.post('/bulk/resolve-import', { tokens }).then((r) => r.data as BulkImportResolution),

  apply: (data: {
    filter?: Record<string, string>
    leadIds?: number[]
    recipe: BulkStep[]
    dryRun?: boolean
  }) => api.post('/bulk/apply', data).then((r) => r.data as BulkRunResult),

  operations: (params?: { page?: number; limit?: number; kind?: string; status?: string; actorId?: number }) =>
    api.get('/bulk/operations', { params }).then((r) => r.data as {
      data: BulkOperationSummary[]
      total: number; page: number; limit: number; totalPages: number
    }),

  operation: (id: number) =>
    api.get(`/bulk/operations/${id}`).then((r) => r.data as BulkOperationSummary & {
      snapshotMeta: { leadCount: number; assignmentCount: number } | null
    }),

  undo: (id: number) =>
    api.post(`/bulk/operations/${id}/undo`).then((r) => r.data as { restored: number; message: string }),

  rerun: (id: number) =>
    api.post(`/bulk/operations/${id}/rerun`).then((r) => r.data as BulkRunResult),

  presets: () => api.get('/bulk/presets').then((r) => r.data as BulkPreset[]),

  createPreset: (data: { name: string; filter: Record<string, unknown>; recipe: BulkStep[] }) =>
    api.post('/bulk/presets', data).then((r) => r.data as BulkPreset),

  updatePreset: (id: number, data: Partial<{ name: string; filter: Record<string, unknown>; recipe: BulkStep[] }>) =>
    api.patch(`/bulk/presets/${id}`, data).then((r) => r.data as BulkPreset),

  deletePreset: (id: number) =>
    api.delete(`/bulk/presets/${id}`).then((r) => r.data as { ok: true }),

  exportCsv: (data: { filter?: Record<string, string>; leadIds?: number[]; columns?: string[] }) =>
    api.post('/bulk/export', data, { responseType: 'blob' }).then((r) => r.data as Blob),

  dedupeMerge: (data: { keepId: number; mergeIds: number[] }) =>
    api.post('/bulk/dedupe-merge', data).then((r) => r.data as { message: string; operationId: number }),
}

// ─── COUNSELLOR REMARKS ────────────────────────────────────────────────────────
export const remarksApi = {
  list: (params?: { counsellorId?: number; callId?: number; hourContext?: string }) =>
    api.get('/remarks', { params }).then((r) => r.data as CounsellorRemark[]),

  create: (data: { counsellorId?: number; counsellorIds?: number[]; remark: string; callId?: number; hourContext?: string }) =>
    api.post('/remarks', data).then((r) => r.data as any),

  delete: (id: number) =>
    api.delete(`/remarks/${id}`).then((r) => r.data as { message: string }),
}

// ─── WEBMAIL ACCOUNTS ────────────────────────────────────────────────────────
export interface WebmailAccount {
  id: number
  email: string
  password?: string
  webmailUrl: string
  createdAt?: string
  updatedAt?: string
}

export const webmailAccountsApi = {
  list: () => api.get<WebmailAccount[]>('/webmail-accounts').then((r) => r.data),
  create: (data: { email: string; password?: string; webmailUrl?: string }) =>
    api.post('/webmail-accounts', data).then((r) => r.data),
  update: (id: number, data: { email: string; password?: string; webmailUrl?: string }) =>
    api.put(`/webmail-accounts/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/webmail-accounts/${id}`).then((r) => r.data),
  loginUrl: (id: number) => api.get<{ loginUrl: string }>(`/webmail-accounts/${id}/login-url`).then((r) => r.data),
}

export interface VerifiedFieldValue {
  id: number
  field: string
  value: string
  parent: string | null
  verifiedBy: number
  verifiedByName: string | null
  createdAt: string
  updatedAt: string
}

export interface VerifiedCandidate {
  value: string
  count: number
  verified: boolean
  verifiedId: number | null
  parent: string | null
  /** Parent value the leads already carry (city → state, state → country). */
  leadParent: string | null
  /** How many other distinct parent values those leads carry. */
  leadParentOthers: number
  /** Leads with this value whose parent field is still empty — what a cascade would fill. */
  leadParentBlank: number
  /** Distinct parent values on those leads, most common first (capped at 8). */
  leadParents: Array<{ value: string; count: number }>
}

export const verifiedApi = {
  list: (field: string) =>
    api.get('/verified', { params: { field } }).then((r) => r.data as VerifiedFieldValue[]),

  allFields: () =>
    api.get('/verified/all-fields').then((r) => r.data as Record<string, Array<{ value: string; parent: string | null }>>),

  candidates: (field: string) =>
    api.get('/verified/candidates', { params: { field } }).then((r) => r.data as VerifiedCandidate[]),

  add: (data: { field: string; value: string; parent?: string | null }) =>
    api.post('/verified', data).then((r) => r.data),

  addBulk: (data: { field: string; values: Array<{ value: string; parent?: string | null }> }) =>
    api.post('/verified/bulk', data).then((r) => r.data as { added: number }),

  remove: (id: number) =>
    api.delete(`/verified/${id}`).then((r) => r.data),

  cascadeFill: (data: {
    sourceField: string
    sourceValues: string[]
    targetField: string
    targetValue: string
    approvedLeadIds?: number[]
  }) =>
    api.post('/verified/cascade-fill', data).then((r) => r.data as {
      message: string; count: number; operationId: number
    }),
}

// ─── WHATSAPP TEMPLATES ──────────────────────────────────────────────────────

export interface WhatsappTemplateFile {
  id: number
  templateId: number
  filePath: string
  fileName: string
  fileType: string | null
  fileSize: number | null
  createdAt: string
}

export interface WhatsappTemplate {
  id: number
  title: string
  description: string
  category: string
  userId: number
  status: number
  createdAt: string
  updatedAt: string
  user?: { id: number; name: string; email: string }
  attachments: WhatsappTemplateFile[]
}

export const whatsappTemplatesApi = {
  list: (params?: { category?: string; search?: string }) =>
    api.get('/whatsapp-templates', { params }).then((r) => r.data as WhatsappTemplate[]),

  get: (id: number) =>
    api.get(`/whatsapp-templates/${id}`).then((r) => r.data as WhatsappTemplate),

  create: (formData: FormData) =>
    api.post('/whatsapp-templates', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data as WhatsappTemplate),

  update: (id: number, formData: FormData) =>
    api.patch(`/whatsapp-templates/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data as WhatsappTemplate),

  delete: (id: number) =>
    api.delete(`/whatsapp-templates/${id}`).then((r) => r.data),

  deleteFile: (fileId: number) =>
    api.delete(`/whatsapp-templates/files/${fileId}`).then((r) => r.data),
}


// ─── API Usage Metrics (admin) ───────────────────────────────────────────────

export interface ApiMetricsLive {
  perSecond: { t: number; hits: number; errors: number }[]
  reqPerSec: number
  peakPerSec: number
  totalSinceBoot: number
  uptimeSec: number
  trackedRoutes: number
  pendingBuckets: number
  droppedBuckets: number
  currentBucketStart: string
  trackingWindow: { startHour: number; endHour: number; tz: string }
  trackingActive: boolean
  trackingEnabled: boolean
  top: {
    method: string
    route: string
    hits: number
    avgMs: number
    maxMs: number
    peakRps: number
    errors: number
  }[]
}

export interface ApiEndpointStat {
  method: string
  route: string
  hits: number
  errors4xx: number
  errors5xx: number
  errorRate: number
  avgMs: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  peakRps: number
  totalMs: number
}

export interface ApiErrorBreakdown {
  hours: number
  granularity: 'm5' | 'h1' | 'd1'
  scope: { method: string | null; route: string } | null
  totalErrors: number
  byStatus: { status: number; count: number }[]
  endpoints: {
    method: string
    route: string
    total: number
    statuses: { status: number; count: number }[]
  }[]
}

export interface ApiMetricsSummary {
  hours: number
  granularity: 'm5' | 'h1' | 'd1'
  since: string
  totals: {
    hits: number
    errors: number
    errorRate: number
    avgMs: number
    distinctRoutes: number
    avgPerHour: number
  }
  endpoints: ApiEndpointStat[]
}

export interface ApiMetricsSeries {
  hours: number
  granularity: 'm5' | 'h1' | 'd1'
  points: { t: string; hits: number; errors: number; avgMs: number }[]
}

export interface ApiMetricsCallers {
  days: number
  callers: {
    /** 0 = unattributed: public ingestion, tracking pixels, failed auth. */
    tenantId: number
    tenantName: string | null
    userId: number
    name: string
    email: string | null
    role: string | null
    hits: number
    errors: number
    avgMs: number
  }[]
}

export interface ApiMetricsCustomers {
  days: number
  total: number
  customers: {
    tenantId: number
    name: string
    slug: string | null
    planName: string | null
    hits: number
    errors: number
    callers: number
    avgMs: number
    /** Percentage of all traffic in the window. */
    share: number
  }[]
}

export interface ApiMetricsStorage {
  statsBytes: number
  userDailyBytes: number
  statusBytes: number
  totalBytes: number
  userDailyRows: number
  byGranularity: {
    granularity: string
    rows: number
    oldest: string | null
    newest: string | null
  }[]
  retention: { m5: string; h1: string; d1: string; userDaily: string }
}

/**
 * API usage metrics — a SUPER ADMIN view, served from /api/platform/metrics.
 *
 * This used to live in the customer admin panel. It moved because endpoint
 * latency and error rates are facts about the platform, not about any one
 * customer, and the accumulator behind them is a single process-wide buffer.
 * Callers now carry the customer they belong to.
 */
export const metricsApi = {
  live: (limit = 20) =>
    api.get('/platform/metrics/live', { params: { limit } }).then((r) => r.data as ApiMetricsLive),

  summary: (params?: { hours?: number; limit?: number }) =>
    api.get('/platform/metrics/summary', { params }).then((r) => r.data as ApiMetricsSummary),

  timeseries: (params?: { hours?: number; route?: string; method?: string }) =>
    api.get('/platform/metrics/timeseries', { params }).then((r) => r.data as ApiMetricsSeries),

  errors: (params?: { hours?: number; route?: string; method?: string }) =>
    api.get('/platform/metrics/errors', { params }).then((r) => r.data as ApiErrorBreakdown),

  callers: (params?: { days?: number; limit?: number }) =>
    api.get('/platform/metrics/callers', { params }).then((r) => r.data as ApiMetricsCallers),

  /** Request volume broken down by customer — the platform operator's view. */
  customers: (params?: { days?: number }) =>
    api.get('/platform/metrics/customers', { params }).then((r) => r.data as ApiMetricsCustomers),

  storage: () => api.get('/platform/metrics/storage').then((r) => r.data as ApiMetricsStorage),

  flush: () =>
    api
      .post('/platform/metrics/flush')
      .then((r) => r.data as { ok: true; buckets: number; rows: number }),

  rollup: () => api.post('/platform/metrics/rollup').then((r) => r.data),

  setEnabled: (enabled: boolean) =>
    api
      .post('/platform/metrics/config', { enabled })
      .then((r) => r.data as { ok: true; enabled: boolean }),
}
