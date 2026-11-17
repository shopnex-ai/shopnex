// How an order uses a discount. Pricing owns the discount (its code, limits and usage count); orders owns the record
// that an order used it, so pricing never needs the orders or customers tables.
import { and, eq } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { discountService } from '@shopnex/pricing'
import { discountRedemptions } from './orders.schema'

/** Whether this customer has already used the discount */
export async function hasRedeemed(conn: Conn, discountId: string, customerId: string) {
  const [used] = await conn
    .select({ id: discountRedemptions.id })
    .from(discountRedemptions)
    .where(and(eq(discountRedemptions.discountId, discountId), eq(discountRedemptions.customerId, customerId)))
    .limit(1)
  return !!used
}

/** For placing an order: locks the discount, then checks it (the code, its limits, once per customer) */
export const checkDiscount = (tx: Conn, shopId: string, code: string, customerId: string | null) =>
  discountService.checkForOrder(tx, shopId, code, customerId, (discountId, customer) =>
    hasRedeemed(tx, discountId, customer),
  )

/** Counts the use and records it, in the order's transaction (after checkDiscount locked the discount) */
export async function redeemDiscount(
  tx: Conn,
  discount: Parameters<typeof discountService.redeem>[1],
  order: { id: string; customerId: string | null },
) {
  await discountService.redeem(tx, discount)
  await tx
    .insert(discountRedemptions)
    .values({ discountId: discount.id, orderId: order.id, customerId: order.customerId })
}
