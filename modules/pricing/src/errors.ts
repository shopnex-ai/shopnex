export type PricingErrorCode =
  | 'DISCOUNT_NOT_FOUND'
  // Another discount in this shop already uses the code (case-insensitive)
  | 'CODE_TAKEN'
  // Value out of range for its type, or ends before it starts
  | 'INVALID_DISCOUNT'
  | 'TAX_RATE_NOT_FOUND'
  // The shop already has a rate for this country / province
  | 'TAX_RATE_EXISTS'

// Domain error; the API layer maps it to an HTTP error
export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PricingError'
  }
}
