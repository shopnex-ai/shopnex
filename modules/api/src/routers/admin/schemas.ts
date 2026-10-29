// Client-safe (zod + table definitions only): the admin imports these for form validation.
// Admin inputs are derived from the Drizzle tables (drizzle-zod): column types, nullability and
// required-ness come from the DB schema. Refinements below only add API policy (lengths, formats);
// drizzle-zod re-applies the column's nullable/optional on top of each refinement.
import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  PRODUCT_STATUSES,
  SLUG_PATTERN,
  collections,
  customers,
  productImages,
  productOptionValues,
  productOptions,
  productVariants,
  products,
  CANCEL_REASONS,
  STAFF_ROLES,
  paymentMethods,
  shippingRates,
  shops,
  storefrontKeys,
  CHANNEL_TYPES,
  SHIPMENT_STATUSES,
  WEBHOOK_TOPICS,
  webhookEndpoints,
  API_SCOPES,
  DISCOUNT_TYPES,
  discounts,
  taxRates,
  MENU_ITEM_TYPES,
  S3_PRESETS,
  SMTP_PRESETS,
  NOTIFICATIONS,
  type StoredMenuItem,
} from '@shopnex/db/schema'

export const slug = z.string().min(1).max(120).regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens')

// Absolute http(s) URLs only: external images, or uploads (admin.files.upload returns their URL)
export const imageUrl = z.url({ protocol: /^https?$/ })

const nonNegative = (s: z.ZodNumber) => s.nonnegative()
const html = (s: z.ZodString) => s.max(100_000)

export const imageInput = createInsertSchema(productImages, {
  url: () => imageUrl,
  alt: (s) => s.max(300),
}).pick({ url: true, alt: true })

const optionValue = createInsertSchema(productOptionValues, { value: (s) => s.min(1).max(60) }).shape.value

export const optionInput = createInsertSchema(productOptions, { name: (s) => s.min(1).max(60) })
  .pick({ name: true })
  .extend({ values: z.array(optionValue).min(1).max(100) })

const variantColumns = createInsertSchema(productVariants, {
  sku: (s) => s.max(100),
  priceCents: nonNegative,
  compareAtPriceCents: nonNegative,
  inventoryQuantity: nonNegative,
  imageUrl: () => imageUrl,
})

export const variantInput = variantColumns
  .pick({ sku: true, priceCents: true, compareAtPriceCents: true, inventoryQuantity: true, imageUrl: true })
  // option name → value; omit for a product without options
  .extend({ options: z.record(z.string(), z.string()).optional() })

const productColumns = createInsertSchema(products, {
  title: (s) => s.min(1),
  // Only active products are visible to storefronts
  status: () => z.enum(PRODUCT_STATUSES),
  // Sanitized on save
  descriptionHtml: html,
  vendor: (s) => s.max(200),
  productType: (s) => s.max(200),
  tags: () => z.array(z.string().max(100)).max(250),
  seoTitle: (s) => s.max(200),
  seoDescription: (s) => s.max(500),
  // Omit to derive from the title
  slug: () => slug,
})

export const seoInput = z.object({
  title: productColumns.shape.seoTitle,
  description: productColumns.shape.seoDescription,
})

export const productFields = productColumns
  .pick({
    title: true,
    status: true,
    description: true,
    descriptionHtml: true,
    vendor: true,
    productType: true,
    tags: true,
    slug: true,
  })
  .partial({ slug: true })
  .extend({
    seo: seoInput.optional(),
    // Simple product: one default variant at this price. With variants: options + variants (each with its own price).
    priceCents: variantColumns.shape.priceCents.optional(),
    images: z.array(imageInput).max(20).optional(),
  })

export const variantsInput = z.object({
  options: z.array(optionInput).max(10),
  variants: z.array(variantInput).min(1).max(1000),
})

export const collectionInput = createInsertSchema(collections, {
  title: (s) => s.min(1),
  descriptionHtml: html,
  imageUrl: () => imageUrl,
  slug: () => slug,
})
  .pick({ title: true, slug: true, description: true, descriptionHtml: true, imageUrl: true })
  .partial({ slug: true })
  .extend({ seo: seoInput.optional() })

export const customerInput = createInsertSchema(customers, {
  email: () => z.email(),
  name: (s) => s.min(1),
  phone: (s) => s.min(1),
}).pick({ email: true, name: true, phone: true })

export const storefrontKeyInput = createInsertSchema(storefrontKeys, { name: (s) => s.min(1).max(100) })
  .pick({ name: true })
  // The channel the key reads; omitted: the Online Store
  .extend({ channelId: z.uuid().optional() })

// Settings → Channels. The handle and type are fixed once created.
export const channelInput = z.object({
  name: z.string().trim().min(1).max(100),
  handle: z.string().min(1).max(60).regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens').optional(),
  type: z.enum(CHANNEL_TYPES).optional(),
  autoPublish: z.boolean().optional(),
})

// Where a product or collection is published: the full list (channels left out are unpublished). A date in the
// future schedules the publication; omitted or null publishes now (a channel that stays keeps its date).
export const publicationsInput = z.object({
  publications: z
    .array(z.object({ channelId: z.uuid(), publishAt: z.coerce.date().nullish() }))
    .max(50)
    .refine((list) => new Set(list.map((p) => p.channelId)).size === list.length, 'Each channel once'),
})

// Settings → API tokens
export const apiTokenInput = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Grant at least one permission'),
})
export { API_SCOPES, type ApiScope } from '@shopnex/db/schema'

// ISO 4217 codes the runtime knows how to format (Node and browsers agree on this list)
export const CURRENCY_CODES: readonly string[] = Intl.supportedValuesOf('currency')

export const shopInput = createInsertSchema(shops, {
  name: (s) => s.trim().min(1).max(100),
  // Prices are stored in the shop's currency; existing orders keep the currency they were placed in
  currency: () => z.string().refine((c) => CURRENCY_CODES.includes(c), 'Choose a currency'),
  // Checkout's "Continue shopping" link
  storefrontUrl: () => z.url({ protocol: /^https?$/ }).max(500),
  // The homepage's <title> and meta description; empty = the shop name, none
  seoTitle: (s) => s.trim().max(200),
  seoDescription: (s) => s.trim().max(500),
}).pick({
  name: true,
  currency: true,
  storefrontUrl: true,
  seoTitle: true,
  seoDescription: true,
  taxesIncluded: true,
  taxShipping: true,
})

export const MIN_PASSWORD = 8

// First-run setup (/admin/setup): the owner account + the shop
export const setupInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(MIN_PASSWORD).max(128),
  shopName: shopInput.shape.name,
  currency: shopInput.shape.currency,
})

export {
  CANCEL_REASONS,
  FINANCIAL_STATUSES,
  FULFILLMENT_STATUSES,
  type CancelReason,
  type FinancialStatus,
  type FulfillmentStatus,
  type MailingAddress,
} from '@shopnex/db/schema'

// Shop staff (Admin → Staff)
export const staffRole = z.enum(STAFF_ROLES)
export const staffInviteInput = z.object({ email: z.email(), role: staffRole })

// Settings → Shipping / Payments (money in minor units)
export const shippingRateInput = createInsertSchema(shippingRates, {
  name: (s) => s.trim().min(1).max(100),
  priceCents: nonNegative,
  freeAboveCents: nonNegative,
}).pick({ name: true, priceCents: true, freeAboveCents: true, active: true })

export const paymentMethodInput = createInsertSchema(paymentMethods, {
  name: (s) => s.trim().min(1).max(100),
  additionalDetails: (s) => s.max(2000),
  instructions: (s) => s.max(5000),
}).pick({ name: true, additionalDetails: true, instructions: true, active: true })

// Discounts (money in minor units; percentage as a whole percent)
export const discountInput = createInsertSchema(discounts, {
  code: (s) => s.trim().min(1).max(100).regex(/^\S+$/, "Codes can't contain spaces"),
  type: () => z.enum(DISCOUNT_TYPES),
  value: (s) => s.int().nonnegative(),
  minSubtotalCents: nonNegative,
  usageLimit: (s) => s.int().min(1),
  // JSON clients send ISO strings
  startsAt: () => z.coerce.date(),
  endsAt: () => z.coerce.date(),
}).pick({
  code: true,
  type: true,
  value: true,
  minSubtotalCents: true,
  usageLimit: true,
  oncePerCustomer: true,
  active: true,
  startsAt: true,
  endsAt: true,
})

// Cross-field rules (the service enforces them too, for partial updates)
export const discountCreateInput = discountInput.superRefine((d, ctx) => {
  if (d.type === 'percentage' && (d.value < 1 || d.value > 100)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a percentage from 1 to 100' })
  }
  if (d.type === 'fixed_amount' && d.value < 1) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount above 0' })
  }
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must be after the start date' })
  }
})

export { DISCOUNT_TYPES, type DiscountType } from '@shopnex/db/schema'

// Settings → Taxes
export const taxRateInput = createInsertSchema(taxRates, {
  countryCode: () => z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
  // Blank = the whole country
  province: (s) => s.trim().max(100),
  name: (s) => s.trim().min(1).max(60),
  ratePercent: (s) => s.min(0).max(100),
}).pick({ countryCode: true, province: true, name: true, ratePercent: true })

export const cancelOrderInput = z.object({
  reason: z.enum(CANCEL_REASONS),
  restock: z.boolean(),
})

const trackingFields = {
  trackingCompany: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  trackingUrl: z.union([z.url({ protocol: /^https?$/ }).max(500), z.literal('')]).optional(),
}

// One shipment: some of the order's items with their own tracking (Shopify fulfillmentCreate)
export const fulfillOrderInput = z.object({
  ...trackingFields,
  /** What this shipment holds (order item ids and quantities). Omitted: everything not shipped yet. */
  items: z
    .array(z.object({ orderItemId: z.uuid(), quantity: z.number().int().min(1).max(99_999) }))
    .min(1)
    .max(200)
    .optional(),
  /** Email the customer a shipping confirmation (default true) */
  notifyCustomer: z.boolean().optional(),
})

// Tracking and where the shipment is (Shopify fulfillmentTrackingInfoUpdate / fulfillmentEventCreate)
export const fulfillmentUpdateInput = z.object({
  ...trackingFields,
  shipmentStatus: z.enum(SHIPMENT_STATUSES).optional(),
})

// Settings → Webhooks
export const webhookEndpointInput = createInsertSchema(webhookEndpoints, {
  url: () => z.url({ protocol: /^https?$/ }).max(2000),
  description: (s) => s.trim().max(200),
  topics: () => z.array(z.enum(WEBHOOK_TOPICS)).min(1, 'Pick at least one event'),
}).pick({ url: true, description: true, topics: true, active: true })

export { SHIPMENT_STATUSES, type ShipmentStatus } from '@shopnex/db/schema'
export { WEBHOOK_TOPICS, type WebhookTopic } from '@shopnex/db/schema'

// Admin → Apps (registry, super admins). Redirect URLs must be absolute; https except on localhost.
const redirectUrl = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), {
    message: 'Use https (http only for localhost)',
  })
export const appInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  iconUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullable()
    .optional(),
  appUrl: z.url({ protocol: /^https?$/ }).max(2000),
  // None: a managed app (installed in the admin, gets tokens with token exchange / client credentials)
  redirectUrls: z.array(redirectUrl).max(10),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Grant at least one permission'),
})

// Admin → Apps → Marketplace
export const marketplaceConnectInput = z.object({
  marketplaceUrl: z.url({ protocol: /^https?$/ }).max(2000),
  // This instance's public origin: the marketplace and apps must be able to reach it
  publicUrl: z.url({ protocol: /^https?$/ }).max(2000),
})

// Online store → Navigation. Items nest up to 3 levels (MENU_MAX_DEPTH), each level built from the one below.
// collection / product / page items need a resourceId, http items a url; fields that don't apply are cleared.
const menuItemFields = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().trim().min(1, 'Enter a name').max(255),
  type: z.enum(MENU_ITEM_TYPES),
  resourceId: z.uuid().nullish(),
  // Relative path, #anchor, http(s), mailto: or tel: (never javascript:)
  url: z
    .string()
    .trim()
    .max(2000)
    .regex(/^(\/|#|https?:\/\/|mailto:|tel:)/i, 'Use a path like /about, or a full https:// address')
    .nullish(),
})

const linksResource = (type: string) => type === 'collection' || type === 'product' || type === 'page'

const menuItem = <T extends z.ZodType>(children: T) =>
  menuItemFields
    .extend({ items: children })
    .superRefine((item, ctx) => {
      if (linksResource(item.type) && !item.resourceId) {
        ctx.addIssue({ code: 'custom', path: ['resourceId'], message: `Choose a ${item.type}` })
      }
      if (item.type === 'http' && !item.url) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Enter a link' })
      }
    })
    .transform((item) => ({
      ...item,
      resourceId: linksResource(item.type) ? item.resourceId! : null,
      url: item.type === 'http' ? item.url! : null,
    }))

// Typed like the stored tree (recursive), but the third level can't have sub-items
const menuItemLevel3 = menuItem(
  z.array(z.custom<StoredMenuItem>()).max(0, 'Menus nest 3 levels deep at most').default([]),
)
const menuItemLevel2 = menuItem(z.array(menuItemLevel3).max(50).default([]))
const menuItemLevel1 = menuItem(z.array(menuItemLevel2).max(50).default([]))

export const menuInput = z.object({
  handle: z
    .string()
    .trim()
    .min(1, 'Enter a handle')
    .max(100)
    .regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens'),
  title: z.string().trim().min(1, 'Enter a name').max(100),
  items: z.array(menuItemLevel1).max(50).default([]),
})

export { MENU_ITEM_TYPES, MENU_MAX_DEPTH, type MenuItemType, type StoredMenuItem } from '@shopnex/db/schema'

// Online store → Pages. The handle is generated from the title when omitted.
export const pageInput = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(255),
  handle: slug.optional(),
  bodyHtml: z.string().max(500_000).optional(),
  seo: seoInput.optional(),
  published: z.boolean().optional(),
})

// Settings → Storage: an S3-compatible bucket (AWS S3, Cloudflare R2, Spaces, B2, MinIO…)
const httpUrl = z.url({ protocol: /^https?$/ }).max(500)
export const s3Input = z.object({
  preset: z.enum(S3_PRESETS),
  endpoint: httpUrl,
  region: z.string().trim().min(1).max(64),
  bucket: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/, 'Use the bucket name exactly as your provider shows it'),
  accessKeyId: z.string().trim().min(1).max(256),
  // Optional when a key is already saved: leaving it empty keeps that one
  secretAccessKey: z.string().trim().max(512).optional(),
  publicUrl: httpUrl,
  forcePathStyle: z.boolean(),
  publicAcl: z.boolean(),
})

export const storageInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('local') }),
  z.object({ provider: z.literal('s3'), s3: s3Input }),
])

export const smtpInput = z.object({
  preset: z.enum(SMTP_PRESETS),
  host: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/, 'Host name only, like smtp.example.com'),
  port: z.number().int().min(1).max(65535),
  // Empty = no login (a local relay)
  username: z.string().trim().max(256),
  // Optional when one is already saved: leaving it empty keeps that one. Not trimmed: spaces can be part of it
  password: z.string().max(512).optional(),
  fromName: z.string().trim().max(100),
  fromEmail: z.email('Enter an email address'),
})

export const notificationParam = z.object({ notification: z.enum(NOTIFICATIONS) })

// Liquid source; syntax is checked by the email service (with the line of the error)
export const templateInput = z.object({
  subject: z.string().max(500),
  body: z.string().max(200_000),
})

// Turning a notification on/off and editing it are the same request
export const templatePatchInput = templateInput.partial().extend({ enabled: z.boolean().optional() })

export const emailInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('off') }),
  z.object({ provider: z.literal('smtp'), smtp: smtpInput }),
])

// Payments apps (Shopify paymentsAppConfigure)
export const paymentsAppConfigureInput = z.object({
  /** Shown at checkout when the method is first created, e.g. "Credit card" (staff can rename it) */
  name: z.string().trim().min(1).max(100),
  /** Gateway name snapshotted on orders, e.g. "stripe" */
  gateway: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Lowercase letters, digits, - and _')
    .refine((g) => g !== 'manual' && g !== 'app', 'Reserved gateway name'),
  /** Receives signed PaymentSessionRequests; must be on the app's own origin */
  paymentSessionUrl: z.url({ protocol: /^https?$/ }),
  /** Receives signed RefundSessionRequests; must be on the app's own origin */
  refundSessionUrl: z.url({ protocol: /^https?$/ }),
  /** false hides the method at checkout (e.g. until the merchant has entered provider keys) */
  ready: z.boolean(),
})
