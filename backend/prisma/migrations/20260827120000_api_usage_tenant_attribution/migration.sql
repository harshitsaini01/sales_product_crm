-- API usage moved from a per-customer feature to a PLATFORM view.
--
-- Without a tenant column, user id 5 means a different person at every customer
-- and the daily caller rows would merge unrelated people into one line. The old
-- unique key (day, user_id) has to widen to include the tenant.
--
-- Existing rows were all written by the original install; they are left at
-- tenant_id = 0 ("unattributed") rather than guessed at, so nothing is claimed
-- that we cannot actually verify.

ALTER TABLE "api_usage_user_daily"
  ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "api_usage_user_daily"
  DROP CONSTRAINT IF EXISTS "api_usage_user_daily_day_user_id_key";

DROP INDEX IF EXISTS "api_usage_user_daily_day_user_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "api_usage_user_daily_day_tenant_id_user_id_key"
  ON "api_usage_user_daily" ("day", "tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "api_usage_user_daily_tenant_id_day_idx"
  ON "api_usage_user_daily" ("tenant_id", "day" DESC);
