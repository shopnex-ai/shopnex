// The part every platform shares: what the fetchers found (products, pages, currency) becomes products, collections,
// pages, the main and footer menus and the shop's currency in the default shop.
import { randomUUID } from 'node:crypto'
import { collectionService, productService, type ProductInput } from '@shopnex/catalog'
import { menuService, pageService } from '@shopnex/content'
import { shops } from '@shopnex/core/schema'
import { db } from '@shopnex/db'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'
import { eq } from 'drizzle-orm'

export type Found = {
  origin: string
  platform: string
  /** ISO code, e.g. USD */
  currency: string
  products: {
    input: ProductInput
    /** Collection names this product belongs to (categories or product types) */
    groups: string[]
    /** What a collection made from it shows, when it is the first of its group */
    groupImage: string | null
  }[]
  /** Candidate pages, any order: the loader keeps the usual shop pages */
  pages: { title: string; handle: string; html: string }[]
  /** How many products the store has in all, when it says */
  total?: number
}

const PAGE_ORDER = ['about', 'contact', 'faq', 'shipping|deliver', 'return|refund', 'size', 'privacy', 'terms']
const JUNK_PAGE = /\b(old|test|draft|copy|backup|v\d|bold)\b|\(old\)/i

/** The usual shop pages, most useful first, with a real body (pages built from a theme template come back empty) */
export function usualPages(pages: Found['pages']) {
  const rank = (p: Found['pages'][number]) =>
    PAGE_ORDER.findIndex((word) => new RegExp(word, 'i').test(`${p.handle} ${p.title}`))
  return pages
    .filter((p) => rank(p) !== -1 && !JUNK_PAGE.test(`${p.handle} ${p.title}`) && p.html.trim().length >= 200)
    .sort((a, b) => rank(a) - rank(b))
}

const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 200) : String(e))

export async function loadIntoShop(found: Found) {
  const t0 = Date.now()
  const problems: string[] = []

  await db.update(shops).set({ currency: found.currency }).where(eq(shops.id, DEFAULT_SHOP_ID))

  // Products
  const created: { id: string; groups: string[]; groupImage: string | null }[] = []
  for (const p of found.products) {
    try {
      // No marker tag of our own: themes print tags on the product page
      const product = await productService.create(DEFAULT_SHOP_ID, p.input, db)
      created.push({ id: product.id, groups: p.groups, groupImage: p.groupImage })
    } catch (e) {
      problems.push(`${p.input.title}: ${why(e)}`)
    }
  }

  // Collections: the biggest few groups, with at least 2 products each. (Reading a store's own collection feeds
  // rate-limits fast, so groups come from data we already have.)
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
      const collection = await collectionService.create(DEFAULT_SHOP_ID, { title: name, imageUrl: group.image }, db)
      for (const id of group.ids) await collectionService.addProduct(DEFAULT_SHOP_ID, collection.id, id, db)
      collections.push({ id: collection.id, title: name })
    } catch (e) {
      problems.push(`collection ${name}: ${why(e)}`)
    }
  }
  const mainMenu = await menuService.getByHandle(DEFAULT_SHOP_ID, 'main-menu', db)
  if (mainMenu && collections.length) {
    await menuService.update(
      DEFAULT_SHOP_ID,
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
      db,
    )
  }

  // Pages (at most 6), linked from the footer menu after the Search link the default footer has
  const pages: { id: string; title: string }[] = []
  for (const p of usualPages(found.pages)) {
    if (pages.length >= 6) break
    try {
      const page = await pageService.create(
        DEFAULT_SHOP_ID,
        { title: p.title.slice(0, 200), handle: p.handle, bodyHtml: p.html, published: true },
        db,
      )
      pages.push({ id: page.id, title: page.title })
    } catch (e) {
      problems.push(`page ${p.title}: ${why(e)}`)
    }
  }
  const footer = await menuService.getByHandle(DEFAULT_SHOP_ID, 'footer', db)
  if (footer && pages.length) {
    await menuService.update(
      DEFAULT_SHOP_ID,
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
      db,
    )
  }

  const variants = found.products.reduce((n, p) => n + (p.input.variants?.length ?? 0), 0)
  console.log(
    `${found.origin} (${found.platform}): ${created.length}/${found.products.length} products` +
      `${found.total ? ` of ${found.total}` : ''}, ${variants} variants, ${collections.length} collections, ` +
      `${pages.length} pages, currency ${found.currency}, ${Date.now() - t0} ms to load`,
  )
  if (problems.length) console.log('PROBLEMS:\n- ' + problems.join('\n- '))
}
