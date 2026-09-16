-- Drop the university registry.
--
-- 82 rows, but abandoned rather than active: last row added 2023-04-07, last
-- edit 2023-07-03, and every table hanging off it was empty (tbl_courses 0,
-- tbl_shortlist 0, tbl_apptrackstudent 0). Of the 51 leads naming a university,
-- exactly ONE matched a row here — counsellors type `leads.intrested_university`
-- as free text and never picked from this list.
--
-- Order matters: children first, or the FKs block the parent drop.
--   tbl_shortlist.university_id -> universities.id
--   tbl_courses.university_id   -> universities.id
-- (tbl_program_fees is dropped by 20260824120000; IF EXISTS keeps this file
--  order-independent should the two ever be applied out of sequence.)
DROP TABLE IF EXISTS "tbl_shortlist";
DROP TABLE IF EXISTS "tbl_courses";
DROP TABLE IF EXISTS "universities";

-- tbl_apptrackstudent.university_id is left in place deliberately: it is a
-- plain nullable BigInt with NO foreign key to universities (confirmed against
-- pg_constraint), all 0 rows carry it as NULL, and App Tracking itself is
-- staying. Dropping the column would be a schema change to a feature that was
-- not part of this cleanup.
--
-- Kept and untouched: university_application_mails. Despite the name it never
-- referenced this table — it works off free-text `universityName` and
-- `leads.intrested_university`, so the University Mails feature is unaffected.
