-- Bulk operation audit + undo + saved-preset tables.
-- Every multi-lead admin action routed through the bulk engine writes one
-- bulk_operations row; reversible ops also save a per-lead snapshot so a
-- later /undo can restore the prior state.

CREATE TABLE "bulk_operations" (
    "id"           BIGSERIAL    PRIMARY KEY,
    "actor_id"     BIGINT       NOT NULL,
    "kind"         VARCHAR(40)  NOT NULL,
    "status"       VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "source"       VARCHAR(20)  NOT NULL DEFAULT 'web',
    "dry_run"      BOOLEAN      NOT NULL DEFAULT false,
    "filter"       JSONB,
    "recipe"       JSONB        NOT NULL,
    "total"        INTEGER      NOT NULL DEFAULT 0,
    "processed"    INTEGER      NOT NULL DEFAULT 0,
    "succeeded"    INTEGER      NOT NULL DEFAULT 0,
    "failed"       INTEGER      NOT NULL DEFAULT 0,
    "skipped"      INTEGER      NOT NULL DEFAULT 0,
    "message"      VARCHAR(500),
    "failures"     JSONB,
    "snapshot"     JSONB,
    "undone_at"    TIMESTAMP(3),
    "undone_by_id" BIGINT,
    "started_at"   TIMESTAMP(3),
    "finished_at"  TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bulk_operations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "bulk_operations_actor_id_created_at_idx"
    ON "bulk_operations"("actor_id", "created_at" DESC);
CREATE INDEX "bulk_operations_status_created_at_idx"
    ON "bulk_operations"("status", "created_at" DESC);
CREATE INDEX "bulk_operations_kind_created_at_idx"
    ON "bulk_operations"("kind", "created_at" DESC);


CREATE TABLE "bulk_presets" (
    "id"         BIGSERIAL    PRIMARY KEY,
    "owner_id"   BIGINT       NOT NULL,
    "name"       VARCHAR(150) NOT NULL,
    "filter"     JSONB        NOT NULL,
    "recipe"     JSONB        NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bulk_presets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "bulk_presets_owner_id_name_idx"
    ON "bulk_presets"("owner_id", "name");
