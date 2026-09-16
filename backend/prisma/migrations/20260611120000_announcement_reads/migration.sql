-- CreateTable
CREATE TABLE "tbl_announcement_reads" (
    "id" BIGSERIAL NOT NULL,
    "announcement_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tbl_announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tbl_announcement_reads_announcement_id_user_id_key"
  ON "tbl_announcement_reads"("announcement_id", "user_id");

-- CreateIndex
CREATE INDEX "tbl_announcement_reads_user_id_idx"
  ON "tbl_announcement_reads"("user_id");

-- AddForeignKey
ALTER TABLE "tbl_announcement_reads"
  ADD CONSTRAINT "tbl_announcement_reads_announcement_id_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "tbl_announcements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_announcement_reads"
  ADD CONSTRAINT "tbl_announcement_reads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
