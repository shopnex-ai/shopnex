import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { checkoutSettings } from '@shopnex/cart'
import { taxService } from '@shopnex/pricing'
import { shopManager } from '../../orpc'
import { paymentMethodInput, shippingRateInput, taxRateInput } from './schemas'
import { paymentMethodOutput, shippingRateOutput, taxRateOutput } from './outputs'

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

// Settings → Taxes: rates by country / province (whether prices include tax is on the shop)
export const taxRates = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/tax-rates' })
    .output(z.array(taxRateOutput))
    .handler(({ context }) => taxService.list(context.shop.id)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/tax-rates' })
    .output(taxRateOutput)
    .input(taxRateInput)
    .handler(({ input, context }) => taxService.create(context.shop.id, input)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/tax-rates/{id}' })
    .output(taxRateOutput)
    .input(id.extend(taxRateInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await taxService.update(context.shop.id, id, patch)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/tax-rates/{id}' })
    .output(taxRateOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await taxService.remove(context.shop.id, input.id))),
}
