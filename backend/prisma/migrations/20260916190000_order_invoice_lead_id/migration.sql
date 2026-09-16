ALTER TABLE "crm_orders" ADD COLUMN IF NOT EXISTS "lead_id" BIGINT;
ALTER TABLE "crm_invoices" ADD COLUMN IF NOT EXISTS "lead_id" BIGINT;

CREATE INDEX IF NOT EXISTS "crm_orders_lead_id_idx" ON "crm_orders"("lead_id");
CREATE INDEX IF NOT EXISTS "crm_invoices_lead_id_idx" ON "crm_invoices"("lead_id");
