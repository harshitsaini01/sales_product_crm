-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'sub-admin', 'counsellor', 'franchise', 'employee', 'agent');

-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('new', 'greetings', 'neet-appearing', 'neet-qualified', 'qualified-leads', 'not-interested', 'admission-drop', 'future-leads', 'old-data');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(100) NOT NULL DEFAULT 'employee',
    "email" VARCHAR(100) NOT NULL,
    "mobile" VARCHAR(100) NOT NULL,
    "loginid" VARCHAR(100) NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password" VARCHAR(250) NOT NULL,
    "password_copy" VARCHAR(250),
    "nick_name" VARCHAR(100),
    "automatic_asign_lead" SMALLINT NOT NULL DEFAULT 0,
    "created_by" BIGINT,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "branch_id" BIGINT,
    "designation" VARCHAR(100),
    "gender" VARCHAR(20),
    "dob" DATE,
    "joining_date" DATE,
    "salary" BIGINT,
    "address" TEXT,
    "city" VARCHAR(50),
    "state" VARCHAR(50),
    "country" VARCHAR(50),
    "new_applicant" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_details" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "ip" VARCHAR(50),
    "browser" VARCHAR(100),
    "os" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "father" VARCHAR(100),
    "mother" VARCHAR(100),
    "father_mobile" VARCHAR(20),
    "mother_mobile" VARCHAR(20),
    "dob" VARCHAR(100),
    "gender" VARCHAR(10),
    "cast_category" VARCHAR(100),
    "nationality" VARCHAR(50),
    "religion" VARCHAR(100),
    "passport_number" VARCHAR(100),
    "imgpath" TEXT,
    "imgname" VARCHAR(200),
    "email" VARCHAR(100),
    "email2" VARCHAR(100),
    "email3" VARCHAR(100),
    "mobile" VARCHAR(50),
    "mobile2" VARCHAR(20),
    "mobile3" VARCHAR(20),
    "password" VARCHAR(100),
    "city" VARCHAR(100),
    "state" VARCHAR(50),
    "country" VARCHAR(100),
    "pincode" VARCHAR(20),
    "intrested_course" VARCHAR(100),
    "intrested_subject" VARCHAR(100),
    "intrested_university" VARCHAR(50),
    "approximate_budget" VARCHAR(100),
    "highest_qualification" VARCHAR(100),
    "preferred_destination" VARCHAR(100),
    "persuing_country" VARCHAR(100),
    "english_exam_type" VARCHAR(50),
    "overall_score" INTEGER,
    "neetscore" VARCHAR(20),
    "neet_rank" VARCHAR(100),
    "neet_qualified" VARCHAR(100),
    "neet_passing_year" INTEGER,
    "lead_type" VARCHAR(50) NOT NULL DEFAULT 'new',
    "lead_status" VARCHAR(100) NOT NULL DEFAULT 'Fresh',
    "lead_sub_status" VARCHAR(100),
    "lead_status_id" BIGINT,
    "lead_sub_status_id" BIGINT,
    "lead_follow_status" BIGINT,
    "department_id" BIGINT DEFAULT 2,
    "status_lead_type_id" BIGINT,
    "userid" BIGINT NOT NULL DEFAULT 28,
    "event" VARCHAR(50),
    "source" VARCHAR(100),
    "source_url" TEXT,
    "website" VARCHAR(100) NOT NULL DEFAULT 'other',
    "comment" TEXT,
    "called" SMALLINT NOT NULL DEFAULT 0,
    "wapp" SMALLINT NOT NULL DEFAULT 0,
    "call_answered_status" VARCHAR(50),
    "flag_send" SMALLINT NOT NULL DEFAULT 0,
    "flag_rcv" SMALLINT NOT NULL DEFAULT 0,
    "followup_date" DATE,
    "comment_date" DATE,
    "reminder_date" DATE,
    "enrolled" SMALLINT,
    "course" VARCHAR(100),
    "total_fees" INTEGER,
    "total_deposit_fees" INTEGER,
    "balance_fees" INTEGER,
    "asign" SMALLINT NOT NULL DEFAULT 1,
    "trash" SMALLINT NOT NULL DEFAULT 0,
    "status" SMALLINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asigned_leads" (
    "id" BIGSERIAL NOT NULL,
    "clr_id" BIGINT NOT NULL,
    "std_id" BIGINT NOT NULL,
    "lead_type" VARCHAR(255) NOT NULL DEFAULT 'new',
    "lead_status_id" BIGINT,
    "lead_sub_status_id" BIGINT,
    "lead_follow_up_status_id" BIGINT,
    "call_answered_status" SMALLINT,
    "department_id" BIGINT DEFAULT 2,
    "status_lead_type_id" BIGINT,
    "called" SMALLINT NOT NULL DEFAULT 0,
    "wapp" SMALLINT NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asigned_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_statuses" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "department_id" BIGINT NOT NULL,
    "move_to" VARCHAR(100),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sub_statuses" (
    "id" BIGSERIAL NOT NULL,
    "status_id" BIGINT NOT NULL,
    "sub_status" VARCHAR(100) NOT NULL,
    "sub_status_slug" VARCHAR(100) NOT NULL,
    "move_to" BIGINT,
    "department_id" BIGINT,
    "status_lead_type_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sub_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_types" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "department_id" BIGINT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_departments" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_followup_statuses" (
    "id" BIGSERIAL NOT NULL,
    "status" VARCHAR(100) NOT NULL,
    "shortnote" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_followup_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_followups" (
    "id" BIGSERIAL NOT NULL,
    "lead_status_id" BIGINT,
    "lead_sub_status_id" BIGINT,
    "userid" BIGINT NOT NULL,
    "std_id" BIGINT NOT NULL,
    "comment" TEXT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "type" VARCHAR(50),
    "f_status" VARCHAR(50),
    "description" TEXT,
    "followup_date" DATE,
    "call_answered_status" SMALLINT,
    "department_id" BIGINT,
    "status_lead_type_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universities" (
    "id" BIGSERIAL NOT NULL,
    "uname" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "imgpath" TEXT NOT NULL,
    "bannerpath" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "country" VARCHAR(50) NOT NULL,
    "rank" VARCHAR(10) NOT NULL,
    "shortnote" TEXT NOT NULL,
    "overview" TEXT NOT NULL,
    "inst_type" VARCHAR(50) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "homeview" SMALLINT NOT NULL DEFAULT 0,
    "intake" TEXT NOT NULL,
    "global_ranking" VARCHAR(50) NOT NULL,
    "regional_ranking" VARCHAR(50) NOT NULL,
    "about" TEXT NOT NULL,
    "founded" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_courses" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "university_id" BIGINT NOT NULL,
    "subject_id" BIGINT,
    "duration" VARCHAR(50),
    "fees" VARCHAR(100),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_program_fees" (
    "id" BIGSERIAL NOT NULL,
    "university_id" BIGINT NOT NULL,
    "program" VARCHAR(100) NOT NULL,
    "fees" VARCHAR(100) NOT NULL,
    "currency" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_program_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_shortlist" (
    "id" BIGSERIAL NOT NULL,
    "student_id" BIGINT NOT NULL,
    "university_id" BIGINT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_apptrackstudent" (
    "id" BIGSERIAL NOT NULL,
    "student_id" BIGINT NOT NULL,
    "university_id" BIGINT,
    "stage" VARCHAR(100),
    "app_status" VARCHAR(100),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_apptrackstudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notes" (
    "id" BIGSERIAL NOT NULL,
    "student_id" BIGINT NOT NULL,
    "app_id" BIGINT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_templates" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_headers" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "is_default" SMALLINT NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_headers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "is_default" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sent_mails" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT,
    "user_id" BIGINT NOT NULL,
    "to_email" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sent_mails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_mail_histories" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_mail_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" BIGSERIAL NOT NULL,
    "from_id" BIGINT NOT NULL,
    "to_id" BIGINT NOT NULL,
    "message" TEXT NOT NULL,
    "seen" SMALLINT NOT NULL DEFAULT 0,
    "locked" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_invoicelist" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "invoice_no" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "due_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_invoicelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_feespayment" (
    "id" BIGSERIAL NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid_at" DATE NOT NULL,
    "mode" VARCHAR(50),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_feespayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_todolist" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "assigned_by_id" BIGINT NOT NULL,
    "assigned_to_id" BIGINT NOT NULL,
    "due_date" DATE,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_todolist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_reminder" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "reminder_date" DATE NOT NULL,
    "note" TEXT,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "user_id" BIGINT NOT NULL,
    "color" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_announcements" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "user_id" BIGINT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_leaves" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approved_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approval_note" TEXT,

    CONSTRAINT "employee_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_documents" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "filepath" TEXT NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_documents" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "filepath" TEXT NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brochures" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "filepath" TEXT NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brochures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_documents" (
    "id" BIGSERIAL NOT NULL,
    "app_id" BIGINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "filepath" TEXT NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_landingpage" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "api_key" VARCHAR(100) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_landingpage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(10) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "country_id" INTEGER NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "websites" (
    "id" SERIAL NOT NULL,
    "website" VARCHAR(100) NOT NULL,
    "country" VARCHAR(20) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_details" ADD CONSTRAINT "login_details_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asigned_leads" ADD CONSTRAINT "asigned_leads_clr_id_fkey" FOREIGN KEY ("clr_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asigned_leads" ADD CONSTRAINT "asigned_leads_std_id_fkey" FOREIGN KEY ("std_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sub_statuses" ADD CONSTRAINT "lead_sub_statuses_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lead_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_userid_fkey" FOREIGN KEY ("userid") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_std_id_fkey" FOREIGN KEY ("std_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_courses" ADD CONSTRAINT "tbl_courses_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_program_fees" ADD CONSTRAINT "tbl_program_fees_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shortlist" ADD CONSTRAINT "tbl_shortlist_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shortlist" ADD CONSTRAINT "tbl_shortlist_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notes" ADD CONSTRAINT "app_notes_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "tbl_apptrackstudent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_mails" ADD CONSTRAINT "sent_mails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_mail_histories" ADD CONSTRAINT "student_mail_histories_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_invoicelist" ADD CONSTRAINT "tbl_invoicelist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_feespayment" ADD CONSTRAINT "tbl_feespayment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tbl_invoicelist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_todolist" ADD CONSTRAINT "tbl_todolist_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_todolist" ADD CONSTRAINT "tbl_todolist_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_reminder" ADD CONSTRAINT "tbl_reminder_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_reminder" ADD CONSTRAINT "tbl_reminder_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_announcements" ADD CONSTRAINT "tbl_announcements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_documents" ADD CONSTRAINT "app_documents_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "tbl_apptrackstudent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
