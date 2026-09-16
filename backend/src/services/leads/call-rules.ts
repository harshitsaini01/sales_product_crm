/**
 * Pure business rules for "POST /leads/:id/call".
 *
 * Given a current leadStatus and a call outcome, decide:
 *   - what (if anything) the new canonical status should be
 *   - whether to schedule an auto follow-up N days from today
 *
 * Keeping this as a pure function (no DB, no I/O) means it's easy to unit-test
 * and easy to tweak without touching the route handler.
 */

export type CallOutcome =
  | 'answered'
  | 'not_answered'
  | 'declined'
  | 'busy'
  | 'wrong_number'
  | 'switched_off'

export interface AutoTransition {
  /** Target lead status title, or null to leave unchanged. */
  toStatus: string | null
  /** Days from today to schedule follow-up; null = no auto follow-up. */
  followupIn: number | null
}

const FRESH_STATUSES = new Set(['Fresh', 'New', 'new'])

/**
 * Canonical lifecycle stage titles (must match seed rows in lead_statuses).
 *   Fresh → Contacted → Follow-up → (Not Interested | Converted | Closed)
 */
export function resolveAutoTransition(
  currentStatus: string | null,
  outcome: CallOutcome,
): AutoTransition {
  switch (outcome) {
    case 'answered':
      // First successful contact → move to "Contacted". Otherwise leave it
      // to the counsellor to set a richer sub-status via a followup.
      if (!currentStatus || FRESH_STATUSES.has(currentStatus)) {
        return { toStatus: 'Contacted', followupIn: null }
      }
      return { toStatus: null, followupIn: null }

    case 'not_answered':
      return { toStatus: 'Follow-up', followupIn: 1 }

    case 'busy':
      return { toStatus: 'Follow-up', followupIn: 1 }

    case 'switched_off':
      return { toStatus: 'Follow-up', followupIn: 2 }

    case 'declined':
      return { toStatus: 'Not Interested', followupIn: null }

    case 'wrong_number':
      return { toStatus: 'Closed', followupIn: null }

    default:
      return { toStatus: null, followupIn: null }
  }
}
