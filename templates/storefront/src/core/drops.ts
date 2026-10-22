// The objects theme templates see. Names follow Shopify's Liquid (product.title, variant.available,
// collection.products, linklists['main-menu'].links…) so Shopify theme developers feel at home; the data comes
// from the Storefront API. `{{ product | json }}` gives the Storefront API's own shape (what theme scripts use
// with @shopnex/storefront-sdk types).
//
// Templates may come from third parties: drops keep their data in private fields, and everything they expose
// is read-only. Lazy values (a collection's products, menus) are fetched once per request by the Loader.
import { Drop } from 'liquidjs'
import type {
  Collection,
  Image,
  Menu,
  MenuItem,
  Money,
  Page,
  Product,
  ProductVariant,
  Shop,
  ThemeSettingField,
  ThemeSettings,
} from '@shopnex/storefront-sdk'
import { menuItemHref, safeUrl } from './links'
import { orNull, shopnex } from './shopnex'

/** HTML output as is (not escaped): rich text from the admin, `code` settings, content_for_* */
export class SafeHtml extends Drop {
  #html: string
  constructor(html: string) {
    super()
    this.#html = html
  }
  valueOf() {
    return this.#html
  }
  toString() {
    return this.#html
  }
  toJSON() {
    return this.#html
  }
}

/** A value fetched on first use: Liquid awaits it wherever it's read (`{{ x.y }}`, `{% for %}`, filters) */
export class Lazy<T> {
  #load: () => Promise<T>
  #promise?: Promise<T>
  constructor(load: () => Promise<T>) {
    this.#load = load
  }
  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    this.#promise ??= this.#load()
    return this.#promise.then(onFulfilled, onRejected)
  }
}

// ── request-scoped data ───────────────────────────────────────────────────────

/** Shopify's collection.products limit without pagination */
const PRODUCTS_PER_COLLECTION = 50

/** Storefront API reads for one request, each made at most once */
export class Loader {
  readonly #cache = new Map<string, Promise<unknown>>()

  constructor(readonly url: URL) {}

  #once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let promise = this.#cache.get(key) as Promise<T> | undefined
    if (!promise) {
      promise = load()
      this.#cache.set(key, promise)
    }
    return promise
  }

  shop() {
    return this.#once('shop', () => shopnex.shop.get().catch(() => null))
  }
  menu(handle: string) {
    return this.#once(`menu:${handle}`, () => orNull(shopnex.menu.get({ handle })).catch(() => null))
  }
  collections() {
    return this.#once('collections', () =>
      shopnex.collections
        .list({ first: 100 })
        .then((c) => c.nodes)
        .catch(() => [] as Collection[]),
    )
  }
  /** Newest first for all products, the collection's own order otherwise. A deleted collection has none. */
  products(collection?: string) {
    return this.#once(`products:${collection ?? ''}`, () =>
      shopnex.products
        .list({ first: PRODUCTS_PER_COLLECTION, collection })
        .then((p) => p.nodes)
        .catch(() => [] as Product[]),
    )
  }
}

// ── values ────────────────────────────────────────────────────────────────────

/** A price: outputs and compares as its amount in minor units (like Shopify's cents); `| money` formats it */
export class MoneyDrop extends Drop {
  #money: Money
  constructor(money: Money) {
    super()
    this.#money = money
  }
  get currency() {
    return this.#money.currencyCode
  }
  valueOf() {
    return this.#money.amountMinor
  }
  toJSON() {
    return this.#money
  }
  static unwrap(value: unknown): Money | null {
    return value instanceof MoneyDrop ? value.#money : null
  }
}

const money = (value: Money | null | undefined) => (value ? new MoneyDrop(value) : null)

export class ImageDrop extends Drop {
  #image: Image
  constructor(image: Image) {
    super()
    this.#image = image
  }
  get id() {
    return this.#image.id
  }
  get src() {
    return this.#image.url
  }
  get alt() {
    return this.#image.altText ?? ''
  }
  get width() {
    return this.#image.width
  }
  get height() {
    return this.#image.height
  }
  get aspect_ratio() {
    const { width, height } = this.#image
    return width && height ? width / height : null
  }
  /** `{{ image }}` outputs its URL */
  valueOf() {
    return this.#image.url
  }
  toJSON() {
    return this.#image
  }
}

const image = (value: Image | null | undefined) => (value ? new ImageDrop(value) : null)

// ── products ──────────────────────────────────────────────────────────────────

const optionsOf = (variant: ProductVariant) => Object.fromEntries(variant.selectedOptions.map((o) => [o.name, o.value]))

export class VariantDrop extends Drop {
  #variant: ProductVariant
  #product: Product
  #selected: boolean
  constructor(variant: ProductVariant, product: Product, selected: boolean) {
    super()
    this.#variant = variant
    this.#product = product
    this.#selected = selected
  }
  get id() {
    return this.#variant.id
  }
  get title() {
    return this.#variant.title
  }
  get sku() {
    return this.#variant.sku ?? ''
  }
  get available() {
    return this.#variant.availableForSale
  }
  get price() {
    return new MoneyDrop(this.#variant.price)
  }
  get compare_at_price() {
    return money(this.#variant.compareAtPrice)
  }
  /** The option values, in the product's option order */
  get options() {
    return this.#variant.selectedOptions.map((o) => o.value)
  }
  get option1() {
    return this.options[0] ?? null
  }
  get option2() {
    return this.options[1] ?? null
  }
  get option3() {
    return this.options[2] ?? null
  }
  get image() {
    return image(this.#variant.image)
  }
  get featured_image() {
    return this.image
  }
  /** The variant in the URL (?variant=), on the product page */
  get selected() {
    return this.#selected
  }
  get url() {
    return `/products/${this.#product.handle}?variant=${this.#variant.id}`
  }
  toJSON() {
    return this.#variant
  }
}

/** A value of one of the product's options, relative to the selected (or first available) variant */
export class OptionValueDrop extends Drop {
  constructor(
    readonly name: string,
    readonly selected: boolean,
    /** A variant with this value and the other selected values can be bought */
    readonly available: boolean,
  ) {
    super()
  }
  valueOf() {
    return this.name
  }
}

export class ProductDrop extends Drop {
  #product: Product
  #variants: VariantDrop[]
  #selected: VariantDrop | null
  #current: ProductVariant | undefined

  /** `selectedVariantId`: ?variant= on the product page */
  constructor(product: Product, selectedVariantId?: string | null) {
    super()
    this.#product = product
    const selected = product.variants.find((v) => v.id === selectedVariantId)
    this.#variants = product.variants.map((v) => new VariantDrop(v, product, v === selected))
    this.#selected = selected ? this.#variants[product.variants.indexOf(selected)]! : null
    this.#current = selected ?? product.variants.find((v) => v.availableForSale) ?? product.variants[0]
  }

  get id() {
    return this.#product.id
  }
  get handle() {
    return this.#product.handle
  }
  get title() {
    return this.#product.title
  }
  get url() {
    return `/products/${this.#product.handle}`
  }
  get vendor() {
    return this.#product.vendor
  }
  get type() {
    return this.#product.productType
  }
  get tags() {
    return this.#product.tags
  }
  get available() {
    return this.#product.availableForSale
  }
  /** Sanitized HTML from the admin; `| strip_html` for plain text */
  get description() {
    return new SafeHtml(this.#product.descriptionHtml)
  }
  get content() {
    return this.description
  }
  get featured_image() {
    return image(this.#product.featuredImage)
  }
  get images() {
    return this.#product.images.map((i) => new ImageDrop(i))
  }
  get variants() {
    return this.#variants
  }
  get has_only_default_variant() {
    return this.#product.options.length === 0 || this.#variants.length === 1
  }
  get selected_variant() {
    return this.#selected
  }
  get first_available_variant() {
    const index = this.#product.variants.findIndex((v) => v.availableForSale)
    return index === -1 ? null : this.#variants[index]!
  }
  get selected_or_first_available_variant() {
    return this.#current ? this.#variants[this.#product.variants.indexOf(this.#current)]! : null
  }
  /** Option names */
  get options() {
    return this.#product.options.map((o) => o.name)
  }
  get options_with_values() {
    const current = this.#current ? optionsOf(this.#current) : {}
    const buyable = this.#product.variants.filter((v) => v.availableForSale).map(optionsOf)
    return this.#product.options.map((option, index) => ({
      name: option.name,
      position: index + 1,
      selected_value: current[option.name] ?? null,
      values: option.optionValues.map((value) => {
        const wanted = { ...current, [option.name]: value.name }
        const available = buyable.some((v) => Object.entries(v).every(([k, x]) => wanted[k] === x))
        return new OptionValueDrop(value.name, current[option.name] === value.name, available)
      }),
    }))
  }
  get price() {
    return this.price_min
  }
  get price_min() {
    return new MoneyDrop(this.#product.priceRange.minVariantPrice)
  }
  get price_max() {
    return new MoneyDrop(this.#product.priceRange.maxVariantPrice)
  }
  get price_varies() {
    const { minVariantPrice, maxVariantPrice } = this.#product.priceRange
    return maxVariantPrice.amountMinor > minVariantPrice.amountMinor
  }
  get compare_at_price() {
    return this.compare_at_price_min
  }
  get compare_at_price_min() {
    return money(this.#product.compareAtPriceRange?.minVariantPrice)
  }
  get compare_at_price_max() {
    return money(this.#product.compareAtPriceRange?.maxVariantPrice)
  }
  get created_at() {
    return this.#product.createdAt
  }
  get updated_at() {
    return this.#product.updatedAt
  }
  toJSON() {
    return this.#product
  }
}

// ── collections ───────────────────────────────────────────────────────────────

/** Extra fields the collection template's collection has (catalog pages) */
export interface CatalogFields {
  /** This page's products */
  products: Product[]
  /** Slug of the sort option in use, '' for the default */
  sort_by: string
  sort_options: { name: string; value: string; url: string; selected: boolean }[]
}

/** A collection, or all products (`collections.all`, handle "all") */
export class CollectionDrop extends Drop {
  #collection: Collection | null
  #loader: Loader
  #catalog?: CatalogFields
  #products?: Lazy<ProductDrop[]>

  constructor(collection: Collection | null, loader: Loader, catalog?: CatalogFields) {
    super()
    this.#collection = collection
    this.#loader = loader
    this.#catalog = catalog
  }

  get id() {
    return this.#collection?.id ?? null
  }
  get handle() {
    return this.#collection?.handle ?? 'all'
  }
  get title() {
    return this.#collection?.title ?? 'All products'
  }
  get url() {
    return this.#collection ? `/collections/${this.#collection.handle}` : '/products'
  }
  /** Sanitized HTML from the admin; `| strip_html` for plain text */
  get description() {
    return new SafeHtml(this.#collection?.descriptionHtml ?? '')
  }
  get image() {
    return image(this.#collection?.image)
  }
  get featured_image() {
    return this.image
  }
  /** Up to 50 (Shopify's limit); on catalog pages, the page shown */
  get products() {
    if (this.#catalog) return this.#catalog.products.map((p) => new ProductDrop(p))
    this.#products ??= new Lazy(() =>
      this.#loader.products(this.#collection?.handle).then((products) => products.map((p) => new ProductDrop(p))),
    )
    return this.#products
  }
  get sort_by() {
    return this.#catalog?.sort_by ?? null
  }
  get sort_options() {
    return this.#catalog?.sort_options ?? []
  }
  toJSON() {
    return this.#collection
  }
}

/**
 * `collections`: the shop's collections (up to 100), also by handle (`collections['summer']`) and
 * `collections.all` (all products). Fetched the first time a template uses it.
 */
export function collectionsObject(loader: Loader) {
  return new Lazy(async () => {
    const list = (await loader.collections()).map((c) => new CollectionDrop(c, loader))
    const byHandle = Object.fromEntries(list.map((c) => [c.handle, c]))
    return Object.assign(list, byHandle, { all: new CollectionDrop(null, loader) })
  })
}

/** A collection setting's value: the collection, or nil when empty or deleted */
function collectionSetting(handle: unknown, loader: Loader) {
  if (typeof handle !== 'string' || !handle) return null
  return new Lazy(async () => {
    const found = (await loader.collections()).find((c) => c.handle === handle)
    return found ? new CollectionDrop(found, loader) : null
  })
}

// ── menus ─────────────────────────────────────────────────────────────────────

type Link = {
  title: string
  url: string
  type: MenuItem['type']
  handle: string | null
  /** The current page is this link's (or under it: a collection's products aren't, the catalog isn't) */
  active: boolean
  child_active: boolean
  links: Link[]
}

function links(items: MenuItem['items'] | MenuItem[], path: string): Link[] {
  return items.map((item) => {
    const url = menuItemHref(item)
    const children = links(item.items as MenuItem[], path)
    const active = path === url || (url !== '/' && url !== '/products' && path.startsWith(`${url}/`))
    return {
      title: item.title,
      url,
      type: item.type,
      handle: item.handle,
      active,
      child_active: children.some((c) => c.active || c.child_active),
      links: children,
    }
  })
}

/** `linklists['main-menu']`: a menu from Online store → Navigation, or nil when there's none */
export class LinklistsDrop extends Drop {
  #loader: Loader
  constructor(loader: Loader) {
    super()
    this.#loader = loader
  }
  liquidMethodMissing(handle: unknown) {
    if (typeof handle !== 'string') return null
    return this.#loader
      .menu(handle)
      .then((menu: Menu | null) =>
        menu ? { handle: menu.handle, title: menu.title, links: links(menu.items, this.#loader.url.pathname) } : null,
      )
  }
}

// ── the rest ──────────────────────────────────────────────────────────────────

export const shopObject = (shop: Shop | null) => ({
  name: shop?.name ?? 'Store',
  handle: shop?.handle ?? null,
  currency: shop?.currencyCode ?? null,
})

export const pageObject = (page: Page) => ({
  id: page.id,
  handle: page.handle,
  title: page.title,
  url: `/pages/${page.handle}`,
  /** Sanitized HTML from the admin */
  content: new SafeHtml(page.body),
  summary: page.bodySummary,
})

/**
 * Settings (the theme's, or a section's) as templates see them: `collection` fields are the collection,
 * `url` and `image` fields only safe URLs ('' otherwise: no javascript:), `code` fields output as is.
 */
export function settingsObject(fields: readonly ThemeSettingField[], values: ThemeSettings, loader: Loader) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = values[field.id]
      switch (field.type) {
        case 'collection':
          return [field.id, collectionSetting(value, loader)]
        case 'url':
        case 'image':
          return [field.id, safeUrl(value as string) ?? '']
        case 'code':
          return [field.id, typeof value === 'string' && value.trim() ? new SafeHtml(value) : '']
        default:
          return [field.id, value]
      }
    }),
  )
}
