// WooCommerce: the public Store API (/wp-json/wc/store/v1) and WordPress's own REST API for pages.
// Prices come in the currency's smallest unit (`prices.currency_minor_unit` says how many decimals), which is what
// ShopNex stores too. Titles and names carry HTML entities.
import type { ProductInput } from '@shopnex/catalog'
import { StoreImportError } from './store-import.errors'
import type { Fetcher } from './fetcher'
import type { Specs } from './specs'
import type { Found } from './types'

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}
export const decode = (text: string) =>
  text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (NAMED[name] ?? whole),
  )

const API = '/wp-json/wc/store/v1'

/** "Size: 3\" x 1\", Stamp Type: self-inking" -> { Size: '3" x 1"', 'Stamp Type': 'self-inking' } */
function fromText(text: unknown): Record<string, string> {
  if (typeof text !== 'string') return {}
  const out: Record<string, string> = {}
  for (const part of text.split(/,\s+(?=[^,:]+:\s)/)) {
    const i = part.indexOf(': ')
    if (i > 0) out[decode(part.slice(0, i))] = decode(part.slice(i + 2))
  }
  return out
}

/**
 * The product's own attributes (Material: Cotton; the ones its variations choose between are options already), its weight
 * and its size. The Store API sends them already formatted with the store's units ("2 kg", "10 × 5 × 3 cm").
 */
export function specsOf(p: any): Specs {
  const specs: Specs = []
  for (const a of p.attributes ?? []) {
    if (a.has_variations) continue
    const value = (a.terms ?? [])
      .map((t: any) => decode(String(t.name)))
      .filter(Boolean)
      .join(', ')
    if (a.name && value) specs.push({ label: decode(String(a.name)), value })
  }
  // A product with none says "N/A"
  const measure = (label: string, text: unknown) => {
    const value = typeof text === 'string' ? decode(text).trim() : ''
    if (value && !/^n\/a$/i.test(value)) specs.push({ label, value })
  }
  measure('Weight', p.formatted_weight)
  measure('Dimensions', p.formatted_dimensions)
  return specs
}

export async function fetchWoo(origin: string, max: number, fetcher: Fetcher): Promise<Found> {
  const getJson = fetcher.json
  const raw: any[] = []
  let total: number | undefined
  for (let page = 1; raw.length < max; page++) {
    const per = Math.min(100, max)
    const res = await fetcher.request(`${origin}${API}/products?per_page=${per}&page=${page}`, 'application/json')
    if (!res.ok) break
    total ??= Number(res.headers.get('x-wp-total')) || undefined
    let list: unknown
    try {
      list = JSON.parse(res.text)
    } catch {
      break
    }
    if (!Array.isArray(list) || !list.length) break
    raw.push(...(list as any[]))
    if (list.length < per) break
  }
  raw.length = Math.min(raw.length, max)
  if (!raw.length)
    throw new StoreImportError('STORE_NOT_READABLE', 'The store answers, but lists no products to import.')

  const currency: string = raw[0].prices?.currency_code ?? 'USD'

  const images = (p: any) =>
    (p.images ?? [])
      .filter((i: any) => /^https?:\/\//.test(i.src ?? ''))
      .map((i: any) => ({ url: i.src as string, alt: i.alt ? decode(String(i.alt)).slice(0, 300) : null }))

  async function toInput(p: any): Promise<ProductInput> {
    const base = {
      title: decode(String(p.name)).slice(0, 250),
      status: 'active' as const,
      descriptionHtml: p.description || p.short_description || null,
      vendor: p.brands?.[0]?.name ? decode(String(p.brands[0].name)) : '',
      productType: p.categories?.[0]?.name ? decode(String(p.categories[0].name)) : '',
      tags: (p.tags ?? []).map((t: any) => decode(String(t.name))).slice(0, 250),
      images: images(p),
    }
    const price = (prices: any) => {
      const now = Number(prices.price)
      const regular = Number(prices.regular_price)
      return { priceCents: now, compareAtPriceCents: regular > now ? regular : null }
    }
    // Stock: the public API has no quantity, only in stock or not
    const stock = (item: any) => (item.is_in_stock === false ? 0 : 10)

    if (p.type !== 'variable' || !p.variations?.length) {
      return { ...base, variants: [{ sku: p.sku || null, ...price(p.prices), inventoryQuantity: stock(p) }] }
    }

    // One request gets every variation of this product with its price; the attribute values come from the list
    const details: any[] = await getJson(`${origin}${API}/products?parent=${p.id}&type=variation&per_page=100`)
    const attributesOf = new Map<number, { name: string; value: string }[]>(
      p.variations.map((v: any) => [v.id, v.attributes ?? []]),
    )
    const names = [
      ...new Set<string>(
        p.variations.flatMap((v: any) => (v.attributes ?? []).map((a: any) => decode(String(a.name)))),
      ),
    ]
    const values = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]))
    const variants = details.map((d) => {
      const picked: Record<string, string> = {}
      for (const name of names) {
        const found = (attributesOf.get(d.id) ?? []).find((a) => decode(String(a.name)) === name)
        // The list sometimes has no value for an attribute ("any"); the variation's own text says it: "Size: Small"
        const value = found?.value ? decode(String(found.value)) : (fromText(d.variation)[name] ?? 'Any')
        picked[name] = value
        values.get(name)!.add(value)
      }
      return {
        sku: d.sku || null,
        ...price(d.prices),
        inventoryQuantity: stock(d),
        imageUrl: /^https?:\/\//.test(d.images?.[0]?.src ?? '') ? (d.images[0].src as string) : null,
        ...(names.length ? { options: picked } : {}),
      }
    })
    if (!variants.length)
      return { ...base, variants: [{ sku: p.sku || null, ...price(p.prices), inventoryQuantity: stock(p) }] }
    return {
      ...base,
      ...(names.length ? { options: names.map((n) => ({ name: n, values: [...values.get(n)!] })) } : {}),
      variants,
    }
  }

  const products: Found['products'] = []
  for (const p of raw) {
    const groups: string[] = (p.categories ?? [])
      .map((c: any) => decode(String(c.name)))
      .filter((n: string) => !/^uncategori[sz]ed$/i.test(n))
    products.push({ input: await toInput(p), specs: specsOf(p), groups, groupImage: images(p)[0]?.url ?? null })
  }

  const pagesFeed: any[] = await getJson(`${origin}/wp-json/wp/v2/pages?per_page=100&_fields=slug,title,content`).catch(
    () => [],
  )
  return {
    origin,
    platform: 'woocommerce',
    currency,
    total,
    products,
    pages: pagesFeed.map((p) => ({
      title: decode(String(p.title?.rendered ?? '')),
      handle: String(p.slug),
      html: String(p.content?.rendered ?? ''),
    })),
  }
}
