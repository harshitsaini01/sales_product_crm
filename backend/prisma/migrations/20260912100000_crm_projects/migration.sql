-- ═══════════════════════════════════════════════════════════════════════════
-- Projects & proposals: crm_teams, crm_team_members, crm_projects,
-- crm_project_messages, crm_project_files.
--
-- FIVE CREATE TABLEs and their foreign keys. Nothing on `leads` or `users` is
-- added, altered or dropped — the only statements naming `users` are foreign
-- keys FROM the new tables, which take a brief validation lock on the parent.
--
-- Rolled out per customer:
--   npm run tenant:migrate:all -- --only=britannica_bots
-- Every query against these tables is behind hasFeature('projects'), so a
-- schema that has not received this migration is never asked for them.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "crm_teams" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "color" VARCHAR(20),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_team_members" (
    "id" BIGSERIAL NOT NULL,
    "team_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_projects" (
    "id" BIGSERIAL NOT NULL,
    "project_number" VARCHAR(30),
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(500),
    "description" TEXT,
    "lead_id" BIGINT,
    "account_id" BIGINT,
    "contact_id" BIGINT,
    "deal_id" BIGINT,
    "team_id" BIGINT,
    "assignee_id" BIGINT,
    "owner_id" BIGINT,
    "created_by_id" BIGINT,
    "status" VARCHAR(24) NOT NULL DEFAULT 'draft',
    "priority" VARCHAR(12) NOT NULL DEFAULT 'medium',
    "budget" DECIMAL(18,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "due_date" DATE,
    "client_name" VARCHAR(160),
    "client_email" VARCHAR(200),
    "client_cc" VARCHAR(500),
    "mail_group_id" BIGINT,
    "ball_with_user_id" BIGINT,
    "last_internal_at" TIMESTAMP(3),
    "last_external_at" TIMESTAMP(3),
    "last_client_reply_at" TIMESTAMP(3),
    "sent_to_client_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "trash" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_project_messages" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "channel" VARCHAR(12) NOT NULL,
    "direction" VARCHAR(6) NOT NULL DEFAULT 'out',
    "kind" VARCHAR(16) NOT NULL DEFAULT 'message',
    "author_id" BIGINT,
    "from_email" VARCHAR(200),
    "from_name" VARCHAR(160),
    "to_email" VARCHAR(500),
    "cc" VARCHAR(500),
    "subject" VARCHAR(500),
    "body" TEXT NOT NULL,
    "message_id" VARCHAR(255),
    "in_reply_to" VARCHAR(255),
    "inbound_mail_id" BIGINT,
    "sent_mail_id" BIGINT,
    "delivery_status" VARCHAR(12),
    "error_message" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_project_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_project_files" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "message_id" BIGINT,
    "file_path" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(120),
    "file_size" BIGINT,
    "uploaded_by_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_project_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_teams_slug_key" ON "crm_teams"("slug");

-- CreateIndex
CREATE INDEX "crm_team_members_user_id_idx" ON "crm_team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_team_members_team_id_user_id_key" ON "crm_team_members"("team_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_projects_project_number_key" ON "crm_projects"("project_number");

-- CreateIndex
CREATE INDEX "crm_projects_trash_status_idx" ON "crm_projects"("trash", "status");

-- CreateIndex
CREATE INDEX "crm_projects_lead_id_idx" ON "crm_projects"("lead_id");

-- CreateIndex
CREATE INDEX "crm_projects_account_id_idx" ON "crm_projects"("account_id");

-- CreateIndex
CREATE INDEX "crm_projects_team_id_trash_idx" ON "crm_projects"("team_id", "trash");

-- CreateIndex
CREATE INDEX "crm_projects_assignee_id_trash_idx" ON "crm_projects"("assignee_id", "trash");

-- CreateIndex
CREATE INDEX "crm_projects_owner_id_trash_idx" ON "crm_projects"("owner_id", "trash");

-- CreateIndex
CREATE INDEX "crm_projects_ball_with_user_id_trash_idx" ON "crm_projects"("ball_with_user_id", "trash");

-- CreateIndex
CREATE INDEX "crm_projects_created_at_idx" ON "crm_projects"("created_at" DESC);

-- CreateIndex
CREATE INDEX "crm_project_messages_project_id_created_at_idx" ON "crm_project_messages"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_project_messages_message_id_idx" ON "crm_project_messages"("message_id");

-- CreateIndex
CREATE INDEX "crm_project_messages_inbound_mail_id_idx" ON "crm_project_messages"("inbound_mail_id");

-- CreateIndex
CREATE INDEX "crm_project_files_project_id_idx" ON "crm_project_files"("project_id");

-- CreateIndex
CREATE INDEX "crm_project_files_message_id_idx" ON "crm_project_files"("message_id");

-- AddForeignKey
ALTER TABLE "crm_team_members" ADD CONSTRAINT "crm_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "crm_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_team_members" ADD CONSTRAINT "crm_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "crm_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_project_messages" ADD CONSTRAINT "crm_project_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "crm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_project_messages" ADD CONSTRAINT "crm_project_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_project_files" ADD CONSTRAINT "crm_project_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "crm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_project_files" ADD CONSTRAINT "crm_project_files_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "crm_project_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_project_files" ADD CONSTRAINT "crm_project_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

