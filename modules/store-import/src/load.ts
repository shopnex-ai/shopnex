// The part every platform shares: what the fetchers found (products, pages) becomes products, collections, pages and the
// main and footer menus of a shop. It adds to what the shop has; it never removes or replaces a product, a collection or a
// page, and it only rewrites a menu that still has the two default menus' content.
import { randomUUID } from 'node:crypto'
import { collectionService, productService, type ProductInput } from '@shopnex/catalog'
import { productVariants } from '@shopnex/catalog/schema'
import { menuService, pageService, seedDefaultMenu } from '@shopnex/content'
import type { Conn } from '@shopnex/db'
import { eq } from 'drizzle-orm'
import { usualPages } from './pages'
import type { StoreImportCounts } from './store-import.schema'
import type { Found } from './types'

export type Progress = (update: { step: string; done?: number; total?: number }) => Promise<unknown> | void

/**
 * Stores send things the catalog rejects: the same SKU on two variants, two variants with the same options, several
 * variants on a product with no options (shipping-insurance add-ons do this). Keep the first of each and blank a SKU the
 * shop already uses (SKUs are unique across the whole shop, so `usedSkus` is shared between products), so one odd product still comes across instead of failing whole.
 */
export function fitCatalogRules(input: ProductInput, usedSkus = new Set<string>()): ProductInput {
  if (!input.variants?.length) return input
  const optionNames = (input.options ?? []).map((o) => o.name.trim())
  const seenKeys = new Set<string>()
  const variants: NonNullable<ProductInput['variants']> = []
  for (const v of input.variants) {
    const key = optionNames.map((n) => (v.options?.[n] ?? '').trim()).join('\u0000')
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const sku = v.sku?.trim()
    if (sku && usedSkus.has(sku)) variants.push({ ...v, sku: undefined })
    else {
      if (sku) usedSkus.add(sku)
      variants.push(v)
    }
  }
  return { ...input, variants }
}

const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 200) : String(e))

type MenuItem = { type: string; items?: unknown[] }
/** The menu a new shop starts with: only the links that need no content. Anything else is the merchant's own. */
const isStarterMenu = (items: MenuItem[], allowed: string[]) =>
  items.every((item) => allowed.includes(item.type) && !item.items?.length)

export async function loadIntoShop(
  shopId: string,
  input: Found,
  conn: Conn,
  progress: Progress = () => {},
): Promise<{ counts: Omit<StoreImportCounts, 'currency' | 'language' | 'branded'>; problems: string[] }> {
  const problems: string[] = []

  // A product whose every price is zero is a store's internal entry (a promo placeholder, a "Content: ..." item), not
  // something to sell: leave it out.
  const free = (p: Found['products'][number]) =>
    p.input.variants?.length ? p.input.variants.every((v) => !v.priceCents) : !p.input.priceCents
  const sellable = input.products.filter((p) => !free(p))
  let skipped = input.products.length - sellable.length

  // SKUs are unique across the whole shop: the ones it already has count too
  const usedSkus = new Set(
    (await conn.select({ sku: productVariants.sku }).from(productVariants).where(eq(productVariants.shopId, shopId)))
      .map((row) => row.sku)
      .filter((sku): sku is string => !!sku),
  )

  const created: { id: string; groups: string[]; groupImage: string | null }[] = []
  let variants = 0
  await progress({ step: 'Adding products', done: 0, total: sellable.length })
  for (const [index, p] of sellable.entries()) {
    try {
      // No marker tag of our own: themes print tags on the product page
      const fitted = fitCatalogRules(p.input, usedSkus)
      const product = await productService.create(shopId, fitted, conn)
      created.push({ id: product.id, groups: p.groups, groupImage: p.groupImage })
      variants += fitted.variants?.length ?? 1
    } catch (e) {
      skipped++
      problems.push(`${p.input.title}: ${why(e)}`)
    }
    if ((index + 1) % 3 === 0 || index + 1 === sellable.length) {
      await progress({ step: 'Adding products', done: index + 1, total: sellable.length })
    }
  }

  // Collections: the biggest few groups, with at least 2 products each. (Reading a store's own collection feeds
  // rate-limits fast, so groups come from data we already have.)
  await progress({ step: 'Making collections' })
  const byGroup = new Map<string, { ids: string[]; image: string | null }>()
  for (const p of created) {
    for (const name of p.groups) {
      const group = byGroup.get(name) ?? { ids: [], image: p.groupImage }
      group.ids.push(p.id)
      byGroup.set(name, group)
    }
  }
  const collections: { id: string; title: string }[] = []
  for (const [name, group] of [...byGroup.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length).slice(0, 6)) {
    if (group.ids.length < 2) continue
    try {
      const collection = await collectionService.create(shopId, { title: name, imageUrl: group.image }, conn)
      for (const id of group.ids) await collectionService.addProduct(shopId, collection.id, id, conn)
      collections.push({ id: collection.id, title: name })
    } catch (e) {
      problems.push(`collection ${name}: ${why(e)}`)
    }
  }
  // A shop made by a migration (the demo's, a scratch one) may have no menus yet; this never replaces one that exists
  await seedDefaultMenu(conn, shopId)
  const mainMenu = await menuService.getByHandle(shopId, 'main-menu', conn)
  if (mainMenu && collections.length && isStarterMenu(mainMenu.items, ['frontpage', 'catalog'])) {
    await menuService.update(
      shopId,
      mainMenu.id,
      {
        items: [
          { id: randomUUID(), title: 'Home', type: 'frontpage', items: [] },
          { id: randomUUID(), title: 'Shop all', type: 'catalog', items: [] },
          ...collections.map((c) => ({
            id: randomUUID(),
            title: c.title,
            type: 'collection' as const,
            resourceId: c.id,
            items: [],
          })),
        ],
      },
      conn,
    )
  }

  // Pages (at most 6), linked from the footer menu after the Search link the default footer has
  await progress({ step: 'Adding pages' })
  const pages: { id: string; title: string }[] = []
  for (const p of usualPages(input.pages)) {
    if (pages.length >= 6) break
    try {
      const page = await pageService.create(
        shopId,
        { title: p.title.slice(0, 200), handle: p.handle, bodyHtml: p.html, published: true },
        conn,
      )
      pages.push({ id: page.id, title: page.title })
    } catch (e) {
      problems.push(`page ${p.title}: ${why(e)}`)
    }
  }
  const footer = await menuService.getByHandle(shopId, 'footer', conn)
  if (footer && pages.length && isStarterMenu(footer.items, ['search'])) {
    await menuService.update(
      shopId,
      footer.id,
      {
        items: [
          ...pages.map((pg) => ({
            id: randomUUID(),
            title: pg.title,
            type: 'page' as const,
            resourceId: pg.id,
            items: [],
          })),
          { id: randomUUID(), title: 'Search', type: 'search', items: [] },
        ],
      },
      conn,
    )
  }

  return {
    counts: {
      products: created.length,
      variants,
      collections: collections.length,
      pages: pages.length,
      skipped,
      total: input.total ?? null,
    },
    problems,
  }
}
