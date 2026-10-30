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
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const shopMembers = pgTable(
  'shop_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shop_members_shop_user_idx').on(t.organizationId, t.userId)],
)

export const shopInvitations = pgTable('shop_invitations', {
  id: text('id').primaryKey(),
  organizationId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  teamId: text('team_id'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

// Storefront host → shop (multi mode). e.g. acme.shopnex.com, shop.acme.com
// Only verified domains resolve: the shop proves it controls the host with a DNS TXT record holding the token.
export const shopDomains = pgTable('shop_domains', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(),
  verificationToken: text('verification_token')
    .notNull()
    .default(sql`gen_random_uuid()::text`),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Shop = typeof shops.$inferSelect
export type ShopDomain = typeof shopDomains.$inferSelect

// Roles staff can be given (invitation or role change). 'owner' exists but isn't handed out.
export const STAFF_ROLES = ['admin', 'member'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]
export type ShopMember = typeof shopMembers.$inferSelect

// Where a shop sells (Shopify: sales channels): the Online Store, a headless storefront, later POS and the like.
// What a channel shows is decided by resource_publications; storefront keys, carts and orders belong to one.
export const CHANNEL_TYPES = ['online_store', 'headless'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]

// Every shop has this channel (created lazily, and by the migration for existing shops); it can't be deleted
export const DEFAULT_CHANNEL_HANDLE = 'online-store'

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // Unique per shop
    handle: text('handle').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<ChannelType>().notNull().default('headless'),
    // New products and collections are published here when they're created (as the Online Store does in Shopify)
    autoPublish: boolean('auto_publish').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('channels_shop_handle_idx').on(t.shopId, t.handle)],
)

export type Channel = typeof channels.$inferSelect

// Publishable keys identify a shop for external storefronts (sent as x-shopnex-key).
// They are public (shipped in browser code): they select a shop, they don't grant extra access.
export const storefrontKeys = pgTable('storefront_keys', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  token: text('token').notNull().unique(),
  // The channel this key reads: storefronts using it see what's published there
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
})

export type StorefrontKey = typeof storefrontKeys.$inferSelect

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
  // Carrier services: apps that quote shipping rates at checkout
  'read_shipping',
  'write_shipping',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

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
