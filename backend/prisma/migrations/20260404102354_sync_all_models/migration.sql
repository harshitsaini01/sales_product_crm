-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "campaign" VARCHAR(255),
ADD COLUMN     "keyword" VARCHAR(255);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pincode" VARCHAR(50);

-- CreateTable
CREATE TABLE "agents" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "mobile" VARCHAR(50) NOT NULL,
    "company_name" VARCHAR(200),
    "address" TEXT,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_registrations" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_department_leadtypes" (
    "id" BIGSERIAL NOT NULL,
    "department_id" BIGINT NOT NULL,
    "lead_type_id" BIGINT NOT NULL,

    CONSTRAINT "lead_department_leadtypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asign_branches" (
    "id" BIGSERIAL NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,

    CONSTRAINT "asign_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_stages" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "app_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_statuses" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "app_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flag_messages" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "message" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flag_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_key" ON "agents"("email");
