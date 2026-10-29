import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { FINANCIAL_STATUSES, FULFILLMENT_STATUSES, orderService } from '@shopnex/orders'
import { paymentService } from '@shopnex/payments'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { cancelOrderInput, fulfillmentUpdateInput, fulfillOrderInput } from './schemas'

const id = z.object({ id: z.uuid() })

const read = scoped('read_orders')
const write = scoped('write_orders')

const importedAddress = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  company: z.string().nullable(),
  address1: z.string(),
  address2: z.string().nullable(),
  city: z.string(),
  province: z.string().nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  zip: z.string().nullable(),
  phone: z.string().nullable(),
})

const importedOrder = z.object({
  sourceOrderName: z.string().trim().min(1).max(100),
  email: z.email(),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  financialStatus: z.enum(FINANCIAL_STATUSES),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  cancelledAt: z.coerce.date().nullable().optional(),
  fulfilledAt: z.coerce.date().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotalCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  discountCodes: z.array(z.string().max(100)).max(50),
  shippingTitle: z.string().max(200).nullable().optional(),
  shippingAddress: importedAddress.nullable().optional(),
  billingAddress: importedAddress.nullable().optional(),
  paymentMethodName: z.string().max(200).nullable().optional(),
  note: z.string().max(10_000).nullable().optional(),
  createdAt: z.coerce.date(),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        variantTitle: z.string().max(500).nullable().optional(),
        sku: z.string().max(200).nullable().optional(),
        vendor: z.string().max(200).nullable().optional(),
        imageUrl: z
          .url({ protocol: /^https?$/ })
          .nullable()
          .optional(),
        unitPriceCents: z.number().int().nonnegative(),
        quantity: z.number().int().min(1).max(9999),
        discountCents: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
})

export const orders = {
  importHistorical: write
    .route({ method: 'POST', path: '/admin/orders/import' })
    .input(z.object({ orders: z.array(importedOrder).min(1).max(50) }))
    .handler(({ input, context }) => orderService.importHistoricalMany(context.shop.id, input.orders)),

  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/orders/bulk' })
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => orderService.removeMany(context.shop.id, input.ids)),

  list: read
    .route({ method: 'GET', path: '/admin/orders' })
    .input(
      pagination.extend({
        customerId: z.uuid().optional(),
        financialStatus: z.enum(FINANCIAL_STATUSES).optional(),
        fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
        /** true: cancelled only; false: open only */
        cancelled: z.stringbool().or(z.boolean()).optional(),
        /** Order number (1001 / #1001), email or customer name */
        search: z.string().trim().max(200).optional(),
      }),
    )
    .handler(({ input, context }) => orderService.list(context.shop.id, input)),

  get: read
    .route({ method: 'GET', path: '/admin/orders/{id}' })
    .input(id)
    .handler(async ({ input, context }) => {
      const order = await orderService.getById(context.shop.id, input.id)
      if (!order) throw new ORPCError('NOT_FOUND')
      return order
    }),

  // Manual order from the admin (no shipping or payment method; mark it as paid when the money arrives)
  create: write
    .route({ method: 'POST', path: '/admin/orders' })
    .input(
      z
        .object({
          customerId: z.uuid().optional(),
          email: z.email().optional(),
          name: z.string().min(1).optional(),
          // Each line names a variantId, or a productId for single-variant products
          items: z
            .array(
              z.union([
                z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(999) }),
                z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(999) }),
              ]),
            )
            .min(1),
          // Applied like at checkout; tax needs a shipping address, so manual orders have none
          discountCode: z.string().trim().min(1).max(100).optional(),
        })
        .refine((v) => v.customerId || v.email, { message: 'customerId or email is required' }),
    )
    .handler(({ input, context }) => orderService.create(context.shop.id, input)),

  // Shopify "Mark as paid": manual payment received
  markAsPaid: write
    .route({ method: 'POST', path: '/admin/orders/{id}/mark-as-paid' })
    .input(id)
    .handler(({ input, context }) => orderService.markAsPaid(context.shop.id, input.id)),

  // Ships some or all of the items as one fulfillment with its own tracking; call again for the rest
  fulfill: write
    .route({ method: 'POST', path: '/admin/orders/{id}/fulfill' })
    .input(id.extend(fulfillOrderInput.shape))
    .handler(({ input: { id, ...fulfillment }, context }) => orderService.fulfill(context.shop.id, id, fulfillment)),

  // Takes a shipment back: its items are unfulfilled again
  cancelFulfillment: write
    .route({ method: 'POST', path: '/admin/orders/{id}/fulfillments/{fulfillmentId}/cancel' })
    .input(id.extend({ fulfillmentId: z.uuid() }))
    .handler(({ input, context }) => orderService.cancelFulfillment(context.shop.id, input.id, input.fulfillmentId)),

  // Tracking and shipment status (in transit, delivered…)
  updateFulfillment: write
    .route({ method: 'PATCH', path: '/admin/orders/{id}/fulfillments/{fulfillmentId}' })
    .input(id.extend({ fulfillmentId: z.uuid() }).extend(fulfillmentUpdateInput.shape))
    .handler(({ input: { id, fulfillmentId, ...patch }, context }) =>
      orderService.updateFulfillment(context.shop.id, id, fulfillmentId, patch),
    ),

  cancel: write
    .route({ method: 'POST', path: '/admin/orders/{id}/cancel' })
    .input(id.extend(cancelOrderInput.shape))
    // Paid through a payments app: the refund is sent to it and the order shows refunded once it confirms
    .handler(({ input: { id, ...options }, context }) => paymentService.cancelOrder(context.shop.id, id, options)),
}
