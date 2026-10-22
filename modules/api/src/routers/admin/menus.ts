import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { menuService } from '@shopnex/content'
import { admin } from '../../orpc'
import { menuInput } from './schemas'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Online store → Navigation. Staff only for now (like themes); read/write_online_store scopes for apps later.
export const menus = {
  list: admin
    .route({ method: 'GET', path: '/admin/menus' })
    .handler(({ context }) => menuService.list(context.shop.id)),
  get: admin
    .route({ method: 'GET', path: '/admin/menus/{id}' })
    .input(id)
    .handler(async ({ input, context }) => found(await menuService.getById(context.shop.id, input.id))),
  create: admin
    .route({ method: 'POST', path: '/admin/menus' })
    .input(menuInput)
    .handler(({ input, context }) => menuService.create(context.shop.id, input)),
  update: admin
    .route({ method: 'PATCH', path: '/admin/menus/{id}' })
    .input(id.extend(menuInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await menuService.update(context.shop.id, id, patch)),
    ),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/menus/{id}' })
    .input(id)
    .handler(async ({ input, context }) => found(await menuService.remove(context.shop.id, input.id))),
}
