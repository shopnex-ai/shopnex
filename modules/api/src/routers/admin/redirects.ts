import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { redirectService } from '@shopnex/catalog'
import { admin } from '../../orpc'
import { pagination } from '../pagination'
import { redirectInput } from './schemas'
import { countOutput, redirectOutput } from './outputs'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Online store → URL redirects. Staff only, like pages and menus. A product, collection or page that changes its
// handle adds its own redirect (see redirectService.record).
export const redirects = {
  deleteMany: admin
    .route({ method: 'DELETE', path: '/admin/redirects/bulk' })
    .output(countOutput)
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => redirectService.removeMany(context.shop.id, input.ids)),
  list: admin
    .route({ method: 'GET', path: '/admin/redirects' })
    .output(z.object({ items: z.array(redirectOutput), total: z.number().int() }))
    .input(pagination.extend({ search: z.string().trim().max(200).optional() }))
    .handler(({ input, context }) => redirectService.list(context.shop.id, input)),
  create: admin
    .route({ method: 'POST', path: '/admin/redirects' })
    .output(redirectOutput)
    .input(redirectInput)
    .handler(({ input, context }) => redirectService.create(context.shop.id, input)),
  update: admin
    .route({ method: 'PATCH', path: '/admin/redirects/{id}' })
    .output(redirectOutput)
    .input(id.extend(redirectInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await redirectService.update(context.shop.id, id, patch)),
    ),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/redirects/{id}' })
    .output(redirectOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await redirectService.remove(context.shop.id, input.id))),
}
