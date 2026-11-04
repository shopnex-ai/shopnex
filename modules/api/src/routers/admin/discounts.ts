import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { discountService } from '@shopnex/pricing'
import { scoped } from '../../orpc'
import { discountCreateInput, discountInput } from './schemas'
import { countOutput, discountOutput } from './outputs'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

const read = scoped('read_discounts')
const write = scoped('write_discounts')

// Discount codes buyers enter at checkout (one per order)
export const discounts = {
  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/discounts/bulk' })
    .output(countOutput)
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => discountService.removeMany(context.shop.id, input.ids)),

  list: read
    .route({ method: 'GET', path: '/admin/discounts' })
    .output(z.array(discountOutput))
    .handler(({ context }) => discountService.list(context.shop.id)),
  get: read
    .route({ method: 'GET', path: '/admin/discounts/{id}' })
    .output(discountOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await discountService.getById(context.shop.id, input.id))),
  create: write
    .route({ method: 'POST', path: '/admin/discounts' })
    .output(discountOutput)
    .input(discountCreateInput)
    .handler(({ input, context }) => discountService.create(context.shop.id, input)),
  update: write
    .route({ method: 'PATCH', path: '/admin/discounts/{id}' })
    .output(discountOutput)
    .input(id.extend(discountInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await discountService.update(context.shop.id, id, patch)),
    ),
  delete: write
    .route({ method: 'DELETE', path: '/admin/discounts/{id}' })
    .output(discountOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await discountService.remove(context.shop.id, input.id))),
}
