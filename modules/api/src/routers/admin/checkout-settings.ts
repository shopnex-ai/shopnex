import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { checkoutSettings } from '@shopnex/cart'
import { db } from '@shopnex/db'
import { shopManager } from '../../orpc'
import { paymentMethodInput, shippingRateInput } from './schemas'
import { paymentMethodOutput, shippingRateOutput } from './outputs'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Settings → Shipping: rates offered at checkout (one zone: every address)
export const shippingRates = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/shipping-rates' })
    .output(z.array(shippingRateOutput))
    .handler(({ context }) => checkoutSettings.listShippingRates(context.shop.id)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/shipping-rates' })
    .output(shippingRateOutput)
    .input(shippingRateInput)
    .handler(({ input, context }) => checkoutSettings.createShippingRate(context.shop.id, input)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/shipping-rates/{id}' })
    .output(shippingRateOutput)
    .input(id.extend(shippingRateInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await checkoutSettings.updateShippingRate(context.shop.id, id, patch)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/shipping-rates/{id}' })
    .output(shippingRateOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await checkoutSettings.deleteShippingRate(context.shop.id, input.id))),
}

// Settings → Payments: manual payment methods (bank transfer, cash on delivery…)
export const paymentMethods = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/payment-methods' })
    .output(z.array(paymentMethodOutput))
    .handler(({ context }) => checkoutSettings.listPaymentMethods(context.shop.id)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/payment-methods' })
    .output(paymentMethodOutput)
    .input(paymentMethodInput)
    .handler(({ input, context }) => checkoutSettings.createPaymentMethod(context.shop.id, input)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/payment-methods/{id}' })
    .output(paymentMethodOutput)
    .input(id.extend(paymentMethodInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await checkoutSettings.updatePaymentMethod(context.shop.id, id, patch)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/payment-methods/{id}' })
    .output(paymentMethodOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await checkoutSettings.deletePaymentMethod(context.shop.id, input.id)),
    ),
}
