// The shapes of this module's API: what the Settings → Webhooks routes take and answer. Plain Zod, no oRPC or server code.
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { WEBHOOK_TOPICS, webhookDeliveries, webhookEndpoints } from './webhooks.schema'

// Settings → Webhooks
export const webhookEndpointInput = createInsertSchema(webhookEndpoints, {
  url: () => z.url({ protocol: /^https?$/ }).max(2000),
  description: (s) => s.trim().max(200),
  topics: () => z.array(z.enum(WEBHOOK_TOPICS)).min(1, 'Pick at least one event'),
}).pick({ url: true, description: true, topics: true, active: true })

export const webhookOutput = createSelectSchema(webhookEndpoints, { topics: z.array(z.enum(WEBHOOK_TOPICS)) })

// The list also says who created each one
export const webhookListItemOutput = webhookOutput.extend({
  /** Name of the API token that created it, when one did */
  apiTokenName: z.string().nullable(),
  createdByApp: z.boolean(),
})

export const webhookDeliveryOutput = createSelectSchema(webhookDeliveries)
