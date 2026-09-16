-- ═══════════════════════════════════════════════════════════════════════════
-- B2B sales core: accounts, contacts, locations, the activity timeline,
-- polymorphic notes and tags, and the custom-field engine.
--
-- ADDITIVE ONLY. Every statement below either creates a new crm_* table or
-- adds a NULLABLE column. Nothing is dropped, no column changes type, and no
-- column becomes NOT NULL. An education customer gets these tables created
-- empty and never writes a row to them, because the `accounts` and
-- `custom_fields` modules are off for them and the API mounts are gated on it.
--
-- The one existing table touched is tbl_todolist (Task), which had no owner
-- columns at all — both new columns stay NULL for every existing row, which is
-- exactly the "no subject" those tasks already have.
--
-- Generated offline with:
--   prisma migrate diff --from-schema-datamodel <previous> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- ═══════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "tbl_todolist" ADD COLUMN     "entity_id" BIGINT,
ADD COLUMN     "entity_type" VARCHAR(20);

-- CreateTable
CREATE TABLE "crm_accounts" (
    "id" BIGSERIAL NOT NULL,
    "account_number" VARCHAR(30),
    "name" VARCHAR(180) NOT NULL,
    "legal_name" VARCHAR(180),
    "account_type_id" BIGINT,
    "industry_id" BIGINT,
    "status" VARCHAR(24) NOT NULL DEFAULT 'prospect',
    "business_model" VARCHAR(24),
    "employee_count" INTEGER,
    "annual_revenue" DECIMAL(18,2),
    "founded_year" INTEGER,
    "website" VARCHAR(255),
    "linkedin" VARCHAR(255),
    "email" VARCHAR(150),
    "phone" VARCHAR(40),
    "whatsapp" VARCHAR(40),
    "logo_url" VARCHAR(255),
    "gstin" VARCHAR(20),
    "pan" VARCHAR(20),
    "cin" VARCHAR(30),
    "legal_structure" VARCHAR(40),
    "owner_id" BIGINT,
    "branch_id" BIGINT,
    "created_by_id" BIGINT,
    "notes" TEXT,
    "trash" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_account_types" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crm_account_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_industries" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "parent_id" BIGINT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crm_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_locations" (
    "id" BIGSERIAL NOT NULL,
    "account_id" BIGINT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" VARCHAR(24) NOT NULL DEFAULT 'branch',
    "address" TEXT,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "pincode" VARCHAR(20),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "phone" VARCHAR(40),
    "email" VARCHAR(150),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" BIGSERIAL NOT NULL,
    "account_id" BIGINT,
    "location_id" BIGINT,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80),
    "job_title" VARCHAR(120),
    "department" VARCHAR(80),
    "seniority" VARCHAR(24),
    "email" VARCHAR(150),
    "personal_email" VARCHAR(150),
    "mobile" VARCHAR(40),
    "whatsapp" VARCHAR(40),
    "office_phone" VARCHAR(40),
    "linkedin" VARCHAR(255),
    "preferred_channel" VARCHAR(20),
    "language" VARCHAR(40),
    "role" VARCHAR(24) NOT NULL DEFAULT 'unknown',
    "relationship_strength" VARCHAR(16) NOT NULL DEFAULT 'unknown',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "owner_id" BIGINT,
    "notes" TEXT,
    "trash" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "subject" VARCHAR(255),
    "body" TEXT,
    "actor_id" BIGINT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "source_type" VARCHAR(30),
    "source_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_notes" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'general',
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tags" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "color" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tag_links" (
    "id" BIGSERIAL NOT NULL,
    "tag_id" BIGINT NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_defs" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "applies_when" JSONB,
    "section" VARCHAR(60),
    "help_text" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_custom_field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_values" (
    "id" BIGSERIAL NOT NULL,
    "def_id" BIGINT NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "value_text" TEXT,
    "value_num" DECIMAL(18,4),
    "value_date" TIMESTAMP(3),
    "value_bool" BOOLEAN,
    "value_json" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_accounts_account_number_key" ON "crm_accounts"("account_number");

-- CreateIndex
CREATE INDEX "crm_accounts_trash_name_idx" ON "crm_accounts"("trash", "name");

-- CreateIndex
CREATE INDEX "crm_accounts_owner_id_trash_idx" ON "crm_accounts"("owner_id", "trash");

-- CreateIndex
CREATE INDEX "crm_accounts_account_type_id_idx" ON "crm_accounts"("account_type_id");

-- CreateIndex
CREATE INDEX "crm_accounts_industry_id_idx" ON "crm_accounts"("industry_id");

-- CreateIndex
CREATE INDEX "crm_accounts_gstin_idx" ON "crm_accounts"("gstin");

-- CreateIndex
CREATE INDEX "crm_accounts_created_at_idx" ON "crm_accounts"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "crm_account_types_slug_key" ON "crm_account_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "crm_industries_slug_key" ON "crm_industries"("slug");

-- CreateIndex
CREATE INDEX "crm_industries_parent_id_idx" ON "crm_industries"("parent_id");

-- CreateIndex
CREATE INDEX "crm_locations_account_id_idx" ON "crm_locations"("account_id");

-- CreateIndex
CREATE INDEX "crm_contacts_account_id_trash_idx" ON "crm_contacts"("account_id", "trash");

-- CreateIndex
CREATE INDEX "crm_contacts_trash_last_name_idx" ON "crm_contacts"("trash", "last_name");

-- CreateIndex
CREATE INDEX "crm_contacts_email_idx" ON "crm_contacts"("email");

-- CreateIndex
CREATE INDEX "crm_contacts_mobile_idx" ON "crm_contacts"("mobile");

-- CreateIndex
CREATE INDEX "crm_activities_entity_type_entity_id_occurred_at_idx" ON "crm_activities"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "crm_activities_actor_id_occurred_at_idx" ON "crm_activities"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "crm_activities_source_type_source_id_key" ON "crm_activities"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "crm_notes_entity_type_entity_id_created_at_idx" ON "crm_notes"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "crm_tags_slug_key" ON "crm_tags"("slug");

-- CreateIndex
CREATE INDEX "crm_tag_links_entity_type_entity_id_idx" ON "crm_tag_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tag_links_tag_id_entity_type_entity_id_key" ON "crm_tag_links"("tag_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "crm_custom_field_defs_entity_type_active_sort_order_idx" ON "crm_custom_field_defs"("entity_type", "active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_defs_entity_type_key_key" ON "crm_custom_field_defs"("entity_type", "key");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_entity_type_entity_id_idx" ON "crm_custom_field_values"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_def_id_value_num_idx" ON "crm_custom_field_values"("def_id", "value_num");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_def_id_value_text_idx" ON "crm_custom_field_values"("def_id", "value_text");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_values_def_id_entity_type_entity_id_key" ON "crm_custom_field_values"("def_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "tbl_todolist_entity_type_entity_id_idx" ON "tbl_todolist"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "crm_account_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "crm_industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_industries" ADD CONSTRAINT "crm_industries_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "crm_industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_locations" ADD CONSTRAINT "crm_locations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "crm_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tag_links" ADD CONSTRAINT "crm_tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_def_id_fkey" FOREIGN KEY ("def_id") REFERENCES "crm_custom_field_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

