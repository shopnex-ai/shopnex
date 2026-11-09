import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { CUSTOM_FIELD_RESOURCES, customFieldService } from '@shopnex/custom-fields'
import { adminOrToken, shopManager } from '../../orpc'
import { customFieldInput, customFieldPatch } from './schemas'
import { customFieldOutput } from './outputs'

const id = z.object({ id: z.uuid() })

// Fields shop staff add to products, orders and customers. Anyone with a token can read the definitions (apps need
// them to make sense of the values); shaping them is shop settings, so owners and admins only.
export const customFields = {
  list: adminOrToken
    .route({ method: 'GET', path: '/admin/custom-fields' })
    .output(z.array(customFieldOutput))
    .input(z.object({ resource: z.enum(CUSTOM_FIELD_RESOURCES).optional() }))
    .handler(({ input, context }) => customFieldService.list(context.shop.id, input.resource)),

  create: shopManager
    .route({ method: 'POST', path: '/admin/custom-fields' })
    .output(customFieldOutput)
    .input(customFieldInput)
    .handler(({ input, context }) => customFieldService.create(context.shop.id, input)),

  update: shopManager
    .route({ method: 'PATCH', path: '/admin/custom-fields/{id}' })
    .output(customFieldOutput)
    .input(id.extend(customFieldPatch.shape))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const field = await customFieldService.update(context.shop.id, id, patch)
      if (!field) throw new ORPCError('NOT_FOUND')
      return field
    }),

  // Also deletes the values stored on products, orders or customers under this key
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/custom-fields/{id}' })
    .output(customFieldOutput)
    .input(id)
    .handler(async ({ input, context }) => {
      const field = await customFieldService.remove(context.shop.id, input.id)
      if (!field) throw new ORPCError('NOT_FOUND')
      return field
    }),
}
