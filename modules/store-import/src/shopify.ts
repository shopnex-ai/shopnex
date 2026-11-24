// Shopify: /products.json (250 per page), /pages.json, /meta.json. All public, no login.
import type { ProductInput } from '@shopnex/catalog'
import type { Fetcher } from './fetcher'
import type { Found } from './types'

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX'])

/**
 * A tag that holds data rather than a label, like Allbirds' `allbirds::gender => unisex` (namespace::key => value:
 * stores and apps keep data in tags). It is no use to the new shop's shoppers and would show up in its tag filter.
 */
export const isDataTag = (tag: string) => tag.includes('::') || tag.includes(' => ')

export async function fetchShopify(origin: string, max: number, fetcher: Fetcher): Promise<Found> {
  const getJson = fetcher.json
  const meta = await getJson(origin + '/meta.json').catch(() => null)
  const currency: string = meta?.currency ?? 'USD'
  const minor = ZERO_DECIMAL.has(currency) ? 1 : 100
  const cents = (value: string | null | undefined) =>
    value == null || value === '' ? null : Math.round(Number(value) * minor)

  const raw: any[] = []
  for (let page = 1; raw.length < max; page++) {
    const data = await getJson(`${origin}/products.json?limit=${Math.min(250, max)}&page=${page}`)
    if (!data.products?.length) break
    raw.push(...data.products)
    if (data.products.length < Math.min(250, max)) break
  }
  raw.length = Math.min(raw.length, max)

  function toInput(p: any): ProductInput {
    // The placeholder option Shopify adds to products without options
    const options = (p.options ?? []).filter(
      (o: any) => o.name !== 'Title' && !(o.values.length === 1 && o.values[0] === 'Default Title'),
    )
    const optionNames: string[] = (p.options ?? []).map((o: any) => o.name)
    const variants = p.variants.map((v: any) => {
      const picked: Record<string, string> = {}
      for (const o of options) {
        const value = v[`option${optionNames.indexOf(o.name) + 1}`]
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
    const labels = tags.filter((t) => !isDataTag(String(t)))
    return {
      title: String(p.title).slice(0, 250),
      status: 'active',
      descriptionHtml: p.body_html || null,
      vendor: p.vendor ?? '',
      productType: p.product_type ?? '',
      tags: labels.slice(0, 250),
      images: (p.images ?? []).map((i: any) => ({ url: i.src, alt: i.alt ? String(i.alt).slice(0, 300) : null })),
      ...(options.length ? { options: options.map((o: any) => ({ name: o.name, values: o.values })) } : {}),
      variants,
    }
  }

  const pagesFeed: any[] = (await getJson(`${origin}/pages.json?limit=250`).catch(() => ({ pages: [] }))).pages ?? []
  return {
    origin,
    platform: 'shopify',
    currency,
    products: raw.map((p) => ({
      input: toInput(p),
      groups: String(p.product_type ?? '').trim() ? [String(p.product_type).trim()] : [],
      groupImage: p.images?.[0]?.src ?? null,
    })),
    pages: pagesFeed.map((p) => ({
      title: String(p.title),
      handle: String(p.handle),
      html: String(p.body_html ?? ''),
    })),
  }
}
