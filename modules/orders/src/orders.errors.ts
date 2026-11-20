import { defineError, type ErrorCode } from '@shopnex/kit'

export type OrderErrorData = { variantIds?: string[]; productIds?: string[]; variantId?: string; available?: number }

// Each code's status is the one the Admin API answers with; the Storefront maps the same errors to its typed ones
const OrderErrorBase = defineError('OrderError', {
  EMPTY_ORDER: 'BAD_REQUEST',
  PRODUCT_NOT_FOUND: 'BAD_REQUEST',
  VARIANT_NOT_FOUND: 'BAD_REQUEST',
  // productId given for a product with several variants: the line must name a variantId
  VARIANT_REQUIRED: 'BAD_REQUEST',
  OUT_OF_STOCK: 'BAD_REQUEST',
  CUSTOMER_NOT_FOUND: 'BAD_REQUEST',
  ORDER_NOT_FOUND: 'NOT_FOUND',
  ORDER_CANCELLED: 'CONFLICT',
  INVALID_STATUS_TRANSITION: 'CONFLICT',
  // A refund of nothing, of a fraction of a cent, or of more than is left to give back
  INVALID_REFUND: 'BAD_REQUEST',
  // A payment recorded on an order is not a whole number of cents, or is more than is left to pay
  INVALID_PAYMENT: 'BAD_REQUEST',
  // Unknown, inactive, used up, already used by this customer, or the subtotal is below its minimum
  DISCOUNT_NOT_APPLICABLE: 'BAD_REQUEST',
})
export type OrderErrorCode = ErrorCode<typeof OrderErrorBase>

export class OrderError extends OrderErrorBase {
  constructor(
    code: OrderErrorCode,
    message: string,
    readonly data: OrderErrorData = {},
  ) {
    super(code, message)
  }
}
