// ─────────────────────────────────────────────────────────────────────────────
// Deals, pipelines and products.
//
// Reachable only when the `deals` module is on, which the education vertical
// leaves off and the API mounts enforce.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from './api'
import type { PaginatedResult } from '@/types'
import type { CrmRef } from './crm-api'

export interface PipelineStage {
  id: number
  pipelineId: number
  name: string
  slug: string
  probability: number
  sortOrder: number
  isWon: boolean
  isLost: boolean
  active: boolean
}

export interface Pipeline {
  id: number
  name: string
  slug: string
  isDefault: boolean
  priority: number
  active: boolean
  stages: PipelineStage[]
  dealCount?: number
}

export interface Deal {
  id: number
  dealNumber: string | null
  name: string
  accountId: number | null
  primaryContactId: number | null
  pipelineId: number
  stageId: number
  ownerId: number | null
  value: number | null
  currency: string
  /** Already resolved: the deal's own probability, or its stage's. */
  probability: number
  /** value × probability, the number a forecast is built from. */
  weightedValue: number | null
  expectedCloseDate: string | null
  actualCloseDate: string | null
  source: string | null
  campaign: string | null
  nextStep: string | null
  lostReasonId: number | null
  lostNotes: string | null
  leadId: number | null
  notes: string | null
  createdAt: string
  stage?: Pick<PipelineStage, 'id' | 'name' | 'probability' | 'isWon' | 'isLost'>
  pipeline?: CrmRef
  owner?: CrmRef | null
  account?: CrmRef | null
  contact?: { id: number; name: string; email: string | null; mobile: string | null } | null
  lostReason?: CrmRef | null
  products?: DealProduct[]
  customFields?: import('./crm-api').CustomFieldValue[]
  /** Board only: when the deal was last touched, for the staleness badge. */
  lastActivityAt?: string | null
  // ── Detail only
  accountDetail?: { id: number; name: string; email: string | null; phone: string | null } | null
  lead?: (CrmRef & { email?: string | null; mobile?: string | null }) | null
  daysInStage?: number
  enteredStageAt?: string
  stageHistory?: { subject: string | null; at: string; by: string | null; meta: Record<string, unknown> | null }[]
  chain?: DealChain
}

/** What has been quoted, ordered, invoiced and received against a deal. */
export interface DealChain {
  quotes: { id: number; quoteNumber: string; status: string; total: number; currency: string; issueDate: string; validUntil: string | null; sentAt: string | null; viewedAt: string | null; decidedAt: string | null }[]
  orders: { id: number; orderNumber: string; status: string; total: number; currency: string; orderDate: string; quoteId: number | null }[]
  invoices: { id: number; invoiceNumber: string; status: string; total: number; amountPaid: number; currency: string; issueDate: string; dueDate: string | null; orderId: number | null; balance: number; overdue: boolean }[]
  quoted: number
  ordered: number
  invoiced: number
  received: number
  acceptedQuoteId: number | null
  uninvoicedOrderId: number | null
}

export interface DealProduct {
  id: number
  dealId: number
  productId: number | null
  name: string
  sku: string | null
  quantity: number
  unitPrice: number
  discountPercent: number
  taxPercent: number
  total: number
  sortOrder: number
}

export interface Product {
  id: number
  name: string
  sku: string | null
  barcode?: string | null
  category: string | null
  collection?: string | null
  brand?: string | null
  description: string | null
  shortDescription?: string | null
  imageUrl?: string | null
  unit?: string
  hsnCode?: string | null
  costPrice?: number
  unitPrice: number | null
  minSellingPrice?: number | null
  currency: string
  taxPercent: number | null
  stockQuantity?: number
  reservedQuantity?: number
  minStockLevel?: number
  available?: number
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock'
  allowBackorder?: boolean
  isKit?: boolean
  active: boolean
}

export interface BoardColumn extends Pick<PipelineStage, 'id' | 'name' | 'probability' | 'isWon' | 'isLost'> {
  count: number
  value: number
  weightedValue: number
  deals: Deal[]
}

export interface Board {
  pipeline: CrmRef
  stages: BoardColumn[]
}

export interface Forecast {
  pipeline: CrmRef
  openCount: number
  openValue: number
  weightedValue: number
  wonCount: number
  wonValue: number
  lostCount: number
  lostValue: number
  winRate: number | null
  averageDealSize: number | null
  averageCycleDays: number | null
}

export const dealsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/deals', { params }).then((r) => r.data as PaginatedResult<Deal>),
  board: (params?: Record<string, unknown>) =>
    api.get('/deals/board', { params }).then((r) => r.data as Board),
  forecast: (params?: Record<string, unknown>) =>
    api.get('/deals/forecast', { params }).then((r) => r.data as Forecast),
  get: (id: number) => api.get(`/deals/${id}`).then((r) => r.data as Deal),
  create: (body: Record<string, unknown>) => api.post('/deals', body).then((r) => r.data as Deal),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/deals/${id}`, body).then((r) => r.data as Deal),
  /**
   * Moving a card. Its own endpoint rather than a field on update, because it
   * stamps the close date and demands a reason on loss.
   */
  moveStage: (id: number, stageId: number, lost?: { lostReasonId: number; lostNotes?: string }) =>
    api.post(`/deals/${id}/stage`, { stageId, ...lost }).then((r) => r.data as Deal),
  remove: (id: number) => api.delete(`/deals/${id}`).then((r) => r.data),

  addLine: (dealId: number, body: Record<string, unknown>) =>
    api.post(`/deals/${dealId}/products`, body).then((r) => r.data as DealProduct),
  updateLine: (dealId: number, lineId: number, body: Record<string, unknown>) =>
    api.patch(`/deals/${dealId}/products/${lineId}`, body).then((r) => r.data as DealProduct),
  removeLine: (dealId: number, lineId: number) =>
    api.delete(`/deals/${dealId}/products/${lineId}`).then((r) => r.data),
  placeOrder: (id: number) =>
    api.post(`/deals/${id}/place-order`).then(
      (r) =>
        r.data as { orderId: number; orderNumber: string; invoiceId: number | null; invoiceNumber: string | null },
    ),
}

export const pipelinesApi = {
  list: () => api.get('/pipelines').then((r) => r.data as Pipeline[]),
  create: (body: Record<string, unknown>) => api.post('/pipelines', body).then((r) => r.data as Pipeline),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/pipelines/${id}`, body).then((r) => r.data as Pipeline),

  addStage: (pipelineId: number, body: Record<string, unknown>) =>
    api.post(`/pipelines/${pipelineId}/stages`, body).then((r) => r.data as PipelineStage),
  updateStage: (pipelineId: number, stageId: number, body: Record<string, unknown>) =>
    api.patch(`/pipelines/${pipelineId}/stages/${stageId}`, body).then((r) => r.data as PipelineStage),
  /** Refused while deals sit in the stage; the error carries the count. */
  removeStage: (pipelineId: number, stageId: number) =>
    api.delete(`/pipelines/${pipelineId}/stages/${stageId}`).then((r) => r.data),

  lostReasons: () => api.get('/pipelines/lost-reasons').then((r) => r.data as CrmRef[]),
  createLostReason: (name: string) =>
    api.post('/pipelines/lost-reasons', { name }).then((r) => r.data as CrmRef),
}

export const productsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/products', { params }).then((r) => r.data as Product[]),
  create: (body: Record<string, unknown>) => api.post('/products', body).then((r) => r.data as Product),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/products/${id}`, body).then((r) => r.data as Product),
  /** Retires rather than deletes — deal lines keep their copied name and price. */
  retire: (id: number) => api.delete(`/products/${id}`).then((r) => r.data),
  remove: (id: number) => api.delete(`/products/${id}/permanent`).then((r) => r.data),
  uploadImage: (id: number, file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return api.post(`/products/${id}/image`, fd).then((r) => r.data as Product)
  },
  adjustStock: (id: number, body: { quantity: number; movementType?: string; notes?: string }) =>
    api.post(`/products/${id}/adjust-stock`, body).then((r) => r.data as Product),
  stockHistory: (id: number) => api.get(`/products/${id}/stock-history`).then((r) => r.data as unknown[]),
}

/** ₹12,50,000 — the grouping Indian users expect, not 1,250,000. */
export function formatMoney(value: number | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined) return '—'
  const symbol = currency === 'INR' ? '₹' : ''
  return `${symbol}${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

/** ₹12.5L / ₹1.2Cr, for a board card that has no room for the full number. */
export function compactMoney(value: number | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined) return '—'
  const symbol = currency === 'INR' ? '₹' : ''
  if (Math.abs(value) >= 1e7) return `${symbol}${(value / 1e7).toFixed(2).replace(/\.00$/, '')}Cr`
  if (Math.abs(value) >= 1e5) return `${symbol}${(value / 1e5).toFixed(2).replace(/\.00$/, '')}L`
  if (Math.abs(value) >= 1000) return `${symbol}${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${symbol}${value}`
}
