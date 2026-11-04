import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { marketplaceService } from '@shopnex/apps'
import { carrierService } from '@shopnex/cart'
import { carrierApp, shopManager } from '../../orpc'
import { carrierServiceConfigureInput } from './schemas'
import { carrierServiceOutput } from './outputs'

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
// signed rates requests ShopNex sends it. App tokens only.
export const carrierServicesApp = {
  configure: carrierApp
    .route({ method: 'POST', path: '/admin/carrier-services/configure' })
    .output(carrierServiceOutput)
    .input(carrierServiceConfigureInput)
    .handler(async ({ input, context }) => view(await carrierService.configure(context.shop.id, context.appId, input))),
}

// Settings → Shipping: the carrier services installed apps registered; staff rename or switch them off
export const carrierServices = {
  // Carrier apps this shop could install (Install opens the app, which starts OAuth)
  available: shopManager
    .route({ method: 'GET', path: '/admin/carrier-services/available' })
    .handler(async ({ context }) => {
      const [instanceUrl, apps] = await Promise.all([
        marketplaceService.instanceUrl(),
        carrierService.availableApps(context.shop.id),
      ])
      return { instanceUrl, apps }
    }),
  list: shopManager
    .route({ method: 'GET', path: '/admin/carrier-services' })
    .output(z.array(carrierServiceOutput))
    .handler(async ({ context }) => (await carrierService.list(context.shop.id)).map(view)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/carrier-services/{id}' })
    .output(carrierServiceOutput)
    .input(id.extend({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const service = await carrierService.update(context.shop.id, id, patch)
      if (!service) throw new ORPCError('NOT_FOUND')
      return view(service)
    }),
}
