import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const PricingError = defineError('PricingError', {
  DISCOUNT_NOT_FOUND: 'NOT_FOUND',
  // Another discount in this shop already uses the code (case-insensitive)
  CODE_TAKEN: 'CONFLICT',
  // Value out of range for its type, or ends before it starts
  INVALID_DISCOUNT: 'BAD_REQUEST',
  TAX_RATE_NOT_FOUND: 'NOT_FOUND',
  // The shop already has a rate for this country / province
  TAX_RATE_EXISTS: 'CONFLICT',
})
export type PricingError = InstanceType<typeof PricingError>
export type PricingErrorCode = ErrorCode<typeof PricingError>
