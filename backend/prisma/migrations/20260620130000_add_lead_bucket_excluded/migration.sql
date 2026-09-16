-- AlterTable
-- Tracks leads an admin has explicitly unassigned. Such leads stay in their
-- own department and must NOT re-enter the shared bucket pool. Cleared when
-- the lead is assigned to a counsellor again.
ALTER TABLE "leads" ADD COLUMN     "bucket_excluded" BOOLEAN NOT NULL DEFAULT false;
