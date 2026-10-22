import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { pageService } from '@shopnex/content'
import { admin } from '../../orpc'
import { pageInput } from './schemas'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Online store → Pages. Staff only for now (like themes and menus); read/write_online_store scopes later.
export const pages = {
  list: admin
    .route({ method: 'GET', path: '/admin/pages' })
    .handler(({ context }) => pageService.list(context.shop.id)),
  get: admin
    .route({ method: 'GET', path: '/admin/pages/{id}' })
    .input(id)
    .handler(async ({ input, context }) => found(await pageService.getById(context.shop.id, input.id))),
  create: admin
    .route({ method: 'POST', path: '/admin/pages' })
    .input(pageInput)
    .handler(({ input, context }) => pageService.create(context.shop.id, input)),
  update: admin
    .route({ method: 'PATCH', path: '/admin/pages/{id}' })
    .input(id.extend(pageInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await pageService.update(context.shop.id, id, patch)),
    ),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/pages/{id}' })
    .input(id)
    .handler(async ({ input, context }) => found(await pageService.remove(context.shop.id, input.id))),
}
