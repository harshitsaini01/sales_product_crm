-- Deduplicate existing assignments on (clr_id, std_id), keeping the earliest row,
-- then add a unique index so future inserts can't create duplicate assignments
-- of the same lead to the same counsellor.

DELETE FROM asigned_leads a
USING asigned_leads b
WHERE  a.ctid < b.ctid          -- delete the "newer" duplicate
  AND  a.clr_id = b.clr_id
  AND  a.std_id = b.std_id;

-- The condition above keeps the row with the LARGEST ctid per (clr_id, std_id).
-- Re-do it the other way (cleanup safety net) — keep lowest id, drop the rest.
DELETE FROM asigned_leads a
USING asigned_leads b
WHERE  a.id > b.id
  AND  a.clr_id = b.clr_id
  AND  a.std_id = b.std_id;

CREATE UNIQUE INDEX IF NOT EXISTS "asigned_leads_clr_std_unique"
  ON "asigned_leads"("clr_id", "std_id");
