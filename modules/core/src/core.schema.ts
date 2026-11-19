// The tables every module points at: user (the account), shops, apps (the registry) and api_tokens, with the scopes a token can
// hold. They belong to no single module: a table of any module may reference them, and none of them may reference a module. So this
// package imports nothing from the modules or from @shopnex/db, only drizzle-orm.
// `pnpm db:generate` finds them through modules/*/src/*.schema.ts; the migrations stay one history in modules/db/migrations.
//
// Shops are Better Auth "organizations" (organization plugin, renamed via modelName): TS keys must match Better Auth field
// names, DB columns use shop_* naming.
import { boolean, index, integer, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // admin plugin: platform role ('superadmin' | 'user') and bans
  role: text('role').default('user'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
  // Apps that email the shop's customers (review requests…) from the shop's own address, with its email settings
  'write_email',
  // Apps that add a script to the shop's online store (a reviews widget, a chat button…)
  'write_storefront',
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
  write_email: "Send email to the shop's customers from the shop's address (apps only)",
  write_storefront: "Load the app's script on the shop's online store (apps only)",
}

// custom: registered here by a super admin (private apps). marketplace: synced from the connected marketplace,
// read-only here (the vendor edits it there). bundled: ships with this install and registers itself at startup,
// so it is not edited or deleted here either.
export const APP_SOURCES = ['custom', 'marketplace', 'bundled'] as const
export type AppSource = (typeof APP_SOURCES)[number]

export const apps = pgTable('apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').$type<AppSource>().notNull().default('custom'),
  // The app's id on the marketplace (marketplace apps only)
  marketplaceAppId: uuid('marketplace_app_id').unique(),
  name: text('name').notNull(),
  // Marketplace listing details (null for custom apps)
  tagline: text('tagline'),
  developerName: text('developer_name'),
  listingUrl: text('listing_url'),
  // No longer in the marketplace catalog: can't be installed anymore; existing installs keep working
  delistedAt: timestamp('delisted_at', { withTimezone: true }),
  description: text('description'),
  iconUrl: text('icon_url'),
  // Where "Open app" in the admin goes (the app's own UI)
  appUrl: text('app_url').notNull(),
  // OAuth redirect_uri must match one of these exactly. None: the app is installed in the admin (managed
  // install) and gets tokens with the token exchange / client credentials grants
  redirectUrls: text('redirect_urls').array().notNull(),
  // The most an installation can be granted; the authorize request may ask for fewer
  scopes: text('scopes').array().$type<ApiScope[]>().notNull(),
  // Public identifier (app_…)
  clientId: text('client_id').notNull().unique(),
  // Ed25519 public key (base64url): checks the app's client assertions. The private key never reaches us.
  publicKey: text('public_key'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type App = typeof apps.$inferSelect

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
