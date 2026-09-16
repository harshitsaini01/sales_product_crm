-- Add "Call Not Answered" review state to the Filter-Leads (lead-staging) flow.
-- Mutually exclusive with `verified`; items in this state are NOT seeded.

ALTER TABLE "lead_staging_items"
  ADD COLUMN "call_not_answered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "lead_staging_batches"
  ADD COLUMN "call_not_answered_count" INTEGER NOT NULL DEFAULT 0;
