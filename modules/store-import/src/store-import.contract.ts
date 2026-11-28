// The shapes of this module's API: what the admin routes accept and answer. Plain Zod, no oRPC or server code, so the
// admin UI imports the same schemas for its forms.
import { z } from 'zod'
import { STORE_IMPORT_STATUSES } from './store-import.schema'

export const storeImportInput = z.object({
  // Any form of a store address ("shop.example.com", "https://shop.example.com/products/x"); the server cleans it
  url: z.string().trim().min(1, 'Enter your store address').max(300),
  // Also set the shop's name, logo, currency, language and theme from the store (always done for a shop with no products)
  branding: z.boolean().optional(),
})

const counts = z.object({
  products: z.number(),
  variants: z.number(),
  collections: z.number(),
  pages: z.number(),
  // Absent on imports made before this existed
  customFields: z.number().optional(),
  skipped: z.number(),
  total: z.number().nullable(),
  currency: z.string(),
  language: z.string().nullable(),
  branded: z.boolean(),
})

export const storeImportOutput = z.object({
  id: z.uuid(),
  origin: z.string(),
  platform: z.enum(['shopify', 'woocommerce']).nullable(),
  status: z.enum(STORE_IMPORT_STATUSES),
  step: z.string(),
  done: z.number(),
  total: z.number(),
  counts: counts.nullable(),
  problems: z.array(z.string()),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const storeImportOverview = z.object({
  /** The shop has no products yet: an import sets it up from the store */
  fresh: z.boolean(),
  latest: storeImportOutput.nullable(),
})
