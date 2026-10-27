// Which resources each channel shows (Shopify: ResourcePublication). A resource is on a channel when it has a
// row here with published_at in the past (a future date schedules it); products also need status "active".
// Polymorphic like entity_drafts: resource_type says which table resource_id is in, so collections now and
// pages, menus or anything else later need no new table. There's no FK to the resource: the module that
// deletes it deletes its publications (publicationService.removeFor).
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { channels, shops } from './tenancy'

export const PUBLISHABLE_TYPES = ['product', 'collection'] as const
export type PublishableType = (typeof PUBLISHABLE_TYPES)[number]

export const resourcePublications = pgTable(
  'resource_publications',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').$type<PublishableType>().notNull(),
    resourceId: uuid('resource_id').notNull(),
    // With time zone: it's compared with now(), and JS dates and the database's clock must agree
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.resourceType, t.resourceId] }),
    index('resource_publications_resource_idx').on(t.resourceType, t.resourceId),
  ],
)

export type ResourcePublication = typeof resourcePublications.$inferSelect
