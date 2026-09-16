-- API metrics advancements: per-endpoint peak load + error status breakdown.

-- Peak requests-per-second per endpoint per bucket. Additive, default 0, so no
-- table rewrite and existing rows read as "no recorded peak".
ALTER TABLE "api_usage_stats" ADD COLUMN IF NOT EXISTS "peak_rps" INTEGER NOT NULL DEFAULT 0;

-- Error breakdown by HTTP status code. Only rows for status >= 400 are ever
-- written, so this stays tiny — it exists purely to answer "which errors?" when
-- an admin clicks an endpoint's error count.
CREATE TABLE IF NOT EXISTS "api_usage_status" (
    "id"           BIGSERIAL      NOT NULL,
    "granularity"  VARCHAR(2)     NOT NULL,
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "method"       VARCHAR(10)    NOT NULL,
    "route"        VARCHAR(180)   NOT NULL,
    "status"       INTEGER        NOT NULL,
    "count"        INTEGER        NOT NULL DEFAULT 0,

    CONSTRAINT "api_usage_status_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_usage_status_gran_bucket_method_route_status_key"
    ON "api_usage_status" ("granularity", "bucket_start", "method", "route", "status");

-- Drilldown: errors for one endpoint over a window.
CREATE INDEX IF NOT EXISTS "api_usage_status_gran_route_method_bucket_idx"
    ON "api_usage_status" ("granularity", "route", "method", "bucket_start" DESC);

-- Window scans + rollup source reads.
CREATE INDEX IF NOT EXISTS "api_usage_status_gran_bucket_idx"
    ON "api_usage_status" ("granularity", "bucket_start" DESC);
