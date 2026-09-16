import { PrismaClient as PrismaPg } from '@prisma/client'
import { createConnection } from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

const pg = new PrismaPg()

// Create legacy connection
async function getLegacyConnection() {
  return await createConnection({
    host: process.env.LEGACY_DB_HOST || 'localhost',
    user: process.env.LEGACY_DB_USER || 'root',
    password: process.env.LEGACY_DB_PASSWORD || '',
    database: process.env.LEGACY_DB_NAME || 'tuttleage_crm',
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function migrateUsers(mysql: any) {
  console.log('--- Migrating Users ---')
  const [users] = await mysql.execute('SELECT * FROM users')
  let count = 0
  for (const user of (users as any[])) {
    try {
      await pg.user.upsert({
        where: { id: BigInt(user.id) },
        update: {},
        create: {
          id: BigInt(user.id),
          loginid: user.loginid || '',
          username: user.username || user.loginid || '',
          password: user.password || '',
          passwordCopy: user.password_copy,
          name: user.name || 'Unknown',
          email: user.email || '',
          mobile: user.mobile || '',
          role: user.role || 'counsellor',
          designation: user.designation,
          address: user.address,
          city: user.city,
          state: user.state,
          country: user.country,
          pincode: user.pincode,
          branchId: user.branch_id ? BigInt(user.branch_id) : null,
          nickName: user.nick_name,
          status: user.status === 'active' || user.status === 1 ? 1 : 0,
          automaticAsignLead: user.automatic_asign_lead || 0,
          joiningDate: user.joining_date ? new Date(user.joining_date) : null,
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
        }
      })
      count++
    } catch (err) {
      console.error(`Failed to migrate user ${user.id}:`, err)
    }
  }
  console.log(`✅ Users migrated: ${count}`)
}

async function migrateLeads(mysql: any) {
  console.log('--- Migrating Leads ---')
  const [leads] = await mysql.execute('SELECT * FROM leads')
  let count = 0
  for (const lead of (leads as any[])) {
    try {
      await pg.lead.upsert({
        where: { id: BigInt(lead.id) },
        update: {},
        create: {
          id: BigInt(lead.id),
          name: lead.name || 'Unknown',
          father: lead.father,
          mother: lead.mother,
          email: lead.email,
          email2: lead.email2,
          email3: lead.email3,
          mobile: lead.mobile,
          mobile2: lead.mobile2,
          mobile3: lead.mobile3,
          city: lead.city,
          state: lead.state,
          country: lead.country,
          pincode: lead.pincode,
          dob: lead.dob,
          
          castCategory: lead.cast_category,
          neetRank: lead.neet_rank,
          neetQualified: lead.neet_qualified,
          intrestedCourse: lead.intrested_course,
          intrestedSubject: lead.intrested_subject,
          approximateBudget: lead.approximate_budget,
          
          event: lead.event,
          source: lead.source,
          campaign: lead.campaign,
          keyword: lead.keyword,
          
          leadType: lead.lead_type || 'new',
          leadStatus: lead.lead_status || 'Fresh',
          leadSubStatus: lead.lead_sub_status,
          
          totalDepositFees: lead.total_deposit_fees,
          totalFees: lead.total_fees,
          balanceFees: lead.balance_fees,
          
          followupDate: lead.followup_date ? new Date(lead.followup_date) : null,
          commentDate: lead.comment_date ? new Date(lead.comment_date) : null,
          reminderDate: lead.reminder_date ? new Date(lead.reminder_date) : null,
          
          called: lead.called || 0,
          wapp: lead.wapp || 0,
          flagSend: lead.flag_send || 0,
          flagRcv: lead.flag_rcv || 0,
          asign: lead.asign || 1,
          trash: lead.trash || 0,
          callAnsweredStatus: lead.call_answered_status,

          createdAt: lead.created_at ? new Date(lead.created_at) : new Date(),
        }
      })
      count++
      if (count % 500 === 0) console.log(`Migrated ${count} leads...`)
    } catch (err) {
      console.error(`Failed to migrate lead ${lead.id}:`, err)
    }
  }
  console.log(`✅ Leads migrated: ${count}`)
}

async function migrateAssignmentsAndFollowups(mysql: any) {
  console.log('--- Migrating Assignments and Followups ---')
  
  // Asigned Leads
  const [assignments] = await mysql.execute('SELECT * FROM asigned_leads')
  let assignCount = 0
  for (const a of (assignments as any[])) {
    try {
      await pg.asignedLead.upsert({
        where: { id: BigInt(a.id) },
        update: {},
        create: {
          id: BigInt(a.id),
          stdId: BigInt(a.lead_id ?? a.std_id),
          clrId: BigInt(a.user_id ?? a.clr_id),
          status: a.status || 0,
          createdAt: a.created_on ? new Date(a.created_on) : new Date(),
        }
      })
      assignCount++
    } catch (e) {}
  }
  console.log(`✅ Lead Assignments migrated: ${assignCount}`)

  // Followups
  const [followups] = await mysql.execute('SELECT * FROM lead_followup')
  let followupCount = 0
  for (const f of (followups as any[])) {
    try {
      await pg.leadFollowup.upsert({
        where: { id: BigInt(f.id) },
        update: {},
        create: {
          id: BigInt(f.id),
          stdId: BigInt(f.leadid ?? f.std_id),
          userid: BigInt(f.userid),
          comment: f.comment || '',
          status: f.status ?? 1,
          followupDate: f.next_followup_date ? new Date(f.next_followup_date) : null,
          createdAt: f.remark_date ? new Date(f.remark_date) : new Date(),
        }
      })
      followupCount++
    } catch (e) {}
  }
  console.log(`✅ Followups migrated: ${followupCount}`)
}

async function migrateEmailTemplatesAndSignatures(mysql: any) {
  console.log('--- Migrating Emails & Templates ---')
  
  const [templates] = await mysql.execute('SELECT * FROM email_templates')
  let tmplCount = 0
  for (const t of (templates as any[])) {
    try {
      await pg.mailTemplate.upsert({
        where: { id: BigInt(t.id) },
        update: {},
        create: {
          id: BigInt(t.id),
          title: t.title || 'Untitled',
          subject: t.subject || '',
          body: t.body || t.description || '',
          userId: BigInt(t.user_id ?? 1),
          status: t.status || 1,
          createdAt: t.created_at ? new Date(t.created_at) : new Date(),
        }
      })
      tmplCount++
    } catch(e) {}
  }
  console.log(`✅ Email Templates migrated: ${tmplCount}`)
  
  const [sigs] = await mysql.execute('SELECT * FROM email_signatures')
  let sigCount = 0
  for (const s of (sigs as any[])) {
    try {
      await pg.signature.upsert({
        where: { id: BigInt(s.id) },
        update: {},
        create: {
          id: BigInt(s.id),
          userId: BigInt(s.user_id),
          title: s.title || 'Default',
          content: s.description || s.content || '',
          createdAt: s.created_at ? new Date(s.created_at) : new Date(),
        }
      })
      sigCount++
    } catch(e) {}
  }
  console.log(`✅ Signatures migrated: ${sigCount}`)
}

async function main() {
  console.log('==== TUTELAGE CRM DATA MIGRATION EXECUTOR ====')
  const mysql = await getLegacyConnection()
  console.log('✅ Connected to Legacy MySQL Database')

  // IMPORTANT: The order matters due to foreign keys.
  // 1. Core Users
  await migrateUsers(mysql)
  
  // 2. Core Leads
  await migrateLeads(mysql)
  
  // 3. Relational Data (Requires Users/Leads)
  await migrateAssignmentsAndFollowups(mysql)
  await migrateEmailTemplatesAndSignatures(mysql)
  
  // Add other modules here: migrateTasks, migrateLeaves...

  console.log('==== MIGRATION COMPLETELY FINISHED ====')
  await mysql.end()
  await pg.$disconnect()
}

main().catch(err => {
  console.error("Migration failed:", err)
  process.exit(1)
})
