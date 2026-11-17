// Client-safe (zod + table definitions only): the admin imports these for form validation.
// Admin inputs are derived from the Drizzle tables (drizzle-zod): column types, nullability and
// required-ness come from the DB schema. Refinements below only add API policy (lengths, formats);
// drizzle-zod re-applies the column's nullable/optional on top of each refinement.
import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'
import { customFieldUpdates } from '@shopnex/custom-fields/contract'
export { discountCreateInput, discountInput, taxRateInput } from '@shopnex/pricing/contract'
export { s3Input, storageInput } from '@shopnex/files/contract'
export { paymentMethodInput, paymentsAppConfigureInput } from '@shopnex/payments/contract'
export {
  CURRENCY_CODES,
  apiTokenInput,
  domainInput,
  shopInput,
  staffInviteInput,
  staffRole,
} from '@shopnex/tenancy/contract'
export { channelInput, storefrontKeyInput } from '@shopnex/channels/contract'
export { appInput, marketplaceConnectInput } from '@shopnex/apps/contract'
export { aiAppConfigureInput, aiRunInput, aiSettingsInput } from '@shopnex/ai/contract'
export { DISCOUNT_TYPES, type DiscountType } from '@shopnex/pricing/schema'
export {
  customFieldInput,
  customFieldPatch,
  customFieldUpdates,
  customFieldValues,
} from '@shopnex/custom-fields/contract'
import { AI_CAPABILITIES, aiCapabilities, type AiCapability } from '@shopnex/marketplace-sdk/ai'
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
  shippingRates,
  shops,
  CHANNEL_TYPES,
  API_SCOPES,
  MENU_ITEM_TYPES,
  SMTP_PRESETS,
  NOTIFICATIONS,
  type StoredMenuItem,
} from '@shopnex/db/schema'
import { STAFF_ROLES } from '@shopnex/tenancy/schema'
import { storefrontKeys } from '@shopnex/channels/schema'

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
  fulfilledBy: () => z.string().trim().min(1).max(100).nullable().optional(),
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
    fulfilledBy: true,
    productType: true,
    tags: true,
    slug: true,
  })
  .partial({ slug: true })
  .extend({
    seo: seoInput.optional(),
    customFields: customFieldUpdates.optional(),
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
})
  .pick({ email: true, name: true, phone: true })
  .extend({ customFields: customFieldUpdates.optional() })

// Where a product or collection is published: the full list (channels left out are unpublished). A date in the
// future schedules the publication; omitted or null publishes now (a channel that stays keeps its date).
export const publicationsInput = z.object({
  publications: z
    .array(z.object({ channelId: z.uuid(), publishAt: z.coerce.date().nullish() }))
    .max(50)
    .refine((list) => new Set(list.map((p) => p.channelId)).size === list.length, 'Each channel once'),
})

export { API_SCOPES, type ApiScope } from '@shopnex/db/schema'

export const MIN_PASSWORD = 8

// First-run setup (/admin/setup): just the owner account. The shop keeps its defaults (DEFAULT_SHOP_NAME, USD) until
// it is renamed in Settings.
export const setupInput = z.object({
  email: z.email(),
  password: z.string().min(MIN_PASSWORD).max(128),
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

// Settings → Shipping / Payments (money in minor units)
export const shippingRateInput = createInsertSchema(shippingRates, {
  name: (s) => s.trim().min(1).max(100),
  priceCents: nonNegative,
  freeAboveCents: nonNegative,
}).pick({ name: true, priceCents: true, freeAboveCents: true, active: true })

export const cancelOrderInput = z.object({
  reason: z.enum(CANCEL_REASONS),
  restock: z.boolean(),
})

export const refundOrderInput = z.object({
  // In the smallest unit of the order's currency (cents), above zero and at most what is left to refund
  amountCents: z.number().int().positive(),
})

export const fulfillOrderInput = z.object({
  trackingCompany: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  trackingUrl: z.union([z.url({ protocol: /^https?$/ }).max(500), z.literal('')]).optional(),
})

export { webhookEndpointInput } from '@shopnex/webhooks/contract'
export { WEBHOOK_TOPICS, type WebhookTopic } from '@shopnex/webhooks/schema'

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

// How long a checkout with an email sits untouched before the reminder (the service enforces the limits)
export const abandonedCartSettingsInput = z.object({
  enabled: z.boolean().optional(),
  delayMinutes: z.number().int().optional(),
})

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

// Carrier services (Shopify carrierServiceCreate)
export const carrierServiceConfigureInput = z.object({
  /** Shown at checkout next to the rates when the service is first created, e.g. "CJ Dropshipping" (staff can rename it) */
  name: z.string().trim().min(1).max(100),
  /** Receives signed RatesRequests; must be on the app's own origin */
  ratesUrl: z.url({ protocol: /^https?$/ }),
  /** false hides it at checkout (e.g. until the merchant has connected the carrier) */
  ready: z.boolean(),
})

export {
  AI_CAPABILITIES,
  AI_LENGTHS,
  AI_PAGE_KINDS,
  AI_TONES,
  aiCapabilities,
  type AiCapability,
  type AiOutput,
} from '@shopnex/marketplace-sdk/ai'
