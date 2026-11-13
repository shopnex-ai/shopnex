import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

// The records a shop can add its own fields to
export const CUSTOM_FIELD_RESOURCES = ['product', 'order', 'customer'] as const
export type CustomFieldResource = (typeof CUSTOM_FIELD_RESOURCES)[number]

// boolean = yes/no; choice = one of the field's options; file = the URL of an uploaded file
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'boolean', 'choice', 'file'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

// What a record stores per field: text, choice and file as a string, number, boolean
export type CustomFieldValue = string | number | boolean
export type CustomFieldValues = Record<string, CustomFieldValue>

// `key` in definitions: how themes and APIs address the field (product.custom_fields.<key>)
export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

// A field a shop added to products, orders or customers. The values live on the record itself (custom_fields).
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    resource: text('resource').$type<CustomFieldResource>().notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').$type<CustomFieldType>().notNull(),
    // The allowed values of a `choice` field (empty for the other types)
    options: text('options')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Only storefront fields reach themes and the Storefront API; the rest stay in the admin, Admin API and apps
    storefront: boolean('storefront').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('custom_field_definitions_key_idx').on(t.shopId, t.resource, t.key),
    index('custom_field_definitions_shop_idx').on(t.shopId, t.resource, t.position),
  ],
)

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect
