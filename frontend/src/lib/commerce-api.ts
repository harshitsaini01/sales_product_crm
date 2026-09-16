import { api } from './api'

export interface Cadence {
  id: number
  name: string
  slug: string
  description: string | null
  active: boolean
  steps?: { id: number; dayOffset: number; channel: string; subject: string | null }[]
  _count?: { enrollments: number }
}

export interface SalesApprovalRow {
  id: number
  entityType: string
  kind: string
  requestedPct: number | null
  reason: string | null
  status: string
  account?: { id: number; name: string } | null
  quote?: { id: number; quoteNumber: string; total: number; status: string } | null
}

export interface PriceList {
  id: number
  name: string
  slug: string
  kind: string
  items?: unknown[]
  _count?: { accounts: number }
}

export interface Cockpit {
  quotes: { status: string; count: number; value: number }[]
  orders: { status: string; count: number }[]
  outstanding: number
  overdue: number
  collected: number
  pendingApprovals: number
  returns: number
  skuCount: number
  lowStock: number
  stockValue: number
}

export const commerceApi = {
  cadences: () => api.get('/commerce/cadences').then((r) => r.data as Cadence[]),
  createCadence: (body: Record<string, unknown>) => api.post('/commerce/cadences', body).then((r) => r.data as Cadence),
  enroll: (cadenceId: number, leadId: number) =>
    api.post(`/commerce/cadences/${cadenceId}/enroll`, { leadId }).then((r) => r.data),
  priceLists: () => api.get('/commerce/price-lists').then((r) => r.data as PriceList[]),
  createPriceList: (body: Record<string, unknown>) => api.post('/commerce/price-lists', body).then((r) => r.data as PriceList),
  addPriceItem: (id: number, body: Record<string, unknown>) =>
    api.post(`/commerce/price-lists/${id}/items`, body).then((r) => r.data),
  approvals: (status = 'pending') =>
    api.get('/commerce/approvals', { params: { status } }).then((r) => r.data as SalesApprovalRow[]),
  decide: (id: number, status: 'approved' | 'rejected') =>
    api.post(`/commerce/approvals/${id}/decide`, { status }).then((r) => r.data),
  requestApproval: (quoteId: number, body: Record<string, unknown>) =>
    api.post(`/commerce/quotes/${quoteId}/request-approval`, body).then((r) => r.data),
  cockpit: () => api.get('/commerce/cockpit').then((r) => r.data as Cockpit),
  runDispatcher: () => api.post('/commerce/dispatcher/run').then((r) => r.data),
  transferStock: (body: { productId: number; fromBranchId: number; toBranchId: number; quantity: number; notes?: string }) =>
    api.post('/commerce/stock/transfer', body).then((r) => r.data),
  branchStock: (productId?: number) =>
    api.get('/commerce/stock/branches', { params: productId ? { productId } : {} }).then((r) => r.data as unknown[]),
  sla: () => api.get('/commerce/sla').then((r) => r.data as { hours: number; breached: { id: number; name: string; hoursLate: number; mobile: string | null }[] }),
  checkIn: (body: { accountId: number; lat?: number; lng?: number; notes?: string }) =>
    api.post('/commerce/field/check-in', body).then((r) => r.data),
  issueSample: (body: { productId: number; quantity: number; accountId?: number; branchId?: number; notes?: string }) =>
    api.post('/commerce/field/sample', body).then((r) => r.data),
  kitItems: (productId: number) => api.get(`/commerce/products/${productId}/kit-items`).then((r) => r.data as KitItem[]),
  saveKit: (productId: number, items: { componentId: number; quantity: number }[]) =>
    api.put(`/commerce/products/${productId}/kit-items`, { items }).then((r) => r.data),
  priceFor: (productId: number, qty: number, accountId?: number) =>
    api.get(`/commerce/products/${productId}/price`, { params: { qty, accountId } }).then((r) => r.data),
  shipments: (orderId: number) => api.get(`/commerce/orders/${orderId}/shipments`).then((r) => r.data as unknown[]),
  createShipment: (orderId: number, body: Record<string, unknown>) =>
    api.post(`/commerce/orders/${orderId}/shipments`, body).then((r) => r.data),
}

export interface KitItem {
  id: number
  componentId: number
  quantity: number
  component?: { id: number; name: string; sku: string | null }
}
