-- API usage metrics — per-endpoint request counters.
--
-- Sizing note: rows are written by a 5-minute flusher, NOT per request. At
-- ~216k requests/day across ~25 actively-hit endpoints this table takes
-- ~7,200 rows/day (288 buckets x 25 routes) written in 288 batched statements,
-- versus ~216,000 INSERTs if each request were logged. Storage lands around
-- 2.5 MB/day with indexes before rollups; the nightly rollup collapses m5 into
-- h1 then d1 and prunes, so the steady state stays well under 1 GB/year.

CREATE TABLE IF NOT EXISTS "api_usage_stats" (
    "id"           BIGSERIAL    NOT NULL,
    "granularity"  VARCHAR(2)   NOT NULL,
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "method"       VARCHAR(10)  NOT NULL,
    "route"        VARCHAR(180) NOT NULL,
    "hits"         INTEGER      NOT NULL DEFAULT 0,
    "errors_4xx"   INTEGER      NOT NULL DEFAULT 0,
    "errors_5xx"   INTEGER      NOT NULL DEFAULT 0,
    "total_ms"     BIGINT       NOT NULL DEFAULT 0,
    "max_ms"       INTEGER      NOT NULL DEFAULT 0,
    "ms50"         INTEGER      NOT NULL DEFAULT 0,
    "ms100"        INTEGER      NOT NULL DEFAULT 0,
    "ms250"        INTEGER      NOT NULL DEFAULT 0,
    "ms500"        INTEGER      NOT NULL DEFAULT 0,
    "ms1000"       INTEGER      NOT NULL DEFAULT 0,
    "ms2500"       INTEGER      NOT NULL DEFAULT 0,
    "ms_inf"       INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT "api_usage_stats_pkey" PRIMARY KEY ("id")
);

-- Target of the flusher's ON CONFLICT. Multiple PM2 workers (or a re-run of the
-- same flush) merge into the existing row instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS "api_usage_stats_granularity_bucket_start_method_route_key"
    ON "api_usage_stats" ("granularity", "bucket_start", "method", "route");

-- Range scans for the dashboard ("top endpoints, last 24h").
CREATE INDEX IF NOT EXISTS "api_usage_stats_granularity_bucket_start_idx"
    ON "api_usage_stats" ("granularity", "bucket_start" DESC);

-- Single-endpoint drilldown ("show me /api/leads/:id over time").
CREATE INDEX IF NOT EXISTS "api_usage_stats_route_granularity_bucket_start_idx"
    ON "api_usage_stats" ("route", "granularity", "bucket_start" DESC);


-- Per-caller daily totals. Day granularity on purpose — see schema.prisma.
CREATE TABLE IF NOT EXISTS "api_usage_user_daily" (
    "id"       BIGSERIAL NOT NULL,
    "day"      DATE      NOT NULL,
    "user_id"  BIGINT    NOT NULL,
    "hits"     INTEGER   NOT NULL DEFAULT 0,
    "errors"   INTEGER   NOT NULL DEFAULT 0,
    "total_ms" BIGINT    NOT NULL DEFAULT 0,

    CONSTRAINT "api_usage_user_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_usage_user_daily_day_user_id_key"
    ON "api_usage_user_daily" ("day", "user_id");

CREATE INDEX IF NOT EXISTS "api_usage_user_daily_day_idx"
    ON "api_usage_user_daily" ("day" DESC);
