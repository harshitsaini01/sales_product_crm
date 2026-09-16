-- Soft delete for lead-staging folders/batches.
-- A null deleted_at = active; non-null = in the Trash tab on /app/filter-leads.
-- Restore = NULL the column; permanent delete = real DELETE (cascades items/assignees).

ALTER TABLE "lead_staging_batches"
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "lead_staging_batches_deleted_at_idx"
  ON "lead_staging_batches"("deleted_at");
