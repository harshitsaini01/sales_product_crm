// ─────────────────────────────────────────────────────────────────────────────
// Lead comments and notes → the timeline, and the lead ↔ account linkage that
// makes one relationship read as one story.
//
// THE PROBLEM THIS SOLVES
//
// A lead's comments live in `lead_comments` and its notes in `lead_notes` —
// both predate the timeline, and neither wrote to it. So a rep who converted a
// lead and opened the account saw "Created from lead #2" and nothing else,
// while months of conversation sat two screens away. The history was not lost;
// it was just somewhere the account could not see.
//
// ONE STORY, NOT TWO COPIES
//
// Converting does not start a new relationship — it renames an existing one. A
// call logged the day before conversion and a call logged the day after are the
// same company, the same person, the same thread, and a rep should never have
// to know which side of that line an event fell on to find it.
//
// The first version of this copied lead events onto the account at write time.
// That was wrong in a way that only showed up later: it is one-directional, so
// anything logged ON the account never came back to the lead, and the two
// timelines silently disagreed. Copying also has to be maintained forever — any
// new kind of event needs a matching mirror, and the one somebody forgets is
// invisible rather than broken.
//
// So nothing is copied. Each event is written once, on the record it actually
// happened to, and timelineScopes() resolves the pair at READ time. Two rows in
// one OR is cheaper than the write amplification was, it works for events that
// already exist without a backfill, and the two sides cannot drift because
// there is only ever one of them.
//
// Every entry still carries a UNIQUE (sourceType, sourceId), so projecting the
// same comment twice updates the row rather than duplicating it.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prisma'
import type { EntityType } from '../../config/crm-entities'
import * as activity from './activity.service'

export type LeadEntryKind = 'comment' | 'note'

const SOURCE: Record<LeadEntryKind, string> = {
  comment: 'lead_comment',
  note: 'lead_note',
}

/**
 * Put one comment or note on its lead's timeline.
 *
 * Only the lead's — the account reads through to it via timelineScopes(), so
 * writing a second copy here would render the same comment twice.
 *
 * Never throws: a comment that saved successfully must not fail because its
 * timeline copy did. Same rule as activity.recordSafe.
 */
export async function recordLeadEntry(opts: {
  kind: LeadEntryKind
  leadId: bigint
  entryId: bigint
  body: string
  actorId: bigint | number
  occurredAt?: Date
}): Promise<void> {
  const { kind, leadId, entryId, body, actorId } = opts
  const occurredAt = opts.occurredAt ?? new Date()
  const subject = kind === 'comment' ? 'Comment' : 'Note'
  const text = body.slice(0, 4000)

  try {
    await activity.record({
      entityType: 'lead',
      entityId: leadId,
      kind,
      subject,
      body: text,
      actorId,
      occurredAt,
      sourceType: SOURCE[kind],
      sourceId: entryId,
    })

  } catch (err) {
    console.error(`[lead-activity] could not mirror ${kind} ${entryId}`, err)
  }
}

/**
 * Project every existing comment and note onto its lead's timeline.
 *
 * Both tables predate the timeline, so a customer switching this on has years
 * of conversation that has never been projected. Idempotent — the unique source
 * key means a second run updates rather than duplicates.
 */
export async function backfillLeadEntries(opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 5000

  // Rows left behind by the write-time mirror this replaced. The account now
  // reads the lead's own rows, so every one of these is a second copy of an
  // event already on screen. Deleting them removes duplicates, not history.
  const { count: removed } = await prisma.activity.deleteMany({
    where: {
      OR: [
        { sourceType: { startsWith: 'acct:' } },
        { sourceType: { startsWith: 'copy:' } },
      ],
    },
  })

  const [comments, notes] = await Promise.all([
    prisma.leadComment.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      select: { id: true, leadId: true, userId: true, comment: true, createdAt: true },
    }),
    prisma.leadNote.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      select: { id: true, leadId: true, userId: true, note: true, createdAt: true },
    }),
  ])

  let projected = 0

  const rows: { kind: LeadEntryKind; id: bigint; leadId: bigint; userId: bigint; body: string; at: Date }[] = [
    ...comments.map((r) => ({
      kind: 'comment' as const, id: r.id, leadId: r.leadId, userId: r.userId,
      body: r.comment, at: r.createdAt,
    })),
    ...notes.map((r) => ({
      kind: 'note' as const, id: r.id, leadId: r.leadId, userId: r.userId,
      body: r.note, at: r.createdAt,
    })),
  ]

  for (const r of rows) {
    if (!r.body?.trim()) continue
    try {
      await activity.record({
        entityType: 'lead',
        entityId: r.leadId,
        kind: r.kind,
        subject: r.kind === 'comment' ? 'Comment' : 'Note',
        body: r.body.slice(0, 4000),
        actorId: r.userId,
        occurredAt: r.at,
        sourceType: SOURCE[r.kind],
        sourceId: r.id,
      })
      projected++
    } catch (err) {
      console.error(`[backfill] skipped ${r.kind} ${r.id}`, err instanceof Error ? err.message : err)
    }
  }

  return { comments: comments.length, notes: notes.length, projected, removed }
}

/**
 * The records whose history belongs in this record's timeline.
 *
 * Always includes the record itself. For a lead that has become an account, or
 * an account that came from a lead, it includes the other side — so the feed
 * spans the whole relationship rather than restarting at conversion.
 *
 * Deliberately does NOT walk further out to the account's contacts, deals and
 * quotes. Those already write account-scoped rows for the things an account
 * page should show ("Quote QUO-000009 accepted"), and pulling in every child
 * record's internal churn would bury the conversation the rep opened the page
 * to read.
 *
 * A failure here degrades to the record's own timeline rather than erroring:
 * a missing link should show less history, never no page.
 */
export async function timelineScopes(
  entityType: EntityType,
  entityId: bigint,
): Promise<activity.TimelineScope[]> {
  const self = { entityType, entityId }

  try {
    if (entityType === 'lead') {
      const link = await prisma.leadBusiness.findUnique({
        where: { leadId: entityId },
        select: { accountId: true },
      })
      return link?.accountId
        ? [self, { entityType: 'account' as const, entityId: link.accountId }]
        : [self]
    }

    if (entityType === 'account') {
      // findFirst, not findUnique: accountId is not unique on lead_business. In
      // practice one lead converts to one account, but merging two leads into a
      // single account is a thing reps do, and every lead behind this account
      // belongs in its history.
      const links = await prisma.leadBusiness.findMany({
        where: { accountId: entityId },
        select: { leadId: true },
      })
      return [self, ...links.map((l) => ({ entityType: 'lead' as const, entityId: l.leadId }))]
    }
  } catch (err) {
    console.error('[lead-activity] could not resolve linked scopes for', entityType, entityId, err)
  }

  return [self]
}
