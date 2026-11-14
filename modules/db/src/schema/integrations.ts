// Credentials and settings for the payment and shipping providers ShopNex talks to directly (not through an app).
// One row per shop and provider: the secret is sealed at rest, the rest is plain settings.
import { boolean, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

export const INTEGRATION_PROVIDERS = ['paystack', 'bobgo'] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const shopIntegrations = pgTable(
  'shop_integrations',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<IntegrationProvider>().notNull(),
    // AES-256-GCM, keyed from SHOPNEX_SECRET (@shopnex/db/secrets)
    secret: text('secret').notNull(),
    // Provider settings that are not secret: collection address, parcel, sandbox, currency...
    config: jsonb('config').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.provider] })],
)

export type ShopIntegration = typeof shopIntegrations.$inferSelect
export type NewShopIntegration = typeof shopIntegrations.$inferInsert
