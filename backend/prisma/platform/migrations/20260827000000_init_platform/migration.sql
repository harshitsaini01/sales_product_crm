-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'expired');

-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('pending', 'creating_schema', 'migrating', 'seeding', 'ready', 'failed');

-- CreateTable
CREATE TABLE "tenants" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "schema_name" VARCHAR(63) NOT NULL,
    "company_name" VARCHAR(150) NOT NULL,
    "contact_name" VARCHAR(100),
    "contact_email" VARCHAR(150),
    "contact_phone" VARCHAR(30),
    "logo_url" VARCHAR(255),
    "notes" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "suspended_reason" VARCHAR(255),
    "plan_name" VARCHAR(50) NOT NULL DEFAULT 'starter',
    "plan_starts_at" TIMESTAMP(3),
    "plan_expires_at" TIMESTAMP(3),
    "provisioning_status" "ProvisioningStatus" NOT NULL DEFAULT 'ready',
    "provisioning_step" VARCHAR(120),
    "provisioning_error" TEXT,
    "max_users" INTEGER,
    "max_counsellors" INTEGER,
    "max_sub_admins" INTEGER,
    "max_branches" INTEGER,
    "max_leads" INTEGER,
    "max_leads_per_month" INTEGER,
    "max_storage_mb" INTEGER,
    "features" JSONB NOT NULL DEFAULT '{}',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password" VARCHAR(250) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "is_root" BOOLEAN NOT NULL DEFAULT false,
    "active_session_id" VARCHAR(64),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_user_directory" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "user_id" BIGINT NOT NULL,
    "loginid" VARCHAR(100) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "username" VARCHAR(100),
    "name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_user_directory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_api_keys" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "key_prefix" VARCHAR(16) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_usage_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "captured_on" DATE NOT NULL,
    "users" INTEGER NOT NULL DEFAULT 0,
    "counsellors" INTEGER NOT NULL DEFAULT 0,
    "branches" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "leads_this_month" INTEGER NOT NULL DEFAULT 0,
    "storage_mb" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "platform_user_id" BIGINT,
    "actor_name" VARCHAR(100) NOT NULL,
    "tenant_id" INTEGER,
    "action" VARCHAR(60) NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "detail" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_schema_name_key" ON "tenants"("schema_name");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_plan_expires_at_idx" ON "tenants"("plan_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE INDEX "tenant_user_directory_loginid_idx" ON "tenant_user_directory"("loginid");

-- CreateIndex
CREATE INDEX "tenant_user_directory_email_idx" ON "tenant_user_directory"("email");

-- CreateIndex
CREATE INDEX "tenant_user_directory_username_idx" ON "tenant_user_directory"("username");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_user_directory_tenant_id_user_id_key" ON "tenant_user_directory"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_api_keys_key_hash_key" ON "tenant_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "tenant_api_keys_tenant_id_idx" ON "tenant_api_keys"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_usage_snapshots_tenant_id_captured_on_key" ON "tenant_usage_snapshots"("tenant_id", "captured_on");

-- CreateIndex
CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_log_tenant_id_idx" ON "platform_audit_log"("tenant_id");

-- CreateIndex
CREATE INDEX "platform_audit_log_action_idx" ON "platform_audit_log"("action");

-- AddForeignKey
ALTER TABLE "tenant_user_directory" ADD CONSTRAINT "tenant_user_directory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_usage_snapshots" ADD CONSTRAINT "tenant_usage_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

