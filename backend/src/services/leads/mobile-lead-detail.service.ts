import { prisma } from '../../lib/prisma'

/**
 * One-shot loader for everything the app's lead-detail screen renders.
 *
 * The screen used to open with seven requests — the lead itself plus notes,
 * comments, followups, timeline, history and flags in parallel — and the 60s
 * poll re-fired all seven. At ~1,460 lead views that was ~8,800 requests, each
 * paying its own `ensureAssigned` check, so ~20 database round trips to draw
 * one screen.
 *
 * Worse, `/timeline` independently re-queried history, followups, notes,
 * comments, calls and flags — the same five lists the sibling endpoints had
 * just fetched. Every list was read twice per screen open.
 *
 * This module reads each list exactly ONCE and derives both the individual
 * lists and the timeline from the same rows. The per-list shapers are exported
 * so the original endpoints (still serving older app builds) return byte-identical
 * payloads — one definition per shape, so the bundle and the singles cannot drift.
 */

// ─── Row types ───────────────────────────────────────────────────────────────
// Structural shapes rather than Prisma generics: the shapers are called both
// with rows from the bundle's queries and from the legacy endpoints' own.

interface WithUser {
  id: bigint
  createdAt: Date
  userId: bigint
  user?: { id: bigint; name: string | null } | null
}

export interface NoteRow extends WithUser {
  note: string
}
export interface CommentRow extends WithUser {
  comment: string
}
export interface FlagRow {
  id: bigint
  createdAt: Date
  userId: bigint
  message: string
  type: string
}
export interface HistoryRow {
  id: bigint
  createdAt: Date
  fromStatus: string | null
  toStatus: string
  fromSubStatus: string | null
  toSubStatus: string | null
  source: string | null
  reason: string | null
  changedBy?: { id: bigint; name: string | null } | null
}
export interface FollowupRow {
  id: bigint
  createdAt: Date
  comment: string
  followupDate: Date | string | null
  user?: { id: bigint; name: string | null } | null
}
export interface CallRow {
  id: bigint
  startedAt: Date
  direction: string
  status: string
  durationSec: number
  phoneNumber: string
}

// ─── Query limits ────────────────────────────────────────────────────────────
// Named so the bundle and the legacy endpoints cannot drift apart. `comments`
// is deliberately larger than the timeline's slice — the Comments tab shows 200
// while the timeline only ever merged the most recent 100.
const TAKE_NOTES = 100
const TAKE_COMMENTS = 200
const TAKE_COMMENTS_IN_TIMELINE = 100
const TAKE_FOLLOWUPS = 100
const TAKE_HISTORY = 100
const TAKE_CALLS = 100
const TAKE_FLAGS = 50

// ─── Shapers ─────────────────────────────────────────────────────────────────

export const shapeNotes = (rows: NoteRow[]) =>
  rows.map((n) => ({
    id: Number(n.id),
    note: n.note,
    createdAt: n.createdAt,
    userId: Number(n.userId),
    userName: n.user?.name ?? null,
  }))

export const shapeComments = (rows: CommentRow[]) =>
  rows.map((r) => ({
    id: Number(r.id),
    comment: r.comment,
    createdAt: r.createdAt,
    userId: Number(r.userId),
    userName: r.user?.name ?? null,
  }))

export const shapeHistory = (rows: HistoryRow[]) =>
  rows.map((r) => ({
    id: Number(r.id),
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    fromSubStatus: r.fromSubStatus,
    toSubStatus: r.toSubStatus,
    source: r.source,
    reason: r.reason,
    createdAt: r.createdAt,
    byName: r.changedBy?.name ?? null,
  }))

/**
 * FlagMessage has no `user` relation in Prisma, so names are hydrated from a
 * caller-supplied map. [loadFlagUserNames] builds it in one query.
 */
export type FlagUsers = Map<string, { id: bigint; name: string | null }>

export const shapeFlags = (rows: FlagRow[], users: FlagUsers) =>
  rows.map((r) => ({
    id: Number(r.id),
    message: r.message,
    type: r.type,
    createdAt: r.createdAt,
    userId: Number(r.userId),
    userName: users.get(String(r.userId))?.name ?? null,
  }))

export async function loadFlagUsers(rows: FlagRow[]): Promise<FlagUsers> {
  const ids = Array.from(new Set(rows.map((r) => r.userId)))
  if (!ids.length) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  })
  return new Map(users.map((u) => [String(u.id), u]))
}

// ─── Timeline ────────────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string
  type: 'status' | 'followup' | 'note' | 'call' | 'comment' | 'flag'
  at: string
  byId: number | null
  byName: string | null
  summary: string
  detail: string | null
}

export function buildTimeline(input: {
  history: HistoryRow[]
  followups: FollowupRow[]
  notes: NoteRow[]
  calls: CallRow[]
  comments: CommentRow[]
  flags: FlagRow[]
  flagUsers: FlagUsers
}): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const h of input.history) entries.push({
    id: `status-${h.id}`,
    type: 'status',
    at: h.createdAt.toISOString(),
    byId: h.changedBy ? Number(h.changedBy.id) : null,
    byName: h.changedBy?.name ?? null,
    summary: `${h.fromStatus ?? '—'} → ${h.toStatus}${h.toSubStatus ? ` (${h.toSubStatus})` : ''}`,
    detail: h.reason ?? (h.source ? `via ${h.source}` : null),
  })
  for (const f of input.followups) entries.push({
    id: `followup-${f.id}`,
    type: 'followup',
    at: f.createdAt.toISOString(),
    byId: f.user ? Number(f.user.id) : null,
    byName: f.user?.name ?? null,
    summary: f.comment,
    detail: f.followupDate
      ? `Next: ${new Date(f.followupDate).toLocaleDateString()}`
      : null,
  })
  for (const n of input.notes) entries.push({
    id: `note-${n.id}`,
    type: 'note',
    at: n.createdAt.toISOString(),
    byId: n.user ? Number(n.user.id) : null,
    byName: n.user?.name ?? null,
    summary: n.note,
    detail: null,
  })
  for (const cl of input.calls) entries.push({
    id: `call-${cl.id}`,
    type: 'call',
    at: cl.startedAt.toISOString(),
    byId: null,
    byName: null,
    summary: `${cl.direction} · ${cl.status}` + (cl.durationSec ? ` · ${cl.durationSec}s` : ''),
    detail: cl.phoneNumber,
  })
  for (const cm of input.comments) entries.push({
    id: `comment-${cm.id}`,
    type: 'comment',
    at: cm.createdAt.toISOString(),
    byId: cm.user ? Number(cm.user.id) : null,
    byName: cm.user?.name ?? null,
    summary: cm.comment,
    detail: null,
  })
  for (const fl of input.flags) {
    // `byId` stays null when the flagging user no longer exists — matching the
    // original timeline, which read the id off the looked-up user row rather
    // than off the flag itself.
    const u = input.flagUsers.get(String(fl.userId))
    entries.push({
      id: `flag-${fl.id}`,
      type: 'flag',
      at: fl.createdAt.toISOString(),
      byId: u ? Number(u.id) : null,
      byName: u?.name ?? null,
      summary: fl.message,
      detail: `Flag (${fl.type})`,
    })
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : -1))
  return entries
}

// ─── The bundle ──────────────────────────────────────────────────────────────

/** The lead columns the app's detail screen actually reads. */
const LEAD_SELECT = {
  id: true, name: true, mobile: true, mobile2: true, email: true,
  city: true, state: true, leadStatus: true, leadSubStatus: true,
  leadStatusId: true, leadSubStatusId: true, leadFollowStatus: true, departmentId: true,
  intrestedCourse: true, followupDate: true, comment: true,
  flagSend: true, flagRcv: true, called: true, wapp: true,
  updatedAt: true, createdAt: true, trash: true,
} as const

/**
 * Everything the detail screen needs, in one pass.
 *
 * Returns `null` when the lead does not exist or is trashed, so the caller can
 * 404 — matching what the single-lead endpoint did.
 *
 * The caller is responsible for the assignment check. Doing it here would mean
 * either passing a userId this module has no other use for, or duplicating the
 * check the route already performs.
 */
export async function loadLeadDetailBundle(leadId: bigint) {
  const [lead, history, followups, notes, comments, calls, flags] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: LEAD_SELECT }),
    prisma.leadStatusHistory.findMany({
      where: { leadId }, orderBy: { createdAt: 'desc' }, take: TAKE_HISTORY,
      include: { changedBy: { select: { id: true, name: true } } },
    }),
    prisma.leadFollowup.findMany({
      where: { stdId: leadId }, orderBy: { createdAt: 'desc' }, take: TAKE_FOLLOWUPS,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.leadNote.findMany({
      where: { leadId }, orderBy: { createdAt: 'desc' }, take: TAKE_NOTES,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.leadComment.findMany({
      where: { leadId }, orderBy: { createdAt: 'desc' }, take: TAKE_COMMENTS,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.mobileCall.findMany({
      where: { leadId, status: { not: 'TRIGGERED' } },
      orderBy: { startedAt: 'desc' }, take: TAKE_CALLS,
    }),
    prisma.flagMessage.findMany({
      where: { leadId }, orderBy: { createdAt: 'desc' }, take: TAKE_FLAGS,
    }),
  ])

  if (!lead || lead.trash === 1) return null

  const flagUsers = await loadFlagUsers(flags)

  return {
    lead,
    notes: shapeNotes(notes),
    comments: shapeComments(comments),
    // The followups endpoint returns the raw rows (via lead-followup.service's
    // getFollowups, which is this same query plus bigintFix); the route
    // bigint-fixes the whole payload, so hand back the rows unchanged.
    followups,
    history: shapeHistory(history),
    flags: shapeFlags(flags, flagUsers),
    timeline: buildTimeline({
      history,
      followups,
      notes,
      calls,
      comments: comments.slice(0, TAKE_COMMENTS_IN_TIMELINE),
      flags,
      flagUsers,
    }),
  }
}
