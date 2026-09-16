-- ═══════════════════════════════════════════════════════════════════════════
-- The business side of a lead: company name, and where it went once converted.
--
-- ONE CREATE TABLE. Nothing is added to, altered on, or dropped from `leads`.
--
-- That is deliberate and it is the reason this is a side table rather than four
-- columns. Prisma's client selects every scalar field on a model, so a
-- `company_name` on Lead that is missing from `public.leads` would break every
-- Tutelage lead query — meaning lead columns can never be rolled out to one
-- customer at a time. A crm_* table can:
--
--   npm run tenant:migrate:all -- --only=britannica_bots
--
-- The only statement naming `leads` is the child table's foreign key, which
-- takes a brief lock on the parent to validate. In the tenant this is applied
-- to, `leads` holds a handful of rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "crm_lead_business" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "company_name" VARCHAR(180),
    "designation" VARCHAR(120),
    "website" VARCHAR(255),
    "account_id" BIGINT,
    "contact_id" BIGINT,
    "deal_id" BIGINT,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_business_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_business_lead_id_key" ON "crm_lead_business"("lead_id");

-- CreateIndex
CREATE INDEX "crm_lead_business_account_id_idx" ON "crm_lead_business"("account_id");

-- CreateIndex
CREATE INDEX "crm_lead_business_company_name_idx" ON "crm_lead_business"("company_name");

-- AddForeignKey
ALTER TABLE "crm_lead_business" ADD CONSTRAINT "crm_lead_business_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

