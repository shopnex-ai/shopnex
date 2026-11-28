// Importing a store into a shop: start it, run it in the background, report how far it got. The shop owner (or a visitor
// signing up on the demo) pastes an address; the server reads that store's public catalog and loads a sample into the shop.
import { products } from '@shopnex/catalog/schema'
import { shops } from '@shopnex/core/schema'
import type { Conn } from '@shopnex/db'
import { createLogger } from '@shopnex/log'
import { and, count, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { applyBrand, readBrand } from './brand'
import { createFetcher, normalizeOrigin, type Fetcher, type FetcherOptions } from './fetcher'
import { detectLanguage } from './language'
import { loadIntoShop } from './load'
import { fetchShopify } from './shopify'
import { StoreImportError } from './store-import.errors'
import { storeImports, type StoreImport, type StoreImportCounts } from './store-import.schema'
import { fetchWoo } from './woo'

const log = createLogger('store-import')

/** A sample, not the whole catalog: a visitor waits for it, and a store's feeds rate-limit quickly */
export const MAX_PRODUCTS = 40
/** An import that stops moving for this long is dead (the server restarted under it) */
const STALE_AFTER_MS = 10 * 60_000
/** The longest an import may run */
const TIME_LIMIT_MS = 8 * 60_000
const MAX_RUNNING_IN_TOTAL = 3
const MAX_PER_SHOP_PER_DAY = 5

export type StartInput = {
  url: string
  /** Also set the shop's name, logo, currency, language and theme from the store. Always on for a shop with no products yet. */
  branding?: boolean
}

/** Test hooks: the fetcher's network, and whether `start` waits for the import to end */
export type Hooks = { fetcher?: FetcherOptions; wait?: boolean }

async function failStale(shopId: string | null, conn: Conn) {
  await conn
    .update(storeImports)
    .set({
      status: 'failed',
      error: 'The import stopped before it finished (the server restarted). Start it again.',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(storeImports.status, 'running'),
        lt(storeImports.updatedAt, new Date(Date.now() - STALE_AFTER_MS)),
        ...(shopId ? [eq(storeImports.shopId, shopId)] : []),
      ),
    )
}

/** Whether the shop has no products yet: the import sets the shop up from the store unless told not to, with no one's work to protect */
export async function isFresh(shopId: string, conn: Conn) {
  const [row] = await conn.select({ n: count() }).from(products).where(eq(products.shopId, shopId))
  return (row?.n ?? 0) === 0
}

export async function latest(shopId: string, conn: Conn): Promise<StoreImport | null> {
  await failStale(shopId, conn)
  const [row] = await conn
    .select()
    .from(storeImports)
    .where(eq(storeImports.shopId, shopId))
    .orderBy(desc(storeImports.createdAt))
    .limit(1)
  return row ?? null
}

export async function get(shopId: string, id: string, conn: Conn): Promise<StoreImport | null> {
  await failStale(shopId, conn)
  const [row] = await conn
    .select()
    .from(storeImports)
    .where(and(eq(storeImports.shopId, shopId), eq(storeImports.id, id)))
  return row ?? null
}

export async function start(shopId: string, input: StartInput, conn: Conn, hooks: Hooks = {}): Promise<StoreImport> {
  const origin = normalizeOrigin(input.url)
  if (!origin) {
    throw new StoreImportError(
      'INVALID_STORE_ADDRESS',
      'That does not look like a store address. Try shop.example.com.',
    )
  }
  await failStale(null, conn)

  const [running] = await conn
    .select({ n: count() })
    .from(storeImports)
    .where(and(eq(storeImports.status, 'running'), gt(storeImports.updatedAt, new Date(Date.now() - STALE_AFTER_MS))))
  if ((running?.n ?? 0) >= MAX_RUNNING_IN_TOTAL) {
    throw new StoreImportError('IMPORT_LIMIT', 'Many stores are being imported right now. Try again in a minute.')
  }
  const [today] = await conn
    .select({ n: count() })
    .from(storeImports)
    .where(and(eq(storeImports.shopId, shopId), gt(storeImports.createdAt, new Date(Date.now() - 24 * 3600_000))))
  if ((today?.n ?? 0) >= MAX_PER_SHOP_PER_DAY) {
    throw new StoreImportError(
      'IMPORT_LIMIT',
      'This shop has imported a store several times today. Try again tomorrow.',
    )
  }

  const fresh = await isFresh(shopId, conn)
  // Asked for or not: left out, an empty shop is set up from the store and one with products is not
  const branding = input.branding ?? fresh
  let row: StoreImport
  try {
    ;[row] = await conn
      .insert(storeImports)
      .values({ shopId, origin, step: 'Reading your store' })
      .returning()
      .then((rows) => rows as [StoreImport])
  } catch (error) {
    // The unique index: this shop has a running import already
    if (isUniqueViolation(error))
      throw new StoreImportError('IMPORT_RUNNING', 'An import is already running for this shop.')
    throw error
  }

  const job = execute(row, { branding, fresh }, conn, hooks)
  if (hooks.wait) await job
  return (await get(shopId, row.id, conn)) ?? row
}

/** The driver wraps the Postgres error ("Failed query"): look through the cause chain for the unique violation (23505) */
function isUniqueViolation(error: unknown) {
  for (let e: any = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === '23505' || /store_imports_one_running_idx|duplicate key/i.test(String(e.message))) return true
  }
  return false
}

async function execute(row: StoreImport, mode: { branding: boolean; fresh: boolean }, conn: Conn, hooks: Hooks) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIME_LIMIT_MS)
  const patch = (values: Partial<typeof storeImports.$inferInsert>) =>
    conn
      .update(storeImports)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(storeImports.id, row.id))
  try {
    const fetcher = createFetcher({ ...hooks.fetcher, signal: controller.signal })
    const found = await read(row.origin, fetcher, patch)
    await patch({ platform: found.platform })

    const [shop] = await conn.select().from(shops).where(eq(shops.id, row.shopId))
    if (!shop) throw new Error('shop is gone')
    if (!mode.branding && shop.currency !== found.currency) {
      throw new StoreImportError(
        'CURRENCY_MISMATCH',
        `This store sells in ${found.currency} but your shop is set to ${shop.currency}, so its prices would be wrong. ` +
          `Import it with "Set up my shop from this store" on, which switches the shop to ${found.currency}.`,
      )
    }
    const brand = mode.branding ? await readBrand(row.origin, fetcher) : null
    // Prices are stored in the shop's currency: set it before the products go in
    if (mode.branding) {
      await conn
        .update(shops)
        .set({ currency: found.currency, ...(found.language ? { language: found.language } : {}) })
        .where(eq(shops.id, row.shopId))
    }

    const loaded = await loadIntoShop(row.shopId, found, conn, (update) =>
      patch({
        step: update.step,
        ...(update.done !== undefined ? { done: update.done, total: update.total ?? 0 } : {}),
      }),
    )
    if (brand) {
      await patch({ step: 'Setting up your look' })
      await applyBrand(row.shopId, brand, row.origin, conn)
    }
    const counts: StoreImportCounts = {
      ...loaded.counts,
      currency: found.currency,
      language: mode.branding ? (found.language ?? null) : null,
      branded: !!brand,
    }
    await patch({ status: 'done', step: 'Done', counts, problems: loaded.problems.slice(0, 20) })
  } catch (error) {
    const message =
      error instanceof StoreImportError
        ? error.message
        : controller.signal.aborted
          ? 'The import took too long and was stopped. Try again.'
          : 'Something went wrong while reading this store. Try again, or import your products with the CSV import.'
    if (!(error instanceof StoreImportError)) log.error({ err: error, importId: row.id }, 'store import failed')
    await patch({ status: 'failed', step: 'Failed', error: message }).catch((e) => log.error(e))
  } finally {
    clearTimeout(timer)
  }
}

/** Which platform the store runs, and its catalog in one shape */
async function read(
  origin: string,
  fetcher: Fetcher,
  patch: (values: Partial<typeof storeImports.$inferInsert>) => Promise<unknown>,
) {
  // Only "not readable" means "not this platform": a store that blocks us says so, rather than being called unreadable
  // (the platform check asks for the first page of products itself, which the reader then reuses)
  const probe = (url: string) =>
    fetcher.json(url).catch((error) => {
      if (error instanceof StoreImportError && error.code === 'STORE_BLOCKED') throw error
      return null
    })
  const isShopify = Boolean(
    (await probe(`${origin}/products.json?limit=${Math.min(250, MAX_PRODUCTS)}&page=1`))?.products,
  )
  const isWoo = !isShopify && Array.isArray(await probe(`${origin}/wp-json/wc/store/v1/products?per_page=1`))
  if (!isShopify && !isWoo) {
    throw new StoreImportError(
      'STORE_NOT_READABLE',
      'We could not read this store. It must be a Shopify store with a public catalog or a WooCommerce store with its public Store API. ' +
        'A password page, a closed catalog or another platform cannot be imported.',
    )
  }
  await patch({ step: 'Reading products' })
  const found = isShopify
    ? await fetchShopify(origin, MAX_PRODUCTS, fetcher)
    : await fetchWoo(origin, MAX_PRODUCTS, fetcher)
  return { ...found, language: await detectLanguage(origin, fetcher) }
}

/** Shop-wide rule for tests and callers: a shop with an import in flight */
export async function isRunning(shopId: string, conn: Conn) {
  await failStale(shopId, conn)
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(storeImports)
    .where(and(eq(storeImports.shopId, shopId), eq(storeImports.status, 'running')))
  return (row?.n ?? 0) > 0
}
