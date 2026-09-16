-- Hand-picked calling tasks (created from the leads list) span arbitrary lead
-- created-dates, so they have no single cohort date to record.
ALTER TABLE "lead_work_batches" ALTER COLUMN "lead_date" DROP NOT NULL;
