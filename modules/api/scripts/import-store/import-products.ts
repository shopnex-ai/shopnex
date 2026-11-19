// Reads a public Shopify store (/products.json, /collections.json, /meta.json) and loads a sample into the default shop.
//   DATABASE_URL=postgres://…/shopnex_main pnpm --filter @shopnex/api exec tsx scripts/import-store/import-products.ts <url> [--max 40]
// Experiment: see README.md.
import { randomUUID } from 'node:crypto'
import { collectionService, productService, type ProductInput } from '@shopnex/catalog'
import { menuService, pageService } from '@shopnex/content'
import { db } from '@shopnex/db'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'
import { assertScratchDb, getJson } from './lib'

assertScratchDb()

const arg = process.argv[2]
if (!arg) throw new Error('Give a store URL')
const origin = new URL(/^https?:\/\//.test(arg) ? arg : `https://${arg}`).origin
const maxIdx = process.argv.indexOf('--max')
const MAX = maxIdx === -1 ? 40 : Number(process.argv[maxIdx + 1])

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX'])
const meta = await getJson(origin + '/meta.json').catch(() => null)
const currency: string = meta?.currency ?? 'USD'
const minor = ZERO_DECIMAL.has(currency) ? 1 : 100
const cents = (value: string | null | undefined) =>
  value == null || value === '' ? null : Math.round(Number(value) * minor)

const problems: string[] = []
const shopifyProducts: any[] = []
for (let page = 1; shopifyProducts.length < MAX; page++) {
  const data = await getJson(`${origin}/products.json?limit=${Math.min(250, MAX)}&page=${page}`)
  if (!data.products?.length) break
  shopifyProducts.push(...data.products)
  if (data.products.length < Math.min(250, MAX)) break
}
shopifyProducts.length = Math.min(shopifyProducts.length, MAX)

function toInput(p: any): ProductInput {
  const options = (p.options ?? []).filter(
    (o: any) => o.name !== 'Title' && !(o.values.length === 1 && o.values[0] === 'Default Title'),
  )
  const optionNames: string[] = (p.options ?? []).map((o: any) => o.name)
  const variants = p.variants.map((v: any) => {
    const picked: Record<string, string> = {}
    for (const o of options) {
      const idx = optionNames.indexOf(o.name)
      const value = v[`option${idx + 1}`]
      if (value) picked[o.name] = value
    }
    return {
      sku: v.sku || null,
      priceCents: cents(v.price) ?? 0,
      compareAtPriceCents: cents(v.compare_at_price),
      // The public feed has no stock level, only available or not
      inventoryQuantity: v.available ? 10 : 0,
      imageUrl: v.featured_image?.src ?? null,
      ...(options.length ? { options: picked } : {}),
    }
  })
  const tags: string[] = Array.isArray(p.tags)
    ? p.tags
    : String(p.tags ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
  return {
    title: String(p.title).slice(0, 250),
    status: 'active',
    descriptionHtml: p.body_html || null,
    vendor: p.vendor ?? '',
    productType: p.product_type ?? '',
    tags: tags.slice(0, 250),
    images: (p.images ?? []).map((i: any) => ({ url: i.src, alt: i.alt ? String(i.alt).slice(0, 300) : null })),
    ...(options.length ? { options: options.map((o: any) => ({ name: o.name, values: o.values })) } : {}),
    variants,
  }
}

const byHandle = new Map<string, string>() // shopify handle -> our product id
let ok = 0
const t0 = Date.now()
for (const p of shopifyProducts) {
  try {
    const created = await productService.create(
      DEFAULT_SHOP_ID,
      { ...toInput(p), tags: [...toInput(p).tags!, 'imported'] },
      db,
    )
    byHandle.set(p.handle, created.id)
    ok++
  } catch (e) {
    problems.push(`${p.title}: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
  }
}

// Collections: one per product type (the store's own collection feeds rate-limit fast, and this needs no requests).
// The biggest few, with at least 2 products each.
const byType = new Map<string, { ids: string[]; image: string | null }>()
for (const p of shopifyProducts) {
  const id = byHandle.get(p.handle)
  const type = String(p.product_type ?? '').trim()
  if (!id || !type) continue
  const group: { ids: string[]; image: string | null } = byType.get(type) ?? {
    ids: [],
    image: p.images?.[0]?.src ?? null,
  }
  group.ids.push(id)
  byType.set(type, group)
}
const collectionIds: { id: string; title: string }[] = []
for (const [type, group] of [...byType.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length).slice(0, 6)) {
  if (group.ids.length < 2) continue
  try {
    const col = await collectionService.create(DEFAULT_SHOP_ID, { title: type, imageUrl: group.image }, db)
    for (const id of group.ids) await collectionService.addProduct(DEFAULT_SHOP_ID, col.id, id, db)
    collectionIds.push({ id: col.id, title: type })
  } catch (e) {
    problems.push(`collection ${type}: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
  }
}

// Main menu: Home, Shop all, then the collections above (replaces the default menu's items)
const mainMenu = await menuService.getByHandle(DEFAULT_SHOP_ID, 'main-menu', db)
if (mainMenu && collectionIds.length) {
  await menuService.update(
    DEFAULT_SHOP_ID,
    mainMenu.id,
    {
      items: [
        { id: randomUUID(), title: 'Home', type: 'frontpage', items: [] },
        { id: randomUUID(), title: 'Shop all', type: 'catalog', items: [] },
        ...collectionIds.map((c) => ({
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
const collectionsMade = collectionIds.length

// Pages: /pages.json has the body. Only the usual shop pages, most useful first (About, Contact, FAQ, shipping,
// returns, privacy, terms), with a real body: pages built from a theme template come back empty. Capped at 6.
const PAGE_ORDER = ['about', 'contact', 'faq', 'shipping|deliver', 'return|refund', 'size', 'privacy', 'terms']
const JUNK_PAGE = /\b(old|test|draft|copy|backup|v\d|bold)\b|\(old\)/i
const pagesFeed: any[] = (await getJson(`${origin}/pages.json?limit=250`).catch(() => ({ pages: [] }))).pages ?? []
const rank = (p: any) => PAGE_ORDER.findIndex((word) => new RegExp(word, 'i').test(`${p.handle} ${p.title}`))
const wanted = pagesFeed
  .filter(
    (p) =>
      rank(p) !== -1 && !JUNK_PAGE.test(`${p.handle} ${p.title}`) && String(p.body_html ?? '').trim().length >= 200,
  )
  .sort((x, y) => rank(x) - rank(y))
const pageIds: { id: string; title: string }[] = []
for (const p of wanted) {
  if (pageIds.length >= 6) break
  try {
    const page = await pageService.create(
      DEFAULT_SHOP_ID,
      { title: String(p.title).slice(0, 200), handle: p.handle, bodyHtml: p.body_html, published: true },
      db,
    )
    pageIds.push({ id: page.id, title: page.title })
  } catch (e) {
    problems.push(`page ${p.title}: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
  }
}
// Footer menu: the pages, after the Search link the default footer has
const footer = await menuService.getByHandle(DEFAULT_SHOP_ID, 'footer', db)
if (footer && pageIds.length) {
  await menuService.update(
    DEFAULT_SHOP_ID,
    footer.id,
    {
      items: [
        ...pageIds.map((pg) => ({
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

console.log(
  `${origin}: ${ok}/${shopifyProducts.length} products, ${collectionsMade} collections, ${pageIds.length} pages, currency ${currency}, ${Date.now() - t0} ms`,
)
if (problems.length) console.log('PROBLEMS:\n- ' + problems.join('\n- '))
await db.$client.end()
