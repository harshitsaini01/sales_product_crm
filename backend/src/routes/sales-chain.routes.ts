// ─────────────────────────────────────────────────────────────────────────────
//   GET /api/sales-chain?deal=|quote=|contract=|order=|invoice=   one family
//   GET /api/sales-chain/attention                                the Sales Desk
//
// Gated on `sales_docs` like the four document routers it reads across.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { authenticate } from '../middleware/auth'
import { resolveChain, attention, type ChainRef } from '../services/crm/sales-chain.service'

export const salesChainRoutes = new Hono()

salesChainRoutes.use('*', authenticate)

salesChainRoutes.get('/attention', async (c) => c.json(await attention()))

salesChainRoutes.get('/', async (c) => {
  const q = c.req.query()
  const pick = (k: string) => (q[k] && /^\d+$/.test(q[k]) ? BigInt(q[k]) : null)

  let ref: ChainRef | null = null
  if (pick('deal')) ref = { deal: pick('deal')! }
  else if (pick('quote')) ref = { quote: pick('quote')! }
  else if (pick('contract')) ref = { contract: pick('contract')! }
  else if (pick('order')) ref = { order: pick('order')! }
  else if (pick('invoice')) ref = { invoice: pick('invoice')! }
  if (!ref) return c.json({ error: 'Pass one of deal, quote, contract, order or invoice.' }, 400)

  const chain = await resolveChain(ref)
  if (!chain) return c.json({ error: 'Not found' }, 404)
  return c.json(chain)
})
