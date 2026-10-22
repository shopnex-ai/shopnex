// Menu links from the admin use Shopify's paths (see MenuItem.url); these are the storefront's routes.
import type { MenuItem } from '@shopnex/storefront-sdk'

export function menuItemHref(item: Pick<MenuItem, 'type' | 'url' | 'handle'>): string {
  switch (item.type) {
    case 'frontpage':
      return '/'
    case 'catalog':
    case 'search':
      return '/products'
    case 'collection':
      return item.handle ? `/collections/${item.handle}` : '/products'
    case 'product':
      return item.handle ? `/products/${item.handle}` : '/products'
    case 'page':
      return item.handle ? `/pages/${item.handle}` : '/'
    default:
      return safeUrl(item.url) ?? '/'
  }
}

/** A merchant-entered link or image URL, or null when it isn't a relative path, http(s) or mailto */
export function safeUrl(value: string | null | undefined): string | null {
  const url = value?.trim()
  if (!url) return null
  if (url.startsWith('/') || url.startsWith('#')) return url.startsWith('//') ? null : url
  return /^(https?:|mailto:)/i.test(url) ? url : null
}
