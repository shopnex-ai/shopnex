// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts; the migrations stay one
// history in modules/db/migrations. The `apps` table (the registry) stays in @shopnex/db/schema with the other foundation
// tables (shops, user, apps, api_tokens): payments, ai and cart point at it, and so does api_tokens.
import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { type ApiScope, apiTokens, apps, shops, user } from '@shopnex/core/schema'

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
