-- Drop the Brochures feature.
--
-- 338 rows, but dead twice over:
--
--   1. Every row has status = 0. The list route filtered `where status = 1`,
--      so the page already rendered an empty list in production.
--   2. The files are gone. `filepath` held absolute URLs into the OLD
--      CodeIgniter site
--      (https://www.tutelagestudy.com/crm/assets/uploadFiles/brochure/...);
--      nothing was ever copied into this system's uploads/. Spot-checked two
--      and both return HTTP 404.
--
-- So the rows were metadata pointing at files that no longer exist anywhere —
-- un-deleting them would only have produced 404s. Uploads ran Oct 2020 to
-- Sep 2021 and stopped; brochure_assignments was never used at all (0 rows).
--
-- Children first: brochure_assignments.brochure_id -> brochures.id.
DROP TABLE IF EXISTS "brochure_assignments";
DROP TABLE IF EXISTS "brochures";

-- Note: the removed `POST /brochures/:id/send-to-lead/:leadId` route wrote to
-- `sent_mails`. That table is shared with the other mail features and is NOT
-- touched here — only the brochure route that fed it is gone.
