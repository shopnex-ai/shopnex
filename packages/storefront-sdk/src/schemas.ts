// Storefront API v1 shapes, aligned with Shopify's Storefront API (checked against version 2026-10).
// Additive changes only from here on: never rename or remove a field — every storefront depends on this.
//
// Conventions (differences from Shopify are deliberate and marked ≠):
//   - Names follow Shopify: handle, selectedOptions, availableForSale, priceRange, featuredImage, seo…
//   - ≠ Money is integer minor units (`amountMinor`), not a decimal string — no float/rounding bugs.
//     Named differently from Shopify's `amount` on purpose so an adapter can't silently mix them up.
//   - ≠ IDs are plain UUIDs, not `gid://shopify/…`.
//   - Lists are connections ({ nodes, pageInfo }) with opaque cursors, so pagination can change later
//     without breaking clients. (Shopify also offers edges; nodes is enough.)
import { z } from 'zod'

// ── primitives ────────────────────────────────────────────────────────────────

export const Money = z.object({
  /** Integer minor units (cents for USD, yen for JPY). ≠ Shopify `amount: "19.99"` */
  amountMinor: z.number().int(),
  /** ISO 4217 */
  currencyCode: z.string().length(3),
})

export const Image = z.object({
  id: z.uuid().nullable(), // Shopify: id (nullable)
  url: z.string(),
  altText: z.string().nullable(),
  /** null until uploads record dimensions */
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
})

export const Seo = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
})

export const PageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
})

export const connection = <T extends z.ZodType>(node: T) => z.object({ nodes: z.array(node), pageInfo: PageInfo })

export const ConnectionArgs = z.object({
  first: z.coerce.number().int().min(1).max(100).default(20),
  /** Opaque cursor from pageInfo.endCursor */
  after: z.string().optional(),
})

// ── shop ──────────────────────────────────────────────────────────────────────

export const Shop = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  /** ≠ Shopify nests this as paymentSettings.currencyCode */
  currencyCode: z.string().length(3),
  /** The homepage's title and meta description (Shopify: Online store → Preferences) */
  seo: Seo,
})

// ── catalog ───────────────────────────────────────────────────────────────────

export const SelectedOption = z.object({ name: z.string(), value: z.string() })

// Shopify 2026-10: ProductOption.values is deprecated in favour of optionValues[]
export const ProductOptionValue = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Variant pairing this value with the first value of every other option (Shopify: firstSelectableVariant) */
  firstSelectableVariantId: z.uuid().nullable(), // ≠ Shopify returns the variant object
  // swatch (color / image): later, additive
})

export const ProductOption = z.object({
  id: z.uuid(),
  name: z.string(),
  /** In display order (Shopify 2026-10 deprecated the plain `values` list) */
  optionValues: z.array(ProductOptionValue),
})

export const ProductVariant = z.object({
  id: z.uuid(),
  /** "M / Black"; "Default Title" for a product without options (Shopify's convention) */
  title: z.string(),
  sku: z.string().nullable(),
  availableForSale: z.boolean(),
  price: Money,
  compareAtPrice: Money.nullable(),
  /** Ordered like Product.options; empty for the default variant */
  selectedOptions: z.array(SelectedOption),
  image: Image.nullable(),
})

export const PriceRange = z.object({
  minVariantPrice: Money,
  maxVariantPrice: Money,
})

export const Product = z.object({
  id: z.uuid(),
  handle: z.string(),
  title: z.string(),
  /** Plain text */
  description: z.string(),
  descriptionHtml: z.string(),
  vendor: z.string(),
  productType: z.string(),
  tags: z.array(z.string()),
  availableForSale: z.boolean(),
  options: z.array(ProductOption),
  variants: z.array(ProductVariant), // ≠ Shopify paginates variants; ours are bounded (≤ 1000) and returned inline
  priceRange: PriceRange,
  compareAtPriceRange: PriceRange.nullable(),
  featuredImage: Image.nullable(),
  images: z.array(Image),
  collectionHandles: z.array(z.string()),
  seo: Seo,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const Collection = z.object({
  id: z.uuid(),
  handle: z.string(),
  title: z.string(),
  description: z.string(),
  descriptionHtml: z.string(),
  image: Image.nullable(),
  seo: Seo,
  updatedAt: z.iso.datetime(),
})

/** MANUAL = the collection's own order (only with a collection filter). Shopify also has BEST_SELLING, RELEVANCE (later) */
export const ProductSortKey = z.enum(['CREATED_AT', 'TITLE', 'PRICE', 'MANUAL'])

// ── pages ─────────────────────────────────────────────────────────────────────

// Shopify Page: About, FAQ, Shipping policy… Only pages the merchant made visible are returned.
export const Page = z.object({
  id: z.uuid(),
  handle: z.string(),
  title: z.string(),
  /** HTML (sanitized by Shopnex) */
  body: z.string(),
  /** Plain-text start of the body, for listings and meta descriptions */
  bodySummary: z.string(),
  seo: Seo,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

// ── navigation ────────────────────────────────────────────────────────────────

// Shopify MenuItemType, lowercase. Blogs and policies come later (additive).
export const MenuItemType = z.enum(['frontpage', 'catalog', 'collection', 'product', 'page', 'search', 'http'])

const menuItemFields = {
  id: z.string(),
  title: z.string(),
  type: MenuItemType,
  /**
   * Shopify's paths: "/", "/collections/all", "/collections/{handle}", "/products/{handle}",
   * "/pages/{handle}", "/search", or the merchant's own address (http). Map them to your storefront's routes.
   */
  url: z.string(),
  /** The linked collection, product or page (Shopify: resourceId) */
  resourceId: z.uuid().nullable(),
  /** Its handle, so storefronts can build their own route. ≠ Shopify (resource lookup instead) */
  handle: z.string().nullable(),
}

// Three levels, like Shopify (spelled out rather than recursive, so the OpenAPI schema stays finite)
const MenuItemLevel3 = z.object({ ...menuItemFields, items: z.array(z.never()) })
const MenuItemLevel2 = z.object({ ...menuItemFields, items: z.array(MenuItemLevel3) })
export const MenuItem = z.object({ ...menuItemFields, items: z.array(MenuItemLevel2) })

export const Menu = z.object({
  id: z.uuid(),
  /** e.g. "main-menu", "footer" (the admin's defaults) */
  handle: z.string(),
  title: z.string(),
  /** Links to deleted collections, unavailable products or hidden pages are already left out */
  items: z.array(MenuItem),
})

// ── cart ──────────────────────────────────────────────────────────────────────

/** What a cart line points at — a variant plus enough of its product to render the line */
export const Merchandise = z.object({
  id: z.uuid(), // variant id
  title: z.string(),
  sku: z.string().nullable(),
  selectedOptions: z.array(SelectedOption),
  image: Image.nullable(), // variant image, else the product's featured image
  product: z.object({ id: z.uuid(), handle: z.string(), title: z.string() }),
})

// Shopify CartDiscountAllocation (code discounts only)
export const CartDiscountAllocation = z.object({
  code: z.string(),
  discountedAmount: Money,
})

// Shopify CartDiscountCode
export const CartDiscountCode = z.object({
  code: z.string(),
  /** false when the code is unknown, inactive, used up, or the subtotal is below its minimum */
  applicable: z.boolean(),
})

export const CartLine = z.object({
  /** Line id — used by cart.linesUpdate / linesRemove (Shopify style) */
  id: z.uuid(),
  quantity: z.number().int(),
  merchandise: Merchandise,
  /** false when stock is below the requested quantity */
  availableForSale: z.boolean(),
  cost: z.object({
    amountPerQuantity: Money,
    compareAtAmountPerQuantity: Money.nullable(),
    /** Before line-level discounts */
    subtotalAmount: Money,
    /** What the buyer pays for the line: subtotal minus its discount allocations */
    totalAmount: Money,
  }),
  /** This line's share of order discounts */
  discountAllocations: z.array(CartDiscountAllocation),
})

export const Cart = z.object({
  /** Secret-ish bearer id — keep it private (localStorage/cookie) */
  id: z.string(),
  checkoutUrl: z.string(),
  status: z.enum(['active', 'completed']), // ≠ Shopify has no status; ours tells you it was checked out
  totalQuantity: z.number().int(),
  lines: z.array(CartLine), // ≠ Shopify paginates lines; ours are bounded (≤ 100)
  // Shopify 2026-10 deprecated CartCost.totalTaxAmount/totalDutyAmount — we don't add them
  // (tax depends on the address: see checkout.options `cost`)
  cost: z.object({
    subtotalAmount: Money,
    /** Subtotal minus discounts; shipping and tax are added at checkout */
    totalAmount: Money,
  }),
  /** At most one code for now (cart.discountCodesUpdate) */
  discountCodes: z.array(CartDiscountCode),
  /** Order-level discounts applied to the cart (sum of the lines' allocations) */
  discountAllocations: z.array(CartDiscountAllocation),
  orderId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const CartLineInput = z.object({
  merchandiseId: z.uuid(),
  quantity: z.number().int().min(1).max(999),
})

export const CartLineUpdateInput = z.object({
  id: z.uuid(), // line id
  quantity: z.number().int().min(0).max(999), // 0 removes the line
})

// Shopify CartDeliveryAddressInput. ≠ `province` is free text (no provinceCode list yet).
export const MailingAddressInput = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().min(1).max(100),
  company: z.string().trim().max(200).optional(),
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().max(100).optional(),
  /** ISO 3166-1 alpha-2, e.g. "US" */
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code'),
  zip: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
})

// ── customer accounts ─────────────────────────────────────────────────────────

export const Customer = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
})

/** An address as placed on an order (a snapshot) */
export const OrderAddress = z.object({
  name: z.string(),
  company: z.string().nullable(),
  address1: z.string(),
  address2: z.string().nullable(),
  city: z.string(),
  province: z.string().nullable(),
  /** ISO 3166-1 alpha-2 */
  countryCode: z.string(),
  zip: z.string().nullable(),
  phone: z.string().nullable(),
})

export const OrderLine = z.object({
  title: z.string(),
  variantTitle: z.string().nullable(),
  quantity: z.number().int(),
  image: Image.nullable(),
  /** Per unit */
  price: Money,
  /** After this line's share of discounts */
  totalPrice: Money,
})

export const OrderFulfillment = z.object({
  trackingCompany: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  createdAt: z.string(),
})

/** One of the signed-in customer's orders (Shopify: Order, customer account view) */
export const CustomerOrder = z.object({
  id: z.uuid(),
  /** Shown as "#1001" */
  orderNumber: z.number().int(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  financialStatus: z.string(),
  fulfillmentStatus: z.string(),
  subtotalPrice: Money,
  shippingPrice: Money,
  totalDiscounts: Money,
  totalTax: Money,
  totalPrice: Money,
  paymentMethod: z.string().nullable(),
  /** How to pay, for a manual method that is still unpaid */
  paymentInstructions: z.string().nullable(),
  lines: z.array(OrderLine),
  fulfillments: z.array(OrderFulfillment),
  shippingAddress: OrderAddress.nullable(),
})

// Shopify CartDeliveryOption (one delivery group: rates apply to the whole cart)
export const ShippingRate = z.object({
  /** A flat rate's id, or carrier:{service}:{code} for a carrier service's live rate (only with an address) */
  id: z.string().max(200),
  title: z.string(),
  /** A carrier service's note, e.g. "2-5 days" */
  description: z.string().nullable().optional(),
  /** For this cart: 0 when its subtotal reached the free-shipping threshold */
  price: Money,
})

// Manual payment methods (bank transfer, cash on delivery…): the order is placed unpaid and the shop
// confirms payment. Payments app methods (card…): the buyer pays on the provider's page (checkout.complete's
// paymentUrl). ≠ Shopify's Storefront API has no payment step (its checkout is hosted only).
export const PaymentMethod = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Shown when the buyer picks this method */
  additionalDetails: z.string().nullable(),
  /** True: the buyer is sent to the payment provider after placing the order */
  offsite: z.boolean(),
})

// What the buyer pays for the chosen shipping rate and address (estimate; final when the order is placed)
export const CheckoutCost = z.object({
  subtotalAmount: Money,
  /** Before shipping discounts */
  shippingAmount: Money,
  /** Line and shipping discounts */
  discountAmount: Money,
  /** null until an address is given (tax depends on it). Part of the prices when `taxesIncluded` */
  totalTaxAmount: Money.nullable(),
  taxesIncluded: z.boolean(),
  totalAmount: Money,
})

export const CheckoutOptions = z.object({
  shippingRates: z.array(ShippingRate),
  paymentMethods: z.array(PaymentMethod),
  cost: CheckoutCost,
})

// ── types ─────────────────────────────────────────────────────────────────────

export type Money = z.infer<typeof Money>
export type Image = z.infer<typeof Image>
export type Seo = z.infer<typeof Seo>
export type PageInfo = z.infer<typeof PageInfo>
export type Connection<T> = { nodes: T[]; pageInfo: PageInfo }
export type ConnectionArgs = z.input<typeof ConnectionArgs>
export type Shop = z.infer<typeof Shop>
export type Customer = z.infer<typeof Customer>
export type CustomerOrder = z.infer<typeof CustomerOrder>
export type OrderAddress = z.infer<typeof OrderAddress>
export type SelectedOption = z.infer<typeof SelectedOption>
export type ProductOptionValue = z.infer<typeof ProductOptionValue>
export type ProductOption = z.infer<typeof ProductOption>
export type ProductVariant = z.infer<typeof ProductVariant>
export type PriceRange = z.infer<typeof PriceRange>
export type Product = z.infer<typeof Product>
export type Collection = z.infer<typeof Collection>
export type ProductSortKey = z.infer<typeof ProductSortKey>
export type Page = z.infer<typeof Page>
export type MenuItemType = z.infer<typeof MenuItemType>
export type MenuItem = z.infer<typeof MenuItem>
export type Menu = z.infer<typeof Menu>
export type Merchandise = z.infer<typeof Merchandise>
export type CartLine = z.infer<typeof CartLine>
export type Cart = z.infer<typeof Cart>
export type CartLineInput = z.input<typeof CartLineInput>
export type CartLineUpdateInput = z.input<typeof CartLineUpdateInput>
export type MailingAddressInput = z.input<typeof MailingAddressInput>
export type ShippingRate = z.infer<typeof ShippingRate>
export type PaymentMethod = z.infer<typeof PaymentMethod>
export type CheckoutOptions = z.infer<typeof CheckoutOptions>
export type CheckoutCost = z.infer<typeof CheckoutCost>
export type CartDiscountCode = z.infer<typeof CartDiscountCode>
export type CartDiscountAllocation = z.infer<typeof CartDiscountAllocation>
