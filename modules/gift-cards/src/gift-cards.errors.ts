import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const GiftCardError = defineError('GiftCardError', {
  GIFT_CARD_NOT_FOUND: 'NOT_FOUND',
  // The amount or expiry is out of range
  INVALID_GIFT_CARD: 'BAD_REQUEST',
  // Switched off, expired or empty: the card exists but can't be spent
  GIFT_CARD_UNAVAILABLE: 'BAD_REQUEST',
  // Asked for more than the card holds
  INSUFFICIENT_BALANCE: 'CONFLICT',
})
export type GiftCardError = InstanceType<typeof GiftCardError>
export type GiftCardErrorCode = ErrorCode<typeof GiftCardError>
