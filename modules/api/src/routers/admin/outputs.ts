// What the admin routes answer. Declared with `.output(...)` so the OpenAPI spec (and the types generated from it)
// describe responses, and the compiler checks each handler returns this shape. Row-shaped answers come from the
// Drizzle tables like the inputs in ./schemas do, so a new column shows up here by itself.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { AI_CAPABILITIES, aiCapabilities } from '@shopnex/marketplace-sdk/ai'
import {
  API_SCOPES,
  CANCEL_REASONS,
  CHANNEL_TYPES,
  NOTIFICATIONS,
  S3_PRESETS,
  SMTP_PRESETS,
  AI_BUILTIN_PROVIDERS,
  type StoredMenuItem,
  type StoredThemeDocument,
  type ThemeRole,
  apiTokens,
  appInstallations,
  apps,
  channels,
  collections,
  discounts,
  files,
  menus,
  pages,
  paymentMethods,
  shippingRates,
  shopThemes,
  shopInvitations,
  storefrontKeys,
  taxRates,
  webhookDeliveries,
  FINANCIAL_STATUSES,
  FULFILLMENT_STATUSES,
  PRODUCT_STATUSES,
  WEBHOOK_TOPICS,
  customers,
  fulfillments,
  orderItems,
  orderShippingLines,
  orderTransactions,
  orders,
  productVariants,
  products,
  shops,
  webhookEndpoints,
} from '@shopnex/db/schema'

export const shopOutput = createSelectSchema(shops)

export const webhookOutput = createSelectSchema(webhookEndpoints, { topics: z.array(z.enum(WEBHOOK_TOPICS)) })

// The list also says who created each one
export const webhookListItemOutput = webhookOutput.extend({
  /** Name of the API token that created it, when one did */
  apiTokenName: z.string().nullable(),
  createdByApp: z.boolean(),
})

const variantOutput = createSelectSchema(productVariants)
  .pick({
    id: true,
    title: true,
    sku: true,
    priceCents: true,
    compareAtPriceCents: true,
    inventoryQuantity: true,
    imageUrl: true,
  })
  .extend({
    available: z.boolean(),
    /** option name → value */
    options: z.record(z.string(), z.string()),
    /** The same, as an array in option order */
    selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
  })

const optionOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  values: z.array(z.string()),
  optionValues: z.array(z.object({ id: z.uuid(), name: z.string(), firstSelectableVariantId: z.uuid().nullable() })),
})

export const productOutput = createSelectSchema(products, { status: z.enum(PRODUCT_STATUSES) }).extend({
  images: z.array(z.object({ id: z.uuid(), url: z.string(), alt: z.string().nullable() })),
  collectionSlugs: z.array(z.string()),
  options: z.array(optionOutput),
  variants: z.array(variantOutput),
})

export const productListOutput = z.object({
  items: z.array(
    productOutput.extend({ publications: z.array(z.object({ channelId: z.uuid(), publishedAt: z.date() })) }),
  ),
  total: z.number().int(),
})

export const orderOutput = createSelectSchema(orders, {
  financialStatus: z.enum(FINANCIAL_STATUSES),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  cancelReason: z.enum(CANCEL_REASONS).nullable(),
})

export const orderDetailOutput = orderOutput.extend({
  items: z.array(createSelectSchema(orderItems)),
  shippingLines: z.array(createSelectSchema(orderShippingLines)),
  transactions: z.array(createSelectSchema(orderTransactions)),
  fulfillments: z.array(createSelectSchema(fulfillments)),
  customer: createSelectSchema(customers).nullable(),
})

export const carrierServiceOutput = z.object({
  id: z.uuid(),
  appId: z.uuid().nullable(),
  name: z.string(),
  /** The merchant's switch in Settings → Shipping */
  active: z.boolean(),
  /** The app has what it needs to quote rates */
  ready: z.boolean(),
})

export const appDataValueOutput = z.object({ key: z.string(), value: z.unknown(), updatedAt: z.date() })

// --- everything else the admin routes answer ---

/** Deleting or toggling something: `{ ok: true }` */
export const okOutput = z.object({ ok: z.boolean() })
/** How many rows a bulk delete removed */
export const countOutput = z.number().int()

const scopes = z.array(z.enum(API_SCOPES))
const publications = z.array(z.object({ channelId: z.uuid(), publishedAt: z.date() }))
export const publicationsOutput = publications

// Channels, checkout settings
export const channelOutput = createSelectSchema(channels, { type: z.enum(CHANNEL_TYPES) })
export const shippingRateOutput = createSelectSchema(shippingRates)
export const paymentMethodOutput = createSelectSchema(paymentMethods, { provider: z.enum(['manual', 'app']) })
export const taxRateOutput = createSelectSchema(taxRates)

// Catalog
export const collectionOutput = createSelectSchema(collections)
export const collectionDetailOutput = collectionOutput.extend({ productCount: z.number().int(), publications })
export const collectionProductOutput = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(PRODUCT_STATUSES),
})
export const variantRowOutput = createSelectSchema(productVariants).extend({ available: z.boolean() })
export const customerOutput = createSelectSchema(customers)
export const discountOutput = createSelectSchema(discounts, {
  type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
})
export const pageOutput = createSelectSchema(pages)
export const menuOutput = createSelectSchema(menus).extend({ items: z.custom<StoredMenuItem[]>() })

// Orders
export const orderListItemOutput = orderOutput.extend({ customerName: z.string().nullable() })
export const orderCreatedOutput = orderOutput.extend({
  items: z.array(createSelectSchema(orderItems)),
  shippingLines: z.array(createSelectSchema(orderShippingLines)),
})

// Webhooks
export const webhookDeliveryOutput = createSelectSchema(webhookDeliveries)

// Apps and tokens
export const apiTokenOutput = createSelectSchema(apiTokens, { scopes }).omit({ tokenHash: true })
export const apiTokenCreatedOutput = apiTokenOutput.extend({ token: z.string() })
export const appOutput = createSelectSchema(apps, {
  scopes,
  source: z.enum(['custom', 'marketplace', 'bundled']),
}).extend({
  managed: z.boolean(),
})
export const appInstallationOutput = createSelectSchema(appInstallations, { scopes })
export const appInstalledOutput = appInstallationOutput.extend({ app: appOutput, lastUsedAt: z.date().nullable() })
export const appCatalogOutput = z.object({
  marketplaceConnected: z.boolean(),
  instanceUrl: z.string(),
  apps: z.array(
    appOutput.extend({
      origin: z.enum(['custom', 'marketplace', 'bundled']),
      installationId: z.string().nullable(),
      installed: z.boolean(),
    }),
  ),
})
export const appRegisteredOutput = z.object({ app: appOutput, privateKey: z.string() })
export const sessionTokenOutput = z.object({ token: z.string() })
export const marketplaceConnectionOutput = z
  .object({
    id: z.string(),
    marketplaceUrl: z.string(),
    publicUrl: z.string(),
    instanceId: z.string().nullable(),
    connectedAt: z.date().nullable(),
    lastSyncAt: z.date().nullable(),
    lastSyncError: z.string().nullable(),
  })
  .nullable()
export const marketplaceConnectedOutput = z.object({ connected: z.boolean() })
export const appDataItemOutput = z.object({ key: z.string(), value: z.unknown(), updatedAt: z.date() })
export const appDataKeyOutput = z.object({ key: z.string() })
/** Apps a shop can install for a job (payments, shipping) */
export const availableAppsOutput = z.object({
  instanceUrl: z.string(),
  apps: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      description: z.string().nullable(),
      iconUrl: z.string().nullable(),
      appUrl: z.string(),
      clientId: z.string(),
      redirectUrls: z.array(z.string()),
    }),
  ),
})
export const storefrontKeyOutput = createSelectSchema(storefrontKeys)

// Payments
export const paymentSessionOutput = z.object({
  id: z.uuid(),
  kind: z.enum(['refund', 'payment']),
  status: z.enum(['pending', 'resolved', 'rejected', 'expired']),
  orderId: z.uuid(),
  amount: z.object({ cents: z.number().int(), currency: z.string() }),
  externalId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  expiresAt: z.date(),
  resolvedAt: z.date().nullable(),
})
export const paymentsAppOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  gateway: z.string().nullable(),
  ready: z.boolean(),
  active: z.boolean(),
})

// Domains, email, storage, files, notifications
const domainOutput = z.object({
  id: z.uuid(),
  domain: z.string(),
  verified: z.boolean(),
  verifiedAt: z.date().nullable(),
  createdAt: z.date(),
  /** The DNS record that proves ownership */
  record: z.object({ type: z.literal('TXT'), name: z.string(), value: z.string() }),
})
export const domainsListOutput = z.object({ routing: z.boolean(), domains: z.array(domainOutput) })
export const domainVerifiedOutput = z.object({ verified: z.boolean(), domain: domainOutput })
export const domainCreatedOutput = domainOutput

const testSteps = z.array(z.object({ step: z.string(), ok: z.boolean(), error: z.string().optional() }))
export const testResultOutput = z.object({ ok: z.boolean(), steps: testSteps })
export const emailSettingsOutput = z.object({
  provider: z.enum(['off', 'smtp']),
  smtp: z
    .object({
      hasPassword: z.boolean(),
      preset: z.enum(SMTP_PRESETS),
      host: z.string(),
      port: z.number().int(),
      username: z.string(),
      fromName: z.string(),
      fromEmail: z.string(),
    })
    .nullable(),
})
export const storageSettingsOutput = z.object({
  provider: z.enum(['s3', 'local']),
  s3: z
    .object({
      hasSecret: z.boolean(),
      preset: z.enum(S3_PRESETS),
      endpoint: z.string(),
      region: z.string(),
      bucket: z.string(),
      accessKeyId: z.string(),
      publicUrl: z.string(),
      forcePathStyle: z.boolean(),
      publicAcl: z.boolean().optional(),
    })
    .nullable(),
})
export const fileOutput = createSelectSchema(files).extend({ url: z.string() })
export const fileListOutput = z.object({ items: z.array(fileOutput), total: z.number().int() })

const notificationBase = {
  enabled: z.boolean(),
  customized: z.boolean(),
  notification: z.enum(NOTIFICATIONS),
  title: z.string(),
  description: z.string(),
  audience: z.enum(['customer', 'staff', 'layout']),
}
export const notificationListItemOutput = z.object(notificationBase)
export const notificationOutput = z.object({
  ...notificationBase,
  subject: z.string(),
  body: z.string(),
  defaults: z.object({ subject: z.string(), body: z.string() }),
})
export const notificationDeliveryOutput = z.object({
  id: z.uuid(),
  notification: z.enum(NOTIFICATIONS),
  orderId: z.uuid().nullable(),
  to: z.string(),
  subject: z.string(),
  status: z.enum(['pending', 'failed', 'sent', 'skipped']),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
})
export const notificationPreviewOutput = z.object({
  sample: z.boolean(),
  subject: z.string(),
  html: z.string(),
  problem: z.object({ message: z.string(), line: z.number().int().nullable() }).nullable(),
})
export const notificationTestOutput = z.object({ to: z.string() })

// Staff
export const staffListOutput = z.object({
  members: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      role: z.string(),
      createdAt: z.date(),
      name: z.string(),
      email: z.string(),
    }),
  ),
  invitations: z.array(createSelectSchema(shopInvitations)),
})
export const invitationOutput = createSelectSchema(shopInvitations)
export const memberOutput = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: z.date(),
})

// Themes
const themeRole = z.enum(['live', 'unpublished']) satisfies z.ZodType<ThemeRole>
const themeDocument = z.custom<StoredThemeDocument>()
const themeRow = createSelectSchema(shopThemes, { role: themeRole }).omit({ files: true })
export const themeSummaryOutput = themeRow
  .omit({ shopId: true, draft: true, published: true, filesVersion: true })
  .extend({ unpublishedChanges: z.boolean() })
export const themeRowOutput = themeRow.omit({ shopId: true, draft: true, published: true }).nullable()
export const themeDetailOutput = themeRow.extend({ draft: themeDocument, published: themeDocument.nullable() })
export const themeFilesOutput = z.object({
  original: z.record(z.string(), z.string()),
  edited: z.record(z.string(), z.string()),
  changed: z.array(z.string()),
  rev: z.number().int(),
})
export const revOutput = z.object({ rev: z.number().int() })
export const themePublishCodeOutput = z.union([
  z.object({ published: z.literal(false), rev: z.number().int(), value: z.undefined().optional() }),
  z.object({ published: z.literal(true), rev: z.number().int(), value: z.void() }),
])
export const themeStoreOutput = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    tagline: z.string(),
    description: z.string().nullable(),
    developerName: z.string(),
    baseThemeId: z.string(),
    screenshotUrl: z.string().nullable(),
    listingUrl: z.string(),
    updatedAt: z.date(),
  }),
)
export const idOutput = z.object({ id: z.string() })
export const updatedAtOutput = z.object({ updatedAt: z.date() })
export const publishedAtOutput = z.object({ publishedAt: z.date() })
export const themeDraftOutput = z.object({ draft: themeDocument, updatedAt: z.date() })
export const previewTokenOutput = z.object({ token: z.string(), expiresAt: z.date() })

// AI
const aiCapability = z.enum(AI_CAPABILITIES)
const providerRef = z.object({ id: z.string(), name: z.string() })
export const aiAppConfigureOutput = z.object({ capabilities: z.record(z.string(), z.string()) })
export const aiCapabilitiesOutput = z.array(
  z.object({ capability: aiCapability, providers: z.array(providerRef.extend({ iconUrl: z.string().nullable() })) }),
)
const aiOutputs = Object.values(aiCapabilities).map((c) => c.output) as unknown as [
  z.ZodType,
  z.ZodType,
  ...z.ZodType[],
]
export const aiRunOutput = z.object({
  id: z.uuid(),
  capability: aiCapability,
  provider: providerRef,
  output: z.union(aiOutputs),
  usage: z
    .object({
      model: z.string().optional(),
      inputTokens: z.number().int().optional(),
      outputTokens: z.number().int().optional(),
    })
    .nullable(),
})
export const aiFeedbackOutput = z.object({ id: z.uuid(), feedback: z.enum(['rejected', 'accepted']).nullable() })
export const aiSettingsOutput = z.object({
  settings: z
    .object({ provider: z.enum(AI_BUILTIN_PROVIDERS), model: z.string(), brandVoice: z.string(), enabled: z.boolean() })
    .nullable(),
  providers: z.array(
    z.object({ id: z.enum(AI_BUILTIN_PROVIDERS), name: z.string(), keyHint: z.string(), models: z.array(z.string()) }),
  ),
})

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
