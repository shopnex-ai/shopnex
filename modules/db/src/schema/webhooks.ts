// Outbound webhooks (Settings → Webhooks). Domain services write deliveries in the same transaction as
// the change (outbox), and a worker sends them, signed per the Standard Webhooks spec, with retries.
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { apiTokens, shops } from './tenancy'

// Topics a shop can subscribe to (`resource.event`, as in the payload's `type`)
export const WEBHOOK_TOPICS = [
  'order.created',
  'order.paid',
  'order.fulfilled',
  'order.cancelled',
  'product.created',
  'product.updated',
  'customer.created',
  'customer.updated',
] as const
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number]
// Sent by "Send test" in the admin; not subscribable
export const WEBHOOK_TEST_TOPIC = 'webhook.test'

// timestamptz: the worker compares these with JS dates, which must not depend on the DB's time zone
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    // e.g. "Zapier: new orders"
    description: text('description'),
    topics: text('topics').array().$type<WebhookTopic[]>().notNull(),
    // whsec_<base64>: the receiver verifies signatures with it
    secret: text('secret').notNull(),
    active: boolean('active').notNull().default(true),
    // Set when an app subscribed through the API: it only sees its own endpoints, which go when it's revoked.
    // Null = added by staff in the admin.
    apiTokenId: uuid('api_token_id').references(() => apiTokens.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_endpoints_shop_idx').on(t.shopId)],
)

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed'] as const
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number]

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    // Sent as `webhook-id`; the same on every retry, so receivers can deduplicate
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    // Exact JSON bytes that are signed and sent (a snapshot taken when the event happened)
    body: text('body').notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    // When the worker picks it up next (also pushed forward while an attempt is in flight)
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    // Start of the response body, or the network error
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
  ],
)

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
