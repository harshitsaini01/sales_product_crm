-- Add the tracking columns that make quick-sent mails first-class citizens in
-- the Sent History and Reports tabs — same funnel as scheduled campaigns.
ALTER TABLE "sent_mails" ADD COLUMN "message_id"    VARCHAR(255);
ALTER TABLE "sent_mails" ADD COLUMN "group_id"      BIGINT;
ALTER TABLE "sent_mails" ADD COLUMN "opened_at"     TIMESTAMP(3);
ALTER TABLE "sent_mails" ADD COLUMN "error_message" TEXT;

CREATE INDEX "sent_mails_message_id_idx"          ON "sent_mails"("message_id");
CREATE INDEX "sent_mails_to_email_created_at_idx" ON "sent_mails"("to_email", "created_at");
