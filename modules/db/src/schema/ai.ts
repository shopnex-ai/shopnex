// AI capabilities (see @shopnex/marketplace-sdk/ai). They come from the provider built into Shopnex (Settings →
// AI, with the shop's own key) or from installed apps that register what they provide. Staff ask Shopnex, Shopnex
// sends only the data the capability needs and returns the answer as a suggestion. Every run is kept as a
// generation: what was asked, what came back, and whether staff used it.
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { apps } from './apps'
import { shops } from './tenancy'

// One row per (shop, app, capability): several apps may provide the same capability, staff pick one
export const aiProviders = pgTable(
  'ai_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    // e.g. product.description (AI_CAPABILITIES in @shopnex/marketplace-sdk/ai)
    capability: text('capability').notNull(),
    // Receives signed AiRunRequests; on the app's own origin
    url: text('url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_providers_shop_app_capability_idx').on(t.shopId, t.appId, t.capability)],
)

// Settings → AI: the provider built into Shopnex, called with the shop's own API key. One row per shop; no row
// means built-in AI is off (apps can still provide capabilities).
export const AI_BUILTIN_PROVIDERS = ['anthropic', 'openai'] as const
export type AiBuiltinProvider = (typeof AI_BUILTIN_PROVIDERS)[number]

export const aiSettings = pgTable('ai_settings', {
  shopId: text('shop_id')
    .primaryKey()
    .references(() => shops.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<AiBuiltinProvider>().notNull(),
  model: text('model').notNull(),
  // How the shop sounds, applied to everything written for it
  brandVoice: text('brand_voice').notNull().default(''),
  // AES-256-GCM, keyed from BETTER_AUTH_SECRET (see @shopnex/db/secrets)
  apiKey: text('api_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const AI_GENERATION_STATUSES = ['succeeded', 'failed'] as const
export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number]

// Staff used the suggestion (accepted) or dismissed it (rejected); null until they decide
export const AI_FEEDBACK = ['accepted', 'rejected'] as const
export type AiFeedback = (typeof AI_FEEDBACK)[number]

export const aiGenerations = pgTable(
  'ai_generations',
  {
    // Sent to the app as the request id
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // The app that answered; null for the built-in provider. Kept when the app is deleted: the history is the shop's
    appId: uuid('app_id').references(() => apps.id, { onDelete: 'set null' }),
    capability: text('capability').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    status: text('status').$type<AiGenerationStatus>().notNull(),
    errorMessage: text('error_message'),
    // What the app reported: model, tokens
    usage: jsonb('usage'),
    feedback: text('feedback').$type<AiFeedback>(),
    // Staff who asked; null for an API token
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_generations_shop_idx').on(t.shopId, t.createdAt),
    index('ai_generations_subject_idx').on(t.subjectType, t.subjectId),
  ],
)

export type AiProvider = typeof aiProviders.$inferSelect
export type AiSettings = typeof aiSettings.$inferSelect
export type AiGeneration = typeof aiGenerations.$inferSelect
