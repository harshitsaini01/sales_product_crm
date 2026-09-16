// Lead-workflow integrity audit.
//
// Reports (read-only by default):
//   1. Cross-dept mismatch — leads whose department_id differs from the
//      CASCADE destination, COALESCE(sub_status.move_to,
//      sub_status.department_id, status.department_id). NOTE: comparing against
//      status.department_id alone (as this report used to) is WRONG — that is
//      the bug the cascade fix removed, and it flags ~1 779 correctly-filed
//      leads whose status belongs to a department they were routed onward from.
//   2. Stale status_lead_type_id — leads whose lead-type bucket belongs to a
//      DIFFERENT department than the lead's own dept. These leak between dept
//      tabs (the "tabs don't sum to All" symptom).
//   3. Backward-direction sub-status configs — sub-statuses whose target
//      department has a LOWER pipeline priority than the parent status's
//      department. Counsellors picking these would now be blocked by the new
//      pipeline guard; admins can still use them.
//   4. Corrupted lead_type — leads whose lead_type slug column holds a numeric
//      department id, stamped there by the old follow-up cascade.
//   5. asigned_leads drift — active assignment rows whose department_id no
//      longer matches their lead. Dept-scoped views read these, so a drifted
//      row keeps the lead showing under the department it left.
//
// Archive (slug='archive') is intentionally excluded from #1 and #2 — by
// design, archived leads keep their pre-archive status/bucket and surface via
// the "Old Data" catch-all tab. Counting Archive mismatches would obscure
// the real bugs in active departments.
//
// Usage:
//   npx tsx scripts/audit-lead-workflow.ts
//      → prints report to stdout, no DB writes
//   npx tsx scripts/audit-lead-workflow.ts --apply --mismatch
//      → moves each mismatched lead to its CASCADE destination (the department
//        its status/sub-status is configured to route it to)
//   npx tsx scripts/audit-lead-workflow.ts --apply --bucket-cleanup
//      → nulls out the stale status_lead_type_id so the lead falls into the
//        correct dept's Default bucket (visible everywhere)
//   npx tsx scripts/audit-lead-workflow.ts --apply --leadtype-cleanup
//      → resets numeric lead_type values back to the 'new' default
//   npx tsx scripts/audit-lead-workflow.ts --apply --assigned-sync
//      → re-syncs asigned_leads department/bucket from the lead row
//   npx tsx scripts/audit-lead-workflow.ts --apply --all
//      → every fix above
import { prisma } from '../src/lib/prisma'

const APPLY = process.argv.includes('--apply')
const FIX_MISMATCH = process.argv.includes('--mismatch') || process.argv.includes('--all')
const FIX_BUCKET = process.argv.includes('--bucket-cleanup') || process.argv.includes('--all')
const FIX_LEADTYPE = process.argv.includes('--leadtype-cleanup') || process.argv.includes('--all')
const FIX_ASSIGNED = process.argv.includes('--assigned-sync') || process.argv.includes('--all')

const BAR = '─'.repeat(72)

function log(line = '') { process.stdout.write(line + '\n') }

async function getArchiveDeptIds(): Promise<bigint[]> {
  const rows = await prisma.leadDepartment.findMany({
    where: { slug: 'archive' },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

async function reportPipelineOrder() {
  log(BAR)
  log('PIPELINE ORDER (lead_departments.priority ascending)')
  log(BAR)
  const depts = await prisma.leadDepartment.findMany({
    orderBy: { priority: 'asc' },
    select: { id: true, name: true, slug: true, priority: true, status: true },
  })
  for (const d of depts) {
    log(`  ${String(d.priority).padStart(2)}  ${d.name.padEnd(22)}  (${d.slug})${d.status === 0 ? '  [disabled]' : ''}`)
  }
  log()
}

async function reportLeadDeptSummary() {
  log(BAR)
  log('LEAD COUNTS PER DEPT (active, trash=0)')
  log(BAR)
  const rows = await prisma.$queryRaw<Array<{
    name: string; priority: number; total: bigint; no_status: bigint
  }>>`
    SELECT d.name, d.priority,
           COUNT(l.id) FILTER (WHERE l.trash = 0)::bigint AS total,
           COUNT(l.id) FILTER (WHERE l.trash = 0 AND l.lead_status_id IS NULL)::bigint AS no_status
    FROM lead_departments d
    LEFT JOIN leads l ON l.department_id = d.id
    GROUP BY d.id, d.name, d.priority
    ORDER BY d.priority
  `
  log('  prio  dept                      total    no-status')
  log('  ----  ------------------------  -------  ---------')
  for (const r of rows) {
    log(`  ${String(r.priority).padStart(4)}  ${r.name.padEnd(24)}  ${String(r.total).padStart(7)}  ${String(r.no_status).padStart(9)}`)
  }
  log()
}

async function reportCrossDeptMismatch(_archiveIds: bigint[], _deptNameById: Map<string, string>) {
  log(BAR)
  log('1. CROSS-DEPT MISMATCH — lead.department_id ≠ the CASCADE destination')
  log(BAR)

  // The rule is COALESCE(sub_status.move_to, sub_status.department_id,
  // status.department_id) — the same precedence status-cascade.service.ts
  // applies on write.
  //
  // This report used to compare against `status.department_id` ALONE, which is
  // the very bug the cascade fix removed. That over-reported wildly: a lead in
  // NEET Dept carrying a Tele Calling "Call Answered" status whose sub-status
  // ("NEET Qualified") routes to NEET is CORRECT — the lead came through Tele
  // Calling and was routed onward, so lead_status_id legitimately points at a
  // status from the department it passed through. Measured on live data, the
  // old rule flagged 1 779 such leads as broken; back-filling them from the
  // status's department would have moved 1 779 correctly-filed leads into the
  // WRONG department.
  const rows = await prisma.$queryRaw<Array<{
    id: bigint; currently_in: string | null; should_be_in: string | null
    via_status: string | null; via_sub_status: string | null; target_dept_id: bigint
  }>>`
    SELECT l.id,
           ldept.name AS currently_in,
           cdept.name AS should_be_in,
           s.title    AS via_status,
           ss.sub_status AS via_sub_status,
           COALESCE(ss.move_to, ss.department_id, s.department_id) AS target_dept_id
    FROM leads l
    JOIN lead_statuses s ON s.id = l.lead_status_id
    LEFT JOIN lead_sub_statuses ss ON ss.id = l.lead_sub_status_id
    LEFT JOIN lead_departments ldept ON ldept.id = l.department_id
    LEFT JOIN lead_departments cdept ON cdept.id = COALESCE(ss.move_to, ss.department_id, s.department_id)
    WHERE l.trash = 0
      AND l.lead_status_id IS NOT NULL
      AND ldept.slug <> 'archive'
      AND l.department_id IS DISTINCT FROM COALESCE(ss.move_to, ss.department_id, s.department_id)
    ORDER BY l.id
  `

  if (rows.length === 0) {
    log('  (none — every active lead sits where its status/sub-status routes it)')
    log()
    return
  }

  const groups = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.currently_in ?? '(none)'} -> ${r.should_be_in ?? '(none)'}  via ${r.via_status ?? '?'} / ${r.via_sub_status ?? '—'}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  log('  count  from → to  (via status / sub-status)')
  log('  -----  ---------------------------------------------------------------')
  for (const [pair, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(count).padStart(5)}  ${pair}`)
  }
  log(`  TOTAL  ${rows.length} leads sitting in the wrong department`)

  if (APPLY && FIX_MISMATCH) {
    log()
    log('  --apply --mismatch : moving leads to their cascade destination…')
    const byTargetDept = new Map<string, bigint[]>()
    for (const r of rows) {
      const key = r.target_dept_id.toString()
      const arr = byTargetDept.get(key) ?? []
      arr.push(r.id)
      byTargetDept.set(key, arr)
    }
    let fixed = 0
    for (const [deptIdStr, ids] of byTargetDept.entries()) {
      const res = await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { departmentId: BigInt(deptIdStr) },
      })
      fixed += res.count
    }
    log(`  ✓ ${fixed} leads moved to their configured department`)
  } else {
    log('  (run with --apply --mismatch to move these to their cascade destination)')
  }
  log()
}


async function reportStaleBucket(archiveIds: bigint[], deptNameById: Map<string, string>) {
  log(BAR)
  log('2. STALE status_lead_type_id — bucket dept ≠ lead\'s dept')
  log(BAR)

  const leads = await prisma.lead.findMany({
    where: {
      trash: 0,
      ...(archiveIds.length ? { departmentId: { notIn: archiveIds } } : {}),
      statusLeadTypeId: { not: null },
    },
    select: {
      id: true,
      departmentId: true,
      statusLeadTypeId: true,
    },
    take: 100_000,
  })

  const typeIds = Array.from(new Set(leads.map((l) => l.statusLeadTypeId!.toString()))).map((s) => BigInt(s))
  const types = typeIds.length
    ? await prisma.leadTypeConfig.findMany({
        where: { id: { in: typeIds } },
        select: { id: true, departmentId: true },
      })
    : []
  const typeById = new Map(types.map((t) => [t.id.toString(), t]))

  const real = leads.filter((l) => {
    const t = typeById.get(l.statusLeadTypeId!.toString())
    if (!t || t.departmentId === null) return false
    return t.departmentId !== l.departmentId
  })

  if (real.length === 0) {
    log('  (none — every active-dept lead\'s bucket matches its dept)')
  } else {
    const groups = new Map<string, number>()
    for (const l of real) {
      const t = typeById.get(l.statusLeadTypeId!.toString())!
      const fromName = l.departmentId ? deptNameById.get(l.departmentId.toString()) ?? '(null)' : '(null)'
      const toName = deptNameById.get(t.departmentId!.toString()) ?? '(null)'
      const key = `${fromName} -> ${toName}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    log('  count  lead\'s dept            bucket\'s dept')
    log('  -----  ---------------------  ---------------------')
    for (const [pair, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
      const [from, to] = pair.split(' -> ')
      log(`  ${String(count).padStart(5)}  ${from.padEnd(22)} ${to}`)
    }
    log(`  ${'TOTAL'.padStart(5)}  ${real.length} leads with stale bucket`)
  }

  if (APPLY && FIX_BUCKET && real.length > 0) {
    log()
    log('  --apply --bucket-cleanup : nulling out stale status_lead_type_id…')
    const r = await prisma.lead.updateMany({
      where: { id: { in: real.map((l) => l.id) } },
      data: { statusLeadTypeId: null },
    })
    log(`  ✓ ${r.count} leads cleared (now in Default bucket of their dept)`)
  }
  log()
}

async function reportBackwardSubStatuses() {
  log(BAR)
  log('3. BACKWARD-DIRECTION SUB-STATUSES — counsellor would be blocked')
  log(BAR)
  const rows = await prisma.$queryRaw<Array<{
    id: bigint
    sub_status: string
    from_dept: string
    to_dept: string
  }>>`
    SELECT
      ss.id, ss.sub_status,
      sd.name AS from_dept,
      md.name AS to_dept
    FROM lead_sub_statuses ss
    JOIN lead_statuses s ON s.id = ss.status_id
    LEFT JOIN lead_departments sd ON sd.id = s.department_id
    -- move_to is the configured target department (that is what the LeadConfig
    -- "Move To (Department)" picker writes); department_id is the legacy mirror
    -- kept only for rows migrated from the old CRM.
    LEFT JOIN lead_departments md ON md.id = COALESCE(ss.move_to, ss.department_id)
    WHERE COALESCE(ss.move_to, ss.department_id) IS NOT NULL
      AND sd.id <> md.id
      AND md.priority < sd.priority
      AND md.slug NOT IN ('marketing', 'consultant', 'archive')
      AND sd.slug NOT IN ('marketing', 'consultant', 'archive')
    ORDER BY ss.id
  `
  if (rows.length === 0) {
    log('  (none — no sub-status configured to move a lead backward)')
  } else {
    log('  Sub-statuses below will require admin role (counsellor blocked):')
    log('  id    sub-status                       from → to')
    log('  ----  ------------------------------- -----------------------------')
    for (const r of rows) {
      log(`  ${String(r.id).padEnd(4)}  ${r.sub_status.padEnd(31)} ${r.from_dept} → ${r.to_dept}`)
    }
  }
  log()
}

// ─── 4. Numeric lead_type ────────────────────────────────────────────────────
// `leads.lead_type` is a SLUG column ('new', 'not-interested', 'cbse-data', …).
// The old follow-up cascade wrote `String(subStatus.move_to)` into it, stamping
// a numeric DEPARTMENT id over the slug. Those leads match no lead-type filter.
// The write is gone; this cleans up what it left behind.
async function reportNumericLeadType() {
  log(BAR)
  log("4. CORRUPTED lead_type — numeric dept id written over the slug")
  log(BAR)

  // Not every numeric value is cascade damage: leads migrated from the old CRM
  // legitimately carry a numeric lead-TYPE id here. Only a value that names a
  // department and names NO lead type is unambiguously the cascade's doing.
  // Values that match both (dept 2 / lead-type 2, say) cannot be told apart and
  // are reported for a human to decide — never auto-reset.
  const rows = await prisma.$queryRaw<Array<{
    lead_type: string; leads: number; dept: string | null; lt: string | null
  }>>`
    SELECT l.lead_type, COUNT(*)::int AS leads, d.name AS dept, lt.title AS lt
    FROM leads l
    LEFT JOIN lead_departments d ON d.id::text = l.lead_type
    LEFT JOIN lead_types lt ON lt.id::text = l.lead_type
    WHERE l.trash = 0 AND l.lead_type ~ '^[0-9]+$'
    GROUP BY l.lead_type, d.name, lt.title
    ORDER BY leads DESC
  `
  if (rows.length === 0) {
    log('  (none — no numeric lead_type values)')
    log()
    return
  }

  log('  lead_type  leads    as department         as lead type          verdict')
  log('  ---------  -------  --------------------  --------------------  -------')
  let corrupt = 0
  let ambiguous = 0
  let legacy = 0
  for (const r of rows) {
    const verdict = r.dept && !r.lt ? 'CORRUPT' : r.dept && r.lt ? 'ambiguous' : 'legacy id'
    if (verdict === 'CORRUPT') corrupt += r.leads
    else if (verdict === 'ambiguous') ambiguous += r.leads
    else legacy += r.leads
    log(
      `  ${r.lead_type.padEnd(9)}  ${String(r.leads).padEnd(7)}  ` +
      `${(r.dept ?? '—').padEnd(20)}  ${(r.lt ?? '—').padEnd(20)}  ${verdict}`,
    )
  }
  log(`  ${corrupt} clearly corrupt · ${ambiguous} ambiguous (manual call) · ${legacy} legacy lead-type ids`)

  if (APPLY && FIX_LEADTYPE && corrupt > 0) {
    // 'new' is the schema default and what every other insert path writes.
    const res = await prisma.$executeRaw`
      UPDATE leads SET lead_type = 'new'
      WHERE trash = 0
        AND lead_type ~ '^[0-9]+$'
        AND EXISTS (SELECT 1 FROM lead_departments d WHERE d.id::text = leads.lead_type)
        AND NOT EXISTS (SELECT 1 FROM lead_types lt WHERE lt.id::text = leads.lead_type)
    `
    log(`  APPLIED: reset ${res} unambiguously-corrupt lead_type values to 'new'`)
  } else if (corrupt > 0) {
    log("  (run with --apply --leadtype-cleanup to reset the CORRUPT rows to 'new';")
    log('   ambiguous and legacy rows are left alone)')
  }
  log()
}

// ─── 5. asigned_leads drift ──────────────────────────────────────────────────
// Dept-scoped views read asigned_leads.department_id. The follow-up cascade
// only ever updated the ACTOR's own assignment row (`clrId: userid`), so an
// admin updating a counsellor's lead updated nothing here and the lead kept
// surfacing under its old department.
async function reportAssignedDrift() {
  log(BAR)
  log('5. asigned_leads OUT OF SYNC — assignment dept ≠ lead dept')
  log(BAR)

  const rows = await prisma.$queryRaw<Array<{ lead_dept: string | null; assigned_dept: string | null; count: number }>>`
    SELECT ld.name AS lead_dept, ad.name AS assigned_dept, COUNT(*)::int AS count
    FROM asigned_leads al
    JOIN leads l ON l.id = al.std_id
    LEFT JOIN lead_departments ld ON ld.id = l.department_id
    LEFT JOIN lead_departments ad ON ad.id = al.department_id
    WHERE al.status = 1 AND l.trash = 0
      AND al.department_id IS DISTINCT FROM l.department_id
    GROUP BY ld.name, ad.name
    ORDER BY count DESC
  `
  if (rows.length === 0) {
    log('  (none — every active assignment row matches its lead)')
    log()
    return
  }
  log('  count    lead sits in           assignment says')
  log('  -------  ---------------------  ---------------------')
  let total = 0
  for (const r of rows) {
    total += r.count
    log(`  ${String(r.count).padEnd(7)}  ${(r.lead_dept ?? '(none)').padEnd(21)}  ${r.assigned_dept ?? '(none)'}`)
  }
  log(`  TOTAL  ${total} assignment rows out of sync`)

  if (APPLY && FIX_ASSIGNED) {
    // The lead row is authoritative — it is what the status cascade writes.
    const res = await prisma.$executeRaw`
      UPDATE asigned_leads al
      SET department_id = l.department_id, status_lead_type_id = l.status_lead_type_id
      FROM leads l
      WHERE l.id = al.std_id AND al.status = 1 AND l.trash = 0
        AND al.department_id IS DISTINCT FROM l.department_id
    `
    log(`  APPLIED: re-synced ${res} assignment rows from their lead`)
  } else if (total > 0) {
    log('  (run with --apply --assigned-sync to re-sync these from the lead row)')
  }
  log()
}

async function main() {
  log()
  log(`Lead Workflow Audit  ${new Date().toISOString()}`)
  if (APPLY) log('Mode: --apply  (writes enabled — fixes will be committed)')
  else log('Mode: read-only  (use --apply with --mismatch / --bucket-cleanup / --leadtype-cleanup / --assigned-sync / --all)')
  log()

  const archiveIds = await getArchiveDeptIds()
  // Shared dept-name lookup — Prisma's schema models LeadDepartment.id only
  // as an FK column on Lead / LeadStatus / LeadTypeConfig, with no relation
  // field, so we hydrate names manually wherever we need them.
  const allDepts = await prisma.leadDepartment.findMany({ select: { id: true, name: true } })
  const deptNameById = new Map(allDepts.map((d) => [d.id.toString(), d.name]))

  await reportPipelineOrder()
  await reportLeadDeptSummary()
  await reportCrossDeptMismatch(archiveIds, deptNameById)
  await reportStaleBucket(archiveIds, deptNameById)
  await reportBackwardSubStatuses()
  await reportNumericLeadType()
  await reportAssignedDrift()
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
