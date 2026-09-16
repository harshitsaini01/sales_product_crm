-- Allow multiple reminders per day + add time component.
-- 1. Drop the (lead_id, reminder_date) unique constraint.
-- 2. Convert reminder_date from DATE to TIMESTAMPTZ (preserves existing dates,
--    interpreting them as midnight of the user's local day).
-- 3. Add a regular non-unique index for query performance.

ALTER TABLE "tbl_reminder"
  DROP CONSTRAINT IF EXISTS "reminder_lead_date_uk";

DROP INDEX IF EXISTS "reminder_lead_date_uk";

ALTER TABLE "tbl_reminder"
  ALTER COLUMN "reminder_date" TYPE TIMESTAMPTZ(6)
  USING "reminder_date"::TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "tbl_reminder_lead_id_reminder_date_idx"
  ON "tbl_reminder" ("lead_id", "reminder_date");
