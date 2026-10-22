import { z } from 'zod'
import { collectionService } from '@shopnex/catalog'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { collectionInput } from './schemas'

const membership = z.object({ id: z.uuid(), productId: z.uuid() })

const read = scoped('read_products')
const write = scoped('write_products')

export const collections = {
  list: read
    .route({ method: 'GET', path: '/admin/collections' })
    .input(pagination)
    .handler(({ input, context }) => collectionService.list(context.shop.id, input)),

  create: write
    .route({ method: 'POST', path: '/admin/collections' })
    .input(collectionInput)
    .handler(({ input, context }) => collectionService.create(context.shop.id, input)),

  addProduct: write
    .route({ method: 'POST', path: '/admin/collections/{id}/products' })
    .input(membership)
    .handler(async ({ input, context }) => {
      await collectionService.addProduct(context.shop.id, input.id, input.productId)
      return { ok: true }
    }),

  removeProduct: write
    .route({ method: 'DELETE', path: '/admin/collections/{id}/products/{productId}' })
    .input(membership)
    .handler(async ({ input, context }) => {
      await collectionService.removeProduct(context.shop.id, input.id, input.productId)
      return { ok: true }
    }),
}
