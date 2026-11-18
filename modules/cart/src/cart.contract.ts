// The shapes of this module's API: what the Settings → Shipping and carrier app routes take and answer. Plain Zod, no oRPC or server code (the
// admin imports the shipping rate input for form validation). The cart and checkout shapes of the storefront are @shopnex/storefront-sdk's.
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { carrierServices, shippingRates } from './cart.schema'

const nonNegative = (s: z.ZodNumber) => s.nonnegative()

// Settings → Shipping (money in minor units)
export const shippingRateInput = createInsertSchema(shippingRates, {
  name: (s) => s.trim().min(1).max(100),
  priceCents: nonNegative,
  freeAboveCents: nonNegative,
}).pick({ name: true, priceCents: true, freeAboveCents: true, active: true })

export const shippingRateOutput = createSelectSchema(shippingRates)

// Carrier services (Shopify carrierServiceCreate)
export const carrierServiceConfigureInput = z.object({
  /** Shown at checkout next to the rates when the service is first created, e.g. "CJ Dropshipping" (staff can rename it) */
  name: z.string().trim().min(1).max(100),
  /** Receives signed RatesRequests; must be on the app's own origin */
  ratesUrl: z.url({ protocol: /^https?$/ }),
  /** false hides it at checkout (e.g. until the merchant has connected the carrier) */
  ready: z.boolean(),
})

export const carrierServiceOutput = createSelectSchema(carrierServices).pick({
  id: true,
  appId: true,
  name: true,
  /** The merchant's switch in Settings → Shipping */
  active: true,
  /** The app has what it needs to quote rates */
  ready: true,
})
