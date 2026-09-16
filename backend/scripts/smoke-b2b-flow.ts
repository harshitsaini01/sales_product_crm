// ─────────────────────────────────────────────────────────────────────────────
// Drive the Account → Deal → Quote → Order → Invoice flow through the REAL HTTP
// stack, and report what actually happens.
//
//   npm run smoke:b2b -- --tenant=britannica_bots
//   npm run smoke:b2b -- --tenant=britannica_bots --send=someone@example.com
//
// WHY THIS EXISTS
//
// Roughly 9,000 lines of route and page code were written, typechecked and
// built without a single request ever reaching them. Typechecking proves the
// shapes line up; it proves nothing about whether a handler works. This closes
// that gap for the flow that matters most.
//
// It calls `app.request()` rather than starting a server, so every piece of the
// real stack runs — tenant resolution, JWT auth, the feature gates, the quota
// extension — with no port to bind and nothing to clean up afterwards.
//
// IT WRITES DATA. It creates an account, a deal and a quote in the named
// tenant, then deletes what it can at the end. Never point it at the primary
// customer; it refuses anyway.
//
// Mail is NOT sent unless --send=<address> is given, so the default run cannot
// email a real person by accident.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(BigInt.prototype as any).toJSON = function () { return this.toString() }

import { sign } from 'jsonwebtoken'
import { app } from '../src/app'
import { getTenantBySlug } from '../src/services/tenant.service'
import { runWithTenant } from '../src/lib/tenant-context'
import { pruneOrphans } from '../src/services/crm/activity.service'
import { prisma } from '../src/lib/prisma'

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const slug = arg('tenant')
const sendTo = arg('send')

let pass = 0
let fail = 0
const failures: string[] = []

function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL  ${label}`)
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail).slice(0, 300)}`)
  }
}

async function main() {
  if (!slug) {
    console.error('Usage: npm run smoke:b2b -- --tenant=<slug> [--send=<email>]')
    process.exit(1)
  }

  const ctx = await getTenantBySlug(slug)
  if (!ctx) {
    console.error(`No customer with the slug "${slug}".`)
    process.exit(1)
  }
  if (ctx.isPrimary) {
    console.error('Refusing to write test data into the primary installation.')
    process.exit(1)
  }

  // Sign a token the same way the login route does, for this tenant's admin.
  const admin = await runWithTenant(ctx, () =>
    prisma.user.findFirst({
      where: { role: 'admin', status: 1 },
      select: { id: true, name: true, email: true, loginid: true, activeWebSessionId: true },
    }),
  )
  if (!admin) {
    console.error('That tenant has no admin user.')
    process.exit(1)
  }

  // The auth middleware enforces one web session per user, so reuse whatever
  // session id is on the row rather than inventing one and signing them out.
  const sid = admin.activeWebSessionId
  if (!sid) {
    console.error(
      `${admin.loginid} has never signed in, so there is no session id to borrow.\n` +
        'Sign in once in the browser as that user, then re-run this.',
    )
    process.exit(1)
  }

  const token = sign(
    {
      userId: Number(admin.id),
      role: 'admin',
      roles: ['admin'],
      name: admin.name,
      email: admin.email,
      sid,
      kind: 'web',
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' },
  )

  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const base = 'http://localhost'

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(`${base}/api${path}`, {
      method,
      headers: H,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let json: unknown = text
    try {
      json = JSON.parse(text)
    } catch {
      /* HTML document endpoints return markup */
    }
    return { status: res.status, body: json as never, text }
  }

  console.log(`\nDriving the flow through the real stack for ${ctx.companyName}\n`)

  const stamp = Date.now()
  const created: { accounts: bigint[]; deals: bigint[]; quotes: bigint[]; comments: bigint[] } = {
    accounts: [], deals: [], quotes: [], comments: [],
  }

  // ── 1. Account
  console.log('Account')
  const acc = await call('POST', '/accounts', {
    name: `Smoke Test Co ${stamp}`,
    status: 'prospect',
    email: 'nobody@example.invalid',
    phone: '9000000000',
  })
  ok('POST /accounts creates one', acc.status === 201, acc.body)
  const accountId = (acc.body as { id?: number })?.id
  if (!accountId) {
    console.log('\nCannot continue without an account.')
    return report()
  }
  created.accounts.push(BigInt(accountId))

  const accGet = await call('GET', `/accounts/${accountId}`)
  ok('GET /accounts/:id returns it', accGet.status === 200, accGet.body)
  const detail = accGet.body as Record<string, never>
  ok('detail carries the summary stats', !!detail.stats)
  ok('stats include contacts and locations', typeof (detail.stats as never)?.['contacts'] === 'number')
  ok('keyContacts is an array', Array.isArray(detail.keyContacts))

  // ── 2. Contact
  console.log('\nContact')
  const ct = await call('POST', '/contacts', {
    accountId,
    firstName: 'Smoke',
    lastName: 'Tester',
    email: 'smoke.tester@example.invalid',
    mobile: '9000000001',
    role: 'decision_maker',
  })
  ok('POST /contacts creates one', ct.status === 201, ct.body)
  const contactId = (ct.body as { id?: number })?.id

  // ── 3. Deal
  console.log('\nDeal')
  const deal = await call('POST', '/deals', {
    name: `Smoke deal ${stamp}`,
    accountId,
    primaryContactId: contactId ?? null,
    value: 100000,
    nextStep: 'Smoke test next step',
  })
  ok('POST /deals creates one', deal.status === 201, deal.body)
  const dealId = (deal.body as { id?: number })?.id
  if (dealId) created.deals.push(BigInt(dealId))

  const board = await call('GET', '/deals/board')
  ok('GET /deals/board renders', board.status === 200, board.body)
  const stages = (board.body as { stages?: unknown[] })?.stages
  ok('board has stages', Array.isArray(stages) && stages.length > 0)

  const forecast = await call('GET', '/deals/forecast')
  ok('GET /deals/forecast renders', forecast.status === 200, forecast.body)

  if (dealId) {
    const line = await call('POST', `/deals/${dealId}/products`, {
      name: 'Smoke line', quantity: 2, unitPrice: 1000, discountPercent: 10, taxPercent: 18,
    })
    ok('deal line item is added', line.status === 201, line.body)
    // 2 x 1000 = 2000, less 10% = 1800, plus 18% = 2124
    ok('line total uses the shared formula', Number((line.body as never)['total']) === 2124, line.body)
  }

  // ── 4. Quote
  console.log('\nQuote')
  const quote = await call('POST', '/quotes', {
    accountId,
    contactId: contactId ?? null,
    dealId: dealId ?? null,
    copyFromDealId: dealId ?? null,
    paymentTerms: '50% advance',
  })
  ok('POST /quotes creates one', quote.status === 201, quote.body)
  const quoteId = (quote.body as { id?: number })?.id
  if (quoteId) created.quotes.push(BigInt(quoteId))

  if (quoteId) {
    const qGet = await call('GET', `/quotes/${quoteId}`)
    ok('GET /quotes/:id returns it', qGet.status === 200, qGet.body)
    const q = qGet.body as Record<string, never>
    ok("deal's line items were copied across", Array.isArray(q.items) && (q.items as never[]).length === 1)
    ok('totals were recomputed from the lines', Number(q.total) === 2124, { total: q.total })
    ok('a default recipient is offered', !!q.defaultRecipient, { defaultRecipient: q.defaultRecipient })

    const doc = await call('GET', `/quotes/${quoteId}/document`)
    ok('GET /quotes/:id/document renders HTML', doc.status === 200 && doc.text.startsWith('<!doctype html>'))
    ok('the document carries the quote number', doc.text.includes(String(q.quoteNumber)))
    ok("the document is on the CUSTOMER's letterhead, not the platform's",
      doc.text.includes(ctx.companyName) || !doc.text.includes('Tutelage'))
    ok('the document shows the total', doc.text.includes('2,124.00'), doc.text.slice(0, 0))

    // Sending is opt-in: a default run must not email anybody.
    if (sendTo) {
      const sent = await call('POST', `/quotes/${quoteId}/send`, { to: sendTo, subject: 'Smoke test quote' })
      ok(`POST /quotes/:id/send delivered to ${sendTo}`, sent.status === 200, sent.body)
    } else {
      console.log('  SKIP  send (pass --send=<email> to actually deliver one)')
    }

    // Convert → order → invoice.
    console.log('\nOrder and invoice')
    await call('POST', `/quotes/${quoteId}/status`, { status: 'accepted' })
    const conv = await call('POST', `/quotes/${quoteId}/convert`)
    ok('accepted quote converts to an order', conv.status === 201, conv.body)
    const orderId = (conv.body as { id?: number })?.id

    const dup = await call('POST', `/quotes/${quoteId}/convert`)
    ok('converting the same quote twice is refused', dup.status === 409, dup.body)

    if (orderId) {
      const inv = await call('POST', `/orders/${orderId}/invoice`)
      ok('order raises an invoice', inv.status === 201, inv.body)
      const invoiceId = (inv.body as { id?: number })?.id

      // Found in live data: one order had two invoices against it, because the
      // UI hid the button but the API accepted a second POST.
      const dupInv = await call('POST', `/orders/${orderId}/invoice`)
      ok('invoicing the same order twice is refused', dupInv.status === 409, dupInv.body)

      if (invoiceId) {
        const iGet = await call('GET', `/invoices/${invoiceId}`)
        ok('invoice carries the copied lines', Number((iGet.body as never)['total']) === 2124, iGet.body)

        const over = await call('POST', `/invoices/${invoiceId}/payments`, {
          amount: 999999, paymentDate: new Date().toISOString().slice(0, 10), mode: 'upi',
        })
        ok('overpayment is refused', over.status === 400, over.body)

        const pay = await call('POST', `/invoices/${invoiceId}/payments`, {
          amount: 1000, paymentDate: new Date().toISOString().slice(0, 10), mode: 'upi',
        })
        ok('a valid payment is accepted', pay.status === 201, pay.body)

        const after = await call('GET', `/invoices/${invoiceId}`)
        ok('invoice moves to partial', (after.body as never)['status'] === 'partial', after.body)
        ok('balance is recomputed', Number((after.body as never)['balance']) === 1124, after.body)
      }
    }
  }

  // An order with no lines should refuse rather than bill zero.
  const emptyOrder = await call('POST', '/orders', { accountId })
  const emptyOrderId = (emptyOrder.body as { id?: number })?.id
  if (emptyOrderId) {
    const zeroInv = await call('POST', `/orders/${emptyOrderId}/invoice`)
    ok('an order with no lines cannot be invoiced', zeroInv.status === 400, zeroInv.body)
  }

  // ── 4b. The company panel that lives on the lead
  console.log('\nLead company panel')
  const lead = await runWithTenant(ctx, () =>
    prisma.lead.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
  )
  if (lead) {
    const lid = Number(lead.id)

    const before = await call('GET', `/lead-business/${lid}`)
    ok('GET /lead-business/:leadId responds', before.status === 200, before.body)

    const named = await call('PATCH', `/lead-business/${lid}`, {
      companyName: `Smoke Company ${stamp}`,
      designation: 'Head of Smoke',
      projectTitle: `Smoke Project ${stamp}`,
      projectDescription: 'Multi-line brief.\nSecond line, to prove text survives a round trip.',
    })
    ok('company name can be recorded on a lead', named.status === 200, named.body)

    const after = await call('GET', `/lead-business/${lid}`)
    ok('and reads back', (after.body as never)['business']?.['companyName'] === `Smoke Company ${stamp}`,
      after.body)
    const biz = (after.body as never)['business'] as Record<string, unknown>
    ok('the project brief reads back', biz?.projectTitle === `Smoke Project ${stamp}`, biz?.projectTitle)
    ok('and its description keeps its line breaks',
      String(biz?.projectDescription ?? '').includes('\nSecond line'), biz?.projectDescription)
    ok('an unconverted lead reports converted:false', (after.body as never)['converted'] === false)
    ok('and carries no account yet', (after.body as never)['account'] === null)

    // The company has to reach the leads LIST too, not just the lead page —
    // that card is where a rep decides which lead to open.
    const list = await call('GET', `/leads?limit=200`)
    const rows = ((list.body as { data?: { id: number; business?: { companyName?: string; projectTitle?: string } | null }[] })?.data ?? [])
    const mine = rows.find((r) => Number(r.id) === lid)
    ok('the leads list carries the company name', mine?.business?.companyName === `Smoke Company ${stamp}`,
      { found: !!mine, business: mine?.business ?? null })
    ok('and the project title', mine?.business?.projectTitle === `Smoke Project ${stamp}`,
      mine?.business ?? null)

    // A comment is the thing reps actually write, and until recently it lived
    // only in `lead_comments` — so the history a lead accumulated was invisible
    // the moment it became an account. Prove the mirror fires.
    const said = await call('POST', '/comments', {
      leadId: Number(lid),
      comment: `Smoke comment ${stamp}`,
    })
    ok('a comment can be added to a lead', said.status === 201, said.body)
    created.comments.push(BigInt((said.body as never)['id']))

    const leadTl = await call('GET', `/crm/timeline/lead/${lid}?kinds=comment,note`)
    const leadItems = ((leadTl.body as { items?: { body?: string }[] })?.items ?? [])
    ok('and shows up on the timeline of that lead',
      leadItems.some((i) => i.body === `Smoke comment ${stamp}`),
      { count: leadItems.length })

    // ── The lead <-> account union.
    //
    // Converting for real would leave a permanent account behind, so instead
    // link the lead this run already owns to the account this run already owns,
    // exercise both directions, and let the existing cleanup unpick it.
    console.log('')
    console.log('Lead and account read as one timeline')
    await runWithTenant(ctx, () =>
      prisma.leadBusiness.updateMany({
        where: { companyName: `Smoke Company ${stamp}` },
        data: { accountId },
      }),
    )

    // The lead overview renders AccountSummary, which needs the account page's
    // full payload — not the thinner one this route used to build for itself.
    const conv = await call('GET', `/lead-business/${lid}`)
    const acct = (conv.body as never)['account'] as Record<string, unknown> | null
    ok('a converted lead reports converted:true', (conv.body as never)['converted'] === true)
    ok('and carries the account stats', !!acct?.stats, acct ? Object.keys(acct) : null)
    ok('and keyContacts, for "who to call"', Array.isArray(acct?.keyContacts))
    ok('and customFields, for "at a glance"', Array.isArray(acct?.customFields))
    ok('and primaryLocation, for reach', !!acct && 'primaryLocation' in acct)

    const acctSees = await call('GET', `/crm/timeline/account/${accountId}?kinds=comment,note`)
    const acctItems = ((acctSees.body as { items?: { body?: string }[] })?.items ?? [])
    ok('a comment made on the lead shows on its account',
      acctItems.some((i) => i.body === `Smoke comment ${stamp}`),
      { count: acctItems.length })
    ok('and is not duplicated there',
      acctItems.filter((i) => i.body === `Smoke comment ${stamp}`).length === 1,
      acctItems.map((i) => i.body))

    // The direction that was broken: logged on the account, invisible on the lead.
    const logged = await call('POST', `/crm/timeline/account/${accountId}`, {
      kind: 'call', subject: `Smoke call ${stamp}`, body: 'rang them',
    })
    ok('an activity can be logged on the account', logged.status === 201, logged.body)

    const leadSees = await call('GET', `/crm/timeline/lead/${lid}?kinds=call`)
    const leadCalls = ((leadSees.body as { items?: { subject?: string }[] })?.items ?? [])
    ok('and a call logged on the account shows on its lead',
      leadCalls.some((i) => i.subject === `Smoke call ${stamp}`),
      { count: leadCalls.length })
  } else {
    console.log('  SKIP  no lead in this tenant to attach a company to')
  }

  // ── 5. Timeline
  console.log('\nTimeline')
  const tl = await call('GET', `/crm/timeline/account/${accountId}`)
  ok('the account has a timeline', tl.status === 200, tl.body)
  const items = (tl.body as { items?: unknown[] })?.items
  ok('and the flow wrote events onto it', Array.isArray(items) && items.length >= 2,
    { count: Array.isArray(items) ? items.length : 0 })

  // ── 6. Cleanup
  console.log('\nCleaning up')
  await runWithTenant(ctx, async () => {
    // Only the fields this run wrote — the lead itself is not ours to remove.
    await prisma.leadBusiness.deleteMany({ where: { companyName: `Smoke Company ${stamp}` } })
    for (const id of created.comments) {
      await prisma.activity.deleteMany({ where: { sourceType: 'lead_comment', sourceId: id } })
      await prisma.leadComment.deleteMany({ where: { id } })
    }
    for (const id of created.quotes) await prisma.quote.deleteMany({ where: { id } })
    for (const id of created.accounts) {
      await prisma.crmInvoice.deleteMany({ where: { accountId: id } })
      await prisma.order.deleteMany({ where: { accountId: id } })
      await prisma.deal.deleteMany({ where: { accountId: id } })
      await prisma.contact.deleteMany({ where: { accountId: id } })
      await prisma.activity.deleteMany({ where: { entityType: 'account', entityId: id } })
      await prisma.account.deleteMany({ where: { id } })
    }

    // Deleting a deal or contact leaves its timeline rows behind — there is no
    // foreign key to cascade. Earlier runs of this script left 70 of them in a
    // live tenant before anybody noticed. Prune rather than enumerate, so a
    // record type added to this test later cannot reintroduce the leak.
    const pruned = await pruneOrphans()
    const n = Object.values(pruned).reduce((a, b) => a + b, 0)
    if (n) console.log(`  pruned ${n} timeline rows left by deleted records`)
  })
  console.log('  removed the test account and everything under it')

  report()
}

function report() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(fail === 0 ? `ALL ${pass} PASSED` : `${pass} passed, ${fail} FAILED`)
  if (failures.length) failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\nCrashed:', e)
  process.exit(1)
})
