-- ────────────────────────────────────────────────────────────────────────────
-- Catch-up for the `public` schema (Tutelage Study).
--
-- WHAT BROKE
--
--   Invalid `prisma.user.findFirst()`: the column `users.show_full_phone`
--   does not exist in the current database.
--
-- Prisma builds SELECT from the model and names every scalar it knows about,
-- so a column in schema.prisma but missing from the database fails the whole
-- statement — which is why login went down rather than degrading.
--
-- `public` came from the original pgloader import, not from Prisma. Five tables
-- and two columns were later added to schema.prisma (via `db push` or by hand
-- elsewhere) without a migration ever being written, so replaying the migration
-- history never produced them here.
--
-- WHAT THIS RUNS, AND WHAT IT DELIBERATELY DOES NOT
--
-- Additive only. `prisma migrate diff` also emitted four destructive statements
-- and they are NOT here:
--
--   DROP CONSTRAINT bulk_operations_actor_id_fkey   -- re-added under the SAME
--   DROP CONSTRAINT bulk_presets_owner_id_fkey      -- name; a no-op rewrite
--   DROP CONSTRAINT inactivity_events_user_fk       -- a rename, nothing more
--   DROP INDEX users_on_call_since_idx              -- an extra index, harmless
--
-- The first three are drop/add pairs that leave the database exactly as it
-- started, so skipping both halves is the same result with none of the risk —
-- and skipping only the DROP would make the ADD fail on a duplicate name. The
-- index costs a little write throughput and nothing else. None of the four is
-- worth touching a live customer's constraints for.
--
-- SAFE TO RE-RUN. Every statement is guarded, so running it twice, or against a
-- schema that already has some of this, changes nothing.
--
-- HOW TO RUN
--
--   cd backend
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file prisma/manual/2026-09-08-public-catchup.sql
--
-- Then confirm and record the history:
--
--   npm run tenant:drift -- --live                     # public should be clean
--   npm run tenant:baseline -- --all --schema=public   # now a true claim
--   npm run tenant:migrate:all                         # works from here on
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── The column that broke login ─────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "show_full_phone" SMALLINT NOT NULL DEFAULT 0;

-- ── The lead project brief ──────────────────────────────────────────────────
ALTER TABLE "crm_lead_business" ADD COLUMN IF NOT EXISTS "project_title" VARCHAR(200);
ALTER TABLE "crm_lead_business" ADD COLUMN IF NOT EXISTS "project_description" TEXT;

-- ── A default the model expects ─────────────────────────────────────────────
ALTER TABLE "lead_work_batches" ALTER COLUMN "work_date" SET DEFAULT CURRENT_TIMESTAMP;

-- ── Five tables that are live Prisma models and were never migrated here ────

CREATE TABLE IF NOT EXISTS "university_application_mails" (
    "id" BIGSERIAL NOT NULL,
    "student_id" BIGINT NOT NULL,
    "to_email" VARCHAR(200) NOT NULL,
    "cc" VARCHAR(200),
    "greeting" VARCHAR(100),
    "recipient_name" VARCHAR(200),
    "sender_name" VARCHAR(200),
    "program" VARCHAR(200),
    "university_name" VARCHAR(200),
    "subject" VARCHAR(250) NOT NULL,
    "body" TEXT NOT NULL,
    "attached_docs" TEXT,
    "sent_by_user_id" BIGINT,
    "tracking_token" VARCHAR(64) NOT NULL,
    "is_opened" BOOLEAN NOT NULL DEFAULT false,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "first_opened_at" TIMESTAMP(3),
    "last_opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "university_application_mails_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "counsellor_remarks" (
    "id" BIGSERIAL NOT NULL,
    "counsellor_id" BIGINT NOT NULL,
    "created_by_id" BIGINT NOT NULL,
    "remark" TEXT NOT NULL,
    "call_id" BIGINT,
    "hour_context" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counsellor_remarks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webmail_accounts" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "webmail_url" VARCHAR(255) NOT NULL DEFAULT 'https://webmail.tutelagestudy.com',
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webmail_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'greeting',
    "user_id" BIGINT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "whatsapp_template_files" (
    "id" BIGSERIAL NOT NULL,
    "template_id" BIGINT NOT NULL,
    "file_path" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(100),
    "file_size" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_template_files_pkey" PRIMARY KEY ("id")
);

-- ── Their indexes ───────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "university_application_mails_tracking_token_key" ON "university_application_mails"("tracking_token");
CREATE INDEX IF NOT EXISTS "counsellor_remarks_counsellor_id_idx" ON "counsellor_remarks"("counsellor_id");
CREATE INDEX IF NOT EXISTS "counsellor_remarks_created_by_id_idx" ON "counsellor_remarks"("created_by_id");
CREATE INDEX IF NOT EXISTS "counsellor_remarks_call_id_idx" ON "counsellor_remarks"("call_id");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_user_id_idx" ON "whatsapp_templates"("user_id");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_category_idx" ON "whatsapp_templates"("category");
CREATE INDEX IF NOT EXISTS "whatsapp_template_files_template_id_idx" ON "whatsapp_template_files"("template_id");

-- ── Their foreign keys ──────────────────────────────────────────────────────
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each is guarded by name.
-- Only keys on the tables created above are here; the three on pre-existing
-- tables are the drop/add rewrites described in the header and are left alone.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('university_application_mails_student_id_fkey',
       'ALTER TABLE "university_application_mails" ADD CONSTRAINT "university_application_mails_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('university_application_mails_sent_by_user_id_fkey',
       'ALTER TABLE "university_application_mails" ADD CONSTRAINT "university_application_mails_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('counsellor_remarks_counsellor_id_fkey',
       'ALTER TABLE "counsellor_remarks" ADD CONSTRAINT "counsellor_remarks_counsellor_id_fkey" FOREIGN KEY ("counsellor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('counsellor_remarks_created_by_id_fkey',
       'ALTER TABLE "counsellor_remarks" ADD CONSTRAINT "counsellor_remarks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('counsellor_remarks_call_id_fkey',
       'ALTER TABLE "counsellor_remarks" ADD CONSTRAINT "counsellor_remarks_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "mobile_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('whatsapp_templates_user_id_fkey',
       'ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('whatsapp_template_files_template_id_fkey',
       'ALTER TABLE "whatsapp_template_files" ADD CONSTRAINT "whatsapp_template_files_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE')
    ) AS t(name, ddl)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fk.name
        AND connamespace = current_schema()::regnamespace
    ) THEN
      EXECUTE fk.ddl;
    END IF;
  END LOOP;
END $$;

COMMIT;
