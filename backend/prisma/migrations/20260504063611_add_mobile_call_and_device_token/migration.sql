-- CreateEnum
CREATE TYPE "MobileCallDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "MobileCallStatus" AS ENUM ('TRIGGERED', 'RINGING', 'ANSWERED', 'MISSED', 'REJECTED', 'NO_ANSWER', 'BUSY', 'FAILED');

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "report_date" DATE NOT NULL,
    "leads_contacted" SMALLINT NOT NULL DEFAULT 0,
    "calls_made" SMALLINT NOT NULL DEFAULT 0,
    "meetings_held" SMALLINT NOT NULL DEFAULT 0,
    "enrollments" SMALLINT NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "challenges" TEXT,
    "tomorrow_plan" TEXT,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_comments" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_calls" (
    "id" BIGSERIAL NOT NULL,
    "deviceCallId" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "lead_id" BIGINT,
    "phone_number" VARCHAR(32) NOT NULL,
    "direction" "MobileCallDirection" NOT NULL,
    "status" "MobileCallStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "recording_path" TEXT,
    "recording_size" INTEGER,
    "recording_expires_at" TIMESTAMP(3),
    "recording_preserved" BOOLEAN NOT NULL DEFAULT false,
    "triggered_from" VARCHAR(20),
    "trigger_call_id" BIGINT,
    "notes" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "device_id" VARCHAR(100) NOT NULL,
    "app_version" VARCHAR(30),
    "platform" VARCHAR(20) NOT NULL DEFAULT 'android',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brochure_assignments" (
    "id" BIGSERIAL NOT NULL,
    "brochure_id" BIGINT NOT NULL,
    "assignee_type" VARCHAR(20) NOT NULL,
    "assignee_id" BIGINT NOT NULL,
    "assigned_by_id" BIGINT NOT NULL,
    "note" TEXT,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brochure_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_school_history" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "level" VARCHAR(50),
    "school_name" VARCHAR(200),
    "board" VARCHAR(100),
    "passing_year" INTEGER,
    "percentage" VARCHAR(20),
    "stream" VARCHAR(100),
    "city" VARCHAR(100),
    "country" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_school_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_ucat" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "exam_date" DATE,
    "total_score" INTEGER,
    "verbal_reasoning" INTEGER,
    "decision_making" INTEGER,
    "quantitative" INTEGER,
    "abstract_reason" INTEGER,
    "situational" VARCHAR(50),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_exam_ucat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_dmat" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "exam_date" DATE,
    "total_score" INTEGER,
    "physics" INTEGER,
    "chemistry" INTEGER,
    "biology" INTEGER,
    "reasoning" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_exam_dmat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_sat" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "exam_date" DATE,
    "total_score" INTEGER,
    "reading" INTEGER,
    "writing" INTEGER,
    "math" INTEGER,
    "essay" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_exam_sat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_feedback" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "feedback" TEXT NOT NULL,
    "rating" SMALLINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_user_id_report_date_key" ON "daily_reports"("user_id", "report_date");

-- CreateIndex
CREATE INDEX "lead_comments_lead_id_created_at_idx" ON "lead_comments"("lead_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_calls_deviceCallId_key" ON "mobile_calls"("deviceCallId");

-- CreateIndex
CREATE INDEX "mobile_calls_user_id_started_at_idx" ON "mobile_calls"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "mobile_calls_lead_id_started_at_idx" ON "mobile_calls"("lead_id", "started_at");

-- CreateIndex
CREATE INDEX "mobile_calls_status_started_at_idx" ON "mobile_calls"("status", "started_at");

-- CreateIndex
CREATE INDEX "mobile_calls_recording_expires_at_idx" ON "mobile_calls"("recording_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_fcm_token_key" ON "device_tokens"("fcm_token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- CreateIndex
CREATE INDEX "brochure_assignments_brochure_id_idx" ON "brochure_assignments"("brochure_id");

-- CreateIndex
CREATE INDEX "brochure_assignments_assignee_type_assignee_id_idx" ON "brochure_assignments"("assignee_type", "assignee_id");

-- CreateIndex
CREATE INDEX "student_school_history_lead_id_idx" ON "student_school_history"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_ucat_lead_id_key" ON "student_exam_ucat"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_dmat_lead_id_key" ON "student_exam_dmat"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_sat_lead_id_key" ON "student_exam_sat"("lead_id");

-- CreateIndex
CREATE INDEX "student_feedback_lead_id_created_at_idx" ON "student_feedback"("lead_id", "created_at");

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_comments" ADD CONSTRAINT "lead_comments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_comments" ADD CONSTRAINT "lead_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_calls" ADD CONSTRAINT "mobile_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_calls" ADD CONSTRAINT "mobile_calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brochure_assignments" ADD CONSTRAINT "brochure_assignments_brochure_id_fkey" FOREIGN KEY ("brochure_id") REFERENCES "brochures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_school_history" ADD CONSTRAINT "student_school_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_ucat" ADD CONSTRAINT "student_exam_ucat_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_dmat" ADD CONSTRAINT "student_exam_dmat_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_sat" ADD CONSTRAINT "student_exam_sat_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_feedback" ADD CONSTRAINT "student_feedback_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
