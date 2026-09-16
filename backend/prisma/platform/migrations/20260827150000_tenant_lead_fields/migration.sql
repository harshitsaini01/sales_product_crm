-- Per-customer Lead Information field visibility.
--
-- Defaults to '{}' meaning "show everything", so every existing customer is
-- unaffected. Only deviations are stored, which is also why adding a new field
-- to the catalogue never needs a migration.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "lead_fields" JSONB NOT NULL DEFAULT '{}';
