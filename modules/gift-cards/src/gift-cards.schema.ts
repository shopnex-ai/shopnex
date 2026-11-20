// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts.
// A gift card is a balance the buyer pays with. It is issued when a gift card product is paid for, or by staff, and every change
// to the balance is a row in gift_card_transactions, so the balance can always be explained.
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from '@shopnex/core/schema'

export const GIFT_CARD_TRANSACTION_KINDS = ['issue', 'redeem', 'refund', 'adjust'] as const
export type GiftCardTransactionKind = (typeof GIFT_CARD_TRANSACTION_KINDS)[number]

export const giftCards = pgTable(
  'gift_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // What the holder types at checkout: 16 letters and digits, upper case, no dashes (shown as XXXX-XXXX-XXXX-XXXX)
    code: text('code').notNull(),
    // Money is in the shop's currency, recorded here so the card stays correct if the shop changes it
    currency: text('currency').notNull(),
    initialCents: integer('initial_cents').notNull(),
    balanceCents: integer('balance_cents').notNull(),
    // Staff can switch a card off (lost, fraud); it keeps its balance and history
    active: boolean('active').notNull().default(true),
    // Null = never expires
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Who the card is for, when the buyer sent it as a gift; the code is emailed here
    recipientEmail: text('recipient_email'),
    // The order that bought it (null for cards staff issued). The order is kept or not independently of the card.
    purchaseOrderId: uuid('purchase_order_id'),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('gift_cards_shop_code_idx').on(t.shopId, t.code)],
)

// amountCents is signed: positive adds to the balance (issue, refund), negative takes from it (redeem)
export const giftCardTransactions = pgTable(
  'gift_card_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    giftCardId: uuid('gift_card_id')
      .notNull()
      .references(() => giftCards.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<GiftCardTransactionKind>().notNull(),
    amountCents: integer('amount_cents').notNull(),
    // The balance after this change
    balanceAfterCents: integer('balance_after_cents').notNull(),
    // The order it was spent on or bought by, when there is one
    orderId: uuid('order_id'),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('gift_card_transactions_card_idx').on(t.giftCardId, t.createdAt)],
)

export type GiftCard = typeof giftCards.$inferSelect
export type GiftCardTransaction = typeof giftCardTransactions.$inferSelect
