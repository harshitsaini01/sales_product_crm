-- CreateTable
CREATE TABLE "lead_status_history" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "changed_by_id" BIGINT NOT NULL,
    "from_status" VARCHAR(100),
    "to_status" VARCHAR(100) NOT NULL,
    "from_sub_status" VARCHAR(100),
    "to_sub_status" VARCHAR(100),
    "reason" TEXT,
    "source" VARCHAR(30) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_call_logs" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(10) NOT NULL DEFAULT 'outbound',
    "duration_seconds" INTEGER,
    "notes" TEXT,
    "auto_status_applied" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_status_history_lead_id_created_at_idx" ON "lead_status_history"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_call_logs_lead_id_created_at_idx" ON "lead_call_logs"("lead_id", "created_at");

-- Dedupe existing duplicates in tbl_reminder before creating the unique index.
-- Keeps the newest row (highest id) for each (lead_id, reminder_date) pair.
DELETE FROM "tbl_reminder" a
USING "tbl_reminder" b
WHERE a.id < b.id
  AND a.lead_id = b.lead_id
  AND a.reminder_date = b.reminder_date;

-- CreateIndex (required by addLeadFollowup upsert)
CREATE UNIQUE INDEX "tbl_reminder_lead_id_reminder_date_key" ON "tbl_reminder"("lead_id", "reminder_date");

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_call_logs" ADD CONSTRAINT "lead_call_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_call_logs" ADD CONSTRAINT "lead_call_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
