-- Cosmetic only: bring three index names in line with what Prisma generates.
--
-- The api_usage_status indexes were created by hand with shortened names, so
-- every `migrate diff` against prisma/schema.prisma reports three RenameIndex
-- statements that are never actually resolved. Left alone, that noise appears
-- in every drift check forever and trains you to ignore drift output.
--
-- Renaming an index is a catalog-only change: no rewrite, no reindex, no data
-- touched. IF EXISTS makes each one a no-op on a schema that is already correct
-- (including any created after this point), so it is safe everywhere.

ALTER INDEX IF EXISTS "api_usage_status_gran_bucket_idx"
  RENAME TO "api_usage_status_granularity_bucket_start_idx";

ALTER INDEX IF EXISTS "api_usage_status_gran_bucket_method_route_status_key"
  RENAME TO "api_usage_status_granularity_bucket_start_method_route_stat_key";

ALTER INDEX IF EXISTS "api_usage_status_gran_route_method_bucket_idx"
  RENAME TO "api_usage_status_granularity_route_method_bucket_start_idx";
