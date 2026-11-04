import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { menuService } from '@shopnex/content'
import { admin } from '../../orpc'
import { menuInput } from './schemas'
import { menuOutput } from './outputs'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Online store → Navigation. Staff only for now (like themes); read/write_online_store scopes for apps later.
export const menus = {
  list: admin
    .route({ method: 'GET', path: '/admin/menus' })
    .output(z.array(menuOutput))
    .handler(({ context }) => menuService.list(context.shop.id)),
  get: admin
    .route({ method: 'GET', path: '/admin/menus/{id}' })
    .output(menuOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await menuService.getById(context.shop.id, input.id))),
  create: admin
    .route({ method: 'POST', path: '/admin/menus' })
    .output(menuOutput)
    .input(menuInput)
    .handler(({ input, context }) => menuService.create(context.shop.id, input)),
  update: admin
    .route({ method: 'PATCH', path: '/admin/menus/{id}' })
    .output(menuOutput)
    .input(id.extend(menuInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await menuService.update(context.shop.id, id, patch)),
    ),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/menus/{id}' })
    .output(menuOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await menuService.remove(context.shop.id, input.id))),
}
