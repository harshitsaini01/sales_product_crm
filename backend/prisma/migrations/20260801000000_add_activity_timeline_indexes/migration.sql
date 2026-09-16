-- CreateIndex
CREATE INDEX "lead_call_logs_user_id_created_at_idx" ON "lead_call_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_followups_userid_created_at_idx" ON "lead_followups"("userid", "created_at");

-- CreateIndex
CREATE INDEX "lead_followups_std_id_created_at_idx" ON "lead_followups"("std_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_status_history_changed_by_id_created_at_idx" ON "lead_status_history"("changed_by_id", "created_at");

