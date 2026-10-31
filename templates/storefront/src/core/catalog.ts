// Product listings for /products, /collections/{handle} and /search: sort options, search and filters
// (?q=shoes&vendor=Acme&tag=sale&price_min=10&available=1&sort=price-asc) and cursor pagination (&after=cursor),
// shared by every theme.
import type { ProductSortKey, StorefrontClient } from '@shopnex/storefront-sdk'
import { moneyAmount } from '@shopnex/storefront-sdk/money'
import type { ThemePage } from './theme'
import { orNull, shopnex } from './shopnex'

type ProductFacets = Awaited<ReturnType<StorefrontClient['products']['facets']>>

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

// The query parameters of a listing's filters
const LIST_FILTERS = [
  { param: 'vendor', label: 'Vendor', key: 'vendors' },
  { param: 'type', label: 'Product type', key: 'productTypes' },
  { param: 'tag', label: 'Tag', key: 'tags' },
] as const

export type FilterValue = {
  label: string
  value: string
  /** Products with this value (before the other filters), null when unknown */
  count: number | null
  active: boolean
  /** The listing with this value selected, or unselected when it is */
  url: string
}

export type FilterGroup =
  | { label: string; param: string; type: 'list'; values: FilterValue[] }
  | {
      label: string
      param: 'price'
      type: 'price_range'
      currency: string
      /** The prices of the listing's products, as decimals ("19.99") */
      min: string
      max: string
      /** What is selected, "" for no limit */
      selected_min: string
      selected_max: string
      param_min: string
      param_max: string
      /** The listing's other parameters, for a form that submits the range */
      hidden: { name: string; value: string }[]
    }

/** A selected filter, with the listing without it */
export type ActiveFilter = { label: string; url: string }

export type CatalogFilters = {
  groups: FilterGroup[]
  active: ActiveFilter[]
  /** The listing without any filter (the search stays); null when none is selected */
  clearUrl: string | null
}

const digitsOf = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

/** "12.50" → 1250 (minor units); undefined for anything that isn't a price */
function toMinor(value: string | null, digits: number) {
  if (!value?.trim()) return undefined
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 10 ** digits) : undefined
}

/** The listing for a request (the collection template's page); null when the collection doesn't exist */
export async function loadCatalog(
  url: URL,
  collectionHandle?: string,
  options: { search?: boolean } = {},
): Promise<Extract<ThemePage, { template: 'collection' }> | null> {
  const params = url.searchParams
  const sort = sortOptions.find((o) => o.slug === params.get('sort')) ?? sortOptions[0]!
  const after = params.get('after') ?? undefined
  const query = params.get('q')?.trim().slice(0, 200) || undefined
  const search = options.search ? (query ?? '') : null
  const selected = Object.fromEntries(
    LIST_FILTERS.map((f) => [f.key, params.getAll(f.param).filter(Boolean)]),
  ) as Record<(typeof LIST_FILTERS)[number]['key'], string[]>
  const priceParams = { min: params.get('price_min'), max: params.get('price_max') }
  // Prices are in the shop's currency; reading them needs its number of decimals
  const digits =
    priceParams.min || priceParams.max
      ? digitsOf((await shopnex.shop.get().catch(() => null))?.currencyCode ?? 'USD')
      : 2

  // /search without a query lists nothing
  const [collection, products, facets] = await Promise.all([
    collectionHandle ? orNull(shopnex.collections.getByHandle({ handle: collectionHandle })) : null,
    search === ''
      ? null
      : orNull(
          shopnex.products.list({
            first: PAGE_SIZE,
            after,
            collection: collectionHandle,
            sortKey: sort.sortKey,
            reverse: sort.reverse,
            query,
            vendor: selected.vendors,
            productType: selected.productTypes,
            tag: selected.tags,
            minPrice: toMinor(priceParams.min, digits),
            maxPrice: toMinor(priceParams.max, digits),
            available: params.get('available') === '1' || undefined,
          }),
        ),
    search === '' ? null : orNull(shopnex.products.facets({ collection: collectionHandle, query })).catch(() => null),
  ])
  if (collectionHandle && !collection) return null
  return {
    template: 'collection',
    collection,
    products: products?.nodes ?? [],
    pageInfo: products?.pageInfo ?? { hasNextPage: false, endCursor: null },
    sort: sort.slug,
    search,
    filters: filtersFor(url, facets, selected, priceParams),
  }
}

function filtersFor(
  url: URL,
  facets: ProductFacets | null,
  selected: Record<(typeof LIST_FILTERS)[number]['key'], string[]>,
  price: { min: string | null; max: string | null },
): CatalogFilters {
  const groups: FilterGroup[] = []
  const active: ActiveFilter[] = []
  // The listing with `value` of `param` added, or removed when it is selected
  const toggle = (param: string, value: string) => {
    const next = new URL(url)
    const current = next.searchParams.getAll(param)
    next.searchParams.delete(param)
    for (const v of current.includes(value) ? current.filter((c) => c !== value) : [...current, value]) {
      next.searchParams.append(param, v)
    }
    next.searchParams.delete('after')
    return next.pathname + next.search
  }

  for (const { param, label, key } of LIST_FILTERS) {
    const offered = facets?.[key] ?? []
    // Selected values the listing no longer offers (a stale link) stay visible, so they can be removed
    const values: FilterValue[] = [
      ...offered.map((v) => ({ ...v, count: v.count as number | null })),
      ...selected[key].filter((v) => !offered.some((o) => o.value === v)).map((value) => ({ value, count: null })),
    ].map((v) => ({
      label: v.value,
      value: v.value,
      count: v.count,
      active: selected[key].includes(v.value),
      url: toggle(param, v.value),
    }))
    for (const v of values) if (v.active) active.push({ label: `${label}: ${v.label}`, url: v.url })
    // One value to choose from isn't a choice
    if (values.length > 1 || values.some((v) => v.active)) groups.push({ label, param, type: 'list', values })
  }

  const inStock = url.searchParams.get('available') === '1'
  const stockUrl = catalogHref(url, { available: inStock ? null : '1', after: null })
  // Nothing to filter in an empty listing
  if (facets?.price || inStock) {
    groups.push({
      label: 'Availability',
      param: 'available',
      type: 'list',
      values: [{ label: 'In stock', value: '1', count: null, active: inStock, url: stockUrl }],
    })
  }
  if (inStock) active.push({ label: 'In stock', url: stockUrl })

  if (facets?.price && facets.price.min.amountMinor < facets.price.max.amountMinor) {
    const hidden = [...url.searchParams]
      .filter(([name]) => !['price_min', 'price_max', 'after'].includes(name))
      .map(([name, value]) => ({ name, value }))
    const { min, max } = facets.price
    const selectedMin = price.min?.trim() ?? ''
    const selectedMax = price.max?.trim() ?? ''
    groups.push({
      label: 'Price',
      param: 'price',
      type: 'price_range',
      currency: min.currencyCode,
      min: moneyAmount(min),
      max: moneyAmount(max),
      selected_min: selectedMin,
      selected_max: selectedMax,
      param_min: 'price_min',
      param_max: 'price_max',
      hidden,
    })
    if (selectedMin || selectedMax) {
      const range =
        selectedMin && selectedMax
          ? `${selectedMin} – ${selectedMax}`
          : selectedMin
            ? `from ${selectedMin}`
            : `up to ${selectedMax}`
      active.push({
        label: `Price: ${range}`,
        url: catalogHref(url, { price_min: null, price_max: null, after: null }),
      })
    }
  }

  const clear = new URL(url)
  for (const name of ['vendor', 'type', 'tag', 'price_min', 'price_max', 'available', 'after'])
    clear.searchParams.delete(name)
  return { groups, active, clearUrl: active.length ? clear.pathname + clear.search : null }
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
