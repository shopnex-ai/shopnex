import { defineError, type ErrorCode } from '@shopnex/kit'

export type CartErrorData = {
  variantIds?: string[]
  lineIds?: string[]
  variantId?: string
  available?: number
}

// Each code's status is the one the Admin API answers with; the Storefront maps the same errors to its typed ones
const CartErrorBase = defineError('CartError', {
  CART_NOT_FOUND: 'NOT_FOUND',
  CART_COMPLETED: 'CONFLICT',
  EMPTY_CART: 'BAD_REQUEST',
  LINE_NOT_FOUND: 'BAD_REQUEST',
  // variant unknown, from another shop, or its product isn't active
  VARIANT_NOT_FOUND: 'NOT_FOUND',
  OUT_OF_STOCK: 'BAD_REQUEST',
  // checkout: unknown/inactive shipping rate or payment method, or none chosen when the shop requires one
  INVALID_SHIPPING_RATE: 'BAD_REQUEST',
  INVALID_PAYMENT_METHOD: 'BAD_REQUEST',
  // checkout: the gift card code can't be used (unknown, disabled, expired, empty)
  GIFT_CARD_NOT_APPLICABLE: 'BAD_REQUEST',
  // too many codes the shop doesn't have, from one visitor
  TOO_MANY_GUESSES: 'TOO_MANY_REQUESTS',
  // a carrier service: not an installed app, or a rates URL outside the app's origin
  NOT_A_CARRIER_APP: 'FORBIDDEN',
  INVALID_RATES_URL: 'BAD_REQUEST',
})
export type CartErrorCode = ErrorCode<typeof CartErrorBase>

export class CartError extends CartErrorBase {
  constructor(
    code: CartErrorCode,
    message: string,
    readonly data: CartErrorData = {},
  ) {
    super(code, message)
  }
}
