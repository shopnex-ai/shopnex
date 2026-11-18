import { db } from '@shopnex/db'
import type { Conn } from '@shopnex/db'
import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { marketplaceService } from '@shopnex/apps'
import { availableAppsOutput } from '@shopnex/payments/contract'
import { createProcedures } from '@shopnex/rpc'
import {
  carrierServiceConfigureInput,
  carrierServiceOutput,
  shippingRateInput,
  shippingRateOutput,
} from './cart.contract'
import * as carrierService from './carrier-services'
import * as checkoutSettings from './checkout-settings'

const { carrierApp, shopManager } = createProcedures()

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
    .handler(({ context }) => checkoutSettings.listShippingRates(context.shop.id, {}, db)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/shipping-rates' })
    .output(shippingRateOutput)
    .input(shippingRateInput)
    .handler(({ input, context }) => checkoutSettings.createShippingRate(context.shop.id, input, db)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/shipping-rates/{id}' })
    .output(shippingRateOutput)
    .input(id.extend(shippingRateInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await checkoutSettings.updateShippingRate(context.shop.id, id, patch, db)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/shipping-rates/{id}' })
    .output(shippingRateOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await checkoutSettings.deleteShippingRate(context.shop.id, input.id, db)),
    ),
}

// What staff and apps see of a service
const view = (s: Awaited<ReturnType<typeof carrierService.configure>>) => ({
  id: s.id,
  appId: s.appId,
  name: s.name,
  active: s.active,
  ready: s.ready,
})

// Carrier apps (see @shopnex/marketplace-sdk/shipping): register the shop's carrier service, then answer the
// signed rates requests ShopNex sends it. App tokens only.
export const carrierServicesApp = {
  configure: carrierApp
    .route({ method: 'POST', path: '/admin/carrier-services/configure' })
    .output(carrierServiceOutput)
    .input(carrierServiceConfigureInput)
    .handler(async ({ input, context }) =>
      view(await carrierService.configure(context.shop.id, context.appId, input, db)),
    ),
}

// Settings → Shipping: the carrier services installed apps registered; staff rename or switch them off
export const carrierServices = {
  // Carrier apps this shop could install (Install opens the app, which starts OAuth)
  available: shopManager
    .route({ method: 'GET', path: '/admin/carrier-services/available' })
    .output(availableAppsOutput)
    .handler(async ({ context }) => {
      const [instanceUrl, apps] = await Promise.all([
        marketplaceService.instanceUrl(),
        carrierService.availableApps(context.shop.id, db),
      ])
      return { instanceUrl, apps }
    }),
  list: shopManager
    .route({ method: 'GET', path: '/admin/carrier-services' })
    .output(z.array(carrierServiceOutput))
    .handler(async ({ context }) => (await carrierService.list(context.shop.id, {}, db)).map(view)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/carrier-services/{id}' })
    .output(carrierServiceOutput)
    .input(id.extend({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const service = await carrierService.update(context.shop.id, id, patch, db)
      if (!service) throw new ORPCError('NOT_FOUND')
      return view(service)
    }),
}
