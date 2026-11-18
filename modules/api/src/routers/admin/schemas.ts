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
export { channelInput, publicationsInput, storefrontKeyInput } from '@shopnex/channels/contract'
export { appInput, marketplaceConnectInput } from '@shopnex/apps/contract'
export {
  collectionInput,
  imageInput,
  imageUrl,
  optionInput,
  productFields,
  seoInput,
  slug,
  variantInput,
  variantsInput,
} from '@shopnex/catalog/contract'
export { menuInput, pageInput } from '@shopnex/content/contract'
export {
  abandonedCartSettingsInput,
  emailInput,
  notificationParam,
  smtpInput,
  templateInput,
  templatePatchInput,
} from '@shopnex/email/contract'
export { MENU_ITEM_TYPES, MENU_MAX_DEPTH, type MenuItemType, type StoredMenuItem } from '@shopnex/content/schema'
export { aiAppConfigureInput, aiRunInput, aiSettingsInput } from '@shopnex/ai/contract'
export { DISCOUNT_TYPES, type DiscountType } from '@shopnex/pricing/schema'
export {
  customFieldInput,
  customFieldPatch,
  customFieldUpdates,
  customFieldValues,
} from '@shopnex/custom-fields/contract'
import { AI_CAPABILITIES, aiCapabilities, type AiCapability } from '@shopnex/marketplace-sdk/ai'
import { customers, CANCEL_REASONS, shippingRates, CHANNEL_TYPES } from '@shopnex/db/schema'
import { STAFF_ROLES } from '@shopnex/tenancy/schema'
import { storefrontKeys } from '@shopnex/channels/schema'
import { MENU_ITEM_TYPES, type StoredMenuItem } from '@shopnex/content/schema'
import { API_SCOPES, shops } from '@shopnex/core/schema'
import { NOTIFICATIONS, SMTP_PRESETS } from '@shopnex/email/schema'

const nonNegative = (s: z.ZodNumber) => s.nonnegative()

export const customerInput = createInsertSchema(customers, {
  email: () => z.email(),
  name: (s) => s.min(1),
  phone: (s) => s.min(1),
})
  .pick({ email: true, name: true, phone: true })
  .extend({ customFields: customFieldUpdates.optional() })

export { API_SCOPES, type ApiScope } from '@shopnex/core/schema'

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
