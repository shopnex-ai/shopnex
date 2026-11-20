// What cart does when another module says something happened. Loaded by the module and the package entry, so any process that can
// uninstall an app through the API has it (api/tests/hooks.test.ts and uninstall-hooks.test.ts guard it).
import { and, eq } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { defineHook } from '@shopnex/kit'
import { appUninstalled } from '@shopnex/apps'
import { carrierServices } from './cart.schema'

// A carrier app's service goes with it: its rates stop being offered at checkout
appUninstalled.on('cart.carrier-services', async (conn, { shopId, appId }) => {
  await conn.delete(carrierServices).where(and(eq(carrierServices.shopId, shopId), eq(carrierServices.appId, appId)))
})

/** Money a buyer pays with that is not a payment method's: a gift card. `label` is what the buyer sees, `kind` says what it is. */
export type CheckoutCredit = { kind: string; label: string; amountCents: number }

/**
 * A buyer entered a code that pays part of the order (a gift card). Cart doesn't know what such codes are: the module that does
 * (gift cards, which sits above cart) listens, works out what the code pays and adds it to `credits`, or says in `error` why it
 * can't be used. Run to show the totals and to check the code before an order is placed (`orderId` null: nothing is spent, and
 * the listener may count wrong guesses against `ip`), and again when the order is placed, inside the transaction that creates it
 * (`orderId` set: the listener spends the code on that order, and an `error` there refuses the order).
 */
export const checkoutCredit = defineHook<
  {
    shopId: string
    code: string
    /** The order's currency: money in another one can't pay for it */
    currency: string
    /** The visitor's address, for limits on guessing codes; null when there is none worth trusting */
    ip: string | null
    /** The most the code may pay: what is due, without the part that can't be paid this way (gift card products) */
    eligibleCents: number
    orderId: string | null
    credits: CheckoutCredit[]
    error: string | null
  },
  Conn
>('checkout.credit')
