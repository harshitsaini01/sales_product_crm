-- CreateTable
CREATE TABLE "app_releases" (
    "id" BIGSERIAL NOT NULL,
    "version_code" INTEGER NOT NULL,
    "version_name" VARCHAR(50) NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "release_notes" TEXT,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" BIGINT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_releases_version_code_key" ON "app_releases"("version_code");

-- CreateIndex
CREATE INDEX "app_releases_version_code_idx" ON "app_releases"("version_code" DESC);

-- AddForeignKey
ALTER TABLE "app_releases" ADD CONSTRAINT "app_releases_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
