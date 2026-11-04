import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { customerService } from '@shopnex/customers'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { customerInput } from './schemas'
import { countOutput, customerOutput } from './outputs'

const emailTaken = () => new ORPCError('CONFLICT', { message: 'A customer with this email already exists' })

const read = scoped('read_customers')
const write = scoped('write_customers')

export const customers = {
  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/customers/bulk' })
    .output(countOutput)
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => customerService.removeMany(context.shop.id, input.ids)),

  list: read
    .route({ method: 'GET', path: '/admin/customers' })
    .output(z.object({ items: z.array(customerOutput), total: z.number().int() }))
    .input(pagination.extend({ search: z.string().trim().max(200).optional() }))
    .handler(({ input, context }) => customerService.list(context.shop.id, input)),

  get: read
    .route({ method: 'GET', path: '/admin/customers/{id}' })
    .output(customerOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const customer = await customerService.getById(context.shop.id, input.id)
      if (!customer) throw new ORPCError('NOT_FOUND')
      return customer
    }),

  create: write
    .route({ method: 'POST', path: '/admin/customers' })
    .output(customerOutput)
    .input(customerInput)
    .handler(async ({ input, context }) => {
      const customer = await customerService.create(context.shop.id, input)
      if (!customer) throw emailTaken()
      return customer
    }),

  update: write
    .route({ method: 'PATCH', path: '/admin/customers/{id}' })
    .output(customerOutput)
    .input(customerInput.partial().extend({ id: z.uuid() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      if (patch.email) {
        const existing = await customerService.getByEmail(context.shop.id, patch.email)
        if (existing && existing.id !== id) throw emailTaken()
      }
      const customer = await customerService.update(context.shop.id, id, patch)
      if (!customer) throw new ORPCError('NOT_FOUND')
      return customer
    }),
}
