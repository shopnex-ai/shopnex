// The shapes of this module's API: what the Settings → Payments routes and the payments-app routes take and answer. Plain
// Zod, no oRPC or server code.
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { apps } from '@shopnex/db/schema'
import { paymentMethods } from './payments.schema'

export const paymentMethodInput = createInsertSchema(paymentMethods, {
  name: (s) => s.trim().min(1).max(100),
  additionalDetails: (s) => s.max(2000),
  instructions: (s) => s.max(5000),
}).pick({ name: true, additionalDetails: true, instructions: true, active: true })

// Payments apps (Shopify paymentsAppConfigure)
export const paymentsAppConfigureInput = z.object({
  /** Shown at checkout when the method is first created, e.g. "Credit card" (staff can rename it) */
  name: z.string().trim().min(1).max(100),
  /** Gateway name snapshotted on orders, e.g. "stripe" */
  gateway: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Lowercase letters, digits, - and _')
    .refine((g) => g !== 'manual' && g !== 'app', 'Reserved gateway name'),
  /** Receives signed PaymentSessionRequests; must be on the app's own origin */
  paymentSessionUrl: z.url({ protocol: /^https?$/ }),
  /** Receives signed RefundSessionRequests; must be on the app's own origin */
  refundSessionUrl: z.url({ protocol: /^https?$/ }),
  /** false hides the method at checkout (e.g. until the merchant has entered provider keys) */
  ready: z.boolean(),
})

export const paymentMethodOutput = createSelectSchema(paymentMethods, { provider: z.enum(['manual', 'app']) })

/** Apps a shop can install for a job (payments, shipping) */
export const availableAppsOutput = z.object({
  instanceUrl: z.string(),
  apps: z.array(
    createSelectSchema(apps).pick({
      id: true,
      name: true,
      description: true,
      iconUrl: true,
      appUrl: true,
      clientId: true,
      redirectUrls: true,
    }),
  ),
})

// Payments
export const paymentSessionOutput = z.object({
  id: z.uuid(),
  kind: z.enum(['refund', 'payment']),
  status: z.enum(['pending', 'resolved', 'rejected', 'expired']),
  orderId: z.uuid(),
  amount: z.object({ cents: z.number().int(), currency: z.string() }),
  externalId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  expiresAt: z.date(),
  resolvedAt: z.date().nullable(),
})
export const paymentsAppOutput = createSelectSchema(paymentMethods).pick({
  id: true,
  name: true,
  gateway: true,
  ready: true,
  active: true,
})
