// ─────────────────────────────────────────────────────────────────────────────
// Projects & proposals — API surface and types.
//
// Reachable only when the `projects` module is on. The mounts are gated the
// same way server-side, so an education session cannot reach any of it.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from './api'
import { useAuthStore } from '@/stores/auth.store'
import type { PaginatedResult } from '@/types'

export type ProjectStatus =
  | 'draft'
  | 'assigned'
  | 'in_review'
  | 'proposal_ready'
  | 'sent_to_client'
  | 'client_replied'
  | 'approved'
  | 'rejected'
  | 'on_hold'
  | 'closed'

export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent'

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; tone: string; hint: string }[] = [
  { value: 'draft', label: 'Draft', tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300', hint: 'Brief recorded, not handed to anyone yet' },
  { value: 'assigned', label: 'Assigned', tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-300', hint: 'With the team, waiting for their first word' },
  { value: 'in_review', label: 'In review', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300', hint: 'Being worked between the rep and the team' },
  { value: 'proposal_ready', label: 'Proposal ready', tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', hint: 'Ready to send to the client' },
  { value: 'sent_to_client', label: 'Sent to client', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', hint: 'Waiting on the client' },
  { value: 'client_replied', label: 'Client replied', tone: 'bg-orange-500/10 text-orange-700 dark:text-orange-300', hint: 'A reply came in — read it' },
  { value: 'approved', label: 'Approved', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', hint: 'The client said yes' },
  { value: 'rejected', label: 'Rejected', tone: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', hint: 'The client said no' },
  { value: 'on_hold', label: 'On hold', tone: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300', hint: 'Parked for now' },
  { value: 'closed', label: 'Closed', tone: 'bg-slate-500/10 text-slate-500', hint: 'Finished' },
]

export const OPEN_STATUSES: ProjectStatus[] = [
  'draft', 'assigned', 'in_review', 'proposal_ready', 'sent_to_client', 'client_replied', 'on_hold',
]

export const PROJECT_PRIORITIES: { value: ProjectPriority; label: string; tone: string }[] = [
  { value: 'low', label: 'Low', tone: 'text-slate-500' },
  { value: 'medium', label: 'Medium', tone: 'text-blue-600' },
  { value: 'high', label: 'High', tone: 'text-amber-600' },
  { value: 'urgent', label: 'Urgent', tone: 'text-rose-600' },
]

export function statusMeta(status: string) {
  return PROJECT_STATUSES.find((s) => s.value === status) ?? PROJECT_STATUSES[0]
}

export interface ProjectUser {
  id: number
  name: string
  email?: string | null
  imgpath?: string | null
  designation?: string | null
}

export interface Team {
  id: number
  name: string
  slug: string
  description: string | null
  color: string | null
  priority: number
  active: boolean
  members: TeamMember[]
  projectCount: number
}

export interface TeamMember extends ProjectUser {
  active: boolean
  memberRole: 'lead' | 'member'
  status?: number
}

export interface ProjectFile {
  id: number
  projectId: number
  messageId: number | null
  filePath: string
  fileName: string
  fileType: string | null
  fileSize: number | null
  uploadedById: number | null
  uploadedBy?: { id: number; name: string } | null
  createdAt: string
  isImage: boolean
  isVideo: boolean
}

export interface ProjectMessage {
  id: number
  projectId: number
  channel: 'internal' | 'external'
  direction: 'in' | 'out'
  kind: 'message' | 'assignment' | 'status' | 'proposal' | 'system'
  authorId: number | null
  author: ProjectUser | null
  fromEmail: string | null
  fromName: string | null
  toEmail: string | null
  cc: string | null
  subject: string | null
  body: string
  messageId: string | null
  deliveryStatus: 'sent' | 'failed' | 'pending' | null
  errorMessage: string | null
  meta: Record<string, unknown> | null
  createdAt: string
  files: ProjectFile[]
}

export interface Project {
  id: number
  projectNumber: string | null
  title: string
  summary: string | null
  description: string | null
  leadId: number | null
  accountId: number | null
  contactId: number | null
  dealId: number | null
  teamId: number | null
  assigneeId: number | null
  ownerId: number | null
  createdById: number | null
  status: ProjectStatus
  priority: ProjectPriority
  budget: number | null
  currency: string
  dueDate: string | null
  clientName: string | null
  clientEmail: string | null
  clientCc: string | null
  mailGroupId: number | null
  ballWithUserId: number | null
  lastInternalAt: string | null
  lastExternalAt: string | null
  lastClientReplyAt: string | null
  sentToClientAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  team: { id: number; name: string; slug: string; color: string | null } | null
  assignee: ProjectUser | null
  owner: ProjectUser | null
  createdBy: ProjectUser | null
  messageCount: number
  fileCount: number
}

export interface ProjectDetail extends Project {
  deal?: { id: number; name: string; dealNumber: string | null } | null
  lead: { id: number; name: string; email: string | null; mobile: string | null; leadStatus: string | null } | null
  account: { id: number; name: string; email: string | null; phone: string | null } | null
  contact: { id: number; fullName: string; email: string | null; mobile: string | null } | null
  ballWith: { id: number; name: string } | null
  mailbox: { id: number; name: string; fromEmail: string; canReceive: boolean } | null
  messages: ProjectMessage[]
  files: ProjectFile[]
}

export interface ProjectSummary {
  byStatus: Record<ProjectStatus, number>
  open: number
  waitingOnMe: number
  awaitingClient: number
  overdue: number
}

export interface Mailbox {
  id: number
  name: string
  fromName: string
  fromEmail: string
  canReceive: boolean
}

export interface ProjectMeta {
  statuses: ProjectStatus[]
  priorities: ProjectPriority[]
  mailboxes: Mailbox[]
  maxUploadBytes: number
}

export interface CreateProjectBody {
  title: string
  summary?: string | null
  description?: string | null
  leadId?: number | null
  accountId?: number | null
  contactId?: number | null
  dealId?: number | null
  teamId?: number | null
  assigneeId?: number | null
  ownerId?: number | null
  priority?: ProjectPriority
  budget?: number | null
  currency?: string
  dueDate?: string | null
  clientName?: string | null
  clientEmail?: string | null
  clientCc?: string | null
  mailGroupId?: number | null
  note?: string | null
}

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } }

export const projectsApi = {
  meta: () => api.get('/projects/meta').then((r) => r.data as ProjectMeta),
  summary: () => api.get('/projects/summary').then((r) => r.data as ProjectSummary),
  waiting: () => api.get('/projects/waiting').then((r) => r.data as Pick<Project, 'id' | 'projectNumber' | 'title' | 'status' | 'updatedAt' | 'dueDate' | 'clientName'>[]),

  list: (params?: {
    status?: string
    teamId?: number | string
    assigneeId?: number | string
    ownerId?: number | string
    leadId?: number | string
    accountId?: number | string
    dealId?: number | string
    search?: string
    mine?: 0 | 1
    priority?: string
    page?: number
    limit?: number
  }) => api.get('/projects', { params }).then((r) => r.data as PaginatedResult<Project>),

  get: (id: number) => api.get(`/projects/${id}`).then((r) => r.data as ProjectDetail),
  create: (body: CreateProjectBody) => api.post('/projects', body).then((r) => r.data as ProjectDetail),
  update: (id: number, body: Partial<CreateProjectBody>) =>
    api.patch(`/projects/${id}`, body).then((r) => r.data as ProjectDetail),
  remove: (id: number) => api.delete(`/projects/${id}`).then((r) => r.data),

  assign: (id: number, body: { teamId?: number | null; assigneeId: number; note?: string | null }) =>
    api.post(`/projects/${id}/assign`, body).then((r) => r.data as ProjectDetail),
  setStatus: (id: number, status: ProjectStatus, note?: string | null) =>
    api.post(`/projects/${id}/status`, { status, note }).then((r) => r.data as ProjectDetail),
  /** The approved project becomes a deal in the default pipeline; the project remembers it. */
  toDeal: (id: number) => api.post(`/projects/${id}/deal`).then((r) => r.data as { dealId: number; dealNumber: string | null; project: ProjectDetail }),

  /** Internal note, optionally with files. */
  postInternal: (id: number, body: { body: string; kind?: 'message' | 'proposal'; files?: File[] }) => {
    const fd = new FormData()
    fd.append('channel', 'internal')
    fd.append('body', body.body)
    if (body.kind) fd.append('kind', body.kind)
    for (const f of body.files ?? []) fd.append('files', f)
    return api.post(`/projects/${id}/messages`, fd, multipart).then((r) => r.data as ProjectMessage)
  },

  /** Email to the client. Returns the whole project, refreshed. */
  sendExternal: (
    id: number,
    body: {
      subject?: string
      body: string
      to?: string
      cc?: string
      files?: File[]
      attachFileIds?: number[]
      mailGroupId?: number | null
    },
  ) => {
    const fd = new FormData()
    fd.append('channel', 'external')
    fd.append('body', body.body)
    if (body.subject) fd.append('subject', body.subject)
    if (body.to) fd.append('to', body.to)
    if (body.cc) fd.append('cc', body.cc)
    if (body.attachFileIds?.length) fd.append('attachFileIds', body.attachFileIds.join(','))
    if (body.mailGroupId) fd.append('mailGroupId', String(body.mailGroupId))
    for (const f of body.files ?? []) fd.append('files', f)
    return api.post(`/projects/${id}/messages`, fd, multipart).then((r) => r.data as ProjectDetail)
  },

  uploadFiles: (id: number, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return api.post(`/projects/${id}/files`, fd, multipart).then((r) => r.data as ProjectFile[])
  },
  removeFile: (id: number, fileId: number) => api.delete(`/projects/${id}/files/${fileId}`).then((r) => r.data),
}

export const teamsApi = {
  list: (includeInactive?: boolean) =>
    api.get('/teams', { params: includeInactive ? { includeInactive: 1 } : undefined }).then((r) => r.data as Team[]),
  mine: () => api.get('/teams/mine').then((r) => r.data as { id: number; name: string; slug: string; color: string | null; memberRole: string }[]),
  members: (teamId: number) => api.get(`/teams/${teamId}/members`).then((r) => r.data as TeamMember[]),
  create: (body: { name: string; description?: string | null; color?: string | null; priority?: number }) =>
    api.post('/teams', body).then((r) => r.data as Team),
  update: (id: number, body: Partial<{ name: string; description: string | null; color: string | null; priority: number; active: boolean }>) =>
    api.patch(`/teams/${id}`, body).then((r) => r.data as Team),
  remove: (id: number) => api.delete(`/teams/${id}`).then((r) => r.data),
  setMembers: (id: number, members: { userId: number; role?: 'lead' | 'member' }[]) =>
    api.put(`/teams/${id}/members`, { members }).then((r) => r.data as TeamMember[]),
  addMember: (id: number, userId: number, role?: 'lead' | 'member') =>
    api.post(`/teams/${id}/members`, { userId, role }).then((r) => r.data as TeamMember[]),
  removeMember: (id: number, userId: number) =>
    api.delete(`/teams/${id}/members/${userId}`).then((r) => r.data as TeamMember[]),
}

/**
 * A URL the browser can open for a stored file.
 *
 * Files under uploads/t/<slug>/ are served only with a token — an <img> or an
 * <a download> cannot set a header, so it rides in the query string, the same
 * way call recordings already do it. Root-level files (the original install)
 * are public and need nothing.
 */
export function fileUrl(filePath: string | null | undefined): string {
  if (!filePath) return '#'
  if (/^https?:\/\//.test(filePath)) return filePath
  const clean = filePath.startsWith('/') ? filePath : `/${filePath}`
  const path = clean.startsWith('/uploads/') ? `/api${clean}` : clean
  if (!/^\/api\/uploads\/t\//.test(path)) return path
  const token = useAuthStore.getState().token
  return token ? `${path}?token=${encodeURIComponent(token)}` : path
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Enough sanitising to render a client's HTML reply inline: no scripts, no
 * styles, no event handlers, no javascript: URLs. The inbox renders the same
 * bodies; this keeps the thread from being the one place a mail can run code.
 */
export function safeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|form|meta|link)[\s\S]*?(\/>|<\/\1>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'\s>]*/gi, '$1=$2#')
}

export function isHtml(s: string): boolean {
  return /<[a-z][^>]*>/i.test(s)
}
