import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { carrierService, checkoutSettings } from '@shopnex/cart'
import { carrierApp, shopManager } from '../../orpc'
import { carrierServiceConfigureInput } from './schemas'

const id = z.object({ id: z.uuid() })

// What staff and apps see of a service
const view = (s: Awaited<ReturnType<typeof carrierService.configure>>) => ({
  id: s.id,
  appId: s.appId,
  name: s.name,
  active: s.active,
  ready: s.ready,
})

// Carrier apps (see @shopnex/marketplace-sdk/shipping): register the shop's carrier service, then answer the
// signed rates requests Shopnex sends it. App tokens only.
export const carrierServicesApp = {
  configure: carrierApp
    .route({ method: 'POST', path: '/admin/carrier-services/configure' })
    .input(carrierServiceConfigureInput)
    .handler(async ({ input, context }) => view(await carrierService.configure(context.shop.id, context.appId, input))),

  // The shop's own flat rates that are on: checkout lists them before any carrier's rates and preselects the first,
  // so an app that quotes live prices tells the merchant when they are in the way. Read only, and only these fields.
  shopRates: carrierApp
    .route({ method: 'GET', path: '/admin/carrier-services/shop-rates' })
    .handler(async ({ context }) =>
      (await checkoutSettings.listShippingRates(context.shop.id, { activeOnly: true })).map((r) => ({
        id: r.id,
        name: r.name,
        priceCents: r.priceCents,
        freeAboveCents: r.freeAboveCents,
      })),
    ),
}

// Settings → Shipping: the carrier services installed apps registered; staff rename or switch them off
export const carrierServices = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/carrier-services' })
    .handler(async ({ context }) => (await carrierService.list(context.shop.id)).map(view)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/carrier-services/{id}' })
    .input(id.extend({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const service = await carrierService.update(context.shop.id, id, patch)
      if (!service) throw new ORPCError('NOT_FOUND')
      return view(service)
    }),
}
