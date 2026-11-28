import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { createProcedures } from '@shopnex/rpc'
import { menuInput, menuOutput, pageInput, pageOutput } from './content.contract'
import { content } from './content.services'

const { admin } = createProcedures()

const id = z.object({ id: z.uuid() })
const ids = z.object({ ids: z.array(z.uuid()).min(1).max(100) })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Online store → Navigation. Staff only for now (like themes); read/write_online_store scopes for apps later.
export const menus = {
  list: admin
    .route({ method: 'GET', path: '/admin/menus' })
    .output(z.array(menuOutput))
    .handler(({ context }) => content.menus.list(context.shop.id)),
  get: admin
    .route({ method: 'GET', path: '/admin/menus/{id}' })
    .output(menuOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await content.menus.getById(context.shop.id, input.id))),
  create: admin
    .route({ method: 'POST', path: '/admin/menus' })
    .output(menuOutput)
    .input(menuInput)
    .handler(({ input, context }) => content.menus.create(context.shop.id, input)),
  update: admin
    .route({ method: 'PATCH', path: '/admin/menus/{id}' })
    .output(menuOutput)
    .input(id.extend(menuInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await content.menus.update(context.shop.id, id, patch)),
    ),
  deleteMany: admin
    .route({ method: 'DELETE', path: '/admin/menus/bulk' })
    .output(z.number().int())
    .input(ids)
    .handler(({ input, context }) => menuService.removeMany(context.shop.id, input.ids, db)),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/menus/{id}' })
    .output(menuOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await content.menus.remove(context.shop.id, input.id))),
}

// Online store → Pages. Staff only for now (like themes and menus); read/write_online_store scopes later.
export const pages = {
  list: admin
    .route({ method: 'GET', path: '/admin/pages' })
    .output(z.array(pageOutput))
    .handler(({ context }) => content.pages.list(context.shop.id)),
  get: admin
    .route({ method: 'GET', path: '/admin/pages/{id}' })
    .output(pageOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await content.pages.getById(context.shop.id, input.id))),
  create: admin
    .route({ method: 'POST', path: '/admin/pages' })
    .output(pageOutput)
    .input(pageInput)
    .handler(({ input, context }) => content.pages.create(context.shop.id, input)),
  update: admin
    .route({ method: 'PATCH', path: '/admin/pages/{id}' })
    .output(pageOutput)
    .input(id.extend(pageInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await content.pages.update(context.shop.id, id, patch)),
    ),
  deleteMany: admin
    .route({ method: 'DELETE', path: '/admin/pages/bulk' })
    .output(z.number().int())
    .input(ids)
    .handler(({ input, context }) => pageService.removeMany(context.shop.id, input.ids, db)),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/pages/{id}' })
    .output(pageOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await content.pages.remove(context.shop.id, input.id))),
}
