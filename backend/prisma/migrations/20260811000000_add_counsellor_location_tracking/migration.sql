ALTER TABLE "users"
  ADD COLUMN "location_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "location_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "user_locations" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracy_m" DOUBLE PRECISION,
  "altitude_m" DOUBLE PRECISION,
  "speed_mps" DOUBLE PRECISION,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "user_locations_user_id_recorded_at_idx" ON "user_locations"("user_id", "recorded_at");