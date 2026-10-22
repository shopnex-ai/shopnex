import { sql } from 'drizzle-orm'
import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

// Valid `slug` (URL handle) for products and collections
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // URL handle, unique per shop
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    // Only `active` products are visible to storefronts
    status: text('status').$type<ProductStatus>().notNull().default('active'),
    // Plain text; descriptionHtml (sanitized on write) wins when set
    description: text('description'),
    descriptionHtml: text('description_html'),
    vendor: text('vendor').notNull().default(''),
    productType: text('product_type').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    // DEPRECATED cache of the lowest variant price (variants are the source of truth).
    // Kept in sync by the catalog service; to be dropped once nothing reads it.
    priceCents: integer('price_cents').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('products_shop_created_idx').on(t.shopId, t.createdAt),
    index('products_shop_status_idx').on(t.shopId, t.status),
    uniqueIndex('products_shop_slug_idx').on(t.shopId, t.slug),
  ],
)

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

// Shopify-style options → values → variants. A product without options has exactly one
// hidden "default" variant (optionsKey = ''), so every product is priced the same way.
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

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    // Canonical option combination, e.g. "Color=Black|Size=M" ('' for the default variant).
    // Unique per product: one variant per combination, and stable across option edits.
    optionsKey: text('options_key').notNull(),
    title: text('title').notNull(),
    sku: text('sku'),
    priceCents: integer('price_cents').notNull(),
    compareAtPriceCents: integer('compare_at_price_cents'),
    // NULL = not tracked (always available)
    inventoryQuantity: integer('inventory_quantity'),
    // Optional per-variant image (URL, usually one of the product's images)
    imageUrl: text('image_url'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('product_variants_product_options_idx').on(t.productId, t.optionsKey),
    uniqueIndex('product_variants_shop_sku_idx')
      .on(t.shopId, t.sku)
      .where(sql`${t.sku} is not null`),
    index('product_variants_product_idx').on(t.productId, t.position),
  ],
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

export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type ProductImage = typeof productImages.$inferSelect
export type Collection = typeof collections.$inferSelect
export type NewCollection = typeof collections.$inferInsert
export type ProductOption = typeof productOptions.$inferSelect
export type ProductVariant = typeof productVariants.$inferSelect
