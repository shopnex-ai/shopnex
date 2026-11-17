import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { checkoutSettings } from '@shopnex/cart'
import { shopManager } from '../../orpc'
import { shippingRateInput } from './schemas'
import { shippingRateOutput } from './outputs'

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
