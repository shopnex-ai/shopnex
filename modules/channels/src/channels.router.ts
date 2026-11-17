import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { createProcedures } from '@shopnex/rpc'
import * as channelService from './channels'
import {
  channelInput,
  channelOutput,
  deletedOutput,
  storefrontKeyInput,
  storefrontKeyOutput,
} from './channels.contract'
import * as storefrontKeyService from './storefront-keys'

const { scoped, shopManager } = createProcedures()

const id = z.object({ id: z.uuid() })

// Sales channels (Shopify: sales channels / publications). Staff managing the shop create and delete them;
// apps with read_publications can list them.
export const channels = {
  list: scoped('read_publications')
    .route({ method: 'GET', path: '/admin/channels' })
    .output(z.array(channelOutput))
    .handler(({ context }) => channelService.list(context.shop.id, db)),

  create: shopManager
    .route({ method: 'POST', path: '/admin/channels' })
    .output(channelOutput)
    .input(channelInput)
    .handler(({ input, context }) => channelService.create(context.shop.id, input, db)),

  update: shopManager
    .route({ method: 'PATCH', path: '/admin/channels/{id}' })
    .output(channelOutput)
    .input(channelInput.pick({ name: true, autoPublish: true }).partial().extend(id.shape))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const row = await channelService.update(context.shop.id, id, patch, db)
      if (!row) throw new ORPCError('NOT_FOUND')
      return row
    }),

  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/channels/{id}' })
    .output(deletedOutput)
    .input(id)
    .handler(async ({ input, context }) => {
      if (!(await channelService.remove(context.shop.id, input.id, db))) throw new ORPCError('NOT_FOUND')
      return { ok: true }
    }),
}

// Publishable keys: a storefront sends one (x-shopnex-key) to say which shop and channel it reads
export const storefrontKeys = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/storefront-keys' })
    .output(z.array(storefrontKeyOutput))
    .handler(({ context }) => storefrontKeyService.list(context.shop.id, db)),

  create: shopManager
    .route({ method: 'POST', path: '/admin/storefront-keys' })
    .output(storefrontKeyOutput)
    .input(storefrontKeyInput)
    .handler(({ input, context }) => storefrontKeyService.create(context.shop.id, input.name, input.channelId, db)),

  revoke: shopManager
    .route({ method: 'POST', path: '/admin/storefront-keys/{id}/revoke' })
    .output(storefrontKeyOutput)
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const key = await storefrontKeyService.revoke(context.shop.id, input.id, db)
      if (!key) throw new ORPCError('NOT_FOUND')
      return key
    }),
}
