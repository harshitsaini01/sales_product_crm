-- CreateTable
CREATE TABLE "lead_staging_batches" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "file_name" VARCHAR(255),
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "verified_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "seeded_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_staging_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_staging_items" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150),
    "phone" VARCHAR(50),
    "verified" BOOLEAN,
    "comments" TEXT,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "lead_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_staging_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_staging_batches_created_at_idx" ON "lead_staging_batches"("created_at" DESC);

-- CreateIndex
CREATE INDEX "lead_staging_items_batch_id_idx" ON "lead_staging_items"("batch_id");

-- AddForeignKey
ALTER TABLE "lead_staging_items" ADD CONSTRAINT "lead_staging_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lead_staging_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
