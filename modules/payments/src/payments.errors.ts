import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const PaymentError = defineError('PaymentError', {
  SESSION_NOT_FOUND: 'NOT_FOUND',
  // Already rejected / expired (resolve), or already resolved (reject)
  SESSION_CLOSED: 'CONFLICT',
  // configure: the caller isn't an installed app, or its URLs aren't on the app's own origin
  NOT_A_PAYMENTS_APP: 'FORBIDDEN',
  INVALID_SESSION_URL: 'BAD_REQUEST',
  // The order can't take a payment (paid, cancelled, manual method…)
  NOT_PAYABLE: 'CONFLICT',
  // The app didn't answer the payment session request with a redirect URL
  PROVIDER_UNAVAILABLE: 'BAD_GATEWAY',
})
export type PaymentError = InstanceType<typeof PaymentError>
export type PaymentErrorCode = ErrorCode<typeof PaymentError>
