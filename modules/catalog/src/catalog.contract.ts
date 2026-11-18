// The shapes of this module's API: what the product and collection routes take and answer. Plain Zod, no oRPC or server code
// (the admin imports the inputs for form validation). Row-shaped shapes come from the Drizzle tables (drizzle-zod): column types,
// nullability and required-ness come from the DB schema; what is added here is API policy (lengths, formats).
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { publicationsOutput } from '@shopnex/channels/contract'
import { customFieldUpdates, customFieldValues } from '@shopnex/custom-fields/contract'
import { PRODUCT_STATUSES, SLUG_PATTERN, productVariants, products } from '@shopnex/db/schema'
import { collections, productImages, productOptionValues, productOptions } from './catalog.schema'

export const slug = z.string().min(1).max(120).regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens')

// Absolute http(s) URLs only: external images, or uploads (admin.files.upload returns their URL)
export const imageUrl = z.url({ protocol: /^https?$/ })

const nonNegative = (s: z.ZodNumber) => s.nonnegative()
const html = (s: z.ZodString) => s.max(100_000)

export const imageInput = createInsertSchema(productImages, {
  url: () => imageUrl,
  alt: (s) => s.max(300),
}).pick({ url: true, alt: true })

const optionValue = createInsertSchema(productOptionValues, { value: (s) => s.min(1).max(60) }).shape.value

export const optionInput = createInsertSchema(productOptions, { name: (s) => s.min(1).max(60) })
  .pick({ name: true })
  .extend({ values: z.array(optionValue).min(1).max(100) })

const variantColumns = createInsertSchema(productVariants, {
  sku: (s) => s.max(100),
  priceCents: nonNegative,
  compareAtPriceCents: nonNegative,
  inventoryQuantity: nonNegative,
  imageUrl: () => imageUrl,
})

export const variantInput = variantColumns
  .pick({ sku: true, priceCents: true, compareAtPriceCents: true, inventoryQuantity: true, imageUrl: true })
  // option name → value; omit for a product without options
  .extend({ options: z.record(z.string(), z.string()).optional() })

const productColumns = createInsertSchema(products, {
  title: (s) => s.min(1),
  // Only active products are visible to storefronts
  status: () => z.enum(PRODUCT_STATUSES),
  // Sanitized on save
  descriptionHtml: html,
  vendor: (s) => s.max(200),
  fulfilledBy: () => z.string().trim().min(1).max(100).nullable().optional(),
  productType: (s) => s.max(200),
  tags: () => z.array(z.string().max(100)).max(250),
  seoTitle: (s) => s.max(200),
  seoDescription: (s) => s.max(500),
  // Omit to derive from the title
  slug: () => slug,
})

export const seoInput = z.object({
  title: productColumns.shape.seoTitle,
  description: productColumns.shape.seoDescription,
})

export const productFields = productColumns
  .pick({
    title: true,
    status: true,
    description: true,
    descriptionHtml: true,
    vendor: true,
    fulfilledBy: true,
    productType: true,
    tags: true,
    slug: true,
  })
  .partial({ slug: true })
  .extend({
    seo: seoInput.optional(),
    customFields: customFieldUpdates.optional(),
    // Simple product: one default variant at this price. With variants: options + variants (each with its own price).
    priceCents: variantColumns.shape.priceCents.optional(),
    images: z.array(imageInput).max(20).optional(),
  })

export const variantsInput = z.object({
  options: z.array(optionInput).max(10),
  variants: z.array(variantInput).min(1).max(1000),
})

export const collectionInput = createInsertSchema(collections, {
  title: (s) => s.min(1),
  descriptionHtml: html,
  imageUrl: () => imageUrl,
  slug: () => slug,
})
  .pick({ title: true, slug: true, description: true, descriptionHtml: true, imageUrl: true })
  .partial({ slug: true })
  .extend({ seo: seoInput.optional() })

// ── what the routes answer

const variantOutput = createSelectSchema(productVariants)
  .pick({
    id: true,
    title: true,
    sku: true,
    priceCents: true,
    compareAtPriceCents: true,
    inventoryQuantity: true,
    imageUrl: true,
  })
  .extend({
    available: z.boolean(),
    /** option name → value */
    options: z.record(z.string(), z.string()),
    /** The same, as an array in option order */
    selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
  })

const optionOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  values: z.array(z.string()),
  optionValues: z.array(z.object({ id: z.uuid(), name: z.string(), firstSelectableVariantId: z.uuid().nullable() })),
})

export const productOutput = createSelectSchema(products, {
  status: z.enum(PRODUCT_STATUSES),
  customFields: customFieldValues,
}).extend({
  images: z.array(createSelectSchema(productImages).pick({ id: true, url: true, alt: true })),
  collectionSlugs: z.array(z.string()),
  options: z.array(optionOutput),
  variants: z.array(variantOutput),
})

export const productListOutput = z.object({
  items: z.array(productOutput.extend({ publications: publicationsOutput })),
  total: z.number().int(),
})

export const collectionOutput = createSelectSchema(collections)
export const collectionDetailOutput = collectionOutput.extend({
  productCount: z.number().int(),
  publications: publicationsOutput,
})
export const collectionProductOutput = createSelectSchema(products, { status: z.enum(PRODUCT_STATUSES) }).pick({
  id: true,
  title: true,
  status: true,
})
export const variantRowOutput = createSelectSchema(productVariants).extend({ available: z.boolean() })

/** Deleting or toggling something: `{ ok: true }` */
export const okOutput = z.object({ ok: z.boolean() })
/** How many rows a bulk delete removed */
export const countOutput = z.number().int()
