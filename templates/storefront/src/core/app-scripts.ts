// What installed apps need from every page's head (added through `{{ content_for_header }}`, so every theme gets it): their
// scripts, and the page they are on. An app registers its script with ShopNex (scope write_storefront); the address is on
// the app's own origin. The page is described with meta tags, like the Storefront API address (`shopnex-url`):
//
//   <meta name="shopnex-page" content="product">          the template: index, collection, product, page, 404…
//   <meta name="shopnex-product" content="{product id}">  on a product page: which product (a plain UUID)
//
// Not in the theme editor's preview: the page is being edited there and an app's widget is not part of the theme.
import type { ThemePage } from './theme'

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// The API only hands out http(s) addresses on the app's own origin; this is the last line, since the value lands in a page
const isWebUrl = (value: string) => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export function appHeaderTags(page: ThemePage, scripts: readonly string[], preview: boolean): string[] {
  if (preview) return []
  return [
    `<meta name="shopnex-page" content="${attr(page.template)}">`,
    page.template === 'product' && `<meta name="shopnex-product" content="${attr(page.product.id)}">`,
    ...scripts.filter(isWebUrl).map((src) => `<script src="${attr(src)}" defer></script>`),
  ].filter((tag): tag is string => typeof tag === 'string')
}
