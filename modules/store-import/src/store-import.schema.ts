// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts.
// One row per import of a store into a shop: what was asked, how far it got and what it brought across. The page that
// started it polls this row. It holds no customer data: an address, counts and short messages.
import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from '@shopnex/core/schema'

export const STORE_IMPORT_STATUSES = ['running', 'done', 'failed'] as const
export type StoreImportStatus = (typeof STORE_IMPORT_STATUSES)[number]

/** What an import brought across, shown when it is done */
export type StoreImportCounts = {
  products: number
  variants: number
  collections: number
  pages: number
  /** Product custom fields made from facts the store lists (Shopify data tags, WooCommerce attributes, weight); absent on older imports */
  customFields?: number
  /** Products the store listed that were left out (free placeholders), or failed to load */
  skipped: number
  /** Products the store has in all, when it says (the import takes a sample) */
  total: number | null
  currency: string
  language: string | null
  /** Shop name, logo, colors and theme were set from the store */
  branded: boolean
}

export const storeImports = pgTable(
  'store_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // https://store.example.com, no path
    origin: text('origin').notNull(),
    platform: text('platform').$type<'shopify' | 'woocommerce'>(),
    status: text('status').$type<StoreImportStatus>().notNull().default('running'),
    // A short line for the progress screen ("Adding products")
    step: text('step').notNull().default('Starting'),
    // For the progress bar: products added so far out of those read
    done: integer('done').notNull().default(0),
    total: integer('total').notNull().default(0),
    counts: jsonb('counts').$type<StoreImportCounts>(),
    // Things that did not come across, one line each, for the result screen
    problems: jsonb('problems').$type<string[]>().notNull().default([]),
    // Why it failed, in words a shop owner can act on
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // Moves with every step: a running import that stops moving is dead (the server restarted)
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('store_imports_shop_idx').on(t.shopId, t.createdAt),
    // A shop has at most one running import: two clicks (or two tabs) cannot start two
    uniqueIndex('store_imports_one_running_idx')
      .on(t.shopId)
      .where(sql`${t.status} = 'running'`),
  ],
)

export type StoreImport = typeof storeImports.$inferSelect
