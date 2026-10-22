import { ORPCError } from '@orpc/server'
import { updateShop } from '@shopnex/tenancy'
import { adminOrToken, shopManager } from '../../orpc'
import { shopInput } from './schemas'

// The shop the admin (or API token) is working in
export const shop = {
  get: adminOrToken.route({ method: 'GET', path: '/admin/shop' }).handler(({ context }) => context.shop),

  update: shopManager
    .route({ method: 'PATCH', path: '/admin/shop' })
    .input(shopInput.partial())
    .handler(async ({ input, context }) => {
      const updated = await updateShop(context.shop.id, input)
      if (!updated) throw new ORPCError('NOT_FOUND')
      return updated
    }),
}
