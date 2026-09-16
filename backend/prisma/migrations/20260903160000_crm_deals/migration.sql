-- ═══════════════════════════════════════════════════════════════════════════
-- Deals: configurable pipelines, opportunities, a product catalogue and deal
-- line items.
--
-- PURELY ADDITIVE. Six CREATE TABLEs, nothing else — no ALTER, no DROP, not one
-- statement against a table that already existed. An education customer gets
-- these created empty and never writes to them, because the `deals` module is
-- off for them and the API mounts are gated on it.
--
-- Generated offline with:
--   prisma migrate diff --from-schema-datamodel <schema before this change> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_stages" (
    "id" BIGSERIAL NOT NULL,
    "pipeline_id" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lost_reasons" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crm_lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" BIGSERIAL NOT NULL,
    "deal_number" VARCHAR(30),
    "name" VARCHAR(200) NOT NULL,
    "account_id" BIGINT,
    "primary_contact_id" BIGINT,
    "pipeline_id" BIGINT NOT NULL,
    "stage_id" BIGINT NOT NULL,
    "owner_id" BIGINT,
    "value" DECIMAL(18,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "probability" SMALLINT,
    "expected_close_date" DATE,
    "actual_close_date" DATE,
    "source" VARCHAR(100),
    "campaign" VARCHAR(255),
    "next_step" VARCHAR(255),
    "lost_reason_id" BIGINT,
    "lost_notes" TEXT,
    "lead_id" BIGINT,
    "branch_id" BIGINT,
    "created_by_id" BIGINT,
    "notes" TEXT,
    "trash" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_products" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "category" VARCHAR(80),
    "description" TEXT,
    "unit_price" DECIMAL(18,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "tax_percent" DECIMAL(6,3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_products" (
    "id" BIGSERIAL NOT NULL,
    "deal_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_slug_key" ON "crm_pipelines"("slug");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_pipeline_id_sort_order_idx" ON "crm_pipeline_stages"("pipeline_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipeline_stages_pipeline_id_slug_key" ON "crm_pipeline_stages"("pipeline_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lost_reasons_slug_key" ON "crm_lost_reasons"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_deal_number_key" ON "crm_deals"("deal_number");

-- CreateIndex
CREATE INDEX "crm_deals_trash_stage_id_idx" ON "crm_deals"("trash", "stage_id");

-- CreateIndex
CREATE INDEX "crm_deals_account_id_trash_idx" ON "crm_deals"("account_id", "trash");

-- CreateIndex
CREATE INDEX "crm_deals_owner_id_trash_idx" ON "crm_deals"("owner_id", "trash");

-- CreateIndex
CREATE INDEX "crm_deals_pipeline_id_trash_idx" ON "crm_deals"("pipeline_id", "trash");

-- CreateIndex
CREATE INDEX "crm_deals_expected_close_date_idx" ON "crm_deals"("expected_close_date");

-- CreateIndex
CREATE UNIQUE INDEX "crm_products_sku_key" ON "crm_products"("sku");

-- CreateIndex
CREATE INDEX "crm_products_active_name_idx" ON "crm_products"("active", "name");

-- CreateIndex
CREATE INDEX "crm_deal_products_deal_id_idx" ON "crm_deal_products"("deal_id");

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_lost_reason_id_fkey" FOREIGN KEY ("lost_reason_id") REFERENCES "crm_lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "crm_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

