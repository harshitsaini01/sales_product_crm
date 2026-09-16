-- Indexes for the lead-work hot path.
--
-- `leads` carried no index at all beyond its primary key, so the task builder's
-- cohort query (WHERE trash = 0 ORDER BY created_at DESC) planned as a parallel
-- seq scan plus an external merge sort that spilled ~3.5 MB to disk.
--
-- `asigned_leads` was seq-scanned once per cohort snapshot, and /lead-work/workload
-- filters lead_work_batches by work_date across all counsellors, which neither of
-- that table's assignee-leading indexes can serve.
--
-- IF NOT EXISTS keeps this safe to re-run and a no-op where an index was already
-- created by hand.
CREATE INDEX IF NOT EXISTS "leads_trash_created_at_idx" ON "leads" ("trash", "created_at");
CREATE INDEX IF NOT EXISTS "asigned_leads_std_id_status_idx" ON "asigned_leads" ("std_id", "status");
CREATE INDEX IF NOT EXISTS "asigned_leads_clr_id_status_idx" ON "asigned_leads" ("clr_id", "status");
CREATE INDEX IF NOT EXISTS "lead_work_batches_work_date_status_idx" ON "lead_work_batches" ("work_date", "status");
