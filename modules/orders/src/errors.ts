export type OrderErrorCode =
  | 'EMPTY_ORDER'
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  // productId given for a product with several variants — the line must name a variantId
  | 'VARIANT_REQUIRED'
  | 'OUT_OF_STOCK'
  | 'CUSTOMER_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_CANCELLED'
  | 'INVALID_STATUS_TRANSITION'
  // Unknown, inactive, used up, already used by this customer, or the subtotal is below its minimum
  | 'DISCOUNT_NOT_APPLICABLE'

export type OrderErrorData = { variantIds?: string[]; productIds?: string[]; variantId?: string; available?: number }

// Domain error; the API layer maps it to an HTTP error
export class OrderError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
    readonly data: OrderErrorData = {},
  ) {
    super(message)
    this.name = 'OrderError'
  }
}
