-- CreateTable
CREATE TABLE "verified_field_values" (
    "id" BIGSERIAL NOT NULL,
    "field" VARCHAR(50) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "parent" VARCHAR(255),
    "verified_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verified_field_values_field_idx" ON "verified_field_values"("field");

-- CreateIndex
CREATE UNIQUE INDEX "verified_field_values_field_value_key" ON "verified_field_values"("field", "value");
