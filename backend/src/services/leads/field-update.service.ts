import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { currentTenant } from '../../lib/tenant-context'
import { isLeadFieldVisible } from '../../config/lead-fields'

// Allowlist of lead columns that can be bulk-updated. Keep this the single
// source of truth — /leads/field-update, /leads/field-preview and
// /verified/cascade-fill all read from here.
export const BULK_UPDATABLE_FIELDS = [
  'city', 'state', 'country', 'nationality',
  'source', 'event', 'website',
  'intrestedCourse', 'intrestedUniversity', 'neetQualified',
] as const
export type BulkUpdatableField = typeof BULK_UPDATABLE_FIELDS[number]

export function isBulkUpdatableField(f: string): f is BulkUpdatableField {
  return (BULK_UPDATABLE_FIELDS as readonly string[]).includes(f)
}

/**
 * The allowlist narrowed to what THIS customer can see.
 *
 * A field a super admin has switched off should not be bulk-editable through
 * the API either — the UI hides it, and this is what stops a hand-crafted
 * request from writing to it anyway.
 */
export function isBulkUpdatableForTenant(f: string): boolean {
  if (!isBulkUpdatableField(f)) return false
  const ctx = currentTenant()
  if (!ctx) return true
  return isLeadFieldVisible(ctx.leadFields, f)
}

export interface ApplyFieldUpdateInput {
  // Fields used to select the leads (find-and-replace or cascade filter).
  filterField: string
  filterValues: string[]
  // Field being written.
  writeField: string
  writeValue: string
  // Optional whitelist of lead ids (from preview approval).
  approvedLeadIds?: number[]
  actorId: bigint
  // Distinguishes cascade rows from plain field-update rows in the ops log.
  // Kept as a label on the recipe step; BulkOperation.kind stays 'field-update'
  // so the existing Undo path picks it up.
  kindLabel?: string
}

export interface ApplyFieldUpdateResult {
  message: string
  count: number
  operationId: number
}

/**
 * Shared bulk field-update primitive with before-snapshot + undo support.
 * Reused by /leads/field-update and /verified/cascade-fill.
 */
export async function applyFieldUpdate(
  input: ApplyFieldUpdateInput,
): Promise<ApplyFieldUpdateResult> {
  const { filterField, filterValues, writeField, writeValue, approvedLeadIds, actorId, kindLabel } = input

  if (!isBulkUpdatableForTenant(filterField)) throw new Error(`filterField "${filterField}" not allowed`)
  if (!isBulkUpdatableForTenant(writeField)) throw new Error(`writeField "${writeField}" not allowed`)

  const where: Prisma.LeadWhereInput = approvedLeadIds?.length
    ? { id: { in: approvedLeadIds.map((id) => BigInt(id)) }, trash: 0 }
    : { [filterField]: { in: filterValues }, trash: 0 }

  // Before-snapshot for undo (cap at 10k rows to bound memory / json size).
  const snapshotLeads = await prisma.lead.findMany({
    where,
    select: {
      id: true, leadStatus: true, leadStatusId: true, leadSubStatus: true,
      leadSubStatusId: true, departmentId: true, statusLeadTypeId: true,
      trash: true, called: true, wapp: true, event: true, source: true,
      website: true, city: true, state: true, country: true, nationality: true,
      intrestedCourse: true, intrestedUniversity: true, neetQualified: true,
      bucketExcluded: true,
    },
    take: 10_000,
    orderBy: { id: 'asc' },
  })

  const totalMatching = approvedLeadIds?.length
    ? snapshotLeads.length
    : await prisma.lead.count({ where })

  const op = await prisma.bulkOperation.create({
    data: {
      actorId,
      kind: 'field-update',
      status: 'running',
      source: 'web',
      dryRun: false,
      filter: Prisma.JsonNull,
      recipe: ([{
        type: kindLabel ?? 'field-update',
        field: writeField,
        value: writeValue,
        filterField,
        filterValues,
      }] as unknown) as Prisma.InputJsonValue,
      total: totalMatching,
      startedAt: new Date(),
      snapshot: ({
        leads: snapshotLeads.map((l) => ({ ...l, id: Number((l as any).id) })),
        assignments: [],
      } as unknown) as Prisma.InputJsonValue,
    },
  })

  try {
    const result = await prisma.lead.updateMany({ where, data: { [writeField]: writeValue } })

    await prisma.bulkOperation.update({
      where: { id: op.id },
      data: {
        status: 'completed',
        processed: result.count,
        succeeded: result.count,
        failed: 0,
        skipped: 0,
        finishedAt: new Date(),
        message: `Updated ${writeField} → "${writeValue}" on ${result.count} lead${result.count === 1 ? '' : 's'}${filterField !== writeField ? ` (via ${filterField})` : ''}`,
      },
    })

    return {
      message: `${result.count} leads updated`,
      count: result.count,
      operationId: Number(op.id),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'update failed'
    await prisma.bulkOperation.update({
      where: { id: op.id },
      data: { status: 'failed', message: msg, finishedAt: new Date() },
    })
    throw new Error(msg)
  }
}
