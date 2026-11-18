// What the admin routes answer. Declared with `.output(...)` so the OpenAPI spec (and the types generated from it)
// describe responses, and the compiler checks each handler returns this shape. Row-shaped answers come from the
// Drizzle tables like the inputs in ./schemas do, so a new column shows up here by itself.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
export { customFieldOutput } from '@shopnex/custom-fields/contract'
export { discountOutput, taxRateOutput } from '@shopnex/pricing/contract'
export { fileListOutput, fileOutput, storageSettingsOutput } from '@shopnex/files/contract'
export { paymentMethodOutput, paymentSessionOutput, paymentsAppOutput } from '@shopnex/payments/contract'
export {
  apiTokenCreatedOutput,
  apiTokenOutput,
  domainCreatedOutput,
  domainVerifiedOutput,
  domainsListOutput,
  invitationOutput,
  memberOutput,
  shopOutput,
  staffListOutput,
} from '@shopnex/tenancy/contract'
export { channelOutput, publicationsOutput, storefrontKeyOutput } from '@shopnex/channels/contract'
export {
  appCatalogOutput,
  appDataItemOutput,
  appDataKeyOutput,
  appDataValueOutput,
  appInstallationOutput,
  appInstalledOutput,
  appOutput,
  appRegisteredOutput,
  marketplaceConnectedOutput,
  marketplaceConnectionOutput,
  sessionTokenOutput,
} from '@shopnex/apps/contract'
export {
  collectionDetailOutput,
  collectionOutput,
  collectionProductOutput,
  productListOutput,
  productOutput,
  variantRowOutput,
} from '@shopnex/catalog/contract'
export { carrierServiceOutput, shippingRateOutput } from '@shopnex/cart/contract'
export { availableAppsOutput } from '@shopnex/payments/contract'
import { orderDetailOutput } from '@shopnex/orders/contract'
import { customerOutput } from '@shopnex/customers/contract'
import { customerErasedOutput } from '@shopnex/privacy/contract'
export { customerOutput } from '@shopnex/customers/contract'
export {
  analyticsOverviewOutput,
  orderCreatedOutput,
  orderDetailOutput,
  orderListItemOutput,
  orderOutput,
} from '@shopnex/orders/contract'
export { customerEraseOutput, customerErasedOutput, customerExportOutput } from '@shopnex/privacy/contract'
export { menuOutput, pageOutput } from '@shopnex/content/contract'
export {
  abandonedCartSettingsOutput,
  emailSettingsOutput,
  notificationDeliveryOutput,
  notificationListItemOutput,
  notificationOutput,
  notificationPreviewOutput,
  notificationTestOutput,
  testResultOutput,
} from '@shopnex/email/contract'
export { webhookDeliveryOutput, webhookListItemOutput, webhookOutput } from '@shopnex/webhooks/contract'
import type { WebhookTopic } from '@shopnex/webhooks/schema'
import { AI_CAPABILITIES, aiCapabilities } from '@shopnex/marketplace-sdk/ai'
import { customFieldValues } from './schemas'
import { shopDomains, shopInvitations, shopMembers } from '@shopnex/tenancy/schema'
import { storefrontKeys } from '@shopnex/channels/schema'
import { appInstallations, marketplaceConnection } from '@shopnex/apps/schema'
import { productOutput } from '@shopnex/catalog/contract'
import { menus, pages, type StoredMenuItem } from '@shopnex/content/schema'
import { API_SCOPES, apiTokens, apps, shops } from '@shopnex/core/schema'
import { emailDeliveries, NOTIFICATIONS, SMTP_PRESETS } from '@shopnex/email/schema'
import { carrierServices, shippingRates } from '@shopnex/cart/schema'
import {
  CANCEL_REASONS,
  FINANCIAL_STATUSES,
  FULFILLMENT_STATUSES,
  fulfillments,
  orderItems,
  orders,
  orderShippingLines,
  orderTransactions,
} from '@shopnex/orders/schema'
import { customers } from '@shopnex/customers/schema'
import { PRODUCT_STATUSES, products, productVariants } from '@shopnex/catalog/schema'
import { CHANNEL_TYPES, channels } from '@shopnex/channels/schema'

// --- everything else the admin routes answer ---

/** Deleting or toggling something: `{ ok: true }` */
export const okOutput = z.object({ ok: z.boolean() })
/** How many rows a bulk delete removed */
export const countOutput = z.number().int()

const scopes = z.array(z.enum(API_SCOPES))

// Domains, email, storage, files, notifications
// `inventory.updated`: one variant's stock after the change (null when an edit stopped tracking it)
const inventoryEventOutput = z.object({
  variantId: z.string(),
  productId: z.string(),
  sku: z.string().nullable(),
  inventoryQuantity: z.number().int().nullable(),
  // After minus before; null when either side was untracked
  change: z.number().int().nullable(),
  reason: z.enum(['order', 'restock', 'edit']),
  updatedAt: z.date(),
})

// The `data` of each webhook topic: the resource as the admin API returns it. The docs list its fields.
export const webhookPayloads: Record<WebhookTopic, z.ZodType> = {
  'order.created': orderDetailOutput,
  'order.paid': orderDetailOutput,
  'order.fulfilled': orderDetailOutput,
  'order.cancelled': orderDetailOutput,
  'order.updated': orderDetailOutput,
  'product.created': productOutput,
  'product.updated': productOutput,
  'inventory.updated': inventoryEventOutput,
  'customer.created': customerOutput,
  'customer.updated': customerOutput,
  'customer.erased': customerErasedOutput,
}
