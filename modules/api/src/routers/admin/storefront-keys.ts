import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { createStorefrontKey, listStorefrontKeys, revokeStorefrontKey } from '@shopnex/tenancy'
import { shopManager } from '../../orpc'
import { storefrontKeyInput } from './schemas'
import { storefrontKeyOutput } from './outputs'

export const storefrontKeys = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/storefront-keys' })
    .output(z.array(storefrontKeyOutput))
    .handler(({ context }) => listStorefrontKeys(context.shop.id)),

  create: shopManager
    .route({ method: 'POST', path: '/admin/storefront-keys' })
    .output(storefrontKeyOutput)
    .input(storefrontKeyInput)
    .handler(({ input, context }) => createStorefrontKey(context.shop.id, input.name, input.channelId)),

  revoke: shopManager
    .route({ method: 'POST', path: '/admin/storefront-keys/{id}/revoke' })
    .output(storefrontKeyOutput)
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const key = await revokeStorefrontKey(context.shop.id, input.id)
      if (!key) throw new ORPCError('NOT_FOUND')
      return key
    }),
}
