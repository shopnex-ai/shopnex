// Reads a public Shopify store (/products.json, /collections.json, /meta.json) and loads a sample into the default shop.
//   DATABASE_URL=postgres://…/shopnex_main pnpm --filter @shopnex/api exec tsx scripts/import-store/import-products.ts <url> [--max 40]
// Experiment: see README.md.
import { collectionService, productService, type ProductInput } from '@shopnex/catalog'
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

// Collections: the first few that have products among those we took
let collectionsMade = 0
const cols =
  (await getJson(`${origin}/collections.json?limit=250`).catch(() => ({ collections: [] }))).collections ?? []
let collectionRequests = 0
for (const c of cols) {
  // Be polite: a few requests only, and stop at the first refusal
  if (collectionsMade >= 6 || collectionRequests >= 8) break
  try {
    collectionRequests++
    const members = (await getJson(`${origin}/collections/${c.handle}/products.json?limit=250`)).products ?? []
    const ids = members.map((m: any) => byHandle.get(m.handle)).filter(Boolean) as string[]
    if (!ids.length) continue
    const col = await collectionService.create(
      DEFAULT_SHOP_ID,
      { title: c.title, descriptionHtml: c.body_html || null, imageUrl: c.image?.src ?? null },
      db,
    )
    for (const id of ids) await collectionService.addProduct(DEFAULT_SHOP_ID, col.id, id, db)
    collectionsMade++
  } catch (e) {
    if (String(e).includes(': 429')) {
      problems.push('store rate-limited us (429): stopped fetching collections')
      break
    }
    problems.push(`collection ${c.title}: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
  }
}

console.log(
  `${origin}: ${ok}/${shopifyProducts.length} products, ${collectionsMade} collections, currency ${currency}, ${Date.now() - t0} ms`,
)
if (problems.length) console.log('PROBLEMS:\n- ' + problems.join('\n- '))
await db.$client.end()
