-- Performance indexes for the slow endpoints surfaced by the API Usage tracker.
--
-- GET /api/leads was ~719ms avg. Every list page calls computeFieldDuplicates(),
-- which runs `WHERE LOWER(email) IN (...)` and `WHERE mobile IN (...)` against
-- the 63k-row leads table. Neither had any index, so both were full scans on
-- every request. LOWER(email) needs a FUNCTIONAL index (a plain email index
-- can't serve it); mobile needs a plain one. Both are partial on trash=0 to
-- match the query and stay small.
CREATE INDEX IF NOT EXISTS "leads_lower_email_idx" ON "leads" (LOWER("email")) WHERE "trash" = 0;
CREATE INDEX IF NOT EXISTS "leads_mobile_idx"      ON "leads" ("mobile")        WHERE "trash" = 0;

-- GET /api/leads/:id was ~461ms avg / 2.19s p99. It loads a lead's notes and
-- documents ordered by recency, but neither child table had a foreign-key index,
-- so each detail view scanned the whole child table. (followups + reminders
-- already had their leadId indexes.)
CREATE INDEX IF NOT EXISTS "lead_notes_lead_id_created_at_idx" ON "lead_notes" ("lead_id", "created_at");
CREATE INDEX IF NOT EXISTS "student_documents_lead_id_idx"     ON "student_documents" ("lead_id");
