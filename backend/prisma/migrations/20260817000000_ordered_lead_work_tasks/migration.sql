ALTER TABLE "lead_work_batches"
  ADD COLUMN "work_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "work_type" VARCHAR(30) NOT NULL DEFAULT 'INITIAL_CALL',
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "lead_work_batch_items"
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "completion_type" VARCHAR(30);

CREATE INDEX "lead_work_batches_assigned_to_id_work_date_sequence_idx"
  ON "lead_work_batches"("assigned_to_id", "work_date", "sequence");
