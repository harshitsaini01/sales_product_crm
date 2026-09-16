export type Role = 'admin' | 'sub-admin' | 'sales-head' | 'counsellor' | 'franchise' | 'employee' | 'agent' | 'warehouse' | 'accounts'

export interface JWTPayload {
  userId: number
  role: Role
  roles: Role[]
  name: string
  email: string
  // Single-session enforcement: rotates on every successful login. The auth
  // middleware compares this to users.active_*_session_id and rejects with
  // 401 + reason='session_invalidated' if it doesn't match.
  sid?: string
  kind?: 'web' | 'mobile'
  // ── Multi-tenancy. Absent on tokens minted before it shipped, which
  // middleware/tenant.ts resolves to the primary customer so an existing
  // deploy does not sign everybody out.
  tenantId?: number
  tenantSlug?: string
  /** Set only while a super admin is acting as this customer. */
  impersonatedBy?: { id: number; name: string }
}

export interface PaginationQuery {
  page?: string
  limit?: string
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface LeadFilters {
  departmentId?: string
  leadStatusId?: string
  leadSubStatusId?: string
  leadType?: string
  userId?: string
  search?: string
  fromDate?: string
  toDate?: string
  website?: string
  source?: string
  trash?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
}
