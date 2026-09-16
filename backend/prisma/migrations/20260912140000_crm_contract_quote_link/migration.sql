-- crm_contracts.quote_id: the accepted quote a contract was drawn up from.
-- Additive only; nothing dropped. Rolled out per customer with
--   npm run tenant:migrate:all -- --only=britannica_bots

-- AlterTable
ALTER TABLE "crm_contracts" ADD COLUMN     "quote_id" BIGINT;

-- CreateIndex
CREATE INDEX "crm_contracts_deal_id_idx" ON "crm_contracts"("deal_id");

-- CreateIndex
CREATE INDEX "crm_contracts_quote_id_idx" ON "crm_contracts"("quote_id");
