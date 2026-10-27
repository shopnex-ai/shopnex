import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { collectionService } from '@shopnex/catalog'
import { publicationService } from '@shopnex/channels'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { collectionInput, publicationsInput } from './schemas'

const membership = z.object({ id: z.uuid(), productId: z.uuid() })

const id = z.object({ id: z.uuid() })

const read = scoped('read_products')
const write = scoped('write_products')
const readPublications = scoped('read_publications')
const writePublications = scoped('write_publications')

export const collections = {
  list: read
    .route({ method: 'GET', path: '/admin/collections' })
    .input(pagination)
    .handler(async ({ input, context }) => {
      const rows = await collectionService.list(context.shop.id, input)
      const counts = await collectionService.productCounts(
        context.shop.id,
        rows.map((r) => r.id),
      )
      const publications = await publicationService.listFor(
        context.shop.id,
        'collection',
        rows.map((r) => r.id),
      )
      return rows.map((r) => ({
        ...r,
        productCount: counts.get(r.id) ?? 0,
        publications: publications.get(r.id) ?? [],
      }))
    }),

  publications: readPublications
    .route({ method: 'GET', path: '/admin/collections/{id}/publications' })
    .input(id)
    .handler(async ({ input, context }) => {
      if (!(await collectionService.getById(context.shop.id, input.id))) throw new ORPCError('NOT_FOUND')
      return (await publicationService.listFor(context.shop.id, 'collection', [input.id])).get(input.id)!
    }),

  // Publishes the collection on exactly these channels
  setPublications: writePublications
    .route({ method: 'PUT', path: '/admin/collections/{id}/publications' })
    .input(publicationsInput.extend(id.shape))
    .handler(async ({ input, context }) => {
      if (!(await collectionService.getById(context.shop.id, input.id))) throw new ORPCError('NOT_FOUND')
      await publicationService.set(context.shop.id, 'collection', input.id, input.publications)
      return (await publicationService.listFor(context.shop.id, 'collection', [input.id])).get(input.id)!
    }),

  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/collections/bulk' })
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => collectionService.removeMany(context.shop.id, input.ids)),

  update: write
    .route({ method: 'PATCH', path: '/admin/collections/{id}' })
    .input(collectionInput.partial().extend({ id: z.uuid() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const row = await collectionService.update(context.shop.id, id, patch)
      if (!row) throw new ORPCError('NOT_FOUND')
      return row
    }),

  delete: write
    .route({ method: 'DELETE', path: '/admin/collections/{id}' })
    .input(id)
    .handler(async ({ input, context }) => {
      if (!(await collectionService.remove(context.shop.id, input.id))) throw new ORPCError('NOT_FOUND')
      return { ok: true }
    }),

  products: read
    .route({ method: 'GET', path: '/admin/collections/{id}/products' })
    .input(id)
    .handler(({ input, context }) => collectionService.listProducts(context.shop.id, input.id)),

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
