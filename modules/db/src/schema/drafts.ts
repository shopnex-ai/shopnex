// Unpublished changes to any entity (the theme's code today; products and the like later). A draft is a
// shallow patch over the entity's live data: key → new value, or null to remove the key when published.
// Keeping it out of the entity's own table means the live row, and everything that reads it (storefronts,
// orders, inventory), never sees a half-edited state, and an entity needs no draft_* columns of its own.
// There is no FK to the entity (the type says which table the id is in): the entity's module deletes its
// drafts with it (draftService.remove).
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

export type DraftChanges = Record<string, unknown>

export const entityDrafts = pgTable(
  'entity_drafts',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // Which kind of entity and which editor, e.g. "theme_code"
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    changes: jsonb('changes').$type<DraftChanges>().notNull().default({}),
    // Only goes up (every change, discard and publish bumps it): a client says which one it saw when it
    // publishes, and caches can key on it
    rev: integer('rev').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.entityType, t.entityId] })],
)

export type EntityDraft = typeof entityDrafts.$inferSelect
