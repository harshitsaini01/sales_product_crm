-- ═══════════════════════════════════════════════════════════════════════════
-- Sales documents: quotes, contracts, orders, B2B invoices and payments.
--
-- PURELY ADDITIVE. CREATE TABLE only — no ALTER, no DROP, not one statement
-- against a table that already existed.
--
-- Note there is NO change to tbl_invoicelist. Tutelage's student fee instalment
-- and a B2B tax invoice are different documents; crm_invoices is a new table
-- and the old one is untouched. See the header of the Quote model.
--
-- Generated offline with:
--   prisma migrate diff --from-schema-datamodel <schema before this change> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "crm_quotes" (
    "id" BIGSERIAL NOT NULL,
    "quote_number" VARCHAR(30) NOT NULL,
    "account_id" BIGINT,
    "contact_id" BIGINT,
    "deal_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "issue_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" DATE,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "payment_terms" VARCHAR(255),
    "delivery_terms" VARCHAR(255),
    "notes" TEXT,
    "owner_id" BIGINT,
    "created_by_id" BIGINT,
    "sent_at" TIMESTAMP(3),
    "viewed_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_quote_items" (
    "id" BIGSERIAL NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crm_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contracts" (
    "id" BIGSERIAL NOT NULL,
    "contract_number" VARCHAR(30) NOT NULL,
    "account_id" BIGINT,
    "deal_id" BIGINT,
    "title" VARCHAR(200) NOT NULL,
    "type" VARCHAR(60),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "start_date" DATE,
    "end_date" DATE,
    "renewal_date" DATE,
    "value" DECIMAL(18,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "payment_terms" VARCHAR(255),
    "signed_by" VARCHAR(150),
    "signed_at" TIMESTAMP(3),
    "document_url" VARCHAR(500),
    "notes" TEXT,
    "owner_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_orders" (
    "id" BIGSERIAL NOT NULL,
    "order_number" VARCHAR(30) NOT NULL,
    "account_id" BIGINT,
    "contact_id" BIGINT,
    "deal_id" BIGINT,
    "quote_id" BIGINT,
    "contract_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    "order_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_date" DATE,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "owner_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_order_items" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crm_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_invoices" (
    "id" BIGSERIAL NOT NULL,
    "invoice_number" VARCHAR(30) NOT NULL,
    "account_id" BIGINT,
    "contact_id" BIGINT,
    "deal_id" BIGINT,
    "order_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "issue_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "terms" VARCHAR(255),
    "notes" TEXT,
    "owner_id" BIGINT,
    "created_by_id" BIGINT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_invoice_items" (
    "id" BIGSERIAL NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "name" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crm_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_payments" (
    "id" BIGSERIAL NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "mode" VARCHAR(24) NOT NULL DEFAULT 'bank_transfer',
    "transaction_id" VARCHAR(120),
    "bank" VARCHAR(120),
    "reference" VARCHAR(255),
    "notes" TEXT,
    "recorded_by_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_quotes_quote_number_key" ON "crm_quotes"("quote_number");

-- CreateIndex
CREATE INDEX "crm_quotes_account_id_idx" ON "crm_quotes"("account_id");

-- CreateIndex
CREATE INDEX "crm_quotes_deal_id_idx" ON "crm_quotes"("deal_id");

-- CreateIndex
CREATE INDEX "crm_quotes_status_issue_date_idx" ON "crm_quotes"("status", "issue_date" DESC);

-- CreateIndex
CREATE INDEX "crm_quote_items_quote_id_idx" ON "crm_quote_items"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contracts_contract_number_key" ON "crm_contracts"("contract_number");

-- CreateIndex
CREATE INDEX "crm_contracts_account_id_idx" ON "crm_contracts"("account_id");

-- CreateIndex
CREATE INDEX "crm_contracts_status_idx" ON "crm_contracts"("status");

-- CreateIndex
CREATE INDEX "crm_contracts_renewal_date_idx" ON "crm_contracts"("renewal_date");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_order_number_key" ON "crm_orders"("order_number");

-- CreateIndex
CREATE INDEX "crm_orders_account_id_idx" ON "crm_orders"("account_id");

-- CreateIndex
CREATE INDEX "crm_orders_status_order_date_idx" ON "crm_orders"("status", "order_date" DESC);

-- CreateIndex
CREATE INDEX "crm_order_items_order_id_idx" ON "crm_order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_invoices_invoice_number_key" ON "crm_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "crm_invoices_account_id_idx" ON "crm_invoices"("account_id");

-- CreateIndex
CREATE INDEX "crm_invoices_status_due_date_idx" ON "crm_invoices"("status", "due_date");

-- CreateIndex
CREATE INDEX "crm_invoice_items_invoice_id_idx" ON "crm_invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "crm_payments_invoice_id_idx" ON "crm_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "crm_payments_payment_date_idx" ON "crm_payments"("payment_date" DESC);

-- AddForeignKey
ALTER TABLE "crm_quotes" ADD CONSTRAINT "crm_quotes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_quote_items" ADD CONSTRAINT "crm_quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "crm_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_orders" ADD CONSTRAINT "crm_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "crm_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_orders" ADD CONSTRAINT "crm_orders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_order_items" ADD CONSTRAINT "crm_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "crm_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_invoices" ADD CONSTRAINT "crm_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "crm_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_invoices" ADD CONSTRAINT "crm_invoices_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_invoice_items" ADD CONSTRAINT "crm_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "crm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "crm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

