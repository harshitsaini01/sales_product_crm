-- Multi-counsellor assignment for filter-leads (staging) batches.
-- Replaces the single `assigned_to_user_id` column with a join table so
-- a batch can be assigned to N counsellors; on seed, each verified lead is
-- duplicated into every assignee's "My Leads".

CREATE TABLE "lead_staging_batch_assignees" (
    "batch_id"   BIGINT      NOT NULL,
    "user_id"    BIGINT      NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_staging_batch_assignees_pkey" PRIMARY KEY ("batch_id", "user_id")
);

CREATE INDEX "lead_staging_batch_assignees_user_id_idx"
    ON "lead_staging_batch_assignees" ("user_id");

ALTER TABLE "lead_staging_batch_assignees"
    ADD CONSTRAINT "lead_staging_batch_assignees_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "lead_staging_batches" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_staging_batch_assignees"
    ADD CONSTRAINT "lead_staging_batch_assignees_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over the existing single-counsellor assignments.
INSERT INTO "lead_staging_batch_assignees" ("batch_id", "user_id")
SELECT "id", "assigned_to_user_id"
FROM "lead_staging_batches"
WHERE "assigned_to_user_id" IS NOT NULL;

-- Drop the now-redundant index + column.
DROP INDEX IF EXISTS "lead_staging_batches_assigned_to_user_id_idx";
ALTER TABLE "lead_staging_batches" DROP COLUMN "assigned_to_user_id";
