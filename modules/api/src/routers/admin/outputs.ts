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
import {
  CANCEL_REASONS,
  CHANNEL_TYPES,
  channels,
  FINANCIAL_STATUSES,
  FULFILLMENT_STATUSES,
  PRODUCT_STATUSES,
  customers,
  fulfillments,
  orderItems,
  orderShippingLines,
  orderTransactions,
  orders,
  productVariants,
  products,
} from '@shopnex/db/schema'
import { shopDomains, shopInvitations, shopMembers } from '@shopnex/tenancy/schema'
import { storefrontKeys } from '@shopnex/channels/schema'
import { appInstallations, marketplaceConnection } from '@shopnex/apps/schema'
import { productOutput } from '@shopnex/catalog/contract'
import { menus, pages, type StoredMenuItem } from '@shopnex/content/schema'
import { API_SCOPES, apiTokens, apps, shops } from '@shopnex/core/schema'
import { emailDeliveries, NOTIFICATIONS, SMTP_PRESETS } from '@shopnex/email/schema'
import { carrierServices, shippingRates } from '@shopnex/cart/schema'

export const orderOutput = createSelectSchema(orders, {
  financialStatus: z.enum(FINANCIAL_STATUSES),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  cancelReason: z.enum(CANCEL_REASONS).nullable(),
  customFields: customFieldValues,
})

export const orderDetailOutput = orderOutput.extend({
  items: z.array(createSelectSchema(orderItems)),
  shippingLines: z.array(createSelectSchema(orderShippingLines)),
  transactions: z.array(createSelectSchema(orderTransactions)),
  fulfillments: z.array(createSelectSchema(fulfillments)),
  customer: createSelectSchema(customers, { customFields: customFieldValues }).nullable(),
})

// --- everything else the admin routes answer ---

/** Deleting or toggling something: `{ ok: true }` */
export const okOutput = z.object({ ok: z.boolean() })
/** How many rows a bulk delete removed */
export const countOutput = z.number().int()

const scopes = z.array(z.enum(API_SCOPES))

export const customerOutput = createSelectSchema(customers, { customFields: customFieldValues })

// What the shop holds about one customer (Privacy → export). The orders, carts and emails are plain records: they are a
// document for a person to read, not a contract for code, and they grow with the data model
const record = z.record(z.string(), z.unknown())
export const customerExportOutput = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.date(),
  customer: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    customFields: customFieldValues,
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  loginAccount: z
    .object({
      name: z.string(),
      email: z.string(),
      emailVerified: z.boolean(),
      createdAt: z.date(),
      sessions: z.array(record),
    })
    .nullable(),
  orders: z.array(record),
  carts: z.array(record),
  emails: z.array(record),
  unsubscribedFromReminders: z.boolean(),
})

// What an erasure did, in counts (no personal data)
export const customerEraseOutput = z.object({
  ordersAnonymized: z.number().int(),
  cartsCleared: z.number().int(),
  emailsRedacted: z.number().int(),
  webhookDeliveriesDeleted: z.number().int(),
  loginAccountDeleted: z.boolean(),
})

// customer.erased: names the customer so a receiver can find and delete its own copy
export const customerErasedOutput = z.object({ id: z.uuid(), email: z.string() })

// Orders
export const orderListItemOutput = orderOutput.extend({ customerName: z.string().nullable() })
export const orderCreatedOutput = orderOutput.extend({
  items: z.array(createSelectSchema(orderItems)),
  shippingLines: z.array(createSelectSchema(orderShippingLines)),
})

// Domains, email, storage, files, notifications
// Analytics
const totals = z.object({
  salesCents: z.number(),
  orders: z.number().int(),
  averageOrderCents: z.number(),
  returningCustomerRate: z.number(),
})
export const analyticsOverviewOutput = z.object({
  current: totals,
  previous: totals,
  series: z.array(
    z.object({
      date: z.string(),
      previousDate: z.string(),
      salesCents: z.number(),
      orders: z.number().int(),
      previousSalesCents: z.number(),
      previousOrders: z.number().int(),
    }),
  ),
  topProducts: z.array(
    z.object({
      productId: z.string().nullable(),
      title: z.string(),
      imageUrl: z.string().nullable(),
      salesCents: z.number(),
      units: z.number().int(),
    }),
  ),
  attention: z.object({ unfulfilled: z.number().int(), unpaid: z.number().int() }),
})

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
