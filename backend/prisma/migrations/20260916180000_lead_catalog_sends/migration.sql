-- Products actually sent to a lead (email or WhatsApp), with a snapshot of
-- name / price / photo so later catalog edits do not rewrite history.

CREATE TABLE IF NOT EXISTS "lead_catalog_sends" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "sent_by_id" BIGINT NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_catalog_sends_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_catalog_send_items" (
    "id" BIGSERIAL NOT NULL,
    "send_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "image_url" VARCHAR(1000),

    CONSTRAINT "lead_catalog_send_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_catalog_sends_lead_id_created_at_idx"
    ON "lead_catalog_sends"("lead_id", "created_at");

CREATE INDEX IF NOT EXISTS "lead_catalog_send_items_send_id_idx"
    ON "lead_catalog_send_items"("send_id");

ALTER TABLE "lead_catalog_sends"
    ADD CONSTRAINT "lead_catalog_sends_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_catalog_sends"
    ADD CONSTRAINT "lead_catalog_sends_sent_by_id_fkey"
    FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_catalog_send_items"
    ADD CONSTRAINT "lead_catalog_send_items_send_id_fkey"
    FOREIGN KEY ("send_id") REFERENCES "lead_catalog_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_catalog_send_items"
    ADD CONSTRAINT "lead_catalog_send_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "crm_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
