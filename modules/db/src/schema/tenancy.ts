// Shops are Better Auth "organizations" (organization plugin, renamed via modelName).
// TS keys must match Better Auth field names; DB columns use shop_* naming.
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { apps } from './apps'
import { user } from './auth'

export const shops = pgTable('shops', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  // ISO 4217; all prices in this shop are in this currency. Not a Better Auth field —
  // organizations created through Better Auth get the DB default.
  currency: text('currency').notNull().default('USD'),
  // Where the storefront lives (e.g. https://shop.acme.com): checkout links back to it
  storefrontUrl: text('storefront_url'),
  // Homepage <title> and meta description (Shopify: Online store → Preferences); null = shop name, none
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  // Next order number (Shopify-style #1001, #1002…); taken under a row lock when an order is created
  nextOrderNumber: integer('next_order_number').notNull().default(1001),
  // Shopify taxesIncluded: prices already contain tax (EU/UK style); tax is extracted, not added
  taxesIncluded: boolean('taxes_included').notNull().default(false),
  // Shopify "Charge tax on shipping rates"
  taxShipping: boolean('tax_shipping').notNull().default(false),
  // Hours after which an unpaid order with no payment attempt open (bank transfer, or a payments app that was
  // unreachable at checkout) is cancelled and its stock put back on sale. null = never: the merchant cancels by hand.
  unpaidOrderExpiryHours: integer('unpaid_order_expiry_hours'),
  // Who issues the invoices (Settings → General → Business details): the legal name (the shop name when empty), a
  // postal address (one line per row) and the VAT or tax number. An EU invoice has to carry all three.
  legalName: text('legal_name'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
  // Settings -> General -> Cookie banner. The storefront asks visitors before it runs scripts a merchant marked as needing
  // consent (analytics, marketing). Off: nothing is asked and those scripts run. The default storefront sets no such
  // cookies itself, so this only matters once scripts are added.
  cookieBanner: boolean('cookie_banner').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Shop = typeof shops.$inferSelect

// Admin API scopes. write_* includes read_*. Staff-only areas (settings, staff, keys, tokens) have no scope:
// tokens can never reach them.
export const API_SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'write_orders',
  'read_customers',
  'write_customers',
  'read_discounts',
  'write_discounts',
  // Sales channels and what's published on them
  'read_publications',
  'write_publications',
  // Payments apps: resolve / reject the payment and refund sessions sent to them
  'read_payment_sessions',
  'write_payment_sessions',
  // AI apps: register the AI capabilities they provide (product descriptions, SEO…)
  'read_ai_capabilities',
  'write_ai_capabilities',
  // Carrier services: apps that quote shipping rates at checkout
  'read_shipping',
  'write_shipping',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

// What each scope allows. The docs table is generated from this (apps/docs/scripts/generate-reference.ts), and
// being a Record, a new scope without a description fails typecheck.
export const API_SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  read_products: 'Products, variants and collections',
  write_products: 'Products, variants and collections',
  read_orders: 'Orders',
  write_orders: 'Orders',
  read_customers: 'Customers',
  write_customers: 'Customers',
  read_discounts: 'Discounts',
  write_discounts: 'Discounts',
  read_publications: 'What is published on each sales channel',
  write_publications: 'What is published on each sales channel',
  read_payment_sessions: 'Payment and refund sessions sent to a payments app (apps only)',
  write_payment_sessions: 'Payment and refund sessions sent to a payments app (apps only)',
  read_ai_capabilities: 'The AI capabilities an app provides (apps only)',
  write_ai_capabilities: 'The AI capabilities an app provides (apps only)',
  read_shipping: 'Carrier services (apps only)',
  write_shipping: 'Register a carrier service (apps only)',
}

// Secret admin API tokens (Authorization: Bearer sk_…) for apps and integrations, scoped to one shop.
// Only a SHA-256 hash is stored: the token is shown once, when it's created.
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    scopes: text('scopes').array().$type<ApiScope[]>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    // Start of the token (e.g. sk_Ab12Cd), so staff can tell tokens apart
    tokenPrefix: text('token_prefix').notNull(),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    // Set for an app installation's token (managed under Apps, not Settings → API tokens)
    appId: uuid('app_id').references((): AnyPgColumn => apps.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_tokens_shop_idx').on(t.shopId)],
)

export type ApiToken = typeof apiTokens.$inferSelect
