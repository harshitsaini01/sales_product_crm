-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active_mobile_session_id" VARCHAR(64),
ADD COLUMN     "active_web_session_id" VARCHAR(64);
