-- Track per-item authorship in the Filter-Leads (lead-staging) flow so the
-- seeded Lead's comment + assignment can be attributed to the counsellor who
-- actually verified / commented on that row, not the user who clicked "Seed".

ALTER TABLE "lead_staging_items"
  ADD COLUMN "verified_by_id" BIGINT,
  ADD COLUMN "commented_by_id" BIGINT;
