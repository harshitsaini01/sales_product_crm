-- DropForeignKey
ALTER TABLE "auto_dialer_campaign_assignments" DROP CONSTRAINT "auto_dialer_campaign_assignments_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "auto_dialer_campaign_contacts" DROP CONSTRAINT "auto_dialer_campaign_contacts_b2b_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "auto_dialer_campaign_contacts" DROP CONSTRAINT "auto_dialer_campaign_contacts_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "auto_dialer_campaigns" DROP CONSTRAINT "auto_dialer_campaigns_recording_id_fkey";

-- DropIndex
DROP INDEX "tbl_reminder_lead_id_reminder_date_key";

-- AlterTable
ALTER TABLE "lead_staging_batches" ADD COLUMN     "assigned_to_user_id" BIGINT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "country_of_education" VARCHAR(100),
ADD COLUMN     "date_of_exam" VARCHAR(100),
ADD COLUMN     "dmat" SMALLINT,
ADD COLUMN     "dmat_exam_date" VARCHAR(50),
ADD COLUMN     "dmat_ir_rank" VARCHAR(50),
ADD COLUMN     "dmat_ir_score" VARCHAR(50),
ADD COLUMN     "dmat_q_rank" VARCHAR(50),
ADD COLUMN     "dmat_q_score" VARCHAR(50),
ADD COLUMN     "dmat_total_rank" VARCHAR(50),
ADD COLUMN     "dmat_total_score" VARCHAR(50),
ADD COLUMN     "dmat_v_rank" VARCHAR(50),
ADD COLUMN     "dmat_v_score" VARCHAR(50),
ADD COLUMN     "dmat_w_rank" VARCHAR(50),
ADD COLUMN     "dmat_w_score" VARCHAR(50),
ADD COLUMN     "first_language" VARCHAR(100),
ADD COLUMN     "grade_average" VARCHAR(100),
ADD COLUMN     "grading_scheme" VARCHAR(100),
ADD COLUMN     "highest_level_of_education" VARCHAR(100),
ADD COLUMN     "home_address" TEXT,
ADD COLUMN     "home_contact_number" VARCHAR(50),
ADD COLUMN     "hs" VARCHAR(50),
ADD COLUMN     "hs_passing_year" VARCHAR(20),
ADD COLUMN     "hs_result" VARCHAR(50),
ADD COLUMN     "hs_school_name" VARCHAR(255),
ADD COLUMN     "intr" VARCHAR(50),
ADD COLUMN     "intr_passing_year" VARCHAR(20),
ADD COLUMN     "intr_result" VARCHAR(50),
ADD COLUMN     "intr_school_name" VARCHAR(255),
ADD COLUMN     "listening_score" VARCHAR(50),
ADD COLUMN     "marital_status" VARCHAR(50),
ADD COLUMN     "neet_result" VARCHAR(100),
ADD COLUMN     "passport_expiry" VARCHAR(100),
ADD COLUMN     "reading_score" VARCHAR(50),
ADD COLUMN     "sat" SMALLINT,
ADD COLUMN     "sat_exam_date" VARCHAR(50),
ADD COLUMN     "sat_reasoning_points" VARCHAR(50),
ADD COLUMN     "sat_subject_points" VARCHAR(50),
ADD COLUMN     "speaking_score" VARCHAR(50),
ADD COLUMN     "student_type" VARCHAR(100),
ADD COLUMN     "ucat" SMALLINT,
ADD COLUMN     "ucat_exam_date" VARCHAR(50),
ADD COLUMN     "ucat_q_rank" VARCHAR(50),
ADD COLUMN     "ucat_q_score" VARCHAR(50),
ADD COLUMN     "ucat_v_rank" VARCHAR(50),
ADD COLUMN     "ucat_v_score" VARCHAR(50),
ADD COLUMN     "ucat_w_rank" VARCHAR(50),
ADD COLUMN     "ucat_w_score" VARCHAR(50),
ADD COLUMN     "ug" VARCHAR(50),
ADD COLUMN     "ug_passing_year" VARCHAR(20),
ADD COLUMN     "ug_result" VARCHAR(50),
ADD COLUMN     "ug_school_name" VARCHAR(255),
ADD COLUMN     "writing_score" VARCHAR(50);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "key_hash" VARCHAR(120) NOT NULL,
    "webhook_secret" VARCHAR(120),
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_department_id" BIGINT,
    "default_lead_status" VARCHAR(100),
    "total_leads" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_ingestion_logs" (
    "id" BIGSERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(64),
    "status" VARCHAR(40) NOT NULL,
    "lead_id" BIGINT,
    "payload" JSONB NOT NULL,
    "error_msg" TEXT,

    CONSTRAINT "lead_ingestion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_slug_key" ON "lead_sources"("slug");

-- CreateIndex
CREATE INDEX "lead_ingestion_logs_source_id_received_at_idx" ON "lead_ingestion_logs"("source_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "lead_staging_batches_assigned_to_user_id_idx" ON "lead_staging_batches"("assigned_to_user_id");

-- AddForeignKey
ALTER TABLE "lead_ingestion_logs" ADD CONSTRAINT "lead_ingestion_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_dialer_campaigns" ADD CONSTRAINT "auto_dialer_campaigns_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "auto_dialer_recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_dialer_campaign_assignments" ADD CONSTRAINT "auto_dialer_campaign_assignments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "auto_dialer_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_dialer_campaign_contacts" ADD CONSTRAINT "auto_dialer_campaign_contacts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "auto_dialer_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_dialer_campaign_contacts" ADD CONSTRAINT "auto_dialer_campaign_contacts_b2b_contact_id_fkey" FOREIGN KEY ("b2b_contact_id") REFERENCES "b2b_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "auto_dialer_campaign_assignments_unique" RENAME TO "auto_dialer_campaign_assignments_campaign_id_counsellor_id_key";

-- RenameIndex
ALTER INDEX "auto_dialer_campaign_contacts_queue_idx" RENAME TO "auto_dialer_campaign_contacts_campaign_id_assigned_to_user__idx";

-- RenameIndex
ALTER INDEX "auto_dialer_campaign_contacts_unique" RENAME TO "auto_dialer_campaign_contacts_campaign_id_b2b_contact_id_key";

-- RenameIndex
ALTER INDEX "auto_dialer_campaign_contacts_user_status_idx" RENAME TO "auto_dialer_campaign_contacts_assigned_to_user_id_status_idx";

