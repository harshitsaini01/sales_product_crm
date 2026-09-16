-- Separate "uploaded" from "released to counsellors".
--
-- GET /api/app-releases/latest returned `orderBy versionCode desc` with no
-- other filter, so the instant an APK row existed with a higher versionCode
-- than the installed build, every counsellor's app saw it — and if the row was
-- flagged is_mandatory, the app-wide blocking gate came up for the whole field
-- team. A test upload, a wrong versionCode typed into the form, or a build
-- staged ahead of its rollout all had the same effect, and the only way to undo
-- it was to DELETE the row.
--
-- New uploads now default to is_published = false and must be published
-- explicitly. Existing rows are backfilled to true so behaviour for anything
-- already distributed is unchanged by this migration.

ALTER TABLE "app_releases"
  ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false;

UPDATE "app_releases" SET "is_published" = true;

CREATE INDEX "app_releases_is_published_version_code_idx"
  ON "app_releases" ("is_published", "version_code" DESC);
