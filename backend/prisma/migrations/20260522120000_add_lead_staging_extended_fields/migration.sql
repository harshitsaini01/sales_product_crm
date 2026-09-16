-- AlterTable: add extended lead fields to lead_staging_items so the bulk
-- upload can carry a full lead profile (father/mother/address/course/etc.)
-- and the seeded Lead row gets populated in one pass.
ALTER TABLE "lead_staging_items"
  ADD COLUMN "father"               VARCHAR(100),
  ADD COLUMN "mother"               VARCHAR(100),
  ADD COLUMN "email2"               VARCHAR(150),
  ADD COLUMN "email3"               VARCHAR(150),
  ADD COLUMN "mobile2"              VARCHAR(50),
  ADD COLUMN "mobile3"              VARCHAR(50),
  ADD COLUMN "father_mobile"        VARCHAR(50),
  ADD COLUMN "mother_mobile"        VARCHAR(50),
  ADD COLUMN "city"                 VARCHAR(100),
  ADD COLUMN "state"                VARCHAR(50),
  ADD COLUMN "country"              VARCHAR(100),
  ADD COLUMN "pincode"              VARCHAR(20),
  ADD COLUMN "dob"                  VARCHAR(100),
  ADD COLUMN "gender"               VARCHAR(10),
  ADD COLUMN "nationality"          VARCHAR(50),
  ADD COLUMN "intrested_course"     VARCHAR(100),
  ADD COLUMN "intrested_university" VARCHAR(100),
  ADD COLUMN "event"                VARCHAR(100),
  ADD COLUMN "source"               VARCHAR(100),
  ADD COLUMN "lead_type"            VARCHAR(50),
  ADD COLUMN "lead_comment"         TEXT;
