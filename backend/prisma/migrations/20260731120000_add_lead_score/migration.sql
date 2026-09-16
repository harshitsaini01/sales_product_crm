-- AlterTable
-- Simple lead score counter. Increments +1 whenever a call to this lead is
-- picked up (MobileCall transitions to ANSWERED). No decay, no cap.
ALTER TABLE "leads" ADD COLUMN     "lead_score" INTEGER NOT NULL DEFAULT 0;
