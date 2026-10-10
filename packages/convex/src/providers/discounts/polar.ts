import { z } from 'zod'
import { requireEnv } from '../../lib/env'
import type { DiscountsProvider, Redemption } from './types'

const discountsSchema = z.object({ items: z.array(z.object({ id: z.string(), code: z.string().nullable() })) })
const ordersSchema = z.object({
  items: z.array(z.object({ id: z.string(), created_at: z.string() })),
  pagination: z.object({ max_page: z.number() }),
})

/**
 * Polar, which Formstep bills through. Reads only: the discount's id by its
 * code, then the orders that used it. Needs an organization access token.
 */
export const polarDiscounts: DiscountsProvider = {
  name: 'polar',
  async redemptions(args): Promise<Redemption[]> {
    const base = requireEnv('POLAR_API_BASE')
    const token = requireEnv('POLAR_ACCESS_TOKEN')
    const organizationId = requireEnv('POLAR_ORGANIZATION_ID')
    const headers = { Authorization: `Bearer ${token}` }
    const discounts = discountsSchema.parse(
      await getJson(`${base}/v1/discounts?organization_id=${organizationId}&query=${encodeURIComponent(args.code)}&limit=50`, headers)
    )
    const discount = discounts.items.find((item) => item.code?.toUpperCase() === args.code.toUpperCase())
    if (!discount) throw new Error(`Polar has no discount with code ${args.code}`)
    const out: Redemption[] = []
    for (let page = 1; ; page += 1) {
      const orders = ordersSchema.parse(
        await getJson(`${base}/v1/orders?organization_id=${organizationId}&discount_id=${discount.id}&page=${page}&limit=100`, headers)
      )
      for (const order of orders.items) {
        const at = new Date(order.created_at).getTime()
        if (at >= args.since) out.push({ orderId: order.id, at })
      }
      if (page >= orders.pagination.max_page) break
    }
    return out
  },
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Polar request failed: ${response.status} ${await response.text()}`)
  return response.json()
}
