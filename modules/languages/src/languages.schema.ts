// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts (modules/db/drizzle.config.ts):
// the migrations stay one history in modules/db/migrations.
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from '@shopnex/core/schema'

// The records whose text can be translated, and which of their fields. languages sits below the modules that own these rows
// (catalog, content), so it cannot import their tables: a translation points at a record by type and id, with no foreign key.
export const TRANSLATABLE_FIELDS = {
  product: ['title', 'description'],
  collection: ['title', 'description'],
  page: ['title', 'body'],
} as const
export const TRANSLATABLE_RESOURCES = ['product', 'collection', 'page'] as const
export type TranslatableResource = (typeof TRANSLATABLE_RESOURCES)[number]

// A product's options are translated like Shopify's: the option's name, and each of its values, by id. Variants are not
// translated themselves: a variant's title and selected options are made of the translated option values.
export const optionNameField = (optionId: string) => `option_name:${optionId}`
export const optionValueField = (valueId: string) => `option_value:${valueId}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether `field` is one a record of this kind can have translated: a fixed field, or (products) an option name or value */
export function isTranslatableField(resource: TranslatableResource, field: string) {
  if ((TRANSLATABLE_FIELDS[resource] as readonly string[]).includes(field)) return true
  if (resource !== 'product') return false
  const [kind, id, ...rest] = field.split(':')
  return rest.length === 0 && (kind === 'option_name' || kind === 'option_value') && !!id && UUID.test(id)
}

/** At most this many published languages per shop, besides the default one */
export const MAX_LANGUAGES = 20

// The languages a shop publishes besides its default (shops.language, which every shop has and which is never listed here)
export const shopLanguages = pgTable(
  'shop_languages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // A BCP 47 tag in its canonical form (fr, pt-BR)
    code: text('code').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shop_languages_code_idx').on(t.shopId, t.code)],
)

// One translated field of one record in one language. The default language stays on the record itself; a missing row means
// "show the default". Translations stay when a language is unpublished, so publishing it again brings them back.
export const translations = pgTable(
  'translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    resource: text('resource').$type<TranslatableResource>().notNull(),
    resourceId: uuid('resource_id').notNull(),
    field: text('field').notNull(),
    language: text('language').notNull(),
    value: text('value').notNull(),
    // A hash of the source text this was translated from (see sourceDigest): when the record's text changes, the digest no
    // longer matches and the admin marks the translation outdated. The storefront shows it either way.
    sourceDigest: text('source_digest').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('translations_field_idx').on(t.shopId, t.resource, t.resourceId, t.field, t.language),
    index('translations_lookup_idx').on(t.shopId, t.resource, t.language),
  ],
)

export type ShopLanguage = typeof shopLanguages.$inferSelect
export type Translation = typeof translations.$inferSelect
