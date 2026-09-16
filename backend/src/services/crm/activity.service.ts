// ─────────────────────────────────────────────────────────────────────────────
// The activity timeline.
//
// One append-only table so an account, contact or lead page renders its whole
// history from ONE ordered query, instead of merging call logs, sent mail,
// follow-ups, notes and status changes in application code and hoping the sort
// comes out right.
//
// TWO WAYS A ROW GETS HERE
//
//   record()   — something happened now. Called inline from the route that did
//                it. Cheap, and the row is the source of truth for that event.
//
//   project()  — something happened in a table that predates this one (a call
//                log, a follow-up). The row over there stays authoritative and
//                this is a copy for display, keyed by (sourceType, sourceId) so
//                re-running it updates rather than duplicating.
//
// WRITES MUST NEVER BREAK THE THING THEY DESCRIBE. A timeline row is a record
// of an action, not the action — so recordSafe() swallows its own failures. A
// call that was logged successfully must not 500 because the timeline insert
// hit a constraint.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import { isEntityType, type EntityType } from '../../config/crm-entities'

export type ActivityKind =
  | 'call'
  | 'email'
  | 'whatsapp'
  | 'meeting'
  | 'note'
  /** A lead comment, mirrored onto the timeline — see lead-activity.service. */
  | 'comment'
  | 'task'
  | 'followup'
  | 'stage_change'
  | 'quote'
  | 'payment'
  /** A project created, assigned, sent to the client, or replied to. */
  | 'project'
  | 'system'

export interface RecordActivityInput {
  entityType: EntityType
  entityId: bigint | number
  kind: ActivityKind
  subject?: string | null
  body?: string | null
  actorId?: bigint | number | null
  occurredAt?: Date
  meta?: Record<string, unknown> | null
  /** Set both to make the write idempotent — see project(). */
  sourceType?: string | null
  sourceId?: bigint | number | null
}

function toBigInt(v: bigint | number | null | undefined): bigint | null {
  if (v === null || v === undefined) return null
  return typeof v === 'bigint' ? v : BigInt(v)
}

/**
 * Append one event. Throws on a bad entityType, because a typo there writes a
 * row nothing will ever read again — silent, and the worst kind of bug.
 */
export async function record(input: RecordActivityInput) {
  if (!isEntityType(input.entityType)) {
    throw new Error(`Unknown entityType "${input.entityType}" for an activity.`)
  }

  const data = {
    entityType: input.entityType,
    entityId: toBigInt(input.entityId)!,
    kind: input.kind,
    subject: input.subject?.slice(0, 255) ?? null,
    body: input.body ?? null,
    actorId: toBigInt(input.actorId),
    occurredAt: input.occurredAt ?? new Date(),
    meta: (input.meta ?? undefined) as never,
    sourceType: input.sourceType ?? null,
    sourceId: toBigInt(input.sourceId),
  }

  // With a source, upsert on it so replaying a projection is safe. Without one,
  // a plain insert — two identical manual notes a minute apart are two events.
  if (data.sourceType && data.sourceId != null) {
    return prisma.activity.upsert({
      where: { sourceType_sourceId: { sourceType: data.sourceType, sourceId: data.sourceId } },
      create: data,
      update: {
        entityType: data.entityType,
        entityId: data.entityId,
        kind: data.kind,
        subject: data.subject,
        body: data.body,
        actorId: data.actorId,
        occurredAt: data.occurredAt,
        meta: data.meta,
      },
    })
  }

  return prisma.activity.create({ data })
}

/**
 * record(), but a failure is logged and swallowed.
 *
 * Use this from inside a route that has already done the real work. The user
 * logged their call; they should not get a 500 because the audit copy of it
 * failed to insert.
 */
export async function recordSafe(input: RecordActivityInput): Promise<void> {
  try {
    await record(input)
  } catch (err) {
    console.error('[activity] could not record', input.kind, 'on', input.entityType, err)
  }
}

/** Alias that reads better at projection call sites. Same idempotent upsert. */
export const project = record

export interface TimelineScope {
  entityType: EntityType
  entityId: bigint
}

export interface TimelineQuery {
  /**
   * The records whose history to read, merged into one feed.
   *
   * Usually more than one. A lead and the account it converted into are the
   * same relationship at two points in its life, and a rep does not care which
   * side of that line a call landed on — see timelineScopes().
   */
  scopes: TimelineScope[]
  /** Restrict to these kinds. Empty or omitted means everything. */
  kinds?: ActivityKind[]
  limit?: number
  /** Keyset pagination: pass the last row's id to get the page after it. */
  before?: bigint
}

/**
 * One page of history across the given records, newest first.
 *
 * Keyset rather than offset pagination: a timeline gets appended to while
 * somebody is reading it, and OFFSET would then skip or repeat rows on every
 * scroll. `id` breaks ties within the same `occurredAt`, which matters because
 * projected rows routinely share a timestamp to the second.
 *
 * Merging several scopes is one OR in one query, so paging stays correct across
 * the union — which it would not if each side were fetched and stitched in
 * application code.
 */
export async function timeline(q: TimelineQuery) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200)
  if (!q.scopes.length) return { items: [], nextCursor: null }

  const rows = await prisma.activity.findMany({
    where: {
      OR: q.scopes.map((s) => ({ entityType: s.entityType, entityId: s.entityId })),
      ...(q.kinds?.length ? { kind: { in: q.kinds } } : {}),
      ...(q.before ? { id: { lt: q.before } } : {}),
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: { actor: { select: { id: true, name: true } } },
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  return {
    items: page.map((r) => ({
      id: Number(r.id),
      entityType: r.entityType,
      entityId: Number(r.entityId),
      kind: r.kind,
      subject: r.subject,
      body: r.body,
      occurredAt: r.occurredAt,
      meta: r.meta,
      actor: r.actor ? { id: Number(r.actor.id), name: r.actor.name } : null,
    })),
    nextCursor: hasMore ? Number(page[page.length - 1].id) : null,
  }
}

/**
 * Move an entity's whole history onto another entity.
 *
 * Used when a lead converts: the calls and emails that happened while it was a
 * lead belong on the account afterwards, or the account's timeline opens on the
 * day it was created and the sales rep loses everything that led up to it.
 */
export async function reassign(
  from: { entityType: EntityType; entityId: bigint },
  to: { entityType: EntityType; entityId: bigint },
): Promise<number> {
  const { count } = await prisma.activity.updateMany({
    where: { entityType: from.entityType, entityId: from.entityId },
    data: { entityType: to.entityType, entityId: to.entityId },
  })
  return count
}

/**
 * Delete timeline rows whose record no longer exists.
 *
 * The timeline holds (entityType, entityId) with no foreign key — deliberately,
 * so one table can describe six kinds of record. The cost is that deleting a
 * deal leaves its events behind, pointing at nothing. They are invisible from
 * every page (nothing can open a deleted deal to read them) but they are still
 * rows, they still come back in counts, and a timeline that reports events for
 * records that do not exist is a timeline nobody can trust.
 *
 * Reads the live id set per entity type once rather than probing per row: a
 * tenant with 60,000 leads should not answer 60,000 existence queries to find
 * the handful of strays.
 */
export async function pruneOrphans(): Promise<Record<string, number>> {
  const live: Record<string, Set<string>> = {
    lead: new Set((await prisma.lead.findMany({ select: { id: true } })).map((r) => String(r.id))),
    account: new Set((await prisma.account.findMany({ select: { id: true } })).map((r) => String(r.id))),
    contact: new Set((await prisma.contact.findMany({ select: { id: true } })).map((r) => String(r.id))),
    deal: new Set((await prisma.deal.findMany({ select: { id: true } })).map((r) => String(r.id))),
    quote: new Set((await prisma.quote.findMany({ select: { id: true } })).map((r) => String(r.id))),
    order: new Set((await prisma.order.findMany({ select: { id: true } })).map((r) => String(r.id))),
  }

  const rows = await prisma.activity.findMany({ select: { id: true, entityType: true, entityId: true } })
  const dead = rows.filter((r) => !live[r.entityType]?.has(String(r.entityId)))
  if (!dead.length) return {}

  const byType: Record<string, number> = {}
  for (const r of dead) byType[r.entityType] = (byType[r.entityType] ?? 0) + 1

  await prisma.activity.deleteMany({ where: { id: { in: dead.map((r) => r.id) } } })
  return byType
}
