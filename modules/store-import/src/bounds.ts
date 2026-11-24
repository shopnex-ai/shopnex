// What a store sends is untrusted: the "store" is whatever server answers at the address someone typed, so any field can be
// huge, odd or hostile. The product API validates its input (limits on lengths and counts, http(s) image addresses), but the
// importer calls the catalog service directly, so it applies the same limits itself, before anything is written.
import type { ProductInput } from '@shopnex/catalog'

// The product API's own limits (modules/catalog/src/catalog.contract.ts), plus bounds on counts the API leaves open
const LIMITS = {
  title: 250,
  vendor: 200,
  productType: 200,
  tag: 100,
  tags: 250,
  descriptionHtml: 100_000,
  optionName: 60,
  optionValue: 60,
  sku: 100,
  alt: 300,
  // Shopify itself allows 3 options and 100 variants per product
  options: 3,
  variants: 100,
  images: 30,
  // The price column is a 32-bit integer
  maxCents: 2_000_000_000,
} as const

const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max)

/** An absolute http(s) address, or null: anything else (javascript:, data:, file:) is not a picture or a link we want to store */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const cents = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), LIMITS.maxCents) : 0
}

/** The product with every length, count and address held to the limits above. Option values are rebuilt from the variants kept. */
export function boundProduct(input: ProductInput): ProductInput {
  const names = [
    ...new Set((input.options ?? []).slice(0, LIMITS.options).map((o) => clip(o.name, LIMITS.optionName).trim())),
  ].filter(Boolean)
  const variants = (input.variants ?? []).slice(0, LIMITS.variants).map((v) => {
    const picked: Record<string, string> = {}
    for (const name of names) {
      const value = clip(v.options?.[name], LIMITS.optionValue).trim()
      if (value) picked[name] = value
    }
    const compareAt = cents(v.compareAtPriceCents)
    const price = cents(v.priceCents)
    return {
      sku: v.sku ? clip(v.sku, LIMITS.sku).trim() || null : null,
      priceCents: price,
      compareAtPriceCents: compareAt > price ? compareAt : null,
      inventoryQuantity: v.inventoryQuantity === 0 ? 0 : 10,
      imageUrl: httpUrl(v.imageUrl),
      ...(names.length ? { options: picked } : {}),
    }
  })
  return {
    title: clip(input.title, LIMITS.title) || 'Untitled',
    status: 'active',
    descriptionHtml: input.descriptionHtml ? clip(input.descriptionHtml, LIMITS.descriptionHtml) : null,
    vendor: clip(input.vendor, LIMITS.vendor),
    productType: clip(input.productType, LIMITS.productType),
    tags: (input.tags ?? []).slice(0, LIMITS.tags).map((t) => clip(t, LIMITS.tag)),
    images: (input.images ?? [])
      .flatMap((i) => {
        const url = httpUrl(i.url)
        return url ? [{ url, alt: i.alt ? clip(i.alt, LIMITS.alt) : null }] : []
      })
      .slice(0, LIMITS.images),
    ...(names.length
      ? {
          options: names.map((name) => ({
            name,
            values: [...new Set(variants.map((v) => v.options?.[name]).filter((x): x is string => !!x))],
          })),
        }
      : {}),
    variants,
  }
}

export const COLLECTION_TITLE_MAX = 100
export const PAGE_HTML_MAX = 100_000
export const PAGE_HANDLE_MAX = 120
