-- Verticals: which kind of business a customer runs, and what they call things.
--
-- `vertical` is a plain VARCHAR rather than a Postgres enum on purpose — adding
-- a vertical should be a code change in src/config/verticals.ts, not a migration
-- against every deployed database.
--
-- Both columns default to the education behaviour ('education' + no label
-- overrides), which is exactly what every existing customer already has, so this
-- migration cannot change anything for them.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "vertical" VARCHAR(30) NOT NULL DEFAULT 'education';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "labels" JSONB NOT NULL DEFAULT '{}';
