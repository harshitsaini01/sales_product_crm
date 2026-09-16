// What /api/auth/me actually returns for a tenant's admin — the exact payload
// the browser uses to decide which lead fields to render.
//
//   npm run check:me -- --tenant=britannica_bots
//
// Exists because "the UI is showing hidden fields" has two very different
// causes — a server that is not sending the config, or a browser running an
// old build — and guessing between them wastes everybody's time.

import 'dotenv/config'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(BigInt.prototype as any).toJSON = function () { return this.toString() }

import { sign } from 'jsonwebtoken'
import { app } from '../src/app'
import { getTenantBySlug } from '../src/services/tenant.service'
import { runWithTenant } from '../src/lib/tenant-context'
import { prisma } from '../src/lib/prisma'

const slug = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1]

async function main() {
  if (!slug) {
    console.error('Usage: npm run check:me -- --tenant=<slug>')
    process.exit(1)
  }
  const ctx = await getTenantBySlug(slug)
  if (!ctx) {
    console.error(`No customer "${slug}".`)
    process.exit(1)
  }

  const admin = await runWithTenant(ctx, () =>
    prisma.user.findFirst({
      where: { role: 'admin', status: 1 },
      select: { id: true, name: true, email: true, activeWebSessionId: true },
    }),
  )
  if (!admin?.activeWebSessionId) {
    console.error('No admin with an active web session — sign in once in the browser first.')
    process.exit(1)
  }

  const token = sign(
    {
      userId: Number(admin.id),
      role: 'admin',
      roles: ['admin'],
      name: admin.name,
      email: admin.email,
      sid: admin.activeWebSessionId,
      kind: 'web',
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' },
  )

  const res = await app.request('http://localhost/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json()) as Record<string, never>

  console.log(`\n/auth/me for ${ctx.companyName} — HTTP ${res.status}\n`)

  const lf = body.leadFields as never as {
    hiddenGroups?: string[]
    hiddenFields?: string[]
    hiddenFieldKeys?: string[]
    labels?: Record<string, string>
  } | undefined

  if (!lf) {
    console.log('leadFields: MISSING — the browser has nothing to hide fields with.')
  } else {
    console.log(`hiddenGroups     (${lf.hiddenGroups?.length ?? 0}): ${lf.hiddenGroups?.join(', ') || '(none)'}`)
    console.log(`hiddenFields     (${lf.hiddenFields?.length ?? 0})`)
    console.log(`hiddenFieldKeys  (${lf.hiddenFieldKeys?.length ?? 0})  <- what the UI actually reads`)
    console.log(`labels           (${Object.keys(lf.labels ?? {}).length}): ${JSON.stringify(lf.labels ?? {})}`)

    const shouldBeHidden = ['neetQualified', 'ucatVScore', 'dmatIrScore', 'satExamDate', 'hs', 'father']
    console.log('\nspot check — are these hidden?')
    for (const k of shouldBeHidden) {
      console.log(`  ${k.padEnd(16)} ${lf.hiddenFieldKeys?.includes(k) ? 'yes' : 'NO  <-- would still render'}`)
    }
  }

  console.log(`\nvertical: ${(body.tenant as never as { vertical?: string })?.vertical ?? '(none)'}`)
  const labels = body.labels as never as Record<string, { singular: string }> | undefined
  console.log(`terminology: student = ${labels?.student?.singular ?? '(none)'}`)
}

main()
  .catch((e) => console.error(e))
  .finally(() => process.exit(0))
