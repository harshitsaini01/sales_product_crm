-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignDistribution" AS ENUM ('AUTHORITY', 'EQUAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'UNSUBSCRIBED', 'REPLIED');

-- CreateTable
CREATE TABLE "campaign_groups" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "from_name" VARCHAR(120) NOT NULL,
    "from_email" VARCHAR(160) NOT NULL,
    "smtp_host" VARCHAR(160) NOT NULL,
    "smtp_port" INTEGER NOT NULL,
    "smtp_user" VARCHAR(160) NOT NULL,
    "smtp_pass" VARCHAR(255) NOT NULL,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "imap_host" VARCHAR(160),
    "imap_port" INTEGER,
    "imap_user" VARCHAR(160),
    "imap_pass" VARCHAR(255),
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "imap_last_uid" INTEGER,
    "hourly_cap" INTEGER NOT NULL DEFAULT 50,
    "authority_score" SMALLINT NOT NULL DEFAULT 5,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "bounces_this_hour" INTEGER NOT NULL DEFAULT 0,
    "sent_this_hour" INTEGER NOT NULL DEFAULT 0,
    "hour_window_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "subject" VARCHAR(240) NOT NULL,
    "body_html" TEXT NOT NULL,
    "signature_id" BIGINT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "distribution" "CampaignDistribution" NOT NULL DEFAULT 'AUTHORITY',
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "chunk_size" INTEGER NOT NULL DEFAULT 50,
    "batch_gap_ms" INTEGER NOT NULL DEFAULT 3600000,
    "per_email_delay_ms" INTEGER NOT NULL DEFAULT 5000,
    "start_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_chunks" (
    "id" BIGSERIAL NOT NULL,
    "campaign_id" BIGINT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "index" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_campaign_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_recipients" (
    "id" BIGSERIAL NOT NULL,
    "campaign_id" BIGINT NOT NULL,
    "chunk_id" BIGINT,
    "group_id" BIGINT,
    "lead_id" BIGINT,
    "to_email" VARCHAR(200) NOT NULL,
    "to_name" VARCHAR(160),
    "status" "RecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "message_id" VARCHAR(255),
    "sent_at" TIMESTAMP(3),
    "error_message" TEXT,
    "opened_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_mails" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "imap_uid" INTEGER NOT NULL,
    "message_id" VARCHAR(255),
    "in_reply_to" VARCHAR(255),
    "from_email" VARCHAR(200) NOT NULL,
    "from_name" VARCHAR(160),
    "to_email" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body_html" TEXT,
    "body_text" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "lead_id" BIGINT,
    "recipient_id" BIGINT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_mails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_groups_from_email_key" ON "campaign_groups"("from_email");

-- CreateIndex
CREATE INDEX "email_campaigns_status_start_at_idx" ON "email_campaigns"("status", "start_at");

-- CreateIndex
CREATE INDEX "email_campaign_chunks_campaign_id_idx" ON "email_campaign_chunks"("campaign_id");

-- CreateIndex
CREATE INDEX "email_campaign_chunks_scheduled_at_idx" ON "email_campaign_chunks"("scheduled_at");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_status_idx" ON "email_campaign_recipients"("status");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_message_id_idx" ON "email_campaign_recipients"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaign_recipients_campaign_id_to_email_key" ON "email_campaign_recipients"("campaign_id", "to_email");

-- CreateIndex
CREATE INDEX "inbound_mails_lead_id_idx" ON "inbound_mails"("lead_id");

-- CreateIndex
CREATE INDEX "inbound_mails_received_at_idx" ON "inbound_mails"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_mails_group_id_imap_uid_key" ON "inbound_mails"("group_id", "imap_uid");

-- AddForeignKey
ALTER TABLE "email_campaign_chunks" ADD CONSTRAINT "email_campaign_chunks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_chunks" ADD CONSTRAINT "email_campaign_chunks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "campaign_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "email_campaign_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "campaign_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "campaign_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "email_campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
