// Order money math: discount allocation, tax and totals. Pure (no DB, no Node APIs) so the hosted
// checkout can show the same totals in the browser that the server charges.
// All amounts are integer minor units; rounding happens per line, as in Shopify.

export type PricingDiscount = {
  code: string
  type: 'percentage' | 'fixed_amount' | 'free_shipping'
  value: number
  minSubtotalCents: number | null
}

export type PricingTaxRate = { countryCode: string; province: string | null; name: string; ratePercent: number }

export type PricingInput = {
  /** Line totals (unit price × quantity), in order */
  lines: number[]
  shippingCents: number
  /** A discount the buyer is allowed to use (eligibility other than the minimum subtotal is checked elsewhere) */
  discount?: PricingDiscount | null
  /** The rate for the shipping address (see taxRateFor); null = no tax */
  taxRate?: Pick<PricingTaxRate, 'name' | 'ratePercent'> | null
  taxesIncluded: boolean
  taxShipping: boolean
}

export type PricingResult = {
  subtotalCents: number
  shippingCents: number
  /** Per line, same order as the input */
  lineDiscountCents: number[]
  shippingDiscountCents: number
  /** Line + shipping discounts */
  discountCents: number
  /** false when a discount was given but the subtotal is below its minimum */
  discountApplicable: boolean
  taxCents: number
  taxLines: { title: string; ratePercent: number; amountCents: number }[]
  taxesIncluded: boolean
  totalCents: number
}

// Most specific rate for an address: province match (case-insensitive) beats the country-wide rate
export function taxRateFor<T extends Pick<PricingTaxRate, 'countryCode' | 'province'>>(
  rates: readonly T[],
  address: { countryCode: string; province?: string | null } | null | undefined,
): T | null {
  if (!address) return null
  const country = rates.filter((r) => r.countryCode === address.countryCode.toUpperCase())
  const province = address.province?.trim().toLowerCase()
  return (
    (province ? country.find((r) => r.province?.trim().toLowerCase() === province) : undefined) ??
    country.find((r) => r.province == null) ??
    null
  )
}

// Splits `amount` across `weights` proportionally; remainders go to the largest fractions so the parts add up
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0 || amount === 0) return weights.map(() => 0)
  const exact = weights.map((w) => (amount * w) / total)
  const parts = exact.map(Math.floor)
  let left = amount - parts.reduce((a, b) => a + b, 0)
  const byFraction = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of byFraction) {
    if (left <= 0) break
    parts[i]! += 1
    left -= 1
  }
  return parts
}

// Tax on `base`: added on top (exclusive) or the part of `base` that is tax (inclusive)
const taxOn = (base: number, ratePercent: number, included: boolean) =>
  Math.round(included ? (base * ratePercent) / (100 + ratePercent) : (base * ratePercent) / 100)

export function calculate(input: PricingInput): PricingResult {
  const subtotalCents = input.lines.reduce((a, b) => a + b, 0)
  const { discount, taxRate } = input
  const discountApplicable =
    !discount || discount.minSubtotalCents == null || subtotalCents >= discount.minSubtotalCents
  const applied = discount && discountApplicable ? discount : null

  let lineDiscountCents = input.lines.map(() => 0)
  let shippingDiscountCents = 0
  if (applied?.type === 'percentage') {
    const percent = Math.min(Math.max(applied.value, 0), 100)
    lineDiscountCents = input.lines.map((l) => Math.round((l * percent) / 100))
  } else if (applied?.type === 'fixed_amount') {
    lineDiscountCents = allocate(Math.min(Math.max(applied.value, 0), subtotalCents), input.lines)
  } else if (applied?.type === 'free_shipping') {
    shippingDiscountCents = input.shippingCents
  }
  const discountCents = lineDiscountCents.reduce((a, b) => a + b, 0) + shippingDiscountCents

  let taxCents = 0
  if (taxRate && taxRate.ratePercent > 0) {
    const included = input.taxesIncluded
    taxCents = input.lines.reduce(
      (sum, l, i) => sum + taxOn(l - lineDiscountCents[i]!, taxRate.ratePercent, included),
      0,
    )
    if (input.taxShipping) taxCents += taxOn(input.shippingCents - shippingDiscountCents, taxRate.ratePercent, included)
  }
  const taxLines =
    taxCents > 0 ? [{ title: taxRate!.name, ratePercent: taxRate!.ratePercent, amountCents: taxCents }] : []

  return {
    subtotalCents,
    shippingCents: input.shippingCents,
    lineDiscountCents,
    shippingDiscountCents,
    discountCents,
    discountApplicable,
    taxCents,
    taxLines,
    taxesIncluded: input.taxesIncluded,
    totalCents: subtotalCents + input.shippingCents - discountCents + (input.taxesIncluded ? 0 : taxCents),
  }
}

/** "20% off", "$5.00 off", "Free shipping" — `money` formats minor units */
export function describeDiscount(d: Pick<PricingDiscount, 'type' | 'value'>, money: (cents: number) => string) {
  return d.type === 'percentage'
    ? `${d.value}% off`
    : d.type === 'fixed_amount'
      ? `${money(d.value)} off`
      : 'Free shipping'
}
