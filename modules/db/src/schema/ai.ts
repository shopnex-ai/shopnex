// AI apps (see @shopnex/marketplace-sdk/ai). An installed app registers the AI capabilities it provides for a
// shop; staff ask Shopnex, Shopnex sends the app only the data the capability needs and returns its answer as a
// suggestion. Every run is kept as a generation: what was asked, what came back, and whether staff used it.
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
    // Kept when the app is deleted: the history is the shop's
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
export type AiGeneration = typeof aiGenerations.$inferSelect
