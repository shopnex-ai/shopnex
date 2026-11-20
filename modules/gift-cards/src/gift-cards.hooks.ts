// What gift cards do when another module says something happened. Loaded by the module and the package entry, so any process that
// places or pays an order through the API has it (api/tests/hooks.test.ts guards it). Gift cards sit above cart and orders: they
// listen, and neither of those knows them.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { checkoutCredit } from '@shopnex/cart'
import { products } from '@shopnex/catalog/schema'
import { orderCreditRefunded, orderEvent, orderService } from '@shopnex/orders'
import * as giftCards from './gift-cards'
import { giftCards as giftCardsTable, giftCardTransactions } from './gift-cards.schema'

// A code entered at checkout. Shown in the totals (no order yet), then spent on the order when it is placed, in that transaction.
checkoutCredit.on('gift-cards.pay', async (tx, payload) => {
  const card = await giftCards.findByCode(payload.shopId, payload.code, tx)
  if (!card) {
    payload.error = "This gift card code isn't valid"
    return
  }
  const reason = giftCards.unavailableReason(card)
  if (reason) {
    payload.error = reason
    return
  }
  const amountCents = giftCards.coverage(card, payload.eligibleCents)
  if (amountCents <= 0) {
    payload.error = "A gift card can't pay for a gift card"
    return
  }
  if (payload.orderId) {
    await giftCards.redeem(tx, payload.shopId, card.id, amountCents, payload.orderId)
    await orderService.recordCreditPayment(tx, payload.shopId, payload.orderId, amountCents)
  }
  payload.credits.push({ kind: 'gift_card', label: `Gift card ending ${card.code.slice(-4)}`, amountCents })
})

// A paid order for gift card products issues the cards: one per unit, for the price paid. Once per order.
orderEvent.on('gift-cards.issue', async (tx, { shopId, event, load }) => {
  if (event !== 'order.paid') return
  const order = await load()
  if (!order) return
  const productIds = order.items.flatMap((i) => (i.productId ? [i.productId] : []))
  if (productIds.length === 0) return
  const gift = new Set(
    (
      await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, productIds), eq(products.isGiftCard, true)))
    ).map((p) => p.id),
  )
  const lines = order.items.filter((i) => i.productId && gift.has(i.productId))
  if (lines.length === 0) return
  const [existing] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(giftCardsTable)
    .where(eq(giftCardsTable.purchaseOrderId, order.id))
  if ((existing?.count ?? 0) > 0) return
  for (const line of lines) {
    // What the buyer paid for it: the price, less its share of discounts
    const paidCents = Math.round((line.unitPriceCents * line.quantity - line.discountCents) / line.quantity)
    if (paidCents < 1) continue
    for (let n = 0; n < line.quantity; n++) {
      await giftCards.issue(shopId, { amountCents: paidCents, purchaseOrderId: order.id }, tx)
    }
  }
})

// Money that was paid with a card goes back to it: what the order spent, less what has already come back
orderCreditRefunded.on('gift-cards.refund', async (tx, { shopId, orderId, amountCents }) => {
  const spent = await tx
    .select({
      giftCardId: giftCardTransactions.giftCardId,
      kind: giftCardTransactions.kind,
      cents: sql<number>`coalesce(sum(${giftCardTransactions.amountCents}), 0)::int`,
    })
    .from(giftCardTransactions)
    .innerJoin(giftCardsTable, eq(giftCardsTable.id, giftCardTransactions.giftCardId))
    .where(
      and(
        eq(giftCardsTable.shopId, shopId),
        eq(giftCardTransactions.orderId, orderId),
        inArray(giftCardTransactions.kind, ['redeem', 'refund']),
      ),
    )
    .groupBy(giftCardTransactions.giftCardId, giftCardTransactions.kind)
  let left = amountCents
  for (const card of new Set(spent.map((s) => s.giftCardId))) {
    const redeemed = -(spent.find((s) => s.giftCardId === card && s.kind === 'redeem')?.cents ?? 0)
    const refunded = spent.find((s) => s.giftCardId === card && s.kind === 'refund')?.cents ?? 0
    const back = Math.min(left, redeemed - refunded)
    if (back <= 0) continue
    await giftCards.refund(tx, shopId, card, back, orderId)
    left -= back
  }
})
