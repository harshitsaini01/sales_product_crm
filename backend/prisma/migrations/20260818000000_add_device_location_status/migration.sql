CREATE TABLE "user_device_location_status" (
  "user_id" BIGINT NOT NULL,
  "permission_granted" BOOLEAN NOT NULL,
  "background_granted" BOOLEAN NOT NULL,
  "gps_enabled" BOOLEAN NOT NULL,
  "battery_exempt" BOOLEAN NOT NULL,
  "blocked" BOOLEAN NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_device_location_status_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_device_location_status" ADD CONSTRAINT "user_device_location_status_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
