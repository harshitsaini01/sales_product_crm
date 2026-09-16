import { z } from 'zod';

/**
 * Schema for adding a lead follow-up.
 * Matches CommonLeadFollowupController::addLeadFollowup() from the old CRM.
 * This is the most critical business logic form — it updates leads, asigned_leads, and inserts into lead_followups.
 */
export const addFollowupSchema = z.object({
  stdId: z.number().int().positive('Lead ID is required'),
  comment: z.string().min(1, 'Comment is required'),
  leadStatusId: z.number().int().optional(),
  leadSubStatusId: z.number().int().optional(),
  leadFollowUpStatusId: z.number().int().optional(),
  callAnsweredStatus: z.string().optional(),
  departmentId: z.number().int().optional(),
  statusLeadTypeId: z.number().int().optional(),
  followupDate: z.string().optional(),          // Next follow-up date (YYYY-MM-DD)
  type: z.string().max(50).optional(),           // 'followup' | 'comment' | 'reminder'
  fStatus: z.string().max(50).optional(),        // Follow-up status
  description: z.string().optional(),
});

export type AddFollowupInput = z.infer<typeof addFollowupSchema>;
