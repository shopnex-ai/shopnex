// Installable apps (Admin → Apps). An app is registered once per ShopNex install (by a super admin) and
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

export type App = typeof apps.$inferSelect
