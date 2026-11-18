// The shapes of this module's API: what the order and dashboard routes take and answer. Plain Zod, no oRPC or server code (the admin
// imports the inputs for form validation). Cancelling and refunding are routes of @shopnex/payments (they send the refund to the app).
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { customerOutput } from '@shopnex/customers/contract'
import { customFieldValues } from '@shopnex/custom-fields/contract'
import {
  CANCEL_REASONS,
  FINANCIAL_STATUSES,
  FULFILLMENT_STATUSES,
  fulfillments,
  orderItems,
  orderShippingLines,
  orderTransactions,
  orders,
} from './orders.schema'

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
  customer: customerOutput.nullable(),
})

// Orders
export const orderListItemOutput = orderOutput.extend({ customerName: z.string().nullable() })
export const orderCreatedOutput = orderOutput.extend({
  items: z.array(createSelectSchema(orderItems)),
  shippingLines: z.array(createSelectSchema(orderShippingLines)),
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

export const fulfillOrderInput = z.object({
  trackingCompany: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  trackingUrl: z.union([z.url({ protocol: /^https?$/ }).max(500), z.literal('')]).optional(),
})
