// ─────────────────────────────────────────────────────────────────────────────
// The sales document chain: quotes, contracts, orders, invoices, payments.
//
// Reachable only when the `sales_docs` module is on.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from './api'
import type { PaginatedResult } from '@/types'
import type { CrmRef } from './crm-api'

/** Every document carries the same line shape — see documents.service.ts. */
export interface DocLine {
  id: number
  productId: number | null
  name: string
  sku: string | null
  hsnCode?: string | null
  quantity: number
  unitPrice: number
  discountPercent: number
  taxPercent: number
  total: number
  sortOrder: number
}

interface DocTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
  currency: string
}

export interface Quote extends DocTotals {
  id: number
  quoteNumber: string
  accountId: number | null
  contactId: number | null
  dealId: number | null
  status: string
  version?: number
  parentQuoteId?: number | null
  counterNotes?: string | null
  approvalStatus?: string
  reservedUntil?: string | null
  issueDate: string
  validUntil: string | null
  paymentTerms: string | null
  deliveryTerms: string | null
  notes: string | null
  sentAt: string | null
  viewedAt: string | null
  decidedAt: string | null
  account?: (CrmRef & { email?: string | null }) | null
  owner?: CrmRef | null
  contact?: { id: number; name: string; email: string | null } | null
  deal?: { id: number; name: string; dealNumber: string | null } | null
  /** Where a send would go by default: the contact, else the account. */
  defaultRecipient?: string | null
  /** Past its validity date while still undecided — derived on read. */
  expiredByDate?: boolean
  /** The customer's no-login view/accept page. Null until APP_URL is set. */
  publicUrl?: string | null
  items?: DocLine[]
  orders?: { id: number; orderNumber: string; status: string }[]
  invoices?: { id: number; invoiceNumber: string; status: string; total: number; amountPaid: number }[]
  _count?: { items: number }
}

export interface QuoteSummary {
  drafts: { count: number; value: number }
  awaiting: { count: number; value: number }
  expiringSoon: { count: number; value: number }
  expired: { count: number; value: number }
  acceptedThisMonth: { count: number; value: number }
  acceptRate: number | null
}

export interface Contract {
  id: number
  contractNumber: string
  accountId: number | null
  dealId: number | null
  /** The accepted quote this was drawn up from, when there was one. */
  quoteId: number | null
  title: string
  type: string | null
  status: string
  startDate: string | null
  endDate: string | null
  renewalDate: string | null
  value: number | null
  currency: string
  paymentTerms: string | null
  signedBy: string | null
  signedAt: string | null
  documentUrl: string | null
  notes: string | null
  account?: (CrmRef & { email?: string | null }) | null
  owner?: CrmRef | null
  // ── Detail only
  quote?: { id: number; quoteNumber: string; status: string; total: number } | null
  deal?: { id: number; name: string; dealNumber: string | null } | null
  orders?: { id: number; orderNumber: string; status: string; total: number }[]
}

export interface Order extends DocTotals {
  id: number
  orderNumber: string
  accountId: number | null
  dealId: number | null
  quoteId: number | null
  status: string
  orderDate: string
  deliveryDate: string | null
  courier?: string | null
  trackingNumber?: string | null
  podNotes?: string | null
  packedAt?: string | null
  shippedAt?: string | null
  deliveredAt?: string | null
  isSample?: boolean
  notes: string | null
  contactId?: number | null
  contractId?: number | null
  account?: (CrmRef & { email?: string | null }) | null
  owner?: CrmRef | null
  items?: DocLine[]
  quote?: { id: number; quoteNumber: string; status?: string; total?: number } | null
  contract?: { id: number; contractNumber: string; title: string; status: string } | null
  deal?: { id: number; name: string; dealNumber: string | null } | null
  contact?: { id: number; name: string; email: string | null } | null
  invoices?: { id: number; invoiceNumber: string; status: string; total: number; amountPaid?: number; balance?: number; overdue?: boolean; dueDate?: string | null }[]
  shipments?: { id: number; shipmentNumber: string; status: string; trackingNumber: string | null; items?: { name: string; quantity: number }[] }[]
  leadId?: number | null
  lead?: CrmRef | null
  _count?: { items: number; invoices: number }
}

export interface Payment {
  id: number
  invoiceId: number
  amount: number
  paymentDate: string
  mode: string
  transactionId: string | null
  bank: string | null
  reference: string | null
  notes: string | null
  recordedBy?: CrmRef | null
}

export interface Invoice extends DocTotals {
  id: number
  invoiceNumber: string
  accountId: number | null
  dealId: number | null
  orderId: number | null
  status: string
  issueDate: string
  dueDate: string | null
  amountPaid: number
  /** total − amountPaid, computed server-side. */
  balance: number
  /** Derived from the due date on read, never a stored flag. */
  overdue: boolean
  sentAt?: string | null
  terms: string | null
  notes: string | null
  account?: (CrmRef & { gstin?: string | null; email?: string | null }) | null
  owner?: CrmRef | null
  items?: DocLine[]
  payments?: Payment[]
  order?: { id: number; orderNumber: string; status?: string } | null
  deal?: { id: number; name: string; dealNumber: string | null } | null
  quote?: { id: number; quoteNumber: string; status: string } | null
  contract?: { id: number; contractNumber: string; title: string; status: string } | null
  leadId?: number | null
  lead?: (CrmRef & { email?: string | null; mobile?: string | null }) | null
}

// ─── The chain ────────────────────────────────────────────────────────────────

export interface ChainNext {
  key: string
  label: string
  hint: string
  tone: 'primary' | 'good' | 'warn' | 'muted'
  target: { kind: 'deal' | 'quote' | 'contract' | 'order' | 'invoice'; id: number } | null
}

/** What /sales-chain returns: one family, resolved from any member. */
export interface SalesChainData {
  deal: {
    id: number
    dealNumber: string | null
    name: string
    value: number | null
    currency: string
    stage: { id: number; name: string; isWon: boolean; isLost: boolean; probability: number }
    owner: CrmRef | null
    expectedCloseDate: string | null
  } | null
  account: { id: number; name: string; email: string | null; phone: string | null } | null
  quotes: { id: number; quoteNumber: string; status: string; total: number; currency: string; issueDate: string; validUntil: string | null; sentAt: string | null; viewedAt: string | null; decidedAt: string | null; expiredByDate: boolean; converted: boolean; contracted: boolean }[]
  contracts: { id: number; contractNumber: string; title: string; status: string; value: number | null; currency: string; quoteId: number | null; startDate: string | null; endDate: string | null; renewalDate: string | null; signedAt: string | null; signedBy: string | null; documentUrl: string | null; ordered: boolean }[]
  orders: { id: number; orderNumber: string; status: string; total: number; currency: string; orderDate: string; deliveryDate: string | null; quoteId: number | null; contractId: number | null; invoiced: boolean }[]
  invoices: { id: number; invoiceNumber: string; status: string; total: number; amountPaid: number; balance: number; currency: string; issueDate: string; dueDate: string | null; orderId: number | null; overdue: boolean }[]
  payments: { id: number; invoiceId: number; amount: number; paymentDate: string; mode: string; reference: string | null }[]
  projectCount: number
  totals: { dealValue: number | null; quoted: number; contracted: number; ordered: number; invoiced: number; received: number; outstanding: number; overdue: number }
  next: ChainNext
  acceptedQuoteId: number | null
  uninvoicedOrderId: number | null
}

interface AttnRow { id: number; accountName: string | null }
export interface Attention {
  quotesToConvert: (AttnRow & { quoteNumber: string; total: number; decidedAt: string | null })[]
  contractsWithoutOrder: (AttnRow & { contractNumber: string; title: string; value: number | null; signedAt: string | null })[]
  ordersToInvoice: (AttnRow & { orderNumber: string; total: number; orderDate: string; status: string })[]
  invoicesOverdue: (AttnRow & { invoiceNumber: string; total: number; amountPaid: number; balance: number; dueDate: string | null })[]
  invoicesDraft: (AttnRow & { invoiceNumber: string; total: number })[]
  quotesExpiring: (AttnRow & { quoteNumber: string; total: number; validUntil: string | null })[]
  quotesAwaiting: (AttnRow & { quoteNumber: string; total: number; validUntil: string | null; sentAt: string | null; status: string })[]
  contractsRenewing: (AttnRow & { contractNumber: string; title: string; value: number | null; renewalDate: string | null })[]
  funnel: { quotedLive: number; accepted: number; contracted: number; ordered: number; invoiced: number; outstanding: number; overdue: number }
}

export const salesChainApi = {
  /** Pass exactly one of the ids. */
  get: (ref: { deal?: number; quote?: number; contract?: number; order?: number; invoice?: number }) =>
    api.get('/sales-chain', { params: ref }).then((r) => r.data as SalesChainData),
  attention: () => api.get('/sales-chain/attention').then((r) => r.data as Attention),
}

export interface Ageing {
  outstanding: number
  buckets: { current: number; days30: number; days60: number; days90: number; older: number }
}

export const QUOTE_STATUSES = ['draft', 'pending_approval', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'countered']
export const CONTRACT_STATUSES = [
  'draft', 'sent', 'under_review', 'signed', 'active', 'expired', 'terminated',
]
export const ORDER_STATUSES = ['draft', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled']
export const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'cancelled']
export const PAYMENT_MODES = ['bank_transfer', 'upi', 'cheque', 'cash', 'card', 'other']

export const quotesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/quotes', { params }).then((r) => r.data as PaginatedResult<Quote>),
  get: (id: number) => api.get(`/quotes/${id}`).then((r) => r.data as Quote),
  create: (body: Record<string, unknown>) => api.post('/quotes', body).then((r) => r.data as Quote),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/quotes/${id}`, body).then((r) => r.data as Quote),
  setStatus: (id: number, status: string) =>
    api.post(`/quotes/${id}/status`, { status }).then((r) => r.data as Quote),
  /**
   * The document itself, as HTML — the same markup the customer receives, so
   * the preview cannot drift from what was sent. Print → Save as PDF from here.
   */
  document: (id: number) => api.get(`/quotes/${id}/document`).then((r) => r.data as string),
  /** Actually emails it. Only marks the quote sent if the mail server accepted. */
  send: (id: number, body: { to?: string; cc?: string; subject?: string; message?: string | null }) =>
    api.post(`/quotes/${id}/send`, body).then((r) => r.data as { to: string; sentAt: string }),
  /** Accepted quote → order, lines and all. Refused if already converted. */
  convert: (id: number) => api.post(`/quotes/${id}/convert`).then((r) => r.data as Order),
  /** A fresh draft with the same lines; the original is marked superseded. */
  revise: (id: number) => api.post(`/quotes/${id}/revise`).then((r) => r.data as Quote),
  summary: () => api.get('/quotes/summary/overview').then((r) => r.data as QuoteSummary),
  /** The PDF as a blob — the endpoint needs the bearer header, so no plain link. */
  pdf: (id: number) => api.get(`/quotes/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
  remove: (id: number) => api.delete(`/quotes/${id}`).then((r) => r.data),
  addItem: (id: number, body: Record<string, unknown>) =>
    api.post(`/quotes/${id}/items`, body).then((r) => r.data as DocLine),
  updateItem: (quoteId: number, itemId: number, body: Record<string, unknown>) =>
    api.patch(`/quotes/${quoteId}/items/${itemId}`, body).then((r) => r.data as DocLine),
  removeItem: (quoteId: number, itemId: number) =>
    api.delete(`/quotes/${quoteId}/items/${itemId}`).then((r) => r.data),
}

export const contractsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/contracts', { params }).then((r) => r.data as PaginatedResult<Contract>),
  get: (id: number) => api.get(`/contracts/${id}`).then((r) => r.data as Contract),
  create: (body: Record<string, unknown>) =>
    api.post('/contracts', body).then((r) => r.data as Contract),
  /** Title, value, terms, account and deal come from the quote. */
  fromQuote: (quoteId: number, body?: { title?: string; type?: string | null; startDate?: string | null; endDate?: string | null }) =>
    api.post(`/contracts/from-quote/${quoteId}`, body ?? {}).then((r) => r.data as Contract),
  setStatus: (id: number, status: string, signedBy?: string | null) =>
    api.post(`/contracts/${id}/status`, { status, signedBy }).then((r) => r.data as Contract),
  pdf: (id: number) => api.get(`/contracts/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/contracts/${id}`, body).then((r) => r.data as Contract),
  remove: (id: number) => api.delete(`/contracts/${id}`).then((r) => r.data),
}

export const ordersApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/orders', { params }).then((r) => r.data as PaginatedResult<Order>),
  get: (id: number) => api.get(`/orders/${id}`).then((r) => r.data as Order),
  create: (body: Record<string, unknown>) => api.post('/orders', body).then((r) => r.data as Order),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/orders/${id}`, body).then((r) => r.data as Order),
  addItem: (id: number, body: Record<string, unknown>) =>
    api.post(`/orders/${id}/items`, body).then((r) => r.data as DocLine),
  updateItem: (orderId: number, itemId: number, body: Record<string, unknown>) =>
    api.patch(`/orders/${orderId}/items/${itemId}`, body).then((r) => r.data as DocLine),
  removeItem: (orderId: number, itemId: number) =>
    api.delete(`/orders/${orderId}/items/${itemId}`).then((r) => r.data),
  /** Raise an invoice for the whole order, copying its lines. */
  invoice: (id: number) => api.post(`/orders/${id}/invoice`).then((r) => r.data as Invoice),
  /** Draw a contract up from the order and point the order at it. */
  contract: (id: number, body?: { title?: string; type?: string | null }) =>
    api.post(`/orders/${id}/contract`, body ?? {}).then((r) => r.data as Contract),
  returnOrder: (id: number, body?: Record<string, unknown>) =>
    api.post(`/orders/${id}/return`, body ?? {}).then((r) => r.data),
  challan: (id: number) => api.get(`/orders/${id}/challan`, { responseType: 'blob' }).then((r) => r.data as Blob),
  packingList: (id: number) => api.get(`/orders/${id}/packing-list`, { responseType: 'blob' }).then((r) => r.data as Blob),
  /** Refused while an invoice exists against it. */
  remove: (id: number) => api.delete(`/orders/${id}`).then((r) => r.data),
}

export const invoicesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/invoices', { params }).then((r) => r.data as PaginatedResult<Invoice>),
  get: (id: number) => api.get(`/invoices/${id}`).then((r) => r.data as Invoice),
  create: (body: Record<string, unknown>) =>
    api.post('/invoices', body).then((r) => r.data as Invoice),
  update: (id: number, body: Record<string, unknown>) =>
    api.patch(`/invoices/${id}`, body).then((r) => r.data as Invoice),
  addItem: (id: number, body: Record<string, unknown>) =>
    api.post(`/invoices/${id}/items`, body).then((r) => r.data as DocLine),
  updateItem: (invoiceId: number, itemId: number, body: Record<string, unknown>) =>
    api.patch(`/invoices/${invoiceId}/items/${itemId}`, body).then((r) => r.data as DocLine),
  removeItem: (invoiceId: number, itemId: number) =>
    api.delete(`/invoices/${invoiceId}/items/${itemId}`).then((r) => r.data),
  addPayment: (id: number, body: Record<string, unknown>) =>
    api.post(`/invoices/${id}/payments`, body).then((r) => r.data as Payment),
  removePayment: (invoiceId: number, paymentId: number) =>
    api.delete(`/invoices/${invoiceId}/payments/${paymentId}`).then((r) => r.data),
  /**
   * Refused when payments exist unless `force` — cancelling keeps the number
   * and the record of what was received, which is what accounting wants.
   */
  remove: (id: number, force = false) =>
    api.delete(`/invoices/${id}`, { params: { force: force ? 1 : undefined } }).then((r) => r.data),
  ageing: () => api.get('/invoices/summary/ageing').then((r) => r.data as Ageing),
  pdf: (id: number) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
}
