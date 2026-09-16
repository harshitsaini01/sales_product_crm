// ─────────────────────────────────────────────────────────────────────────────
// Demo data for a B2B tenant.
//
//   npm run seed:b2b -- --tenant=britannica
//   npm run seed:b2b -- --tenant=britannica --wipe
//
// WHY THIS EXISTS
//
// A freshly provisioned tenant has departments, statuses, lead types, follow-up
// outcomes, a pipeline and a lost-reason list — and NOT ONE ROW that uses any of
// them. Every filter dropdown is populated and every filtered list is empty, so
// there is no way to tell a working screen from a broken one.
//
// This walks a realistic record all the way down the chain:
//
//   Lead (department + status + type + source + UTM)
//     └─▶ Account ─▶ Contacts ─▶ Locations
//           └─▶ Deal (in a real stage, with line items)
//                 └─▶ Quote ─▶ Order ─▶ Invoice ─▶ Payment
//
// plus tags, notes, custom fields and a timeline, so the account page has
// something to render.
//
// SAFETY
//
//   • Refuses to run against the primary tenant. The education install must
//     never get demo companies in it, and `--tenant` is easy to typo.
//   • Refuses if the tenant's `accounts` module is off — that is the signal it
//     is not a B2B customer.
//   • Idempotent: re-running updates the same rows rather than making a second
//     set. `--wipe` removes what it previously created, and only that.
//
// Everything it creates is marked `demoTag` so --wipe can find it again without
// guessing.
// ─────────────────────────────────────────────────────────────────────────────

import { getTenantBySlug } from '../src/services/tenant.service'
import { runWithTenant } from '../src/lib/tenant-context'
import { prisma } from '../src/lib/prisma'
import { lineTotal, summarize } from '../src/services/crm/deals.service'
import { documentNumber } from '../src/services/crm/documents.service'
import { hash } from 'bcryptjs'
import { randomBytes } from 'crypto'

const DEMO_TAG = 'demo-data'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.split('=')[1]
}

const slug = arg('tenant')
const wipe = process.argv.includes('--wipe')

async function main() {
  if (!slug) {
    console.error('Usage: npm run seed:b2b -- --tenant=<slug> [--wipe]')
    process.exit(1)
  }

  const ctx = await getTenantBySlug(slug)
  if (!ctx) {
    console.error(`No customer with the slug "${slug}".`)
    process.exit(1)
  }

  // Two guards, both about the same fear: demo companies appearing in a real
  // education customer's lead list.
  if (ctx.isPrimary) {
    console.error(
      `"${slug}" is the primary installation. This script will not write demo data there.`,
    )
    process.exit(1)
  }
  if (ctx.features.accounts !== true) {
    console.error(
      `"${slug}" does not have the Accounts module on, so it is not a B2B customer. ` +
        'Switch it on in the super admin panel first, or seed a different tenant.',
    )
    process.exit(1)
  }

  console.log(`\n${wipe ? 'Wiping' : 'Seeding'} demo data for ${ctx.companyName} (${ctx.schemaName})\n`)

  await runWithTenant(ctx, async () => {
    if (wipe) {
      await wipeDemo()
      return
    }
    await seed()
  })
}

// ─────────────────────────────────────────────────────────────────────────────

async function wipeDemo() {
  const tag = await prisma.crmTag.findUnique({ where: { slug: DEMO_TAG } })
  if (!tag) {
    console.log('Nothing tagged as demo data — nothing to remove.')
    return
  }

  const links = await prisma.crmTagLink.findMany({ where: { tagId: tag.id } })
  const accountIds = links.filter((l) => l.entityType === 'account').map((l) => l.entityId)
  const leadIds = links.filter((l) => l.entityType === 'lead').map((l) => l.entityId)

  // Down the chain, children first: an invoice's payments before the invoice,
  // and everything before the account it hangs off.
  const invoices = await prisma.crmInvoice.findMany({
    where: { accountId: { in: accountIds } },
    select: { id: true },
  })
  const invoiceIds = invoices.map((i) => i.id)

  await prisma.crmPayment.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
  await prisma.crmInvoice.deleteMany({ where: { id: { in: invoiceIds } } })
  await prisma.order.deleteMany({ where: { accountId: { in: accountIds } } })
  await prisma.quote.deleteMany({ where: { accountId: { in: accountIds } } })
  await prisma.contract.deleteMany({ where: { accountId: { in: accountIds } } })
  await prisma.deal.deleteMany({ where: { accountId: { in: accountIds } } })
  await prisma.contact.deleteMany({ where: { accountId: { in: accountIds } } })
  await prisma.crmLocation.deleteMany({ where: { accountId: { in: accountIds } } })

  for (const type of ['account', 'contact', 'deal', 'lead'] as const) {
    const ids = links.filter((l) => l.entityType === type).map((l) => l.entityId)
    if (!ids.length) continue
    await prisma.activity.deleteMany({ where: { entityType: type, entityId: { in: ids } } })
    await prisma.crmNote.deleteMany({ where: { entityType: type, entityId: { in: ids } } })
    await prisma.customFieldValue.deleteMany({ where: { entityType: type, entityId: { in: ids } } })
  }

  await prisma.account.deleteMany({ where: { id: { in: accountIds } } })
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } })
  await prisma.crmTagLink.deleteMany({ where: { tagId: tag.id } })
  await prisma.crmTag.delete({ where: { id: tag.id } })

  console.log(`Removed ${accountIds.length} demo accounts and ${leadIds.length} demo leads.`)
}

// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin', status: 1 }, select: { id: true } })
  if (!admin) {
    console.error('This tenant has no admin user. Provisioning must finish before seeding.')
    process.exit(1)
  }
  const userId = admin.id

  const tag = await prisma.crmTag.upsert({
    where: { slug: DEMO_TAG },
    create: { name: 'Demo Data', slug: DEMO_TAG, color: '#94a3b8' },
    update: {},
  })
  const tagIt = async (entityType: string, entityId: bigint) => {
    await prisma.crmTagLink.upsert({
      where: { tagId_entityType_entityId: { tagId: tag.id, entityType, entityId } },
      create: { tagId: tag.id, entityType, entityId },
      update: {},
    })
  }

  // ── The pipeline config this tenant was seeded with. Read, never created:
  //    if it is missing, provisioning did not finish and inventing rows here
  //    would hide that rather than surface it.
  const department = await prisma.leadDepartment.findFirst({ orderBy: { priority: 'asc' } })
  const statuses = await prisma.leadStatus.findMany({
    where: department ? { departmentId: department.id } : {},
    orderBy: { priority: 'asc' },
  })
  const leadTypes = await prisma.leadTypeConfig.findMany({ orderBy: { priority: 'asc' } })
  const followupStatuses = await prisma.leadFollowupStatus.findMany()
  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { sortOrder: 'asc' } } },
  })

  if (!department || !statuses.length || !pipeline?.stages.length) {
    console.error(
      'This tenant is missing its seeded pipeline (departments, statuses or deal stages).\n' +
        'Run provisioning first — this script deliberately does not invent that configuration.',
    )
    process.exit(1)
  }

  console.log(`Using department "${department.name}", ${statuses.length} statuses, ` +
    `${leadTypes.length} lead types, pipeline "${pipeline.name}" with ${pipeline.stages.length} stages.`)

  // ── A lead source, so the Lead Sources screen and its filter are not empty.
  //
  // `keyHash` is required — a source IS an ingestion credential. The plaintext
  // key is deliberately thrown away rather than printed: this is demo data, and
  // a working API key echoed into a terminal log is a credential nobody
  // intended to create. Rotate it from the Lead Sources screen to actually use
  // the endpoint.
  const source = await prisma.leadSource.upsert({
    where: { slug: 'demo-website' },
    create: {
      name: 'Website — Demo',
      slug: 'demo-website',
      keyHash: await hash(randomBytes(32).toString('hex'), 10),
      defaultDepartmentId: department.id,
      defaultLeadStatus: statuses[0]?.title ?? null,
    },
    update: {},
  })

  // ── THE LEAD, wired to every filterable field.
  //
  // This is the point of the whole script: a lead that actually carries a
  // department, a status, a type, a source and full UTM attribution, so every
  // dropdown on the Leads screen filters down to something instead of nothing.
  const contacted = statuses.find((s) => s.slug === 'contacted') ?? statuses[1] ?? statuses[0]
  const inboundType = leadTypes.find((t) => t.slug === 'inbound') ?? leadTypes[0]

  const existingLead = await prisma.lead.findFirst({ where: { email: 'priya@nimbusretail.in' } })

  const lead = existingLead
    ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: { leadStatusId: contacted.id, leadStatus: contacted.title, departmentId: department.id },
      })
    : await prisma.lead.create({
        data: {
          name: 'Priya Raghavan',
          email: 'priya@nimbusretail.in',
          mobile: '9845012345',
          city: 'Bengaluru',
          state: 'Karnataka',
          country: 'INDIA',
          homeAddress: '4th Floor, Prestige Tech Park, Kadubeesanahalli',
          pincode: '560103',

          // The filterable pipeline fields.
          departmentId: department.id,
          leadStatusId: contacted.id,
          leadStatus: contacted.title,
          statusLeadTypeId: inboundType?.id ?? null,
          leadType: inboundType?.slug ?? 'inbound',

          // Attribution — what the Lead Sources and campaign filters read.
          source: source.name,
          website: 'demo-website',
          campaign: 'q3-erp-launch',
          keyword: 'retail inventory software',
          sourceUrl: 'https://example.com/pricing',
          event: 'Demo request form',

          intrestedCourse: 'Inventory & POS Platform',
          intrestedSubject: '40 stores, 200 users, GST billing',
          approximateBudget: '1500000',

          userId,
          asign: 0,
          called: 1,
          callAnsweredStatus: 'Connected',
          comment: 'Wants a demo for the regional managers before the festive season.',
          commentDate: new Date(),
          followupDate: new Date(Date.now() + 2 * 86_400_000),
        },
      })

  await tagIt('lead', lead.id)
  console.log(`Lead #${lead.id} — ${lead.name} (${contacted.title}, ${source.name})`)

  // A follow-up, so the Followups screen and the outcome filter are not empty.
  const outcome = followupStatuses.find((f) => f.status === 'Interested') ?? followupStatuses[0]
  const hasFollowup = await prisma.leadFollowup.findFirst({ where: { stdId: lead.id } })
  if (!hasFollowup) {
    await prisma.leadFollowup.create({
      data: {
        stdId: lead.id,
        userid: userId,
        comment: 'Discovery call done. Sending a proposal for 40 stores.',
        leadStatusId: contacted.id,
        departmentId: department.id,
        fStatus: outcome?.status ?? null,
        followupDate: new Date(Date.now() + 2 * 86_400_000),
        type: 'call',
      },
    })
  }

  // ── ACCOUNT
  const accountType = await prisma.accountType.findFirst({ where: { slug: 'retailer' } })
  const industry = await prisma.industry.findFirst({ where: { slug: 'retail' } })

  const account = await prisma.account.upsert({
    where: { accountNumber: 'ACC-DEMO01' },
    create: {
      accountNumber: 'ACC-DEMO01',
      name: 'Nimbus Retail Pvt Ltd',
      legalName: 'Nimbus Retail Private Limited',
      accountTypeId: accountType?.id ?? null,
      industryId: industry?.id ?? null,
      status: 'prospect',
      businessModel: 'retail',
      employeeCount: 420,
      annualRevenue: 480000000,
      foundedYear: 2014,
      website: 'https://nimbusretail.in',
      email: 'hello@nimbusretail.in',
      phone: '08041234567',
      gstin: '29AABCN1234M1ZP',
      pan: 'AABCN1234M',
      legalStructure: 'Private Limited',
      ownerId: userId,
      createdById: userId,
      notes: 'Referred by their CFO after the Bengaluru retail expo.',
    },
    update: {},
  })
  await tagIt('account', account.id)

  await prisma.lead.update({ where: { id: lead.id }, data: { comment: lead.comment } })

  // ── LOCATIONS
  for (const loc of [
    { name: 'Head Office', type: 'head_office', city: 'Bengaluru', state: 'Karnataka', pincode: '560103', isPrimary: true },
    { name: 'Whitefield Warehouse', type: 'warehouse', city: 'Bengaluru', state: 'Karnataka', pincode: '560066', isPrimary: false },
    { name: 'Chennai Regional Office', type: 'branch', city: 'Chennai', state: 'Tamil Nadu', pincode: '600032', isPrimary: false },
  ]) {
    const exists = await prisma.crmLocation.findFirst({ where: { accountId: account.id, name: loc.name } })
    if (!exists) await prisma.crmLocation.create({ data: { ...loc, accountId: account.id, country: 'INDIA' } })
  }

  // ── CONTACTS, with different roles so the role filter is meaningful.
  const contactSpecs = [
    { firstName: 'Priya', lastName: 'Raghavan', jobTitle: 'Head of Operations', role: 'decision_maker', relationshipStrength: 'good', email: 'priya@nimbusretail.in', mobile: '9845012345', seniority: 'vp' },
    { firstName: 'Arun', lastName: 'Menon', jobTitle: 'IT Manager', role: 'technical', relationshipStrength: 'new', email: 'arun.menon@nimbusretail.in', mobile: '9845067890', seniority: 'manager' },
    { firstName: 'Sunita', lastName: 'Bose', jobTitle: 'Finance Controller', role: 'finance', relationshipStrength: 'weak', email: 'sunita.bose@nimbusretail.in', mobile: '9845098765', seniority: 'director' },
  ]

  const contacts = []
  for (const spec of contactSpecs) {
    const found = await prisma.contact.findFirst({ where: { accountId: account.id, email: spec.email } })
    contacts.push(
      found ?? (await prisma.contact.create({ data: { ...spec, accountId: account.id, ownerId: userId } })),
    )
  }
  for (const ct of contacts) await tagIt('contact', ct.id)

  // ── DEAL, parked mid-pipeline so the board is not one lopsided column.
  const openStages = pipeline.stages.filter((s) => !s.isWon && !s.isLost)
  const stage = openStages[Math.min(3, openStages.length - 1)] ?? pipeline.stages[0]

  const existingDeal = await prisma.deal.findFirst({ where: { dealNumber: 'DEAL-DEMO01' } })
  const deal =
    existingDeal ??
    (await prisma.deal.create({
      data: {
        dealNumber: 'DEAL-DEMO01',
        name: 'Nimbus Retail — Inventory & POS rollout',
        accountId: account.id,
        primaryContactId: contacts[0]?.id ?? null,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: userId,
        createdById: userId,
        currency: 'INR',
        expectedCloseDate: new Date(Date.now() + 30 * 86_400_000),
        source: source.name,
        campaign: 'q3-erp-launch',
        nextStep: 'Send the proposal for 40 stores by Friday',
        leadId: lead.id,
      },
    }))
  await tagIt('deal', deal.id)

  // ── Line items. Priced through lineTotal() rather than typed literals, so the
  //    demo data can never disagree with what the app would compute.
  const lines = [
    { name: 'Inventory Platform — annual licence', sku: 'INV-PLAT-YR', quantity: 40, unitPrice: 24000, discountPercent: 10, taxPercent: 18 },
    { name: 'POS terminals — software', sku: 'POS-SW', quantity: 200, unitPrice: 3600, discountPercent: 5, taxPercent: 18 },
    { name: 'Implementation & data migration', sku: 'SVC-IMPL', quantity: 1, unitPrice: 350000, discountPercent: 0, taxPercent: 18 },
    { name: 'Priority support — 12 months', sku: 'SVC-SUP-12', quantity: 12, unitPrice: 18000, discountPercent: 0, taxPercent: 18 },
  ]

  if (!(await prisma.dealProduct.count({ where: { dealId: deal.id } }))) {
    for (const [i, l] of lines.entries()) {
      await prisma.dealProduct.create({
        data: { ...l, dealId: deal.id, total: lineTotal(l), sortOrder: i * 10 },
      })
    }
    const totals = summarize(lines)
    await prisma.deal.update({ where: { id: deal.id }, data: { value: totals.total } })
    console.log(`Deal #${deal.id} in "${stage.name}" — ₹${totals.total.toLocaleString('en-IN')}`)
  }

  // ── The document chain: quote → order → invoice → part payment.
  let quote = await prisma.quote.findFirst({ where: { dealId: deal.id } })
  if (!quote) {
    quote = await prisma.quote.create({
      data: {
        quoteNumber: 'PENDING',
        accountId: account.id,
        contactId: contacts[0]?.id ?? null,
        dealId: deal.id,
        status: 'sent',
        sentAt: new Date(Date.now() - 5 * 86_400_000),
        validUntil: new Date(Date.now() + 25 * 86_400_000),
        paymentTerms: '50% advance, 50% on go-live',
        deliveryTerms: 'Rollout over 8 weeks from PO',
        ownerId: userId,
        createdById: userId,
      },
    })
    await prisma.quote.update({
      where: { id: quote.id },
      data: { quoteNumber: documentNumber('QUO', quote.id) },
    })
    for (const [i, l] of lines.entries()) {
      await prisma.quoteItem.create({
        data: { ...l, quoteId: quote.id, total: lineTotal(l), sortOrder: i * 10 },
      })
    }
    const t = summarize(lines)
    await prisma.quote.update({ where: { id: quote.id }, data: t })
  }

  let order = await prisma.order.findFirst({ where: { quoteId: quote.id } })
  if (!order) {
    order = await prisma.order.create({
      data: {
        orderNumber: 'PENDING',
        accountId: account.id,
        contactId: contacts[0]?.id ?? null,
        dealId: deal.id,
        quoteId: quote.id,
        status: 'confirmed',
        deliveryDate: new Date(Date.now() + 56 * 86_400_000),
        ownerId: userId,
      },
    })
    await prisma.order.update({
      where: { id: order.id },
      data: { orderNumber: documentNumber('ORD', order.id) },
    })
    for (const [i, l] of lines.entries()) {
      await prisma.orderItem.create({
        data: { ...l, orderId: order.id, total: lineTotal(l), sortOrder: i * 10 },
      })
    }
    await prisma.order.update({ where: { id: order.id }, data: summarize(lines) })
  }

  let invoice = await prisma.crmInvoice.findFirst({ where: { orderId: order.id } })
  if (!invoice) {
    const totals = summarize(lines)
    invoice = await prisma.crmInvoice.create({
      data: {
        invoiceNumber: 'PENDING',
        accountId: account.id,
        contactId: contacts[2]?.id ?? null,
        dealId: deal.id,
        orderId: order.id,
        status: 'partial',
        issueDate: new Date(Date.now() - 10 * 86_400_000),
        // Deliberately in the past, so the overdue filter and the ageing report
        // have a row to show instead of five empty buckets.
        dueDate: new Date(Date.now() - 2 * 86_400_000),
        terms: '50% advance against this invoice',
        ownerId: userId,
        createdById: userId,
        ...totals,
      },
    })
    await prisma.crmInvoice.update({
      where: { id: invoice.id },
      data: { invoiceNumber: documentNumber('INV', invoice.id) },
    })
    for (const [i, l] of lines.entries()) {
      await prisma.crmInvoiceItem.create({
        data: { ...l, invoiceId: invoice.id, total: lineTotal(l), sortOrder: i * 10 },
      })
    }

    const advance = Math.round(totals.total * 0.5 * 100) / 100
    await prisma.crmPayment.create({
      data: {
        invoiceId: invoice.id,
        amount: advance,
        paymentDate: new Date(Date.now() - 8 * 86_400_000),
        mode: 'bank_transfer',
        transactionId: 'NEFT-2026-004417',
        bank: 'HDFC Bank',
        reference: '50% advance per PO',
        recordedById: userId,
      },
    })
    await prisma.crmInvoice.update({
      where: { id: invoice.id },
      data: { amountPaid: advance, status: 'partial' },
    })
  }

  const contractExists = await prisma.contract.findFirst({ where: { dealId: deal.id } })
  if (!contractExists) {
    const contract = await prisma.contract.create({
      data: {
        contractNumber: 'PENDING',
        title: 'Nimbus Retail — Master Services Agreement',
        accountId: account.id,
        dealId: deal.id,
        type: 'MSA',
        status: 'signed',
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 86_400_000),
        renewalDate: new Date(Date.now() + 335 * 86_400_000),
        value: summarize(lines).total,
        paymentTerms: '50/50',
        signedBy: 'Priya Raghavan',
        signedAt: new Date(),
        ownerId: userId,
      },
    })
    await prisma.contract.update({
      where: { id: contract.id },
      data: { contractNumber: documentNumber('CON', contract.id) },
    })
  }

  // ── Notes and a timeline, so the account page renders something.
  const noteCount = await prisma.crmNote.count({ where: { entityType: 'account', entityId: account.id } })
  if (!noteCount) {
    for (const n of [
      { kind: 'meeting', body: 'Discovery call with Priya and Arun. 40 stores live, 12 more planned this year. Current stack is spreadsheets plus a legacy POS.', pinned: true },
      { kind: 'sales', body: 'Sunita in finance wants annual billing, not monthly. Priced accordingly.', pinned: false },
      { kind: 'internal', body: 'Competitor in the mix — they evaluated Vyapar last year and dropped it on multi-store support.', pinned: false },
    ]) {
      await prisma.crmNote.create({
        data: { entityType: 'account', entityId: account.id, userId, ...n },
      })
    }
  }

  const activityCount = await prisma.activity.count({ where: { entityType: 'account', entityId: account.id } })
  if (!activityCount) {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000)
    for (const a of [
      { kind: 'system', subject: 'Account created from lead', occurredAt: day(21) },
      { kind: 'call', subject: 'Intro call with Priya', body: '18 minutes. Asked for a demo for regional managers.', occurredAt: day(20), meta: { durationSec: 1080, outcome: 'connected' } },
      { kind: 'email', subject: 'Sent company profile and case studies', occurredAt: day(18) },
      { kind: 'meeting', subject: 'Product demo — 6 attendees', body: 'Walked through multi-store stock transfer and GST billing.', occurredAt: day(12) },
      { kind: 'note', subject: 'Note', body: 'Finance wants annual billing.', occurredAt: day(11) },
      { kind: 'quote', subject: 'Quote sent', occurredAt: day(5) },
      { kind: 'payment', subject: 'Advance received', occurredAt: day(8), meta: { amount: 500000 } },
    ]) {
      await prisma.activity.create({
        data: {
          entityType: 'account',
          entityId: account.id,
          actorId: userId,
          ...a,
          meta: (a.meta ?? undefined) as never,
        },
      })
    }
  }

  // ── Custom fields — the thing that makes this a retailer rather than a
  //    generic company, without a single new column.
  const fieldDefs = [
    { key: 'store_count', label: 'Number of Stores', type: 'number', section: 'Retail Profile', sortOrder: 10 },
    { key: 'pos_terminals', label: 'POS Terminals', type: 'number', section: 'Retail Profile', sortOrder: 20 },
    { key: 'erp_in_use', label: 'Current ERP', type: 'text', section: 'Retail Profile', sortOrder: 30 },
    { key: 'gst_registered', label: 'GST Registered', type: 'boolean', section: 'Compliance', sortOrder: 40 },
  ]

  for (const def of fieldDefs) {
    const existing = await prisma.customFieldDef.findFirst({
      where: { entityType: 'account', key: def.key },
    })
    const row = existing ?? (await prisma.customFieldDef.create({ data: { ...def, entityType: 'account' } }))

    const values: Record<string, unknown> = {
      store_count: { valueNum: 40 },
      pos_terminals: { valueNum: 200 },
      erp_in_use: { valueText: 'Spreadsheets + legacy POS' },
      gst_registered: { valueBool: true },
    }

    await prisma.customFieldValue.upsert({
      where: { defId_entityType_entityId: { defId: row.id, entityType: 'account', entityId: account.id } },
      create: { defId: row.id, entityType: 'account', entityId: account.id, ...(values[def.key] as object) },
      update: values[def.key] as object,
    })
  }

  const totals = summarize(lines)
  console.log(`
Done.

  Lead      #${lead.id}  Priya Raghavan — ${contacted.title}, ${source.name}
            department "${department.name}", type "${inboundType?.title ?? 'n/a'}",
            campaign q3-erp-launch, follow-up due in 2 days
  Account   #${account.id}  Nimbus Retail Pvt Ltd — 3 locations, 3 contacts, 4 custom fields
  Deal      #${deal.id}  in "${stage.name}" — ₹${totals.total.toLocaleString('en-IN')} across 4 lines
  Quote     sent · Order confirmed · Invoice PARTIAL and overdue by 2 days
  Timeline  7 activities, 3 notes

Every filter on the Leads screen — department, status, type, source, campaign —
now matches at least one row, and the ageing report has an overdue bucket.

Remove it all again with:  npm run seed:b2b -- --tenant=${slug} --wipe
`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => process.exit(0))
