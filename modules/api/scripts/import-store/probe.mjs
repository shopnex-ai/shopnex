// Read-only probe: detect Shopify / WooCommerce from a store URL and fetch a small sample of its public catalog.
// Usage: node store-probe.mjs <url> [<url> ...]
// One visitor, one store, a handful of requests, with a pause between them. Nothing is saved to disk.

const UA = 'ShopNexImportProbe/0.1 (reads the public catalog of a store its owner pasted)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, accept = '*/*') {
  await sleep(300)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, url: res.url, headers: res.headers, text }
  } catch (e) {
    return { ok: false, status: 0, url, headers: new Headers(), text: '', error: String(e.cause?.code ?? e.message) }
  }
}

const json = (r) => {
  try {
    return r.ok ? JSON.parse(r.text) : null
  } catch {
    return null
  }
}

function origin(input) {
  const u = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`)
  return u.origin
}

async function detect(base) {
  const home = await get(base + '/', 'text/html')
  if (!home.ok) return { platform: 'unreachable', why: home.error ?? `home ${home.status}`, base: base }
  const root = new URL(home.url).origin // after redirects (www etc.)
  const html = home.text
  const signals = []
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/.test(html) || home.headers.get('x-shopid'))
    signals.push('shopify-html')
  if (/wp-content\/plugins\/woocommerce|woocommerce/i.test(html)) signals.push('woo-html')
  const productsJson = json(await get(root + '/products.json?limit=1', 'application/json'))
  if (productsJson?.products) signals.push('shopify-products.json')
  const wooApi = json(await get(root + '/wp-json/wc/store/v1/products?per_page=1', 'application/json'))
  if (Array.isArray(wooApi)) signals.push('woo-store-api')
  let platform = 'unknown'
  if (signals.includes('shopify-products.json')) platform = 'shopify'
  else if (signals.includes('woo-store-api')) platform = 'woocommerce'
  else if (signals.includes('shopify-html')) platform = 'shopify (catalog blocked)'
  else if (signals.includes('woo-html')) platform = 'woocommerce (catalog blocked)'
  return { platform, signals, root, html }
}

function brand(html) {
  const meta = (re) => html.match(re)?.[1]
  const themeColor = meta(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
  const title =
    meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ?? meta(/<title>([^<]+)<\/title>/i)
  const ogImage = meta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  // CSS custom properties that look like a brand/accent/primary/button color
  const vars = [...html.matchAll(/--(color-(?:base-)?(?:accent|primary|button|brand)[\w-]*)\s*:\s*([^;}\n]+)/gi)]
    .slice(0, 5)
    .map((m) => `${m[1]}: ${m[2].trim()}`)
  return { title: title?.trim(), themeColor, vars, ogImage: Boolean(ogImage) }
}

async function shopify(root) {
  const out = {
    products: 0,
    variants: 0,
    images: 0,
    maxVariants: 0,
    maxImages: 0,
    noImage: 0,
    noDesc: 0,
    optionNames: new Set(),
    collections: null,
    meta: null,
    notes: [],
  }
  const page = json(await get(root + '/products.json?limit=250', 'application/json'))
  const products = page?.products ?? []
  out.products = products.length
  for (const p of products) {
    out.variants += p.variants.length
    out.images += p.images.length
    out.maxVariants = Math.max(out.maxVariants, p.variants.length)
    out.maxImages = Math.max(out.maxImages, p.images.length)
    if (!p.images.length) out.noImage++
    if (!p.body_html?.trim()) out.noDesc++
    for (const o of p.options ?? []) out.optionNames.add(o.name)
  }
  if (products.length === 250) out.notes.push('250 on first page: more pages exist')
  const cols = json(await get(root + '/collections.json?limit=250', 'application/json'))
  out.collections = cols?.collections?.length ?? null
  const meta = json(await get(root + '/meta.json', 'application/json'))
  out.meta = meta ? { name: meta.name, currency: meta.currency, country: meta.country } : null
  const sample = products[0]
  out.sample = sample && {
    title: sample.title,
    price: sample.variants[0]?.price,
    image: sample.images[0]?.src ? 'yes' : 'no',
  }
  return out
}

async function woo(root) {
  const out = {
    products: 0,
    variantsHint: 0,
    images: 0,
    noImage: 0,
    noDesc: 0,
    categories: null,
    pages: null,
    site: null,
    notes: [],
  }
  const res = await get(root + '/wp-json/wc/store/v1/products?per_page=20', 'application/json')
  const products = json(res) ?? []
  out.products = products.length
  out.totalHeader = res.headers.get('x-wp-total')
  let currency
  for (const p of products) {
    out.images += p.images?.length ?? 0
    if (!p.images?.length) out.noImage++
    if (!(p.description || p.short_description)?.trim()) out.noDesc++
    out.variantsHint += p.variations?.length ?? 0
    currency ??= p.prices?.currency_code
  }
  out.currency = currency
  const cats = json(await get(root + '/wp-json/wc/store/v1/products/categories?per_page=100', 'application/json'))
  out.categories = Array.isArray(cats) ? cats.length : null
  const pages = await get(root + '/wp-json/wp/v2/pages?per_page=100&_fields=slug,title', 'application/json')
  const pj = json(pages)
  out.pages = Array.isArray(pj) ? pj.length : null
  const site = json(await get(root + '/wp-json', 'application/json'))
  out.site = site?.name
  const p0 = products[0]
  out.sample = p0 && { title: p0.name, price: p0.prices?.price, image: p0.images?.[0]?.src ? 'yes' : 'no' }
  return out
}

for (const arg of process.argv.slice(2)) {
  const t0 = Date.now()
  console.log(`\n=== ${arg}`)
  let base
  try {
    base = origin(arg)
  } catch {
    console.log('  not a URL')
    continue
  }
  const d = await detect(base)
  console.log(
    `  platform: ${d.platform}${d.why ? ` (${d.why})` : ''}   signals: ${(d.signals ?? []).join(', ') || '-'}`,
  )
  if (d.html) {
    const b = brand(d.html)
    console.log(`  brand: name=${JSON.stringify(b.title)} theme-color=${b.themeColor ?? '-'} og:image=${b.ogImage}`)
    if (b.vars.length) console.log(`  css vars: ${b.vars.join(' | ')}`)
  }
  if (d.platform === 'shopify') {
    const r = await shopify(d.root)
    r.optionNames = [...r.optionNames].slice(0, 8)
    console.log('  ', JSON.stringify(r))
  } else if (d.platform === 'woocommerce') {
    console.log('  ', JSON.stringify(await woo(d.root)))
  }
  console.log(`  (${Date.now() - t0} ms)`)
}
