// ─────────────────────────────────────────────────────────────────────────────
// Checks the vertical, lead-field and terminology config without touching a
// database — pure functions over the catalogues in src/config.
//
// THE FIRST BLOCK IS THE ONE THAT MATTERS. Every existing customer stores `{}`
// in features, leadFields and labels, so "empty config resolves to exactly the
// catalogue defaults" is the guarantee that shipping verticals cannot change
// anything for Tutelage. If those assertions ever fail, an existing customer's
// panel has changed and the change was not intended.
//
//   npm run verticals:verify
// ─────────────────────────────────────────────────────────────────────────────

import { getVertical, VERTICALS } from '../src/config/verticals'
import { resolveLeadFields, sanitizeLeadFieldConfig, LEAD_FIELD_GROUPS, hiddenFieldKeys } from '../src/config/lead-fields'
import { resolveTerms, TERMS } from '../src/config/terminology'
import { resolveFeatures, defaultFeatureMap, allFeaturesOn, sanitizeFeatureMap, FEATURES } from '../src/config/features'
import { ENTITY_TYPES, isEntityType, isLiveEntityType } from '../src/config/crm-entities'
import { applies, normalizeKey, isFieldType, FIELD_TYPES } from '../src/services/crm/custom-fields.service'
import { lineTotal, summarize } from '../src/services/crm/deals.service'
import { invoiceStatus, isOverdue } from '../src/services/crm/documents.service'

let fail = 0
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) fail++
}

// ── Acceptance test: an existing customer stores {} everywhere. Nothing may change.
const edu = getVertical('education')
ok('education preset hides no groups', edu.leadFields.hiddenGroups.length === 0)
ok('education preset hides no fields', edu.leadFields.hiddenFields.length === 0)
ok('education preset renames nothing', Object.keys(edu.labels).length === 0)
ok('education preset changes no features', Object.keys(edu.features).length === 0)

const storedEmpty = {}
const resolved = resolveLeadFields(storedEmpty)
ok('empty config shows every group', resolved.every((g) => g.visible))
ok('empty config shows every field', resolved.every((g) => g.fields.every((f) => f.visible)))
ok(
  'empty config keeps every catalogue label',
  resolved.every((g, i) =>
    g.title === LEAD_FIELD_GROUPS[i].title &&
    g.fields.every((f, j) => f.label === LEAD_FIELD_GROUPS[i].fields[j].label)),
)
const terms = resolveTerms(storedEmpty)
ok('empty labels give catalogue wording', TERMS.every((t) => terms[t.key].singular === t.singular))
ok('brand still says Sales CRM by default', terms.brand.singular === 'Sales CRM')
ok('allFeaturesOn is unaffected', Object.values(allFeaturesOn()).every(Boolean))

// ── The b2b preset does what it claims.
const b2b = getVertical('b2b_sales')
const b2bFields = resolveLeadFields(b2b.leadFields)
const byId = Object.fromEntries(b2bFields.map((g) => [g.id, g]))
ok('b2b hides NEET', !byId.neet.visible)
ok('b2b hides UCAT / DMAT / SAT', !byId.ucat.visible && !byId.dmat.visible && !byId.sat.visible)
ok('b2b keeps the locked pipeline group', byId.other.visible)
ok('b2b keeps the name field', byId.personal.fields.find((f) => f.key === 'name')!.visible)
ok('b2b hides father', !byId.personal.fields.find((f) => f.key === 'father')!.visible)
ok(
  'b2b renames Course inside the locked group',
  byId.other.fields.find((f) => f.key === 'intrestedCourse')!.label === 'Product / Service Interest',
)
ok(
  'b2b hides University inside the locked group',
  !byId.other.fields.find((f) => f.key === 'intrestedUniversity')!.visible,
)
const b2bTerms = resolveTerms(b2b.labels)
ok('b2b says Client not Student', b2bTerms.student.plural === 'Clients')
ok('b2b leaves Lead alone', b2bTerms.lead.plural === 'Leads')
const b2bFeatures = resolveFeatures({ ...defaultFeatureMap(), ...b2b.features })
ok('b2b turns Students off', b2bFeatures.students === false)
ok('b2b turns the auto dialer on', b2bFeatures.auto_dialer === true)

const product = getVertical('product_sales')
const productFields = resolveLeadFields(product.leadFields)
const pById = Object.fromEntries(productFields.map((g) => [g.id, g]))
ok('product_sales hides NEET', !pById.neet.visible)
ok('product_sales keeps name', pById.personal.fields.find((f) => f.key === 'name')!.visible)
ok('product_sales keeps email', pById.personal.fields.find((f) => f.key === 'email')!.visible)
ok('product_sales keeps mobile', pById.personal.fields.find((f) => f.key === 'mobile')!.visible)
ok('product_sales says Customer not Student', resolveTerms(product.labels).student.plural === 'Customers')
ok('product_sales says Sales Rep', resolveTerms(product.labels).counsellor.singular === 'Sales Rep')
const productFeatures = resolveFeatures({ ...defaultFeatureMap(), ...product.features })
ok('product_sales turns Students off', productFeatures.students === false)
ok('product_sales turns deals on', productFeatures.deals === true)
ok('product_sales turns location on', productFeatures.location_tracking === true)
ok('product_sales seed has Catalog Sent', product.seed.lifecycle.some((s) => s.slug === 'catalog-sent'))

// ── Sanitising refuses what it must.
const hostile = sanitizeLeadFieldConfig({
  hiddenGroups: ['other', 'personal', 'not_a_group'],
  hiddenFields: ['name', 'father', 'not_a_field'],
  labels: { name: '  ', father: 'Guardian', bogus: 'x' },
  groupLabels: { personal: 'People', nope: 'x' },
})
ok('locked group cannot be hidden', !hostile.hiddenGroups.includes('other'))
ok('unknown group dropped', !hostile.hiddenGroups.includes('not_a_group'))
ok('always-on field cannot be hidden', !hostile.hiddenFields.includes('name'))
ok('unknown field dropped', !hostile.hiddenFields.includes('not_a_field'))
ok('blank rename dropped', hostile.labels?.name === undefined)
ok('unknown rename key dropped', hostile.labels?.bogus === undefined)
ok('valid rename kept', hostile.labels?.father === 'Guardian')
ok('unknown group rename dropped', hostile.groupLabels?.nope === undefined)

// ── B2B: the entity-type guard, which is all that stands in for a foreign key.
ok('known entity type accepted', isEntityType('account'))
ok('typo rejected', !isEntityType('acount'))
ok('non-string rejected', !isEntityType(42))
ok('lead / account / contact / deal are live', ['lead', 'account', 'contact', 'deal'].every(isLiveEntityType))
ok('quote is a valid type but not live yet', isEntityType('quote') && !isLiveEntityType('quote'))
ok('entity types are unique', new Set(ENTITY_TYPES).size === ENTITY_TYPES.length)

// ── Custom fields: the pure logic, which is where the subtle bugs live.
ok('field key is snake_cased', normalizeKey('  Number of Rooms!  ') === 'number_of_rooms')
ok('leading/trailing separators trimmed', normalizeKey('--Beds--') === 'beds')
ok('every field type is recognised', FIELD_TYPES.every(isFieldType))
ok('unknown field type rejected', !isFieldType('richtext'))

ok('no appliesWhen means always shown', applies(null, { accountType: 'hotel' }))
ok('appliesWhen matches', applies({ accountType: ['hotel', 'hospital'] }, { accountType: 'hotel' }))
ok('appliesWhen excludes', !applies({ accountType: ['hotel'] }, { accountType: 'school' }))
ok('missing context property excludes', !applies({ accountType: ['hotel'] }, {}))
ok(
  'every rule must match, not just one',
  !applies({ accountType: ['hotel'], status: ['active'] }, { accountType: 'hotel', status: 'churned' }),
)

// ── The b2b preset must switch its own core on, or the nav renders nothing.
ok('b2b turns Accounts on', b2bFeatures.accounts === true)
ok('b2b turns Custom Fields on', b2bFeatures.custom_fields === true)
ok('education leaves Accounts off', defaultFeatureMap().accounts === false)
ok('education leaves Custom Fields off', defaultFeatureMap().custom_fields === false)
ok('b2b seeds account types', (b2b.seed.accountTypes?.length ?? 0) > 0)
ok('education seeds no account types', edu.seed.accountTypes === undefined)

// ── Deal maths. Quotes, orders and invoices all have to agree with this, so a
//    rounding change here is a change to what customers get billed.
ok('plain line', lineTotal({ quantity: 2, unitPrice: 100, discountPercent: 0, taxPercent: 0 }) === 200)
ok('discount applied', lineTotal({ quantity: 1, unitPrice: 1000, discountPercent: 10, taxPercent: 0 }) === 900)
ok('tax applied', lineTotal({ quantity: 1, unitPrice: 1000, discountPercent: 0, taxPercent: 18 }) === 1180)
ok(
  'discount before tax, not after',
  lineTotal({ quantity: 1, unitPrice: 1000, discountPercent: 10, taxPercent: 18 }) === 1062,
)
ok('zero quantity is zero', lineTotal({ quantity: 0, unitPrice: 999, discountPercent: 0, taxPercent: 18 }) === 0)
// 3 x 33.33 = 99.99 -> less 7% = 92.9907 -> plus 18% = 109.729026 -> 109.73.
// Rounding after each step instead would give 109.74; that one-paise gap is the
// whole reason lineTotal() rounds once, at the end.
ok(
  'rounded once at the end, to paise',
  lineTotal({ quantity: 3, unitPrice: 33.33, discountPercent: 7, taxPercent: 18 }) === 109.73,
)

const bill = summarize([
  { quantity: 2, unitPrice: 1000, discountPercent: 10, taxPercent: 18 },
  { quantity: 1, unitPrice: 500, discountPercent: 0, taxPercent: 18 },
])
ok('summary subtotal is gross', bill.subtotal === 2500)
ok('summary discount', bill.discount === 200)
ok('summary tax is on the discounted amount', bill.tax === 414)
ok('summary total reconciles', bill.total === bill.subtotal - bill.discount + bill.tax)
ok(
  'header total matches the sum of its lines',
  bill.total ===
    lineTotal({ quantity: 2, unitPrice: 1000, discountPercent: 10, taxPercent: 18 }) +
      lineTotal({ quantity: 1, unitPrice: 500, discountPercent: 0, taxPercent: 18 }),
)

// ── Invoice status. Found by the smoke test: a payment against a draft used to
//    leave it reading "draft" with a part-paid balance forever, invisible to the
//    ageing report and the overdue filter.
ok('unpaid draft stays a draft', invoiceStatus('draft', 2124, 0) === 'draft')
ok('part-paid draft becomes partial', invoiceStatus('draft', 2124, 1000) === 'partial')
ok('fully paid draft becomes paid', invoiceStatus('draft', 2124, 2124) === 'paid')
ok('part-paid sent becomes partial', invoiceStatus('sent', 2124, 1000) === 'partial')
ok('overpayment still reads paid', invoiceStatus('sent', 2124, 3000) === 'paid')
ok('cancelled is sticky even when paid', invoiceStatus('cancelled', 2124, 2124) === 'cancelled')
ok('a zero-total invoice is not "paid"', invoiceStatus('sent', 0, 0) === 'sent')

const yesterday = new Date(Date.now() - 86_400_000)
const tomorrow = new Date(Date.now() + 86_400_000)
ok('past due and unpaid is overdue', isOverdue({ status: 'partial', dueDate: yesterday }))
ok('paid is never overdue', !isOverdue({ status: 'paid', dueDate: yesterday }))
ok('draft is never overdue', !isOverdue({ status: 'draft', dueDate: yesterday }))
ok('cancelled is never overdue', !isOverdue({ status: 'cancelled', dueDate: yesterday }))
ok('not yet due is not overdue', !isOverdue({ status: 'sent', dueDate: tomorrow }))
ok('no due date is not overdue', !isOverdue({ status: 'sent', dueDate: null }))

// ── The b2b preset must seed a usable pipeline, or the board opens empty.
const pl = b2b.seed.pipelines?.[0]
ok('b2b seeds a pipeline', Boolean(pl))
ok('education seeds no pipeline', edu.seed.pipelines === undefined)
ok('pipeline has exactly one won stage', pl!.stages.filter((s) => s.isWon).length === 1)
ok('pipeline has exactly one lost stage', pl!.stages.filter((s) => s.isLost).length === 1)
ok('every probability is 0-100', pl!.stages.every((s) => s.probability >= 0 && s.probability <= 100))
ok('won stage is 100%', pl!.stages.find((s) => s.isWon)!.probability === 100)
ok('lost stage is 0%', pl!.stages.find((s) => s.isLost)!.probability === 0)
ok(
  'open stages ascend in probability',
  pl!.stages
    .filter((s) => !s.isWon && !s.isLost)
    .every((s, i, a) => i === 0 || s.probability >= a[i - 1].probability),
)
ok('b2b turns Deals on', b2bFeatures.deals === true)
ok('education leaves Deals off', defaultFeatureMap().deals === false)
ok('deal is now a live entity type', isLiveEntityType('deal'))

// ── Flattening groups into field keys. This is what lets a client call
//    visible('neetQualified') without knowing it lives in the `neet` group —
//    the bug that put a NEET cell and a permanently-capped completion score on
//    every B2B lead card.
const eduHidden = hiddenFieldKeys({})
ok('education hides no field keys', eduHidden.length === 0)

const b2bHidden = hiddenFieldKeys(b2b.leadFields)
ok('group members are flattened in', b2bHidden.includes('neetQualified') && b2bHidden.includes('neetResult'))
ok('every field of every hidden group is included',
  LEAD_FIELD_GROUPS.filter((g) => b2b.leadFields.hiddenGroups.includes(g.id))
    .every((g) => g.fields.every((f) => b2bHidden.includes(f.key))))
ok('individually hidden fields survive flattening', b2bHidden.includes('father') && b2bHidden.includes('gender'))
ok('always-on fields are never flattened in', !b2bHidden.includes('name'))
ok('visible fields stay out', !b2bHidden.includes('city') && !b2bHidden.includes('intrestedCourse'))
ok('no duplicates', new Set(b2bHidden).size === b2bHidden.length)

// The completion score must only count fields the customer actually has.
const COMPLETION = ['name','email','mobile','father','city','state','gender','dob','neetQualified','intrestedCourse','approximateBudget','highestQualification']
const countable = COMPLETION.filter((k) => !b2bHidden.includes(k))
ok('b2b scores against 7 fields, not 12', countable.length === 7)
ok('education still scores against all 12', COMPLETION.filter((k) => !eduHidden.includes(k)).length === 12)

// ── Per-module permissions. The catalogue is what the super admin grid renders
//    and what routes/index.ts guards, so these are the load-bearing invariants.
const criticalKeys = FEATURES.filter((f) => f.critical).map((f) => f.key)
ok('the load-bearing modules are flagged', criticalKeys.length === 4)
ok('they are leads/users/dashboard/settings',
  ['leads', 'users', 'dashboard', 'settings'].every((k) => criticalKeys.includes(k)))
ok('each says what breaks', FEATURES.filter((f) => f.critical).every((f) => !!f.criticalWarning))

// EVERY module is switchable, including the load-bearing four. `critical` is a
// warning in the panel, never a lock in the data layer.
const allOff = sanitizeFeatureMap({ leads: false, users: false, dashboard: false, settings: false })
ok('sanitize keeps critical keys', allOff.leads === false && allOff.dashboard === false)
const resolvedOff = resolveFeatures({ leads: false, dashboard: false, settings: false, users: false })
ok('resolve honours them being off',
  !resolvedOff.leads && !resolvedOff.dashboard && !resolvedOff.settings && !resolvedOff.users)
ok('unrelated modules are unaffected', resolveFeatures({ leads: false }).whatsapp === false)

// Every mount is guarded now, including the critical ones — nothing is exempt.
ok('every module with prefixes is guardable',
  FEATURES.every((f) => Array.isArray(f.apiPrefixes)))
ok('the critical four all declare their mounts',
  FEATURES.filter((f) => f.critical).every((f) => f.apiPrefixes.length > 0))

// THE ONE THAT MATTERS MOST. A customer stores only deviations, so a newly
// added key falls back to defaultEnabled. Any new flag for behaviour that
// already shipped MUST default true, or every live customer silently loses it.
const preExisting = ['bucket','lead_config','lead_sources','duplicates','trash','remarks','reminders',
  'calendar','reports','daily_reports','activity_tracking','login_logs','announcements','chat',
  'agents','email']
ok('every flag added over existing behaviour defaults ON',
  preExisting.every((k) => FEATURES.find((f) => f.key === k)?.defaultEnabled === true))
ok('a customer with an empty stored map keeps all of them',
  preExisting.every((k) => resolveFeatures({})[k] === true))

// The load-bearing four became switchable rather than forced-on. Neither live
// customer has those keys in their stored column, so they fall back to
// defaultEnabled — which must stay true, or unlocking them would have silently
// switched off Leads and the Dashboard for everybody.
ok('the critical four default ON for a customer that has never set them',
  ['leads', 'users', 'dashboard', 'settings'].every((k) => resolveFeatures({})[k] === true))
ok('and stay on under a partial map that mentions none of them',
  ['leads', 'users', 'dashboard', 'settings']
    .every((k) => resolveFeatures({ whatsapp: false, chat: false })[k] === true))

ok('feature keys are unique', new Set(FEATURES.map((f) => f.key)).size === FEATURES.length)
ok('every feature has a group and description',
  FEATURES.every((f) => !!f.group && !!f.description))
// A non-core module with no API prefixes is nav-only; that is allowed, but a
// typo'd prefix that guards nothing is not.
ok('every apiPrefix starts with a slash',
  FEATURES.every((f) => f.apiPrefixes.every((p) => p.startsWith('/'))))
ok('b2b modules stay off by default for education',
  ['accounts','deals','sales_docs','custom_fields'].every((k) => defaultFeatureMap()[k] === false))

ok('every vertical key is unique', new Set(VERTICALS.map((v) => v.key)).size === VERTICALS.length)
ok('unknown vertical falls back to product_sales', getVertical('nonsense').key === 'product_sales')
ok('undefined vertical falls back to product_sales', getVertical(undefined).key === 'product_sales')

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
