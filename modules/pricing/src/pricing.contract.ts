// The shapes of this module's API: what the admin routes accept and answer. Plain Zod, no oRPC or server code, so the
// admin UI uses the same schemas for its forms (re-exported by @shopnex/api/schemas).
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { DISCOUNT_TYPES, discounts, taxRates } from './pricing.schema'

// Discounts (money in minor units; percentage as a whole percent)
export const discountInput = createInsertSchema(discounts, {
  code: (s) => s.trim().min(1).max(100).regex(/^\S+$/, "Codes can't contain spaces"),
  type: () => z.enum(DISCOUNT_TYPES),
  value: (s) => s.int().nonnegative(),
  minSubtotalCents: (s) => s.nonnegative(),
  usageLimit: (s) => s.int().min(1),
  // JSON clients send ISO strings
  startsAt: () => z.coerce.date(),
  endsAt: () => z.coerce.date(),
}).pick({
  code: true,
  type: true,
  value: true,
  minSubtotalCents: true,
  usageLimit: true,
  oncePerCustomer: true,
  active: true,
  startsAt: true,
  endsAt: true,
})

// Cross-field rules (the service enforces them too, for partial updates)
export const discountCreateInput = discountInput.superRefine((d, ctx) => {
  if (d.type === 'percentage' && (d.value < 1 || d.value > 100)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a percentage from 1 to 100' })
  }
  if (d.type === 'fixed_amount' && d.value < 1) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount above 0' })
  }
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must be after the start date' })
  }
})

// Settings → Taxes
export const taxRateInput = createInsertSchema(taxRates, {
  countryCode: () => z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
  // Blank = the whole country
  province: (s) => s.trim().max(100),
  name: (s) => s.trim().min(1).max(60),
  ratePercent: (s) => s.min(0).max(100),
}).pick({ countryCode: true, province: true, name: true, ratePercent: true })

export const discountOutput = createSelectSchema(discounts, {
  type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
})
export const taxRateOutput = createSelectSchema(taxRates)
