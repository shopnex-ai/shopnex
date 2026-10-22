import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { FINANCIAL_STATUSES, FULFILLMENT_STATUSES, orderService } from '@shopnex/orders'
import { paymentService } from '@shopnex/payments'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { cancelOrderInput, fulfillOrderInput } from './schemas'

const id = z.object({ id: z.uuid() })

const read = scoped('read_orders')
const write = scoped('write_orders')

export const orders = {
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

  fulfill: write
    .route({ method: 'POST', path: '/admin/orders/{id}/fulfill' })
    .input(id.extend(fulfillOrderInput.shape))
    .handler(({ input: { id, ...tracking }, context }) => orderService.fulfill(context.shop.id, id, tracking)),

  cancel: write
    .route({ method: 'POST', path: '/admin/orders/{id}/cancel' })
    .input(id.extend(cancelOrderInput.shape))
    // Paid through a payments app: the refund is sent to it and the order shows refunded once it confirms
    .handler(({ input: { id, ...options }, context }) => paymentService.cancelOrder(context.shop.id, id, options)),
}
