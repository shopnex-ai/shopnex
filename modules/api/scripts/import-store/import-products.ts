// Reads a public store (Shopify or WooCommerce, found out from the URL) and loads a sample into the default shop:
// products with variants, collections, the usual pages, menus and the currency.
//   DATABASE_URL=postgres://…/shopnex_main pnpm --filter @shopnex/api exec tsx scripts/import-store/import-products.ts <url> [--max 40]
// Experiment: see README.md.
import { db } from '@shopnex/db'
import { assertScratchDb, getJson } from './lib'
import { loadIntoShop } from './load'
import { fetchShopify } from './shopify'
import { fetchWoo } from './woo'

assertScratchDb()

const arg = process.argv[2]
if (!arg) throw new Error('Give a store URL')
const origin = new URL(/^https?:\/\//.test(arg) ? arg : `https://${arg}`).origin
const maxIdx = process.argv.indexOf('--max')
const max = maxIdx === -1 ? 40 : Number(process.argv[maxIdx + 1])

// Which platform: Shopify answers /products.json, WooCommerce the Store API
const isShopify = Boolean((await getJson(`${origin}/products.json?limit=1`).catch(() => null))?.products)
const found = isShopify ? await fetchShopify(origin, max) : await fetchWoo(origin, max)
await loadIntoShop(found)
await db.$client.end()
