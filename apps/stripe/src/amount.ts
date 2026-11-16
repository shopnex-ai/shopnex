// ShopNex keeps every amount in its currency's smallest unit (cents, yen, fils). Stripe does too, with three exceptions.

// ISK and UGX are zero-decimal currencies that Stripe still takes as two-decimal values ending in 00 (500 for ISK 5)
const TWO_DECIMAL_ON_STRIPE = new Set(['ISK', 'UGX'])
// Stripe takes these in thousandths and requires the last digit to be 0
const WHOLE_HUNDREDTHS_ON_STRIPE = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

const digitsOf = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

/** The `amount` to send Stripe for `minor` units of `currency`; throws for an amount Stripe cannot take */
export function toStripeAmount(minor: number, currency: string) {
  const code = currency.toUpperCase()
  if (TWO_DECIMAL_ON_STRIPE.has(code)) return minor * 100
  if (WHOLE_HUNDREDTHS_ON_STRIPE.has(code) && minor % 10 !== 0) {
    throw new Error(
      `Stripe takes ${code} amounts in multiples of 0.010: ${minor / 10 ** digitsOf(code)} cannot be charged`,
    )
  }
  return minor
}
