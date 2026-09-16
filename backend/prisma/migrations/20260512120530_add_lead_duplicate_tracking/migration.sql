-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "duplicate_of_id" BIGINT;
