ALTER TABLE "user_device_location_status"
  ADD COLUMN "call_phone_granted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "phone_state_granted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "call_log_granted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "record_audio_granted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifications_granted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "block_reason" VARCHAR(120);
