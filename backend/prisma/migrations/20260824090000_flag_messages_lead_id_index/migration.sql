-- flag_messages had exactly one index, ("type", "created_at"), for the bell feed.
--
-- Nothing covered "lead_id" — yet every lead-detail open reads this table by
-- lead_id twice (once for the flags list, once more inside the timeline, which
-- independently re-queried the same rows). Both were sequential scans of every
-- flag ever raised. At six counsellors that is invisible; it degrades linearly
-- with the table and would be one of the first things to fall over under real
-- multi-tenant load.
--
-- ("lead_id", "created_at") matches how the rows are actually read — filter by
-- lead, order by recency, take 50 — so the index serves the ORDER BY too, and
-- mirrors the shape lead_notes / lead_comments / lead_status_history already use.
--
-- CONCURRENTLY cannot run inside Prisma's migration transaction; this table is
-- small enough that a plain CREATE INDEX takes a brief lock and finishes fast.
CREATE INDEX IF NOT EXISTS "flag_messages_lead_id_created_at_idx"
  ON "flag_messages" ("lead_id", "created_at");
