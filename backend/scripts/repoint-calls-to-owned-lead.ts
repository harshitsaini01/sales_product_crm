// One-off repair: move calls that were filed against a duplicate lead row owned
// by SOMEONE ELSE onto the copy of the same number that the caller actually owns.
//
// Why this exists
//   The same person is often in the CRM several times (re-import, second web
//   enquiry) and the duplicates get split across counsellors. Until the fix in
//   src/routes/calls.routes.ts (resolveLeadId), a synced call kept whatever lead
//   id the device sent, so counsellor A's call could land on counsellor B's copy
//   of the lead — B's pipeline showed work B never did, and A's lead looked
//   uncalled. New calls are attributed correctly now; this cleans up the history.
//
// Rule — deliberately conservative. A call is moved ONLY when ALL hold:
//   1. it carries a lead id and is not a TRIGGERED placeholder;
//   2. the lead it sits on is NOT actively assigned to the caller;
//   3. exactly one live (non-trashed) lead carrying the same number IS actively
//      assigned to the caller — or, when several are, exactly one of them is in
//      one of that counsellor's calling tasks;
//   4. the target lead's number really matches the number that was dialled.
//   Anything ambiguous is left untouched and reported.
//
// Safety
//   Dry-run by default. --apply writes a backup of every (call id → old lead id)
//   to backend/backups/ BEFORE updating, and --revert <file> puts them back.
//
// Usage:
//   npx tsx scripts/repoint-calls-to-owned-lead.ts             # dry-run report
//   npx tsx scripts/repoint-calls-to-owned-lead.ts --apply      # fix + write backup
//   npx tsx scripts/repoint-calls-to-owned-lead.ts --revert backups/<file>.json
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { phoneKey } from '../src/utils/phone'

const APPLY = process.argv.includes('--apply')
const REVERT_AT = process.argv.indexOf('--revert')
const REVERT_FILE = REVERT_AT >= 0 ? process.argv[REVERT_AT + 1] : null
const BACKUP_DIR = path.join(process.cwd(), 'backups')

type Move = { callId: string; from: string; to: string; userId: string; phone: string }

async function revert(file: string) {
  const moves: Move[] = JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`Reverting ${moves.length} calls from ${file}`)
  let done = 0
  for (const move of moves) {
    await prisma.mobileCall.update({ where: { id: BigInt(move.callId) }, data: { leadId: BigInt(move.from) } })
    if (++done % 200 === 0) console.log(`  ${done}/${moves.length}`)
  }
  console.log(`Reverted ${done} calls.`)
}

async function main() {
  if (REVERT_FILE) return revert(REVERT_FILE)

  console.log(APPLY ? 'APPLY mode — rows will be updated.' : 'DRY RUN — no rows will be changed.\n')

  // 1. Every call that carries a lead link.
  const calls = await prisma.mobileCall.findMany({
    where: { leadId: { not: null }, status: { not: 'TRIGGERED' } },
    select: { id: true, leadId: true, userId: true, phoneNumber: true },
  })

  // 2. Who actively owns what. One pass over live assignments gives both
  //    "does the caller own the lead this call sits on" and "which copy of this
  //    number does the caller own".
  const assignments = await prisma.asignedLead.findMany({
    where: { status: 1 },
    select: { stdId: true, clrId: true, lead: { select: { trash: true, mobile: true, mobile2: true, mobile3: true } } },
  })
  const ownersOfLead = new Map<string, Set<string>>()
  const ownedByUserAndNumber = new Map<string, Set<string>>()
  for (const row of assignments) {
    const leadId = row.stdId.toString()
    const userId = row.clrId.toString()
    if (!ownersOfLead.has(leadId)) ownersOfLead.set(leadId, new Set())
    ownersOfLead.get(leadId)!.add(userId)
    if (row.lead.trash !== 0) continue // never move a call onto a binned lead
    for (const value of [row.lead.mobile, row.lead.mobile2, row.lead.mobile3]) {
      const key = phoneKey(value)
      if (!key) continue
      const mapKey = `${userId}:${key}`
      if (!ownedByUserAndNumber.has(mapKey)) ownedByUserAndNumber.set(mapKey, new Set())
      ownedByUserAndNumber.get(mapKey)!.add(leadId)
    }
  }

  // 3. Classify.
  const moves: Move[] = []
  const ambiguous: Move[] = []
  let ownedAlready = 0
  let noOwnedCopy = 0
  let unusableNumber = 0
  const candidatesByUser = new Map<string, { callId: bigint; options: string[]; from: string; phone: string }[]>()

  for (const call of calls) {
    const leadId = call.leadId!.toString()
    const userId = call.userId.toString()
    if (ownersOfLead.get(leadId)?.has(userId)) { ownedAlready++; continue }
    const key = phoneKey(call.phoneNumber)
    if (!key) { unusableNumber++; continue }
    const owned = [...(ownedByUserAndNumber.get(`${userId}:${key}`) || [])].filter((id) => id !== leadId)
    if (!owned.length) { noOwnedCopy++; continue }
    if (owned.length === 1) {
      moves.push({ callId: call.id.toString(), from: leadId, to: owned[0], userId, phone: call.phoneNumber })
      continue
    }
    // Several copies owned by this counsellor — resolve via their calling tasks below.
    const list = candidatesByUser.get(userId) || []
    list.push({ callId: call.id, options: owned, from: leadId, phone: call.phoneNumber })
    candidatesByUser.set(userId, list)
  }

  // 4. Tie-break the multi-copy cases the same way resolveLeadId does: the copy
  //    that sits in one of this counsellor's calling tasks is the one they were
  //    working from. Still ambiguous after that → leave it alone.
  for (const [userId, rows] of candidatesByUser.entries()) {
    const optionIds = [...new Set(rows.flatMap((row) => row.options))].map((id) => BigInt(id))
    const inTasks = await prisma.leadWorkBatchItem.findMany({
      where: { leadId: { in: optionIds }, batch: { assignedToId: BigInt(userId) } },
      select: { leadId: true },
    })
    const taskLeads = new Set(inTasks.map((item) => item.leadId.toString()))
    for (const row of rows) {
      const preferred = row.options.filter((id) => taskLeads.has(id))
      const move: Move = { callId: row.callId.toString(), from: row.from, to: preferred[0] || row.options[0], userId, phone: row.phone }
      if (preferred.length === 1) moves.push(move)
      else ambiguous.push(move)
    }
  }

  console.log(`calls with a lead link          : ${calls.length}`)
  console.log(`  already on a lead they own    : ${ownedAlready}`)
  console.log(`  caller owns no copy — left    : ${noOwnedCopy}`)
  console.log(`  unusable number — left        : ${unusableNumber}`)
  console.log(`  ambiguous (several copies)    : ${ambiguous.length}  → left untouched`)
  console.log(`  TO MOVE                       : ${moves.length}`)
  const affectedLeads = new Set(moves.flatMap((move) => [move.from, move.to]))
  console.log(`  leads affected                : ${affectedLeads.size}`)
  for (const move of moves.slice(0, 10)) {
    console.log(`    call ${move.callId}: lead ${move.from} → ${move.to} (counsellor ${move.userId}, ${move.phone})`)
  }
  if (moves.length > 10) console.log(`    … and ${moves.length - 10} more`)

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.')
    return
  }
  if (!moves.length) {
    console.log('\nNothing to do.')
    return
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = path.join(BACKUP_DIR, `repoint-calls-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify(moves, null, 1))
  console.log(`\nBackup written: ${backupFile}`)

  let done = 0
  const CHUNK = 200
  for (let index = 0; index < moves.length; index += CHUNK) {
    const chunk = moves.slice(index, index + CHUNK)
    await prisma.$transaction(chunk.map((move) => prisma.mobileCall.update({
      where: { id: BigInt(move.callId) },
      data: { leadId: BigInt(move.to) },
    })))
    done += chunk.length
    console.log(`  updated ${done}/${moves.length}`)
  }
  console.log(`\nDone. ${done} calls now sit on the lead their caller owns.`)
  console.log(`Undo with: npx tsx scripts/repoint-calls-to-owned-lead.ts --revert "${backupFile}"`)
}

main()
  .catch((error) => { console.error(error); process.exit(1) })
  .finally(() => prisma.$disconnect())
