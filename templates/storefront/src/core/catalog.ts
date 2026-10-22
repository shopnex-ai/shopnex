// Product listings for /products and /collections/{handle}: sort options and cursor pagination
// (?sort=price-asc&after=cursor), shared by every theme.
import type { ProductSortKey } from '@shopnex/storefront-sdk'
import type { ThemePage } from './theme'
import { orNull, shopnex } from './shopnex'

export const PAGE_SIZE = 24

export type SortOption = { slug: string | null; title: string; sortKey?: ProductSortKey; reverse?: boolean }

// The default (slug null) is the collection's own order, or newest first for all products
export const sortOptions: SortOption[] = [
  { slug: null, title: 'Featured' },
  { slug: 'latest-desc', title: 'Latest arrivals', sortKey: 'CREATED_AT', reverse: true },
  { slug: 'title-asc', title: 'Alphabetically, A–Z', sortKey: 'TITLE', reverse: false },
  { slug: 'price-asc', title: 'Price: Low to high', sortKey: 'PRICE', reverse: false },
  { slug: 'price-desc', title: 'Price: High to low', sortKey: 'PRICE', reverse: true },
]

/** The listing for a request (the collection template's page); null when the collection doesn't exist */
export async function loadCatalog(
  url: URL,
  collectionHandle?: string,
): Promise<Extract<ThemePage, { template: 'collection' }> | null> {
  const sort = sortOptions.find((o) => o.slug === url.searchParams.get('sort')) ?? sortOptions[0]!
  const after = url.searchParams.get('after') ?? undefined
  const [collection, products] = await Promise.all([
    collectionHandle ? orNull(shopnex.collections.getByHandle({ handle: collectionHandle })) : null,
    orNull(
      shopnex.products.list({
        first: PAGE_SIZE,
        after,
        collection: collectionHandle,
        sortKey: sort.sortKey,
        reverse: sort.reverse,
      }),
    ),
  ])
  if (collectionHandle && !collection) return null
  return {
    template: 'collection',
    collection,
    products: products?.nodes ?? [],
    pageInfo: products?.pageInfo ?? { hasNextPage: false, endCursor: null },
    sort: sort.slug,
  }
}

/** The same listing URL with other query parameters (null removes one) */
export function catalogHref(url: URL, changes: Record<string, string | null>) {
  const next = new URL(url)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.searchParams.delete(key)
    else next.searchParams.set(key, value)
  }
  return next.pathname + next.search
}
