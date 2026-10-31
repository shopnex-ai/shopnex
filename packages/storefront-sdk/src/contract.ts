// Storefront API v1 contract. The server implements it (modules/api), clients consume it.
// Additive changes only: new procedures/fields/optional inputs; never rename or remove.
// Typed errors: clients get `error.code` + typed `error.data` instead of parsing messages.
import { oc, type InferContractRouterInputs, type InferContractRouterOutputs } from '@orpc/contract'
import { z } from 'zod'
import {
  Cart,
  CartLineInput,
  CartLineUpdateInput,
  CheckoutOptions,
  Collection,
  Customer,
  CustomerOrder,
  MailingAddressInput,
  ConnectionArgs,
  Menu,
  Page,
  Product,
  ProductSortKey,
  Shop,
  connection,
} from './schemas'
import { ThemeDocument, ThemeFilePath } from './theme'

// Every typed error the storefront can return. The server builds its errors from this map too,
// so codes, statuses and data shapes can't drift from what clients are told to expect.
export const storefrontErrorMap = {
  NOT_FOUND: {}, // unknown product/collection, or unknown or expired cart
  CART_COMPLETED: { status: 409 },
  LINE_NOT_FOUND: { status: 404, data: z.object({ lineIds: z.array(z.uuid()) }) },
  MERCHANDISE_NOT_FOUND: { status: 404, data: z.object({ merchandiseIds: z.array(z.uuid()) }) },
  OUT_OF_STOCK: { status: 400, data: z.object({ merchandiseId: z.uuid(), available: z.number().int() }) },
  EMPTY_CART: { status: 400 },
  /** No customer token, or it expired: sign in again */
  UNAUTHORIZED: { status: 401 },
  INVALID_CODE: { status: 400 },
  TOO_MANY_REQUESTS: { status: 429 },
  /** The shop doesn't send email (or turned the sign-in code off), so customers can't sign in */
  CUSTOMER_LOGIN_UNAVAILABLE: { status: 503 },
}

const {
  NOT_FOUND,
  UNAUTHORIZED,
  INVALID_CODE,
  TOO_MANY_REQUESTS,
  CUSTOMER_LOGIN_UNAVAILABLE,
  EMPTY_CART,
  ...cartOnlyErrors
} = storefrontErrorMap
const notFound = { NOT_FOUND }
const cartErrors = { NOT_FOUND, ...cartOnlyErrors }

export const storefrontContract = {
  shop: oc.tag('Storefront · Shop').router({
    get: oc.route({ method: 'GET', path: '/storefront/shop' }).output(Shop),
  }),

  products: oc.tag('Storefront · Products').router({
    list: oc
      .route({ method: 'GET', path: '/storefront/products' })
      .input(
        ConnectionArgs.extend({
          /** Collection handle */
          collection: z.string().optional(),
          /** Default: MANUAL with a collection, else newest first. Explicit keys sort ascending unless `reverse`. */
          sortKey: ProductSortKey.optional(),
          reverse: z.stringbool().or(z.boolean()).default(false),
        }),
      )
      .output(connection(Product)),
    get: oc
      .route({ method: 'GET', path: '/storefront/products/{id}' })
      .input(z.object({ id: z.uuid() }))
      .errors(notFound)
      .output(Product),
    getByHandle: oc
      .route({ method: 'GET', path: '/storefront/products/by-handle/{handle}' })
      .input(z.object({ handle: z.string() }))
      .errors(notFound)
      .output(Product),
  }),

  collections: oc.tag('Storefront · Collections').router({
    list: oc
      .route({ method: 'GET', path: '/storefront/collections' })
      .input(ConnectionArgs)
      .output(connection(Collection)),
    getByHandle: oc
      .route({ method: 'GET', path: '/storefront/collections/{handle}' })
      .input(z.object({ handle: z.string() }))
      .errors(notFound)
      .output(Collection),
  }),

  // Content pages (Shopify: page(handle), pages)
  pages: oc.tag('Storefront · Pages').router({
    list: oc.route({ method: 'GET', path: '/storefront/pages' }).input(ConnectionArgs).output(connection(Page)),
    getByHandle: oc
      .route({ method: 'GET', path: '/storefront/pages/{handle}' })
      .input(z.object({ handle: z.string() }))
      .errors(notFound)
      .output(Page),
  }),

  // Navigation menus the merchant edits in the admin (Online store → Navigation). Shopify: menu(handle)
  menu: oc.tag('Storefront · Navigation').router({
    get: oc
      .route({ method: 'GET', path: '/storefront/menus/{handle}' })
      .input(z.object({ handle: z.string() }))
      .errors(notFound)
      .output(Menu),
  }),

  // Shopify-style names: cartCreate / cartLinesAdd / cartLinesUpdate / cartLinesRemove
  cart: oc.tag('Storefront · Cart').router({
    create: oc
      .route({ method: 'POST', path: '/storefront/carts' })
      .input(z.object({ lines: z.array(CartLineInput).max(100).optional() }))
      .errors(cartErrors)
      .output(Cart),
    get: oc
      .route({ method: 'GET', path: '/storefront/carts/{id}' })
      .input(z.object({ id: z.string() }))
      .errors(notFound)
      .output(Cart),
    /** Adds to existing quantities (same merchandise merges into one line) */
    linesAdd: oc
      .route({ method: 'POST', path: '/storefront/carts/{cartId}/lines' })
      .input(z.object({ cartId: z.string(), lines: z.array(CartLineInput).min(1).max(100) }))
      .errors(cartErrors)
      .output(Cart),
    /** Sets quantities by line id; 0 removes */
    linesUpdate: oc
      .route({ method: 'PATCH', path: '/storefront/carts/{cartId}/lines' })
      .input(z.object({ cartId: z.string(), lines: z.array(CartLineUpdateInput).min(1).max(100) }))
      .errors(cartErrors)
      .output(Cart),
    linesRemove: oc
      .route({ method: 'POST', path: '/storefront/carts/{cartId}/lines/remove' })
      .input(z.object({ cartId: z.string(), lineIds: z.array(z.uuid()).min(1).max(100) }))
      .errors(cartErrors)
      .output(Cart),
    /** Replaces the cart's codes (Shopify cartDiscountCodesUpdate); [] removes. Unknown codes are kept with applicable: false */
    discountCodesUpdate: oc
      .route({ method: 'PUT', path: '/storefront/carts/{cartId}/discount-codes' })
      .input(z.object({ cartId: z.string(), discountCodes: z.array(z.string().trim().min(1).max(100)).max(1) }))
      .errors(cartErrors)
      .output(Cart),
  }),

  // The merchant's theme customizations (see ./theme). ≠ Shopify: themes there are Liquid, not API clients.
  theme: oc.tag('Storefront · Theme').router({
    /**
     * For storefronts with several themes: which theme to render and the merchant's document for it. That's
     * the shop's live theme, or with a valid preview token the copy being edited (its draft). `themeId` is
     * null for a shop without themes; `document` is null until published. Render your default theme, or
     * the theme's defaults, then — and fall back the same way when `themeId` isn't a theme you include.
     */
    current: oc
      .route({ method: 'GET', path: '/storefront/theme' })
      .input(
        z.object({
          /** From the editor's preview URL (THEME_PREVIEW_PARAM). Invalid or expired = the live theme */
          previewToken: z.string().max(500).optional(),
        }),
      )
      .output(
        z.object({
          themeId: z.string().nullable(),
          document: ThemeDocument.nullable(),
          /** True when `document` is a draft (don't cache it) */
          preview: z.boolean(),
          /** The copy has edited Liquid files (Edit code): load them with `theme.files` (null: none). A new
           * `version` means they changed. */
          files: z.object({ copyId: z.uuid(), version: z.number().int() }).nullable(),
        }),
      ),
    /**
     * The edited Liquid files of the theme `current` returns (same input): render them instead of the theme's
     * own files with the same path (snippets may be new). Readable with the publishable key, like everything a
     * storefront renders from.
     */
    files: oc
      .route({ method: 'GET', path: '/storefront/theme/files' })
      .input(z.object({ previewToken: z.string().max(500).optional() }))
      .output(
        z.object({
          copyId: z.uuid().nullable(),
          version: z.number().int(),
          files: z.record(ThemeFilePath, z.string()),
        }),
      ),
    /** For single-theme storefronts: the document for this theme when it's the shop's live theme (null
     * otherwise, or until published: render its defaults), or with a valid preview token the draft of a copy
     * of it being edited. */
    get: oc
      .route({ method: 'GET', path: '/storefront/themes/{themeId}' })
      .input(
        z.object({
          themeId: z.string(),
          /** From the editor's preview URL (THEME_PREVIEW_PARAM). Invalid or expired = published */
          previewToken: z.string().max(500).optional(),
        }),
      )
      .output(
        z.object({
          document: ThemeDocument.nullable(),
          /** True when `document` is the draft (don't cache it) */
          preview: z.boolean(),
        }),
      ),
  }),

  // Customer accounts: sign in with a code emailed to the customer. Shopify's Customer Account API is a separate
  // OAuth API; here it is part of this one. Send the token from `signIn` in the x-shopnex-customer-token header.
  customer: oc.tag('Storefront · Customer').router({
    /** Emails a sign-in code. The answer is the same whether or not the address has an account. */
    requestCode: oc
      .route({ method: 'POST', path: '/storefront/customer/code' })
      .input(z.object({ email: z.email().max(254) }))
      .errors({ TOO_MANY_REQUESTS, CUSTOMER_LOGIN_UNAVAILABLE })
      .output(z.object({ success: z.literal(true) })),
    /** Checks the code. A first sign-in creates the account; earlier guest orders with this email join it. */
    signIn: oc
      .route({ method: 'POST', path: '/storefront/customer/sign-in' })
      .input(z.object({ email: z.email().max(254), code: z.string().trim().min(4).max(12) }))
      .errors({ INVALID_CODE })
      .output(z.object({ token: z.string(), customer: Customer })),
    signOut: oc
      .route({ method: 'POST', path: '/storefront/customer/sign-out' })
      .output(z.object({ success: z.literal(true) })),
    get: oc.route({ method: 'GET', path: '/storefront/customer' }).errors({ UNAUTHORIZED }).output(Customer),
    update: oc
      .route({ method: 'PATCH', path: '/storefront/customer' })
      .input(
        z.object({
          name: z.string().trim().min(1).max(200).optional(),
          phone: z.string().trim().max(40).nullable().optional(),
        }),
      )
      .errors({ UNAUTHORIZED })
      .output(Customer),
    orders: oc
      .route({ method: 'GET', path: '/storefront/customer/orders' })
      .input(ConnectionArgs)
      .errors({ UNAUTHORIZED })
      .output(connection(CustomerOrder)),
    order: oc
      .route({ method: 'GET', path: '/storefront/customer/orders/{id}' })
      .input(z.object({ id: z.uuid() }))
      .errors({ UNAUTHORIZED, NOT_FOUND })
      .output(CustomerOrder),
  }),

  // ≠ Shopify: Storefront API can't place orders (hosted checkout only). Ours can, for headless checkouts.
  checkout: oc.tag('Storefront · Checkout').router({
    /** Shipping rates (priced for this cart), payment methods, and the cost for a rate + address */
    options: oc
      .route({ method: 'GET', path: '/storefront/carts/{cartId}/checkout-options' })
      .input(
        z.object({
          cartId: z.string(),
          /** For `cost`; defaults to the first rate */
          shippingRateId: z.string().max(200).optional(),
          /** For `cost.totalTaxAmount` (ISO 3166-1 alpha-2), and to ask the shop's carrier services for live rates */
          countryCode: z
            .string()
            .regex(/^[A-Z]{2}$/)
            .optional(),
          province: z.string().trim().max(100).optional(),
          /** With countryCode: what carrier services use to quote shipping */
          city: z.string().trim().max(100).optional(),
          zip: z.string().trim().max(20).optional(),
          address1: z.string().trim().max(200).optional(),
        }),
      )
      .errors(notFound)
      .output(CheckoutOptions),
    complete: oc
      .route({ method: 'POST', path: '/storefront/carts/{cartId}/complete' })
      .input(
        z.object({
          cartId: z.string(),
          email: z.email(),
          name: z.string().min(1).max(200).optional(),
          phone: z.string().trim().max(40).optional(),
          shippingAddress: MailingAddressInput.optional(),
          /** From checkout.options; defaults to the first rate. No rates configured = no shipping charge */
          shippingRateId: z.string().max(200).optional(),
          /** From checkout.options; defaults to the first method */
          paymentMethodId: z.uuid().optional(),
          note: z.string().trim().max(1000).optional(),
        }),
      )
      .errors({ ...cartErrors, EMPTY_CART })
      .output(
        z.object({
          orderId: z.uuid(),
          /** Shown to the buyer as "#1001" */
          orderNumber: z.number().int(),
          alreadyCompleted: z.boolean(),
          /**
           * Payments app methods (card…): send the buyer here to pay; they come back to the cart's checkoutUrl,
           * which shows the order and its payment status. Null for manual methods, or with `paymentError`.
           */
          paymentUrl: z.string().nullable(),
          /** The payment couldn't be started; the order is placed and unpaid, completing again retries */
          paymentError: z.string().nullable(),
        }),
      ),
  }),
}

export type StorefrontContract = typeof storefrontContract
export type StorefrontErrorMap = typeof storefrontErrorMap
export type StorefrontErrorCode = keyof StorefrontErrorMap

/** Input of any procedure, e.g. `StorefrontInputs['cart']['create']` */
export type StorefrontInputs = InferContractRouterInputs<StorefrontContract>
/** Output of any procedure, e.g. `StorefrontOutputs['products']['list']` */
export type StorefrontOutputs = InferContractRouterOutputs<StorefrontContract>
