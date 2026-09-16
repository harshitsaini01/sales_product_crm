-- Drop Application Tracking.
--
-- "App Tracking" was short for APPLICATION tracking — the university admissions
-- pipeline (Applied -> Under Review -> Documents Requested -> Sent to University
-- -> Offer Received -> Visa Processing -> Completed/Rejected), with notes and
-- documents per application. Unrelated to the mobile app, and unrelated to the
-- inactivity/activity tracking that stays.
--
-- Never used once: 0 applications, 0 notes, 0 documents, in a database holding
-- 63,528 leads. Removed with its two pages, the Applications tab on Student
-- Detail, and 9 backend routes.
--
-- Children first: app_notes.app_id and app_documents.app_id both reference
-- tbl_apptrackstudent.id.
DROP TABLE IF EXISTS "app_notes";
DROP TABLE IF EXISTS "app_documents";
DROP TABLE IF EXISTS "tbl_apptrackstudent";
