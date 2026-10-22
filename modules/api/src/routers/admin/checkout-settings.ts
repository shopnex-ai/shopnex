import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { checkoutSettings } from '@shopnex/cart'
import { taxService } from '@shopnex/pricing'
import { shopManager } from '../../orpc'
import { paymentMethodInput, shippingRateInput, taxRateInput } from './schemas'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Settings → Shipping: rates offered at checkout (one zone: every address)
export const shippingRates = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/shipping-rates' })
    .handler(({ context }) => checkoutSettings.listShippingRates(context.shop.id)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/shipping-rates' })
    .input(shippingRateInput)
    .handler(({ input, context }) => checkoutSettings.createShippingRate(context.shop.id, input)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/shipping-rates/{id}' })
    .input(id.extend(shippingRateInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await checkoutSettings.updateShippingRate(context.shop.id, id, patch)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/shipping-rates/{id}' })
    .input(id)
    .handler(async ({ input, context }) => found(await checkoutSettings.deleteShippingRate(context.shop.id, input.id))),
}

// Settings → Payments: manual payment methods (bank transfer, cash on delivery…)
export const paymentMethods = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/payment-methods' })
    .handler(({ context }) => checkoutSettings.listPaymentMethods(context.shop.id)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/payment-methods' })
    .input(paymentMethodInput)
    .handler(({ input, context }) => checkoutSettings.createPaymentMethod(context.shop.id, input)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/payment-methods/{id}' })
    .input(id.extend(paymentMethodInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await checkoutSettings.updatePaymentMethod(context.shop.id, id, patch)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/payment-methods/{id}' })
    .input(id)
    .handler(async ({ input, context }) =>
      found(await checkoutSettings.deletePaymentMethod(context.shop.id, input.id)),
    ),
}

// Settings → Taxes: rates by country / province (whether prices include tax is on the shop)
export const taxRates = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/tax-rates' })
    .handler(({ context }) => taxService.list(context.shop.id)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/tax-rates' })
    .input(taxRateInput)
    .handler(({ input, context }) => taxService.create(context.shop.id, input)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/tax-rates/{id}' })
    .input(id.extend(taxRateInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await taxService.update(context.shop.id, id, patch)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/tax-rates/{id}' })
    .input(id)
    .handler(async ({ input, context }) => found(await taxService.remove(context.shop.id, input.id))),
}
