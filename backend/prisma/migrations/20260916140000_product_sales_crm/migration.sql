-- Product sales CRM: catalog/stock, fulfillment, pricing, dynamic file fields.

-- Products
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(60);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "collection" VARCHAR(80);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "brand" VARCHAR(80);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "short_description" VARCHAR(280);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "gallery" JSONB;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "video_url" VARCHAR(500);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs';
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "hsn_code" VARCHAR(20);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "min_selling_price" DECIMAL(18,2);
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "stock_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "reserved_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "min_stock_level" DECIMAL(12,3) NOT NULL DEFAULT 5;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "allow_backorder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_products" ADD COLUMN IF NOT EXISTS "is_kit" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "crm_products_category_idx" ON "crm_products"("category");
CREATE INDEX IF NOT EXISTS "crm_products_collection_idx" ON "crm_products"("collection");

-- Custom fields
ALTER TABLE "crm_custom_field_defs" ADD COLUMN IF NOT EXISTS "file_config" JSONB;
ALTER TABLE "crm_custom_field_defs" ADD COLUMN IF NOT EXISTS "show_in_table" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_custom_field_defs" ADD COLUMN IF NOT EXISTS "show_in_quick" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_custom_field_defs" ADD COLUMN IF NOT EXISTS "read_only" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "crm_custom_field_values" ADD COLUMN IF NOT EXISTS "file_url" TEXT;
ALTER TABLE "crm_custom_field_values" ADD COLUMN IF NOT EXISTS "file_name" VARCHAR(255);
ALTER TABLE "crm_custom_field_values" ADD COLUMN IF NOT EXISTS "file_size" INTEGER;
ALTER TABLE "crm_custom_field_values" ADD COLUMN IF NOT EXISTS "mime_type" VARCHAR(100);

-- Mail templates
ALTER TABLE "mail_templates" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(24) NOT NULL DEFAULT 'marketing';
ALTER TABLE "mail_templates" ADD COLUMN IF NOT EXISTS "event_key" VARCHAR(40);
ALTER TABLE "mail_templates" ADD COLUMN IF NOT EXISTS "product_ids" JSONB;
CREATE INDEX IF NOT EXISTS "mail_templates_kind_event_key_idx" ON "mail_templates"("kind", "event_key");

-- Accounts
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "billing_state" VARCHAR(100);
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "credit_limit" DECIMAL(18,2);
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "credit_days" INTEGER;
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "price_list_id" BIGINT;
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "health" VARCHAR(16);
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "last_ordered_at" TIMESTAMP(3);
ALTER TABLE "crm_accounts" ADD COLUMN IF NOT EXISTS "replenish_days" INTEGER;

-- Quotes
ALTER TABLE "crm_quotes" ALTER COLUMN "status" TYPE VARCHAR(24);
ALTER TABLE "crm_quotes" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "crm_quotes" ADD COLUMN IF NOT EXISTS "parent_quote_id" BIGINT;
ALTER TABLE "crm_quotes" ADD COLUMN IF NOT EXISTS "counter_notes" TEXT;
ALTER TABLE "crm_quotes" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(24) NOT NULL DEFAULT 'not_required';
ALTER TABLE "crm_quotes" ADD COLUMN IF NOT EXISTS "reserved_until" TIMESTAMP(3);

-- Orders
ALTER TABLE "crm_orders" ALTER COLUMN "status" TYPE VARCHAR(24);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "courier" VARCHAR(80);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "tracking_number" VARCHAR(80);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "packed_at" TIMESTAMP(3);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP(3);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "pod_url" VARCHAR(500);
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "pod_notes" TEXT;
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "is_sample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "promised_date" DATE;

ALTER TABLE "crm_quote_items" ADD COLUMN IF NOT EXISTS "hsn_code" VARCHAR(20);
ALTER TABLE "crm_order_items" ADD COLUMN IF NOT EXISTS "hsn_code" VARCHAR(20);
ALTER TABLE "crm_invoice_items" ADD COLUMN IF NOT EXISTS "hsn_code" VARCHAR(20);

-- New tables
CREATE TABLE IF NOT EXISTS "crm_stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "movement_type" VARCHAR(30) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "previous_stock" DECIMAL(12,3) NOT NULL,
    "new_stock" DECIMAL(12,3) NOT NULL,
    "reference_type" VARCHAR(30),
    "reference_id" BIGINT,
    "notes" TEXT,
    "created_by_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_stock_movements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_stock_movements_product_id_created_at_idx" ON "crm_stock_movements"("product_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_stock_movements_reference_type_reference_id_idx" ON "crm_stock_movements"("reference_type", "reference_id");

CREATE TABLE IF NOT EXISTS "crm_product_branch_stock" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "stock_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    CONSTRAINT "crm_product_branch_stock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_product_branch_stock_product_id_branch_id_key" ON "crm_product_branch_stock"("product_id", "branch_id");
CREATE INDEX IF NOT EXISTS "crm_product_branch_stock_branch_id_idx" ON "crm_product_branch_stock"("branch_id");

CREATE TABLE IF NOT EXISTS "crm_product_kit_items" (
    "id" BIGSERIAL NOT NULL,
    "kit_id" BIGINT NOT NULL,
    "component_id" BIGINT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    CONSTRAINT "crm_product_kit_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_product_kit_items_kit_id_component_id_key" ON "crm_product_kit_items"("kit_id", "component_id");

CREATE TABLE IF NOT EXISTS "crm_price_lists" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'retail',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_price_lists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_price_lists_slug_key" ON "crm_price_lists"("slug");

CREATE TABLE IF NOT EXISTS "crm_price_list_items" (
    "id" BIGSERIAL NOT NULL,
    "price_list_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "min_qty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "min_selling_price" DECIMAL(18,2),
    CONSTRAINT "crm_price_list_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_price_list_items_price_list_id_product_id_min_qty_key" ON "crm_price_list_items"("price_list_id", "product_id", "min_qty");

CREATE TABLE IF NOT EXISTS "crm_shipments" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "account_id" BIGINT,
    "shipment_number" VARCHAR(30) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'packed',
    "courier" VARCHAR(80),
    "tracking_number" VARCHAR(80),
    "eta" DATE,
    "packed_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "pod_url" VARCHAR(500),
    "pod_notes" TEXT,
    "notes" TEXT,
    "created_by_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_shipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_shipments_shipment_number_key" ON "crm_shipments"("shipment_number");
CREATE INDEX IF NOT EXISTS "crm_shipments_order_id_idx" ON "crm_shipments"("order_id");
CREATE INDEX IF NOT EXISTS "crm_shipments_status_created_at_idx" ON "crm_shipments"("status", "created_at");

CREATE TABLE IF NOT EXISTS "crm_shipment_items" (
    "id" BIGSERIAL NOT NULL,
    "shipment_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    CONSTRAINT "crm_shipment_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_shipment_items_shipment_id_idx" ON "crm_shipment_items"("shipment_id");

CREATE TABLE IF NOT EXISTS "crm_credit_notes" (
    "id" BIGSERIAL NOT NULL,
    "credit_note_number" VARCHAR(30) NOT NULL,
    "account_id" BIGINT,
    "order_id" BIGINT,
    "invoice_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'issued',
    "reason" VARCHAR(40),
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_credit_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_credit_notes_credit_note_number_key" ON "crm_credit_notes"("credit_note_number");
CREATE INDEX IF NOT EXISTS "crm_credit_notes_account_id_idx" ON "crm_credit_notes"("account_id");
CREATE INDEX IF NOT EXISTS "crm_credit_notes_order_id_idx" ON "crm_credit_notes"("order_id");

CREATE TABLE IF NOT EXISTS "crm_credit_note_items" (
    "id" BIGSERIAL NOT NULL,
    "credit_note_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT "crm_credit_note_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_credit_note_items_credit_note_id_idx" ON "crm_credit_note_items"("credit_note_id");

CREATE TABLE IF NOT EXISTS "crm_sales_approvals" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "account_id" BIGINT,
    "quote_id" BIGINT,
    "order_id" BIGINT,
    "kind" VARCHAR(24) NOT NULL,
    "requested_pct" DECIMAL(6,3),
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "decided_by_id" BIGINT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_sales_approvals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_sales_approvals_status_created_at_idx" ON "crm_sales_approvals"("status", "created_at");
CREATE INDEX IF NOT EXISTS "crm_sales_approvals_entity_type_entity_id_idx" ON "crm_sales_approvals"("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "crm_cadences" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_cadences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_cadences_slug_key" ON "crm_cadences"("slug");

CREATE TABLE IF NOT EXISTS "crm_cadence_steps" (
    "id" BIGSERIAL NOT NULL,
    "cadence_id" BIGINT NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "channel" VARCHAR(20) NOT NULL,
    "event_key" VARCHAR(40),
    "subject" VARCHAR(200),
    "body" TEXT,
    CONSTRAINT "crm_cadence_steps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_cadence_steps_cadence_id_sort_order_idx" ON "crm_cadence_steps"("cadence_id", "sort_order");

CREATE TABLE IF NOT EXISTS "crm_cadence_enrollments" (
    "id" BIGSERIAL NOT NULL,
    "cadence_id" BIGINT NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "step_index" INTEGER NOT NULL DEFAULT 0,
    "next_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_cadence_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_cadence_enrollments_lead_id_status_idx" ON "crm_cadence_enrollments"("lead_id", "status");
CREATE INDEX IF NOT EXISTS "crm_cadence_enrollments_next_at_status_idx" ON "crm_cadence_enrollments"("next_at", "status");

-- FKs
ALTER TABLE "crm_stock_movements" ADD CONSTRAINT "crm_stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "crm_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_product_branch_stock" ADD CONSTRAINT "crm_product_branch_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "crm_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_product_kit_items" ADD CONSTRAINT "crm_product_kit_items_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "crm_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_product_kit_items" ADD CONSTRAINT "crm_product_kit_items_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "crm_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_price_list_items" ADD CONSTRAINT "crm_price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "crm_price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_price_list_items" ADD CONSTRAINT "crm_price_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "crm_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_shipments" ADD CONSTRAINT "crm_shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "crm_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_shipment_items" ADD CONSTRAINT "crm_shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "crm_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_credit_note_items" ADD CONSTRAINT "crm_credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "crm_credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_cadence_steps" ADD CONSTRAINT "crm_cadence_steps_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_cadence_enrollments" ADD CONSTRAINT "crm_cadence_enrollments_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "crm_accounts_price_list_id_idx" ON "crm_accounts"("price_list_id");
