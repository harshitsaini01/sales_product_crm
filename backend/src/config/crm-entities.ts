// ─────────────────────────────────────────────────────────────────────────────
// What `entityType` may be.
//
// The polymorphic satellites — activities, notes, tags, custom fields, tasks —
// store an owner as (entityType, entityId) rather than a foreign key, so one
// table serves accounts, contacts, deals and leads alike. The price of that is
// no referential integrity: nothing at the database level stops a row claiming
// entityType 'acount'. This module is where that is caught instead.
//
// Validate at EVERY write boundary. A typo'd entityType does not error — it
// silently writes a row that no query will ever read again, which is the worst
// kind of bug: no failure, no data, no clue.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../lib/prisma'

export const ENTITY_TYPES = ['lead', 'account', 'contact', 'deal', 'quote', 'order'] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

const SET = new Set<string>(ENTITY_TYPES)

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && SET.has(value)
}

/** Entities that exist today. `quote` and `order` land in Phase 3. */
export const LIVE_ENTITY_TYPES: EntityType[] = ['lead', 'account', 'contact', 'deal']

export function isLiveEntityType(value: unknown): value is EntityType {
  return isEntityType(value) && LIVE_ENTITY_TYPES.includes(value)
}

/** Human labels, for timeline headings and error messages. */
export const ENTITY_LABELS: Record<EntityType, string> = {
  lead: 'Lead',
  account: 'Account',
  contact: 'Contact',
  deal: 'Deal',
  quote: 'Quote',
  order: 'Order',
}

/**
 * Does (entityType, entityId) actually name a row?
 *
 * Called before attaching a note, tag, custom-field value or activity, because
 * a foreign key is not doing it for us. Without this a client could attach
 * notes to account 999999 forever and never see an error.
 *
 * Soft-deleted rows count as existing: a lead in the trash still has a history
 * worth reading, and refusing to load it would make the trash view useless.
 */
export async function entityExists(entityType: EntityType, entityId: bigint): Promise<boolean> {
  switch (entityType) {
    case 'lead':
      return (await prisma.lead.count({ where: { id: entityId } })) > 0
    case 'account':
      return (await prisma.account.count({ where: { id: entityId } })) > 0
    case 'contact':
      return (await prisma.contact.count({ where: { id: entityId } })) > 0
    case 'deal':
      return (await prisma.deal.count({ where: { id: entityId } })) > 0
    // Not built yet. Returning false is the safe answer: better to refuse the
    // write than to accept a reference to a table that does not exist.
    case 'quote':
    case 'order':
      return false
  }
}
