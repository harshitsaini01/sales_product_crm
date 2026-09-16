-- AlterTable
ALTER TABLE "mobile_calls" ADD COLUMN     "sim_carrier" VARCHAR(80),
ADD COLUMN     "sim_number" VARCHAR(32),
ADD COLUMN     "sim_slot" SMALLINT;
