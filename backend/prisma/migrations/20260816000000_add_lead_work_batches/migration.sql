CREATE TABLE "lead_work_batches" (
  "id" BIGSERIAL NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "lead_date" DATE NOT NULL,
  "due_date" DATE,
  "priority" VARCHAR(20) NOT NULL DEFAULT 'high',
  "status" SMALLINT NOT NULL DEFAULT 0,
  "assigned_by_id" BIGINT NOT NULL,
  "assigned_to_id" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lead_work_batches_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "lead_work_batch_items" (
  "id" BIGSERIAL NOT NULL,
  "batch_id" BIGINT NOT NULL,
  "lead_id" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_work_batch_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lead_work_batch_items_batch_id_lead_id_key" ON "lead_work_batch_items"("batch_id", "lead_id");
CREATE INDEX "lead_work_batches_assigned_to_id_status_due_date_idx" ON "lead_work_batches"("assigned_to_id", "status", "due_date");
CREATE INDEX "lead_work_batch_items_lead_id_idx" ON "lead_work_batch_items"("lead_id");
ALTER TABLE "lead_work_batches" ADD CONSTRAINT "lead_work_batches_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_work_batches" ADD CONSTRAINT "lead_work_batches_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_work_batch_items" ADD CONSTRAINT "lead_work_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lead_work_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_work_batch_items" ADD CONSTRAINT "lead_work_batch_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
