-- Indexes for GET /api/notifications — the header bell, polled every 60 s.
--
-- Measured at 9.53 s of server time on live. None of the five tables it reads
-- carried an index for the shape it queries them with; the dominant cost was
-- `leads.followup_date`, which the endpoint hits TWICE per poll (a sorted
-- findMany and a count) and which matched 39 403 rows against a 63k-row table
-- with no index at all.
CREATE INDEX IF NOT EXISTS "leads_trash_followup_date_idx" ON "leads" ("trash", "followup_date");
CREATE INDEX IF NOT EXISTS "chat_messages_to_id_seen_idx" ON "chat_messages" ("to_id", "seen");
CREATE INDEX IF NOT EXISTS "tbl_todolist_status_due_date_idx" ON "tbl_todolist" ("status", "due_date");
CREATE INDEX IF NOT EXISTS "tbl_todolist_assigned_to_id_status_idx" ON "tbl_todolist" ("assigned_to_id", "status");
CREATE INDEX IF NOT EXISTS "tbl_reminder_reminder_date_status_idx" ON "tbl_reminder" ("reminder_date", "status");
CREATE INDEX IF NOT EXISTS "tbl_reminder_user_id_reminder_date_idx" ON "tbl_reminder" ("user_id", "reminder_date");
CREATE INDEX IF NOT EXISTS "flag_messages_type_created_at_idx" ON "flag_messages" ("type", "created_at");
