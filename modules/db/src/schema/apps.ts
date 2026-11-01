// Installable apps (Admin → Apps). An app is registered once per Shopnex install (by a super admin) and
// installed per shop, either right in the admin (managed install) or through OAuth (authorization code). Each
// installation is backed by an API token, so scopes and webhook subscriptions work exactly as for hand-made
// tokens. Apps authenticate with their own key pair; this instance only stores the public half.
import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { apiTokens, shops, type ApiScope } from './tenancy'

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

export const appInstallations = pgTable(
  'app_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // The installation's current token; re-authorizing rotates it in place
    apiTokenId: uuid('api_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    scopes: text('scopes').array().$type<ApiScope[]>().notNull(),
    installedById: text('installed_by_id').references(() => user.id, { onDelete: 'set null' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    // Set on uninstall; installing again clears it
    uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('app_installations_app_shop_idx').on(t.appId, t.shopId)],
)

// One-time codes from the consent screen, exchanged by the app's backend for a token (10 minutes)
export const appAuthorizationCodes = pgTable(
  'app_authorization_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull().unique(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().$type<ApiScope[]>().notNull(),
    redirectUri: text('redirect_uri').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('app_authorization_codes_expires_idx').on(t.expiresAt)],
)

// What an app keeps for each shop (settings, its own API keys…), through the Admin API with its own token.
// Only that app can read it. Kept across uninstall / reinstall; deleted with the app.
export const appData = pgTable(
  'app_data',
  {
    installationId: uuid('installation_id')
      .notNull()
      .references(() => appInstallations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.installationId, t.key] })],
)

// This instance's signing keys (Ed25519): session tokens, access tokens and payments requests. The public
// halves are published at /api/v1/oauth/jwks; the newest key signs.
export const instanceKeys = pgTable('instance_keys', {
  kid: text('kid').primaryKey(),
  // PKCS#8, snxk_… Stored as is: the instance signs with it (encrypt at rest with the settings module later)
  privateKey: text('private_key').notNull(),
  publicKey: text('public_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type App = typeof apps.$inferSelect
export type AppInstallation = typeof appInstallations.$inferSelect

// This instance's link to an app marketplace (one per install; super admins manage it in Admin → Apps)
export const marketplaceConnection = pgTable('marketplace_connection', {
  // Always 'default': there is at most one connection
  id: text('id').primaryKey().default('default'),
  marketplaceUrl: text('marketplace_url').notNull(),
  // This instance's public origin as apps reach it (sent to apps as `instance`)
  publicUrl: text('public_url').notNull(),
  // Published at /api/v1/marketplace/challenge while connecting, so the marketplace can verify publicUrl
  pendingChallenge: text('pending_challenge'),
  instanceId: uuid('instance_id'),
  // Bearer key for the marketplace API. Stored as is: the instance must send it (encrypt at rest with the
  // settings module later)
  instanceKey: text('instance_key'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncError: text('last_sync_error'),
})

export type MarketplaceConnection = typeof marketplaceConnection.$inferSelect
