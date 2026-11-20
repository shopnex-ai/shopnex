// The shapes of this module's API: what the admin routes accept and answer. Plain Zod, no oRPC or server code, so the
// admin UI imports the same schemas for its forms.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { GIFT_CARD_TRANSACTION_KINDS, giftCards, giftCardTransactions } from './gift-cards.schema'

export const giftCardOutput = createSelectSchema(giftCards)
export const giftCardTransactionOutput = createSelectSchema(giftCardTransactions, {
  kind: () => z.enum(GIFT_CARD_TRANSACTION_KINDS),
})
export const giftCardDetailOutput = giftCardOutput.extend({ transactions: z.array(giftCardTransactionOutput) })

// Staff issue a card by hand: an amount in minor units, and optionally who it is for
export const giftCardIssueInput = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  recipientEmail: z.email().nullish(),
  // JSON clients send ISO strings
  expiresAt: z.coerce.date().nullish(),
  note: z.string().trim().max(500).nullish(),
})

export const giftCardAdjustInput = z.object({
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Enter an amount that is not zero'),
  note: z.string().trim().max(500).nullish(),
})
