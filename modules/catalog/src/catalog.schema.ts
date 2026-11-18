import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { products, productVariants } from '@shopnex/db/schema'
import { shops } from '@shopnex/core/schema'

// products and product_variants are still defined in @shopnex/db: orders and cart have foreign keys into them, and db cannot import a
// module that imports db. They move here when those two do. Everything else of the catalog is below.

// Ordered by position (0 = primary image)
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    alt: text('alt'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.position)],
)

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    descriptionHtml: text('description_html'),
    imageUrl: text('image_url'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('collections_shop_slug_idx').on(t.shopId, t.slug)],
)

export const productCollections = pgTable(
  'product_collections',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.collectionId] }),
    index('product_collections_collection_idx').on(t.collectionId, t.position),
  ],
)

export const productOptions = pgTable(
  'product_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('product_options_product_name_idx').on(t.productId, t.name)],
)

export const productOptionValues = pgTable(
  'product_option_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOptions.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('product_option_values_option_value_idx').on(t.optionId, t.value)],
)

export const variantOptionValues = pgTable(
  'variant_option_values',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.optionValueId] })],
)

export type ProductImage = typeof productImages.$inferSelect
export type Collection = typeof collections.$inferSelect
export type NewCollection = typeof collections.$inferInsert
export type ProductOption = typeof productOptions.$inferSelect
