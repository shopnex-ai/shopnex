export type CartErrorCode =
  | 'CART_NOT_FOUND'
  | 'CART_COMPLETED'
  | 'EMPTY_CART'
  | 'LINE_NOT_FOUND'
  // variant unknown, from another shop, or its product isn't active
  | 'VARIANT_NOT_FOUND'
  | 'OUT_OF_STOCK'
  // checkout: unknown/inactive shipping rate or payment method, or none chosen when the shop requires one
  | 'INVALID_SHIPPING_RATE'
  | 'INVALID_PAYMENT_METHOD'
  // a carrier service: not an installed app, or a rates URL outside the app's origin
  | 'NOT_A_CARRIER_APP'
  | 'INVALID_RATES_URL'

export type CartErrorData = {
  variantIds?: string[]
  lineIds?: string[]
  variantId?: string
  available?: number
}

// Domain error; the API layer maps it to an HTTP error
export class CartError extends Error {
  constructor(
    readonly code: CartErrorCode,
    message: string,
    readonly data: CartErrorData = {},
  ) {
    super(message)
    this.name = 'CartError'
  }
}
