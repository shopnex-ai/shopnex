import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { channelService } from '@shopnex/channels'
import { scoped, shopManager } from '../../orpc'
import { channelInput } from './schemas'
import { channelOutput, okOutput } from './outputs'

const id = z.object({ id: z.uuid() })

// Sales channels (Shopify: sales channels / publications). Staff managing the shop create and delete them;
// apps with read_publications can list them.
export const channels = {
  list: scoped('read_publications')
    .route({ method: 'GET', path: '/admin/channels' })
    .output(z.array(channelOutput))
    .handler(({ context }) => channelService.list(context.shop.id)),

  create: shopManager
    .route({ method: 'POST', path: '/admin/channels' })
    .output(channelOutput)
    .input(channelInput)
    .handler(({ input, context }) => channelService.create(context.shop.id, input)),

  update: shopManager
    .route({ method: 'PATCH', path: '/admin/channels/{id}' })
    .output(channelOutput)
    .input(channelInput.pick({ name: true, autoPublish: true }).partial().extend(id.shape))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const row = await channelService.update(context.shop.id, id, patch)
      if (!row) throw new ORPCError('NOT_FOUND')
      return row
    }),

  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/channels/{id}' })
    .output(okOutput)
    .input(id)
    .handler(async ({ input, context }) => {
      if (!(await channelService.remove(context.shop.id, input.id))) throw new ORPCError('NOT_FOUND')
      return { ok: true }
    }),
}
