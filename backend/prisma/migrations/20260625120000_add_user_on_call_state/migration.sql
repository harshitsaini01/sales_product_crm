-- Phone-call suppression for the inactivity tracker. While `on_call_since` is
-- non-null the scheduler skips raising warnings/alerts/half-days for the user.
-- The mobile app posts to /api/activity/phone-state to flip these.

ALTER TABLE "users"
  ADD COLUMN "on_call_since"      TIMESTAMP(3),
  ADD COLUMN "on_call_updated_at" TIMESTAMP(3);

CREATE INDEX "users_on_call_since_idx" ON "users" ("on_call_since");
