// Points where other modules act on what happens to an order, without orders knowing them (see defineHook in @shopnex/kit).
import type { Conn } from '@shopnex/db'
import { defineHook } from '@shopnex/kit'
import type * as orders from './orders'

export type OrderEvent = 'order.created' | 'order.paid' | 'order.fulfilled' | 'order.cancelled'

/**
 * Something happened to an order. Runs inside the transaction that changed it, so what a listener writes is only kept if the change
 * is. `load` reads the order as that transaction sees it, and only when a listener asks. Email listens (it sits above orders: it
 * reads them, and its tables point at them); both orders and payments run it.
 */
export const orderEvent = defineHook<
  { shopId: string; event: OrderEvent; load: () => Promise<Awaited<ReturnType<typeof orders.getById>>> },
  Conn
>('order.event')

/**
 * Money that was paid with a gift card goes back to it (an order was cancelled or partly refunded). Runs in the transaction that
 * records the refund; the gift card module puts the amount back on the card the order spent.
 */
/**
 * Everything an order took has been given back, or is on its way (a cancelled paid order, a full refund). Runs in the transaction
 * that records the refund. Gift cards listen: the cards a refunded order bought stop being spendable.
 */
export const orderFullyRefunded = defineHook<{ shopId: string; orderId: string }, Conn>('order.fully-refunded')

export const orderCreditRefunded = defineHook<{ shopId: string; orderId: string; amountCents: number }, Conn>(
  'order.credit-refunded',
)
