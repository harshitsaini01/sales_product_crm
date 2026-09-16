// ─────────────────────────────────────────────────────────────────────────────
// Projects & proposals.
//
// THE SHAPE OF THE WORK
//
//   1. A rep records what the client wants (the brief) — on a lead, on an
//      account, or on nothing yet.
//   2. They hand it to a DEPARTMENT (IT, Digital Marketing, Design…) and to one
//      person in it. The people offered are whoever is an active member of that
//      team today, read from crm_team_members — not a hardcoded list.
//   3. The two of them go back and forth on the INTERNAL thread until there is
//      a proposal. Files ride along: mock-ups, decks, a walkthrough video.
//   4. The rep sends it to the client on the EXTERNAL thread. That is a real
//      email, from a real mailbox, with the attachments attached.
//   5. The client replies by email. The inbox poller sees the reply, matches it
//      to the project, and it appears on the same thread — with its attachments.
//
// WHOSE TURN IS IT
//
// `ballWithUserId` is recomputed on every message. It is the single fact the
// notification bell needs — "projects waiting on you" — and computing it at
// write time is what keeps that query one indexed lookup instead of a join
// across the whole thread on every poll.
//
// THREADING. Every outgoing mail carries In-Reply-To / References back to the
// previous message on the external channel, so the client's mail app files it
// under one conversation, and the subject carries [PRJ-000012] as a fallback
// for the mail clients that strip the headers.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs'
import path from 'path'
import type { CampaignGroup, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { currentTenant } from '../../lib/tenant-context'
import { currentUploadsDir } from '../../utils/tenant-paths'
import { storedUploadPath, uploadDiskPath } from '../../middleware/upload'
import { emailService } from '../email.service'
import { sendViaGroup } from '../campaign-mailer.service'
import { documentNumber } from './documents.service'
import * as activity from './activity.service'
import { bigintFix } from './serialize'
import { notifyUser } from './project-notify.service'

// ─── Vocabulary ───────────────────────────────────────────────────────────────

export const PROJECT_STATUSES = [
  'draft',
  'assigned',
  'in_review',
  'proposal_ready',
  'sent_to_client',
  'client_replied',
  'approved',
  'rejected',
  'on_hold',
  'closed',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Nothing more is expected on these; they drop out of the bell. */
export const TERMINAL_STATUSES: ProjectStatus[] = ['approved', 'rejected', 'closed']

export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

export interface ActingUser {
  userId: number
  role: string
  roles?: string[]
  name?: string
  email?: string
}

const PRIVILEGED = ['admin', 'sub-admin', 'sales-head']

export function isPrivileged(user: ActingUser): boolean {
  return PRIVILEGED.includes(user.role) || (user.roles ?? []).some((r) => PRIVILEGED.includes(r))
}

// ─── Scope ────────────────────────────────────────────────────────────────────

/**
 * Which projects this person may see.
 *
 * A manager sees everything. Everybody else sees the projects they own, made,
 * are assigned to, or that sit with a team they are a member of — the last one
 * so a team lead can watch what is coming into their department before it is
 * handed to a name.
 */
export async function projectScope(user: ActingUser): Promise<Prisma.CrmProjectWhereInput> {
  if (isPrivileged(user)) return {}
  const me = BigInt(user.userId)
  const teams = await prisma.crmTeamMember.findMany({ where: { userId: me }, select: { teamId: true } })
  return {
    OR: [
      { ownerId: me },
      { createdById: me },
      { assigneeId: me },
      ...(teams.length ? [{ teamId: { in: teams.map((t) => t.teamId) } }] : []),
    ],
  }
}

export async function canAccess(user: ActingUser, projectId: bigint): Promise<boolean> {
  const scope = await projectScope(user)
  const n = await prisma.crmProject.count({ where: { id: projectId, trash: 0, ...scope } })
  return n > 0
}

// ─── Serialisation ────────────────────────────────────────────────────────────

const USER_SEL = { select: { id: true, name: true, email: true, imgpath: true, designation: true } } as const
const TEAM_SEL = { select: { id: true, name: true, slug: true, color: true } } as const

export const PROJECT_INCLUDE = {
  team: TEAM_SEL,
  assignee: USER_SEL,
  owner: USER_SEL,
  createdBy: USER_SEL,
  _count: { select: { messages: true, files: true } },
} satisfies Prisma.CrmProjectInclude

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeProject(p: any) {
  const out = bigintFix(p)
  if (p._count) {
    out.messageCount = p._count.messages
    out.fileCount = p._count.files
    delete out._count
  }
  if (p.budget != null) out.budget = Number(p.budget)
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeMessage(m: any) {
  const out = bigintFix(m)
  if (m.files) out.files = m.files.map(serializeFile)
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeFile(f: any) {
  const out = bigintFix(f)
  if (f.fileSize != null) out.fileSize = Number(f.fileSize)
  out.isImage = !!f.fileType && String(f.fileType).startsWith('image/')
  out.isVideo = !!f.fileType && String(f.fileType).startsWith('video/')
  return out
}

// ─── Whose turn ───────────────────────────────────────────────────────────────

function nextBall(
  project: { ownerId: bigint | null; assigneeId: bigint | null },
  authorId: bigint,
): bigint | null {
  // The assignee wrote: back to the rep. Anybody else wrote (the rep, or a
  // manager weighing in): over to the assignee, if there is one.
  if (project.assigneeId && authorId === project.assigneeId) return project.ownerId ?? null
  if (project.assigneeId) return project.assigneeId
  return project.ownerId && project.ownerId !== authorId ? project.ownerId : null
}

// ─── Origin lookups ───────────────────────────────────────────────────────────

/**
 * Where the client thread should go, worked out from what the project hangs
 * off. A contact's work email first, then the account's, then the lead's.
 */
async function defaultClient(input: {
  leadId?: bigint | null
  accountId?: bigint | null
  contactId?: bigint | null
}): Promise<{ clientName: string | null; clientEmail: string | null; accountId: bigint | null }> {
  let clientName: string | null = null
  let clientEmail: string | null = null
  let accountId = input.accountId ?? null

  if (input.contactId) {
    const ct = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { firstName: true, lastName: true, email: true, accountId: true },
    })
    if (ct) {
      clientName = [ct.firstName, ct.lastName].filter(Boolean).join(' ') || null
      clientEmail = ct.email ?? null
      accountId = accountId ?? ct.accountId ?? null
    }
  }

  if (!clientEmail && accountId) {
    const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true, email: true } })
    if (acc) {
      clientName = clientName ?? acc.name
      clientEmail = acc.email ?? null
    }
  }

  if (input.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { name: true, email: true } })
    if (lead) {
      clientName = clientName ?? lead.name ?? null
      clientEmail = clientEmail ?? lead.email ?? null
    }
    // A lead that was already converted points at its account.
    if (!accountId) {
      const biz = await prisma.leadBusiness.findUnique({ where: { leadId: input.leadId }, select: { accountId: true } })
      accountId = biz?.accountId ?? null
    }
  }

  return { clientName, clientEmail, accountId }
}

/** Timeline entries on the lead and the account, so the project shows up on both. */
async function trail(
  project: { id: bigint; leadId: bigint | null; accountId: bigint | null; projectNumber: string | null; title: string },
  subject: string,
  body: string | null,
  actorId: bigint | number | null,
  meta: Record<string, unknown> = {},
) {
  const payload = { projectId: Number(project.id), projectNumber: project.projectNumber, ...meta }
  if (project.leadId) {
    await activity.recordSafe({ entityType: 'lead', entityId: project.leadId, kind: 'project', subject, body, actorId, meta: payload })
  }
  if (project.accountId) {
    await activity.recordSafe({ entityType: 'account', entityId: project.accountId, kind: 'project', subject, body, actorId, meta: payload })
  }
}

// ─── Create / update ──────────────────────────────────────────────────────────

export interface CreateProjectInput {
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
  priority?: string
  budget?: number | null
  currency?: string
  dueDate?: string | null
  clientName?: string | null
  clientEmail?: string | null
  clientCc?: string | null
  mailGroupId?: number | null
  /** The opening internal note, if any. */
  note?: string | null
}

const big = (v: number | null | undefined): bigint | null => (v == null ? null : BigInt(v))

export async function createProject(input: CreateProjectInput, user: ActingUser) {
  const leadId = big(input.leadId)
  const contactId = big(input.contactId)
  const derived = await defaultClient({ leadId, accountId: big(input.accountId), contactId })

  const created = await prisma.crmProject.create({
    data: {
      title: input.title.trim(),
      summary: input.summary?.trim() || null,
      description: input.description ?? null,
      leadId,
      accountId: derived.accountId,
      contactId,
      dealId: big(input.dealId),
      teamId: big(input.teamId),
      assigneeId: big(input.assigneeId),
      ownerId: big(input.ownerId) ?? BigInt(user.userId),
      createdById: BigInt(user.userId),
      status: input.assigneeId ? 'assigned' : 'draft',
      priority: input.priority ?? 'medium',
      budget: input.budget ?? null,
      currency: input.currency ?? 'INR',
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      clientName: input.clientName?.trim() || derived.clientName,
      clientEmail: input.clientEmail?.trim().toLowerCase() || derived.clientEmail,
      clientCc: input.clientCc?.trim() || null,
      mailGroupId: big(input.mailGroupId),
      ballWithUserId: big(input.assigneeId),
    },
  })

  // The number comes from the id, so two people creating at once can never
  // collide — see documentNumber().
  const project = await prisma.crmProject.update({
    where: { id: created.id },
    data: { projectNumber: documentNumber('PRJ', created.id) },
    include: PROJECT_INCLUDE,
  })

  await prisma.crmProjectMessage.create({
    data: {
      projectId: project.id,
      channel: 'internal',
      kind: 'system',
      authorId: BigInt(user.userId),
      body: `Project ${project.projectNumber} created.`,
    },
  })

  if (input.assigneeId) {
    await recordAssignment(project, big(input.teamId), BigInt(input.assigneeId), input.note ?? null, user)
  } else if (input.note?.trim()) {
    await prisma.crmProjectMessage.create({
      data: { projectId: project.id, channel: 'internal', kind: 'message', authorId: BigInt(user.userId), body: input.note.trim() },
    })
    await prisma.crmProject.update({ where: { id: project.id }, data: { lastInternalAt: new Date() } })
  }

  await trail(project, `Project ${project.projectNumber} opened: ${project.title}`, input.summary ?? null, user.userId)

  return getProject(project.id)
}

export interface UpdateProjectInput {
  title?: string
  summary?: string | null
  description?: string | null
  priority?: string
  budget?: number | null
  currency?: string
  dueDate?: string | null
  clientName?: string | null
  clientEmail?: string | null
  clientCc?: string | null
  mailGroupId?: number | null
  ownerId?: number | null
  contactId?: number | null
  dealId?: number | null
}

export async function updateProject(id: bigint, input: UpdateProjectInput) {
  const data: Prisma.CrmProjectUpdateInput = {}
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.summary !== undefined) data.summary = input.summary?.trim() || null
  if (input.description !== undefined) data.description = input.description
  if (input.priority !== undefined) data.priority = input.priority
  if (input.budget !== undefined) data.budget = input.budget
  if (input.currency !== undefined) data.currency = input.currency
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null
  if (input.clientName !== undefined) data.clientName = input.clientName?.trim() || null
  if (input.clientEmail !== undefined) data.clientEmail = input.clientEmail?.trim().toLowerCase() || null
  if (input.clientCc !== undefined) data.clientCc = input.clientCc?.trim() || null
  if (input.mailGroupId !== undefined) data.mailGroupId = input.mailGroupId
  if (input.ownerId !== undefined) data.owner = input.ownerId ? { connect: { id: BigInt(input.ownerId) } } : { disconnect: true }
  if (input.contactId !== undefined) data.contactId = big(input.contactId)
  if (input.dealId !== undefined) data.dealId = big(input.dealId)

  await prisma.crmProject.update({ where: { id }, data })
  return getProject(id)
}

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * The people a project can be handed to inside one team — active members
 * only. Read live, so a rep never assigns to somebody who left last week.
 */
export async function teamMembers(teamId: bigint) {
  const rows = await prisma.crmTeamMember.findMany({
    where: { teamId, user: { status: 1 } },
    include: { user: USER_SEL },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
  })
  return rows.map((r) => ({ ...bigintFix(r.user), memberRole: r.role }))
}

async function recordAssignment(
  project: { id: bigint; leadId: bigint | null; accountId: bigint | null; projectNumber: string | null; title: string; status: string },
  teamId: bigint | null,
  assigneeId: bigint,
  note: string | null,
  user: ActingUser,
) {
  const [team, assignee] = await Promise.all([
    teamId ? prisma.crmTeam.findUnique({ where: { id: teamId }, select: { name: true } }) : null,
    prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } }),
  ])
  const line = `Assigned to ${assignee?.name ?? 'someone'}${team ? ` (${team.name})` : ''}.`

  await prisma.crmProjectMessage.create({
    data: {
      projectId: project.id,
      channel: 'internal',
      kind: 'assignment',
      authorId: BigInt(user.userId),
      body: note?.trim() ? `${line}\n\n${note.trim()}` : line,
      meta: { teamId: teamId ? Number(teamId) : null, assigneeId: Number(assigneeId) },
    },
  })

  await prisma.crmProject.update({
    where: { id: project.id },
    data: {
      teamId,
      assigneeId,
      ballWithUserId: assigneeId,
      lastInternalAt: new Date(),
      // Sending it to a team restarts the internal loop, unless the project is
      // already over — reassigning a closed project does not reopen it.
      ...(TERMINAL_STATUSES.includes(project.status as ProjectStatus) ? {} : { status: 'assigned' }),
    },
  })

  await trail(project, `${project.projectNumber} ${line}`, note, user.userId, { assigneeId: Number(assigneeId) })

  if (Number(assigneeId) !== user.userId) {
    await notifyUser(assigneeId, 'assigned', project, { by: user.name ?? null, excerpt: note })
  }
}

export async function assignProject(
  id: bigint,
  input: { teamId?: number | null; assigneeId: number; note?: string | null },
  user: ActingUser,
) {
  const project = await prisma.crmProject.findUnique({ where: { id } })
  if (!project || project.trash) throw new NotFound()

  const assigneeId = BigInt(input.assigneeId)
  const teamId = input.teamId != null ? BigInt(input.teamId) : project.teamId

  const assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true, status: true } })
  if (!assignee || assignee.status !== 1) throw new Invalid('That person is not an active team member.')

  if (teamId) {
    const member = await prisma.crmTeamMember.count({ where: { teamId, userId: assigneeId } })
    if (!member) throw new Invalid('That person is not in the chosen team. Add them to the team first, or pick another team.')
  }

  await recordAssignment(project, teamId, assigneeId, input.note ?? null, user)
  return getProject(id)
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function setStatus(id: bigint, status: ProjectStatus, note: string | null, user: ActingUser) {
  const project = await prisma.crmProject.findUnique({ where: { id } })
  if (!project || project.trash) throw new NotFound()
  if (project.status === status && !note) return getProject(id)

  const label = status.replace(/_/g, ' ')
  await prisma.crmProjectMessage.create({
    data: {
      projectId: id,
      channel: 'internal',
      kind: 'status',
      authorId: BigInt(user.userId),
      body: note?.trim() ? `Status → ${label}.\n\n${note.trim()}` : `Status → ${label}.`,
      meta: { from: project.status, to: status },
    },
  })

  const terminal = TERMINAL_STATUSES.includes(status)
  await prisma.crmProject.update({
    where: { id },
    data: {
      status,
      lastInternalAt: new Date(),
      closedAt: terminal ? new Date() : null,
      // A finished project waits on nobody. A proposal marked ready goes back
      // to the rep, who is the one who sends it out.
      ballWithUserId: terminal ? null : status === 'proposal_ready' ? project.ownerId : project.ballWithUserId,
    },
  })

  await trail(project, `${project.projectNumber} marked ${label}`, note, user.userId, { status })
  return getProject(id)
}

// ─── Files ────────────────────────────────────────────────────────────────────

export interface UploadedFile {
  path: string
  originalname: string
  mimetype: string
  size: number
}

async function storeFiles(
  projectId: bigint,
  messageId: bigint | null,
  files: UploadedFile[],
  uploadedById: bigint | null,
) {
  if (!files.length) return []
  const rows = await Promise.all(
    files.map((f) =>
      prisma.crmProjectFile.create({
        data: {
          projectId,
          messageId,
          filePath: storedUploadPath(f),
          fileName: f.originalname.slice(0, 255),
          fileType: f.mimetype.slice(0, 120),
          fileSize: BigInt(f.size),
          uploadedById,
        },
      }),
    ),
  )
  return rows
}

export async function addProjectFiles(id: bigint, files: UploadedFile[], user: ActingUser) {
  const project = await prisma.crmProject.findUnique({ where: { id }, select: { id: true, trash: true } })
  if (!project || project.trash) throw new NotFound()
  const rows = await storeFiles(id, null, files, BigInt(user.userId))
  return rows.map(serializeFile)
}

export async function removeProjectFile(id: bigint, fileId: bigint, user: ActingUser) {
  const file = await prisma.crmProjectFile.findFirst({ where: { id: fileId, projectId: id } })
  if (!file) throw new NotFound()
  if (!isPrivileged(user) && file.uploadedById !== BigInt(user.userId)) {
    throw new Invalid('Only the person who uploaded a file, or a manager, can remove it.')
  }
  await prisma.crmProjectFile.delete({ where: { id: fileId } })
  // The bytes go too. Best-effort: a missing file is already gone.
  try {
    fs.unlinkSync(uploadDiskPath(file.filePath))
  } catch {
    /* already gone */
  }
}

// ─── Internal thread ──────────────────────────────────────────────────────────

export async function postInternal(
  id: bigint,
  input: { body: string; kind?: 'message' | 'proposal'; files?: UploadedFile[] },
  user: ActingUser,
) {
  const project = await prisma.crmProject.findUnique({ where: { id } })
  if (!project || project.trash) throw new NotFound()

  const me = BigInt(user.userId)
  const message = await prisma.crmProjectMessage.create({
    data: {
      projectId: id,
      channel: 'internal',
      kind: input.kind ?? 'message',
      authorId: me,
      body: input.body,
    },
  })
  const files = await storeFiles(id, message.id, input.files ?? [], me)

  const fromAssignee = !!project.assigneeId && project.assigneeId === me
  const ball = nextBall(project, me)
  await prisma.crmProject.update({
    where: { id },
    data: {
      lastInternalAt: new Date(),
      ballWithUserId: ball,
      // The assignee's first word back moves it out of "assigned"; marking
      // something a proposal says it is ready to send.
      ...(input.kind === 'proposal' && !TERMINAL_STATUSES.includes(project.status as ProjectStatus)
        ? { status: 'proposal_ready' }
        : fromAssignee && project.status === 'assigned'
          ? { status: 'in_review' }
          : {}),
    },
  })

  if (ball && ball !== me) {
    await notifyUser(ball, input.kind === 'proposal' ? 'proposal_ready' : 'reply', project, { by: user.name ?? null, excerpt: input.body })
  }

  return serializeMessage({ ...message, author: await prisma.user.findUnique({ where: { id: me }, ...USER_SEL }), files })
}

// ─── External thread (email) ──────────────────────────────────────────────────

export interface SendExternalInput {
  subject?: string | null
  body: string
  to?: string | null
  cc?: string | null
  /** Freshly uploaded with this message. */
  files?: UploadedFile[]
  /** Already on the project — attach these too. */
  attachFileIds?: number[]
  mailGroupId?: number | null
}

function splitAddresses(v: string | null | undefined): string[] {
  return (v ?? '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
}

/** The token every outgoing subject carries, and the fallback match for replies. */
export function subjectToken(projectNumber: string | null): string {
  return projectNumber ? `[${projectNumber}]` : ''
}

function withToken(subject: string, projectNumber: string | null): string {
  const token = subjectToken(projectNumber)
  if (!token || subject.includes(token)) return subject
  return `${subject} ${token}`
}

async function externalChain(projectId: bigint): Promise<{ inReplyTo?: string; references: string[] }> {
  const rows = await prisma.crmProjectMessage.findMany({
    where: { projectId, channel: 'external', messageId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { messageId: true },
  })
  const ids = rows.map((r) => r.messageId!).filter(Boolean)
  return { inReplyTo: ids[ids.length - 1], references: ids.slice(-20) }
}

export async function sendExternal(id: bigint, input: SendExternalInput, user: ActingUser) {
  const project = await prisma.crmProject.findUnique({ where: { id }, include: { owner: USER_SEL } })
  if (!project || project.trash) throw new NotFound()

  const to = splitAddresses(input.to || project.clientEmail)
  if (!to.length) throw new Invalid('No client email. Add one to the project first.')
  const cc = splitAddresses(input.cc ?? project.clientCc)

  const subject = withToken(
    (input.subject?.trim() || `Proposal: ${project.title}`).slice(0, 480),
    project.projectNumber,
  )

  const groupId = input.mailGroupId != null ? BigInt(input.mailGroupId) : project.mailGroupId
  const group: CampaignGroup | null = groupId
    ? await prisma.campaignGroup.findFirst({ where: { id: groupId, isActive: true } })
    : null

  // Row first, so a crash mid-send still leaves a record of the attempt.
  const me = BigInt(user.userId)
  const message = await prisma.crmProjectMessage.create({
    data: {
      projectId: id,
      channel: 'external',
      direction: 'out',
      kind: 'proposal',
      authorId: me,
      fromEmail: group?.fromEmail ?? process.env.SMTP_FROM ?? null,
      fromName: group?.fromName ?? currentTenant()?.companyName ?? null,
      toEmail: to.join(', ').slice(0, 500),
      cc: cc.length ? cc.join(', ').slice(0, 500) : null,
      subject,
      body: input.body,
      deliveryStatus: 'pending',
    },
  })

  const newFiles = await storeFiles(id, message.id, input.files ?? [], me)
  const existing = input.attachFileIds?.length
    ? await prisma.crmProjectFile.findMany({
        where: { projectId: id, id: { in: input.attachFileIds.map((x) => BigInt(x)) } },
      })
    : []

  const attachments = [...newFiles, ...existing].map((f) => ({
    filename: f.fileName,
    path: uploadDiskPath(f.filePath),
    contentType: f.fileType ?? undefined,
  }))

  const chain = await externalChain(id)
  // Everything on the chain except the row we just made, which has no id yet.
  const references = chain.references

  const html = renderExternalHtml(input.body, project)
  const replyTo = group?.fromEmail || project.owner?.email || user.email || undefined

  // Also in sent_mails, so Sent History and the reports see it like any other
  // mail this rep sent.
  const sent = await prisma.sentMail.create({
    data: {
      leadId: project.leadId,
      userId: me,
      toEmail: to[0].slice(0, 200),
      subject: subject.slice(0, 200),
      body: input.body,
      status: 'pending',
      groupId: group?.id ?? null,
    },
  })

  try {
    let messageId: string | null = null
    if (group) {
      const r = await sendViaGroup(group, {
        to: to[0],
        toName: project.clientName,
        subject,
        html,
        inReplyTo: chain.inReplyTo,
        references: references.length ? references : undefined,
        cc: [...to.slice(1), ...cc],
        replyTo,
        attachments,
      })
      messageId = r.messageId || null
    } else {
      const info = await emailService.send({
        to,
        cc: cc.length ? cc : undefined,
        subject,
        html,
        replyTo,
        attachments,
        inReplyTo: chain.inReplyTo,
        references: references.length ? references : undefined,
      })
      messageId = info.messageId ? String(info.messageId) : null
    }

    await prisma.crmProjectMessage.update({
      where: { id: message.id },
      data: { deliveryStatus: 'sent', messageId, inReplyTo: chain.inReplyTo ?? null, sentMailId: sent.id },
    })
    await prisma.sentMail.update({ where: { id: sent.id }, data: { status: 'sent', messageId } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.crmProjectMessage.update({
      where: { id: message.id },
      data: { deliveryStatus: 'failed', errorMessage: msg.slice(0, 500), sentMailId: sent.id },
    })
    await prisma.sentMail.update({ where: { id: sent.id }, data: { status: 'failed', errorMessage: msg.slice(0, 500) } })
    throw new SendFailed(msg)
  }

  const now = new Date()
  await prisma.crmProject.update({
    where: { id },
    data: {
      lastExternalAt: now,
      sentToClientAt: project.sentToClientAt ?? now,
      // Waiting on the client now — nobody inside has the ball.
      ballWithUserId: null,
      ...(TERMINAL_STATUSES.includes(project.status as ProjectStatus) ? {} : { status: 'sent_to_client' }),
      // Remember the mailbox and address for the next message on this thread.
      ...(group && !project.mailGroupId ? { mailGroupId: group.id } : {}),
      ...(!project.clientEmail ? { clientEmail: to[0] } : {}),
    },
  })

  await trail(
    project,
    `${project.projectNumber} sent to ${to.join(', ')}: ${subject}`,
    stripHtml(input.body).slice(0, 2000),
    user.userId,
    { messageId: Number(message.id), to },
  )

  return getProject(id)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderExternalHtml(body: string, project: { projectNumber: string | null; title: string }): string {
  // A body typed as plain text (no tags at all) still needs its line breaks.
  const inner = /<[a-z][^>]*>/i.test(body) ? body : escapeHtml(body).replace(/\n/g, '<br>')
  const company = currentTenant()?.companyName ?? ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;">
${inner}
<p style="margin-top:28px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:10px;">
${escapeHtml(company)}${company ? ' · ' : ''}Ref ${escapeHtml(project.projectNumber ?? '')} · ${escapeHtml(project.title)}
</p>
</div>`
}

// ─── Inbound: a client replied ────────────────────────────────────────────────

export interface InboundLike {
  id: bigint
  messageId: string | null
  inReplyTo: string | null
  fromEmail: string
  fromName: string | null
  subject: string
  bodyHtml: string | null
  bodyText: string | null
  receivedAt: Date
  leadId: bigint | null
}

const TOKEN_RE = /\[(PRJ-\d{6,})\]/

/**
 * Match an inbound mail to a project and put it on the thread.
 *
 * Returns the project id when it matched, null when this was not a reply to
 * any project — which is most mail, and is not an error.
 *
 * Order of evidence:
 *   1. In-Reply-To / References naming a Message-ID we sent.
 *   2. The [PRJ-000012] token in the subject, for clients whose mail app
 *      dropped the headers (some webmail does).
 */
export async function attachInbound(
  inbound: InboundLike,
  opts: { references?: string[]; raw?: string } = {},
): Promise<bigint | null> {
  const candidates = [inbound.inReplyTo, ...(opts.references ?? [])].filter((x): x is string => !!x)

  let projectId: bigint | null = null
  if (candidates.length) {
    const hit = await prisma.crmProjectMessage.findFirst({
      where: { messageId: { in: candidates } },
      select: { projectId: true },
      orderBy: { createdAt: 'desc' },
    })
    projectId = hit?.projectId ?? null
  }
  if (!projectId) {
    const m = TOKEN_RE.exec(inbound.subject || '')
    if (m) {
      const p = await prisma.crmProject.findUnique({ where: { projectNumber: m[1] }, select: { id: true } })
      projectId = p?.id ?? null
    }
  }
  if (!projectId) return null

  // Idempotent on the inbound row — the poller is at-least-once.
  const dup = await prisma.crmProjectMessage.count({ where: { inboundMailId: inbound.id } })
  if (dup) return projectId

  const project = await prisma.crmProject.findUnique({ where: { id: projectId } })
  if (!project) return null

  const message = await prisma.crmProjectMessage.create({
    data: {
      projectId,
      channel: 'external',
      direction: 'in',
      kind: 'message',
      fromEmail: inbound.fromEmail.slice(0, 200),
      fromName: inbound.fromName?.slice(0, 160) ?? null,
      toEmail: null,
      subject: inbound.subject?.slice(0, 500) ?? null,
      body: inbound.bodyHtml || inbound.bodyText || '(empty message)',
      messageId: inbound.messageId,
      inReplyTo: inbound.inReplyTo,
      inboundMailId: inbound.id,
      createdAt: inbound.receivedAt,
    },
  })

  // Whatever they attached — a signed PDF, a marked-up screenshot — belongs on
  // the thread as much as the words do.
  if (opts.raw) {
    try {
      const saved = extractMimeAttachments(opts.raw)
      if (saved.length) await storeFiles(projectId, message.id, saved, null)
    } catch (err) {
      console.error('[projects] could not extract attachments from inbound', Number(inbound.id), err)
    }
  }

  await prisma.crmProject.update({
    where: { id: projectId },
    data: {
      lastExternalAt: inbound.receivedAt,
      lastClientReplyAt: inbound.receivedAt,
      ballWithUserId: project.ownerId ?? project.assigneeId,
      ...(TERMINAL_STATUSES.includes(project.status as ProjectStatus) ? {} : { status: 'client_replied' }),
    },
  })

  // The inbox's own lead link, when the poller could not work it out from the
  // sender address (a colleague of the contact replying, say).
  if (!inbound.leadId && project.leadId) {
    await prisma.inboundMail.update({ where: { id: inbound.id }, data: { leadId: project.leadId } }).catch(() => undefined)
  }

  await trail(
    project,
    `${project.projectNumber}: reply from ${inbound.fromName || inbound.fromEmail}`,
    (inbound.bodyText || stripHtml(inbound.bodyHtml || '')).slice(0, 2000),
    null,
    { messageId: Number(message.id), from: inbound.fromEmail },
  )

  await notifyUser(project.ownerId ?? project.assigneeId, 'client_reply', project, {
    by: inbound.fromName || inbound.fromEmail,
    excerpt: inbound.bodyText || stripHtml(inbound.bodyHtml || ''),
  })

  return projectId
}

// ─── A small MIME walker for attachments ─────────────────────────────────────
//
// The poller stores the text parts of a mail and nothing else. For a proposal
// thread the attachments ARE the reply half the time — a signed PDF back, a
// screenshot of the bit they want changed — so they are pulled out here and
// stored like any other project file.
//
// Not a full MIME implementation: multipart nesting, base64 and
// quoted-printable bodies, RFC 2047 encoded filenames. That covers what mail
// clients actually send. Anything it cannot read is skipped, never thrown.

interface MimePart {
  headers: Record<string, string>
  body: string
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Unfold continuation lines first.
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

function splitPart(raw: string): MimePart {
  const m = /\r?\n\r?\n/.exec(raw)
  if (!m) return { headers: parseHeaders(raw), body: '' }
  return { headers: parseHeaders(raw.slice(0, m.index)), body: raw.slice(m.index + m[0].length) }
}

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null
  const m = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(contentType)
  return m ? m[1].trim() : null
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*(?:\\r?\\n|$)`))
  // First chunk is the preamble, last is the epilogue.
  return parts.slice(1, -1).filter((p) => p.trim().length > 0)
}

/** RFC 2047: =?UTF-8?B?...?= and =?UTF-8?Q?...?= inside a header value. */
function decodeWord(v: string): string {
  return v.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, charset: string, enc: string, text: string) => {
    try {
      if (enc.toUpperCase() === 'B') return new TextDecoder(charset).decode(Buffer.from(text, 'base64'))
      const bytes: number[] = []
      const t = text.replace(/_/g, ' ')
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) {
          bytes.push(parseInt(t.substr(i + 1, 2), 16))
          i += 2
        } else bytes.push(t.charCodeAt(i) & 0xff)
      }
      return new TextDecoder(charset).decode(new Uint8Array(bytes))
    } catch {
      return text
    }
  })
}

function filenameOf(h: Record<string, string>): string | null {
  const cd = h['content-disposition'] ?? ''
  const ct = h['content-type'] ?? ''
  // RFC 2231: filename*=UTF-8''name%20here.pdf
  const ext = /filename\*\s*=\s*([^']*)'[^']*'([^;\r\n]+)/i.exec(cd)
  if (ext) {
    try {
      return decodeURIComponent(ext[2].trim())
    } catch {
      /* fall through */
    }
  }
  const m = /filename\s*=\s*"?([^";\r\n]+)"?/i.exec(cd) || /name\s*=\s*"?([^";\r\n]+)"?/i.exec(ct)
  return m ? decodeWord(m[1].trim()) : null
}

function decodeBodyBytes(body: string, encoding: string): Buffer {
  const enc = encoding.toLowerCase().trim()
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64')
  if (enc === 'quoted-printable') {
    const stripped = body.replace(/=\r?\n/g, '')
    const bytes: number[] = []
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(stripped.substr(i + 1, 2))) {
        bytes.push(parseInt(stripped.substr(i + 1, 2), 16))
        i += 2
      } else bytes.push(stripped.charCodeAt(i) & 0xff)
    }
    return Buffer.from(bytes)
  }
  return Buffer.from(body, 'latin1')
}

const MAX_INBOUND_ATTACHMENT = 50 * 1024 * 1024
const MAX_INBOUND_TOTAL = 150 * 1024 * 1024

function walk(part: MimePart, out: UploadedFile[], budget: { left: number }): void {
  const ct = part.headers['content-type'] ?? 'text/plain'
  const boundary = boundaryOf(ct)

  if (/^multipart\//i.test(ct) && boundary) {
    for (const chunk of splitMultipart(part.body, boundary)) walk(splitPart(chunk), out, budget)
    return
  }

  const disposition = part.headers['content-disposition'] ?? ''
  const name = filenameOf(part.headers)
  const isAttachment = /^attachment/i.test(disposition) || (!!name && !/^text\/(plain|html)/i.test(ct))
  if (!isAttachment || !name) return

  const bytes = decodeBodyBytes(part.body, part.headers['content-transfer-encoding'] ?? '7bit')
  if (!bytes.length || bytes.length > MAX_INBOUND_ATTACHMENT || bytes.length > budget.left) return
  budget.left -= bytes.length

  const mime = ct.split(';')[0].trim().toLowerCase() || 'application/octet-stream'
  const ext = path.extname(name)
  const base = path.basename(name, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50) || 'attachment'
  const dir = currentUploadsDir()
  fs.mkdirSync(dir, { recursive: true })
  const stored = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}${ext}`)
  fs.writeFileSync(stored, bytes)
  out.push({ path: stored, originalname: name, mimetype: mime, size: bytes.length })
}

/** Every attachment in a raw RFC 822 message, written to the current customer's uploads. */
export function extractMimeAttachments(raw: string): UploadedFile[] {
  const out: UploadedFile[] = []
  walk(splitPart(raw), out, { left: MAX_INBOUND_TOTAL })
  return out
}

/** The References header of a raw message, split into ids. */
export function referencesOf(raw: string): string[] {
  const m = /(^|\r?\n)References:\s*((?:.+(?:\r?\n[ \t]+.+)*))/i.exec(raw)
  if (!m) return []
  return m[2].replace(/\r?\n[ \t]+/g, ' ').split(/\s+/).filter((x) => x.startsWith('<'))
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getProject(id: bigint) {
  const p = await prisma.crmProject.findFirst({
    where: { id, trash: 0 },
    include: {
      ...PROJECT_INCLUDE,
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: USER_SEL, files: true },
      },
      files: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { id: true, name: true } } } },
    },
  })
  if (!p) return null

  const [lead, account, contact, ball, mailbox, deal] = await Promise.all([
    p.leadId
      ? prisma.lead.findUnique({ where: { id: p.leadId }, select: { id: true, name: true, email: true, mobile: true, leadStatus: true } })
      : null,
    p.accountId ? prisma.account.findUnique({ where: { id: p.accountId }, select: { id: true, name: true, email: true, phone: true } }) : null,
    p.contactId
      ? prisma.contact.findUnique({ where: { id: p.contactId }, select: { id: true, firstName: true, lastName: true, email: true, mobile: true } })
      : null,
    p.ballWithUserId ? prisma.user.findUnique({ where: { id: p.ballWithUserId }, select: { id: true, name: true } }) : null,
    p.mailGroupId ? prisma.campaignGroup.findUnique({ where: { id: p.mailGroupId }, select: { id: true, name: true, fromEmail: true, imapHost: true } }) : null,
    p.dealId ? prisma.deal.findUnique({ where: { id: p.dealId }, select: { id: true, name: true, dealNumber: true } }) : null,
  ])

  const { messages, files, ...rest } = p
  return {
    ...serializeProject(rest),
    lead: lead ? bigintFix(lead) : null,
    account: account ? bigintFix(account) : null,
    contact: contact
      ? { ...bigintFix(contact), fullName: [contact.firstName, contact.lastName].filter(Boolean).join(' ') }
      : null,
    ballWith: ball ? bigintFix(ball) : null,
    deal: deal ? bigintFix(deal) : null,
    mailbox: mailbox ? { ...bigintFix(mailbox), canReceive: !!mailbox.imapHost, imapHost: undefined } : null,
    messages: messages.map(serializeMessage),
    files: files.map(serializeFile),
  }
}

export interface ListQuery {
  status?: string
  teamId?: string
  assigneeId?: string
  ownerId?: string
  leadId?: string
  accountId?: string
  dealId?: string
  search?: string
  /** Only projects waiting on me. */
  mine?: string
  priority?: string
  page: number
  limit: number
  skip: number
}

export async function listProjects(q: ListQuery, user: ActingUser) {
  const scope = await projectScope(user)
  const statuses = q.status ? q.status.split(',').filter(Boolean) : []
  const where: Prisma.CrmProjectWhereInput = {
    trash: 0,
    ...scope,
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(q.teamId ? { teamId: BigInt(q.teamId) } : {}),
    ...(q.assigneeId ? { assigneeId: BigInt(q.assigneeId) } : {}),
    ...(q.ownerId ? { ownerId: BigInt(q.ownerId) } : {}),
    ...(q.leadId ? { leadId: BigInt(q.leadId) } : {}),
    ...(q.accountId ? { accountId: BigInt(q.accountId) } : {}),
    ...(q.dealId ? { dealId: BigInt(q.dealId) } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.mine === '1' ? { ballWithUserId: BigInt(user.userId) } : {}),
    ...(q.search?.trim()
      ? {
          OR: [
            { title: { contains: q.search.trim(), mode: 'insensitive' } },
            { summary: { contains: q.search.trim(), mode: 'insensitive' } },
            { projectNumber: { contains: q.search.trim().toUpperCase() } },
            { clientName: { contains: q.search.trim(), mode: 'insensitive' } },
            { clientEmail: { contains: q.search.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  // The scope is itself an OR; combining two ORs needs AND.
  const finalWhere: Prisma.CrmProjectWhereInput =
    scope.OR && where.OR ? { ...where, OR: undefined, AND: [{ OR: scope.OR }, { OR: where.OR }] } : where

  const [rows, total] = await Promise.all([
    prisma.crmProject.findMany({
      where: finalWhere,
      include: PROJECT_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
      skip: q.skip,
      take: q.limit,
    }),
    prisma.crmProject.count({ where: finalWhere }),
  ])

  return {
    data: rows.map(serializeProject),
    total,
    page: q.page,
    limit: q.limit,
    totalPages: Math.max(1, Math.ceil(total / q.limit)),
  }
}

/** The numbers the Projects page and the lead panel open with. */
export async function summary(user: ActingUser) {
  const scope = await projectScope(user)
  const me = BigInt(user.userId)
  const base = { trash: 0, ...scope }

  const [byStatus, waitingOnMe, awaitingClient, overdue] = await Promise.all([
    prisma.crmProject.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.crmProject.count({ where: { ...base, ballWithUserId: me } }),
    prisma.crmProject.count({ where: { ...base, status: 'sent_to_client' } }),
    prisma.crmProject.count({
      where: { ...base, dueDate: { lt: new Date() }, status: { notIn: TERMINAL_STATUSES } },
    }),
  ])

  const counts: Record<string, number> = {}
  for (const s of PROJECT_STATUSES) counts[s] = 0
  for (const row of byStatus) counts[row.status] = row._count._all

  return {
    byStatus: counts,
    open: Object.entries(counts)
      .filter(([k]) => !TERMINAL_STATUSES.includes(k as ProjectStatus))
      .reduce((t, [, v]) => t + v, 0),
    waitingOnMe,
    awaitingClient,
    overdue,
  }
}

/** Projects waiting on one person — what the bell shows. */
export async function waitingOn(userId: number, take = 50) {
  return prisma.crmProject.findMany({
    where: { trash: 0, ballWithUserId: BigInt(userId), status: { notIn: TERMINAL_STATUSES } },
    select: { id: true, projectNumber: true, title: true, status: true, updatedAt: true, dueDate: true, clientName: true },
    orderBy: { updatedAt: 'desc' },
    take,
  })
}

/**
 * An approved project becomes a deal.
 *
 * The brief was priced and the client said yes; from here on it is money to
 * be quoted, ordered and invoiced, which is the deal's job. The deal takes the
 * project's title, budget, account, contact, lead and owner, lands in the
 * default pipeline's first stage, and the project remembers it — so the deal
 * page shows the project and the project page shows the deal.
 */
export async function convertToDeal(id: bigint, user: ActingUser) {
  const project = await prisma.crmProject.findUnique({ where: { id } })
  if (!project || project.trash) throw new NotFound()
  if (project.dealId) {
    const existing = await prisma.deal.findUnique({ where: { id: project.dealId }, select: { id: true, name: true, dealNumber: true } })
    if (existing) throw new Invalid(`This project is already deal ${existing.dealNumber ?? existing.name}.`)
  }

  const pipeline =
    (await prisma.pipeline.findFirst({ where: { isDefault: true, active: true } })) ??
    (await prisma.pipeline.findFirst({ where: { active: true }, orderBy: { priority: 'asc' } }))
  if (!pipeline) throw new Invalid('No pipeline has been set up yet. Create one under Pipelines first.')
  const stage = await prisma.pipelineStage.findFirst({ where: { pipelineId: pipeline.id, active: true }, orderBy: { sortOrder: 'asc' } })
  if (!stage) throw new Invalid('That pipeline has no stages.')

  // A project opened from a converted lead may predate the conversion; take
  // the account the lead became if the project has none of its own.
  let accountId = project.accountId
  let contactId = project.contactId
  if (!accountId && project.leadId) {
    const biz = await prisma.leadBusiness.findUnique({ where: { leadId: project.leadId }, select: { accountId: true, contactId: true } })
    accountId = biz?.accountId ?? null
    contactId = contactId ?? biz?.contactId ?? null
  }

  const deal = await prisma.deal.create({
    data: {
      name: project.title,
      accountId,
      primaryContactId: contactId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: project.ownerId ?? BigInt(user.userId),
      value: project.budget ?? null,
      currency: project.currency,
      expectedCloseDate: project.dueDate,
      source: 'project',
      nextStep: 'Raise the quote from the approved proposal',
      leadId: project.leadId,
      notes: project.summary ?? null,
      createdById: BigInt(user.userId),
    },
  })
  const numbered = await prisma.deal.update({ where: { id: deal.id }, data: { dealNumber: `DEAL-${String(deal.id).padStart(6, '0')}` } })

  await prisma.crmProject.update({ where: { id }, data: { dealId: deal.id } })
  await prisma.crmProjectMessage.create({
    data: { projectId: id, channel: 'internal', kind: 'system', authorId: BigInt(user.userId), body: `Opened as deal ${numbered.dealNumber}.`, meta: { dealId: Number(deal.id) } },
  })

  await activity.recordSafe({ entityType: 'deal', entityId: deal.id, kind: 'project', subject: `Opened from project ${project.projectNumber}: ${project.title}`, actorId: user.userId, meta: { projectId: Number(id) } })
  await trail(project, `${project.projectNumber} opened as deal ${numbered.dealNumber}`, null, user.userId, { dealId: Number(deal.id) })

  return { dealId: Number(deal.id), dealNumber: numbered.dealNumber, project: await getProject(id) }
}

export async function softDelete(id: bigint) {
  await prisma.crmProject.update({ where: { id }, data: { trash: 1 } })
}

/** The mailboxes an external thread can be sent from. */
export async function mailboxes() {
  const groups = await prisma.campaignGroup.findMany({
    where: { isActive: true },
    select: { id: true, name: true, fromName: true, fromEmail: true, imapHost: true },
    orderBy: { name: 'asc' },
  })
  return groups.map((g) => ({
    id: Number(g.id),
    name: g.name,
    fromName: g.fromName,
    fromEmail: g.fromEmail,
    /** Replies come back onto the thread only from a mailbox the poller reads. */
    canReceive: !!g.imapHost,
  }))
}

// ─── Errors the routes turn into status codes ────────────────────────────────

export class NotFound extends Error {
  constructor() {
    super('Project not found')
  }
}
export class Invalid extends Error {}
export class SendFailed extends Error {}
