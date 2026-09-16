-- Drop four tables nothing can reach.
--
-- All four hold 0 rows, no foreign key points at any of them, and no code path
-- reads or writes them. Verified three ways: no Prisma accessor
-- (prisma.state / prisma.website / prisma.agentRegistration / prisma.appStage /
-- prisma.appStatus), no raw SQL naming the tables, and — for `states`, which
-- produced 28 grep hits — every one of those hits inspected and confirmed to be
-- a JS variable, a UI label ("All states"), a comment ("three review states"),
-- or the /b2b/states endpoint, which reads the b2b_contacts.state COLUMN.
--
--   agent_registrations  an agent signup/approval flow that was scaffolded and
--                        never built. The `agents` table it pairs with stays.
--   app_stages           config lookups for Application Tracking (dropped in
--   app_statuses         20260824120400). Never populated even while that
--                        feature existed — the pipeline options were hardcoded
--                        in a STAGES array on the client instead.
--   states               legacy state lookup from the CodeIgniter migration.
--                        The new CRM builds state dropdowns from distinct
--                        leads.state values, so this was bypassed from day one.
--
-- No data is lost and no runtime behaviour changes; this is schema hygiene.
DROP TABLE IF EXISTS "agent_registrations";
DROP TABLE IF EXISTS "app_stages";
DROP TABLE IF EXISTS "app_statuses";
DROP TABLE IF EXISTS "states";
