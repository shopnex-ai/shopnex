// What search engines and link previews read, added to every page's head by the storefront (through
// `{{ content_for_header }}`), so every theme gets it without writing it: the canonical URL, og:url and og:type,
// product prices for link previews, and structured data (schema.org JSON-LD) for Google's rich results.
// Themes keep the visible parts: <title>, the meta description, og:title/og:description/og:image.
import type { Product, Shop } from '@shopnex/storefront-sdk'
import { moneyAmount } from '@shopnex/storefront-sdk/money'
import type { ThemePage } from './theme'

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** JSON inside <script>: `<` escaped, so a product description can't close the tag */
const jsonLd = (data: object) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

/**
 * The page's one address: no sort order or selected variant, which show the same content. Pages of a catalog
 * keep their cursor (each is its own page to Google). None for the 404 page.
 */
export function canonicalUrl(page: ThemePage, url: URL): string | null {
  switch (page.template) {
    case '404':
    case 'account':
      return null
    case 'product':
      return `${url.origin}/products/${encodeURIComponent(page.product.handle)}`
    case 'collection': {
      const after = url.searchParams.get('after')
      return `${url.origin}${url.pathname}${after ? `?after=${encodeURIComponent(after)}` : ''}`
    }
    default:
      return `${url.origin}${url.pathname}`
  }
}

const AVAILABILITY = { true: 'https://schema.org/InStock', false: 'https://schema.org/OutOfStock' }

/** Google's Product rich result: one Offer per variant */
function productData(product: Product, canonical: string, origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    url: canonical,
    description: product.description || undefined,
    image: product.images.length ? product.images.map((i) => new URL(i.url, origin).href) : undefined,
    brand: product.vendor ? { '@type': 'Brand', name: product.vendor } : undefined,
    sku: product.variants.length === 1 ? (product.variants[0]!.sku ?? undefined) : undefined,
    offers: product.variants.map((v) => ({
      '@type': 'Offer',
      url: product.variants.length > 1 ? `${canonical}?variant=${v.id}` : canonical,
      sku: v.sku ?? undefined,
      name: product.variants.length > 1 ? v.title : undefined,
      price: moneyAmount(v.price),
      priceCurrency: v.price.currencyCode,
      availability: AVAILABILITY[`${v.availableForSale}`],
    })),
  }
}

/** The tags for one page; `preview` (the theme editor) keeps search engines out */
export function seoTags(page: ThemePage, url: URL, shop: Shop | null, preview: boolean): string[] {
  const canonical = canonicalUrl(page, url)
  const tags: (string | false | null)[] = [
    (preview || page.template === '404' || page.template === 'account') && `<meta name="robots" content="noindex">`,
    canonical && `<link rel="canonical" href="${attr(canonical)}">`,
    canonical && `<meta property="og:url" content="${attr(canonical)}">`,
    `<meta property="og:type" content="${page.template === 'product' ? 'product' : 'website'}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ]
  if (page.template === 'product' && canonical) {
    const { minVariantPrice } = page.product.priceRange
    tags.push(
      `<meta property="og:price:amount" content="${moneyAmount(minVariantPrice)}">`,
      `<meta property="og:price:currency" content="${attr(minVariantPrice.currencyCode)}">`,
      jsonLd(productData(page.product, canonical, url.origin)),
    )
  }
  if (page.template === 'index' && shop) {
    // Google's site name in search results
    tags.push(jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', name: shop.name, url: `${url.origin}/` }))
  }
  return tags.filter((t): t is string => !!t)
}
