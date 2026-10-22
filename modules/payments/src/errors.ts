export type PaymentErrorCode =
  | 'SESSION_NOT_FOUND'
  // Already rejected / expired (resolve), or already resolved (reject)
  | 'SESSION_CLOSED'
  // configure: the caller isn't an installed app, or its URLs aren't on the app's own origin
  | 'NOT_A_PAYMENTS_APP'
  | 'INVALID_SESSION_URL'
  // The order can't take a payment (paid, cancelled, manual method…)
  | 'NOT_PAYABLE'
  // The app didn't answer the payment session request with a redirect URL
  | 'PROVIDER_UNAVAILABLE'

// Domain error; the API layer maps it to an HTTP error
export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}
