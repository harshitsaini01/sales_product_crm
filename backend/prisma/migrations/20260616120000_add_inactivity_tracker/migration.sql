-- Inactivity tracker for counsellors. Adds last_activity columns to users
-- and a new inactivity_events table for warning/alert/halfday raises.

ALTER TABLE "users"
  ADD COLUMN "last_activity_at"     TIMESTAMP(3),
  ADD COLUMN "last_activity_source" VARCHAR(20);

CREATE TABLE "inactivity_events" (
    "id"               BIGSERIAL    PRIMARY KEY,
    "user_id"          BIGINT       NOT NULL,
    "kind"             VARCHAR(20)  NOT NULL,
    "raised_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ack_at"           TIMESTAMP(3),
    "inactive_seconds" INTEGER      NOT NULL,
    CONSTRAINT "inactivity_events_user_fk"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id")
);

CREATE INDEX "inactivity_events_user_id_raised_at_idx"
  ON "inactivity_events" ("user_id", "raised_at");

CREATE INDEX "inactivity_events_kind_raised_at_idx"
  ON "inactivity_events" ("kind", "raised_at");

-- Seed default settings (idempotent). Admin can change these in /settings.
INSERT INTO "system_settings" ("key", "value", "created_at", "updated_at")
VALUES
  ('inactivity_tracker_enabled', 'true',  NOW(), NOW()),
  ('inactivity_warning_minutes', '3',     NOW(), NOW()),
  ('inactivity_alert_minutes',   '6',     NOW(), NOW()),
  ('inactivity_halfday_minutes', '15',    NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
