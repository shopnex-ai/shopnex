// What the admin routes answer. Declared with `.output(...)` so the OpenAPI spec (and the types generated from it)
// describe responses, and the compiler checks each handler returns this shape. Row-shaped answers come from the
// Drizzle tables like the inputs in ./schemas do, so a new column shows up here by itself.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  CANCEL_REASONS,
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
