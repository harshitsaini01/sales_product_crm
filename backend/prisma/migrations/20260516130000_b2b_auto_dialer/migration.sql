-- B2B + Auto Dialer module

-- AlterTable: MobileCall - add campaign linkage
ALTER TABLE "mobile_calls"
  ADD COLUMN "campaign_contact_id" BIGINT,
  ADD COLUMN "recording_played_id" BIGINT;

CREATE INDEX "mobile_calls_campaign_contact_id_idx" ON "mobile_calls"("campaign_contact_id");

-- B2B Contacts
CREATE TABLE "b2b_contacts" (
  "id"           BIGSERIAL PRIMARY KEY,
  "name"         VARCHAR(150) NOT NULL,
  "email"        VARCHAR(150),
  "phone"        VARCHAR(32) NOT NULL,
  "state"        VARCHAR(80),
  "upload_batch" VARCHAR(64) NOT NULL,
  "source"       VARCHAR(20) NOT NULL DEFAULT 'csv',
  "uploaded_by"  BIGINT NOT NULL,
  "dnd_flag"     BOOLEAN NOT NULL DEFAULT false,
  "notes"        TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);

CREATE INDEX "b2b_contacts_phone_idx"        ON "b2b_contacts"("phone");
CREATE INDEX "b2b_contacts_state_idx"        ON "b2b_contacts"("state");
CREATE INDEX "b2b_contacts_upload_batch_idx" ON "b2b_contacts"("upload_batch");
CREATE INDEX "b2b_contacts_created_at_idx"   ON "b2b_contacts"("created_at" DESC);

-- Auto-Dialer Recordings
CREATE TABLE "auto_dialer_recordings" (
  "id"           BIGSERIAL PRIMARY KEY,
  "name"         VARCHAR(150) NOT NULL,
  "file_path"    TEXT NOT NULL,
  "duration_sec" INTEGER NOT NULL DEFAULT 0,
  "size_bytes"   INTEGER NOT NULL DEFAULT 0,
  "mime_type"    VARCHAR(80) NOT NULL DEFAULT 'audio/mpeg',
  "uploaded_by"  BIGINT NOT NULL,
  "archived_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);

CREATE INDEX "auto_dialer_recordings_created_at_idx" ON "auto_dialer_recordings"("created_at" DESC);

-- Auto-Dialer Campaigns
CREATE TABLE "auto_dialer_campaigns" (
  "id"             BIGSERIAL PRIMARY KEY,
  "name"           VARCHAR(200) NOT NULL,
  "description"    TEXT,
  "type"           VARCHAR(10) NOT NULL DEFAULT 'B2B',
  "recording_id"   BIGINT,
  "call_gap_sec"   INTEGER NOT NULL DEFAULT 30,
  "status"         VARCHAR(20) NOT NULL DEFAULT 'draft',
  "total_contacts" INTEGER NOT NULL DEFAULT 0,
  "created_by"     BIGINT NOT NULL,
  "started_at"     TIMESTAMP(3),
  "completed_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auto_dialer_campaigns_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "auto_dialer_recordings"("id") ON DELETE SET NULL
);

CREATE INDEX "auto_dialer_campaigns_status_idx"     ON "auto_dialer_campaigns"("status");
CREATE INDEX "auto_dialer_campaigns_created_at_idx" ON "auto_dialer_campaigns"("created_at" DESC);

-- Campaign Assignments
CREATE TABLE "auto_dialer_campaign_assignments" (
  "id"            BIGSERIAL PRIMARY KEY,
  "campaign_id"   BIGINT NOT NULL,
  "counsellor_id" BIGINT NOT NULL,
  "assigned_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auto_dialer_campaign_assignments_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "auto_dialer_campaigns"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "auto_dialer_campaign_assignments_unique"
  ON "auto_dialer_campaign_assignments"("campaign_id", "counsellor_id");
CREATE INDEX "auto_dialer_campaign_assignments_counsellor_id_idx"
  ON "auto_dialer_campaign_assignments"("counsellor_id");

-- Campaign Contacts (queue rows)
CREATE TABLE "auto_dialer_campaign_contacts" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "campaign_id"         BIGINT NOT NULL,
  "b2b_contact_id"      BIGINT NOT NULL,
  "assigned_to_user_id" BIGINT,
  "status"              VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempt_count"       INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at"     TIMESTAMP(3),
  "mobile_call_id"      BIGINT,
  "notes"               TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auto_dialer_campaign_contacts_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "auto_dialer_campaigns"("id") ON DELETE CASCADE,
  CONSTRAINT "auto_dialer_campaign_contacts_b2b_contact_id_fkey"
    FOREIGN KEY ("b2b_contact_id") REFERENCES "b2b_contacts"("id")
);

CREATE UNIQUE INDEX "auto_dialer_campaign_contacts_unique"
  ON "auto_dialer_campaign_contacts"("campaign_id", "b2b_contact_id");
CREATE INDEX "auto_dialer_campaign_contacts_queue_idx"
  ON "auto_dialer_campaign_contacts"("campaign_id", "assigned_to_user_id", "status");
CREATE INDEX "auto_dialer_campaign_contacts_user_status_idx"
  ON "auto_dialer_campaign_contacts"("assigned_to_user_id", "status");
