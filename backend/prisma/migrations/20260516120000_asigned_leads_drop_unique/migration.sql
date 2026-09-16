-- Drop the unique index added by 20260516000000_asigned_leads_unique.
-- The "no duplicate assignments" guarantee is now enforced in application
-- code (see leads.routes.ts: bulk-assign, assign-all, single assign).
DROP INDEX IF EXISTS "asigned_leads_clr_std_unique";
