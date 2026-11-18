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
