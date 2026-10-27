import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { publicationService } from '@shopnex/channels'
import { productService, variantService } from '@shopnex/catalog'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { optionInput, productFields, publicationsInput, variantInput, variantsInput } from './schemas'

const read = scoped('read_products')
const write = scoped('write_products')
const readPublications = scoped('read_publications')
const writePublications = scoped('write_publications')

// The channels each product is published on (a scheduled one has a date in the future)
async function withPublications<T extends { id: string }>(shopId: string, items: T[]) {
  const byProduct = await publicationService.listFor(
    shopId,
    'product',
    items.map((i) => i.id),
  )
  return items.map((item) => ({ ...item, publications: byProduct.get(item.id) ?? [] }))
}

export const products = {
  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/products/bulk' })
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => productService.removeMany(context.shop.id, input.ids)),

  list: read
    .route({ method: 'GET', path: '/admin/products' })
    .input(pagination.extend({ search: z.string().trim().max(200).optional() }))
    .handler(async ({ input, context }) => {
      const [rows, total] = await Promise.all([
        productService.list(context.shop.id, input),
        productService.count(context.shop.id, input),
      ])
      return { items: await withPublications(context.shop.id, await productService.withDetails(rows)), total }
    }),

  // Images, options, variants, collection slugs (the list also has `publications`; get those with GET …/publications)
  get: read
    .route({ method: 'GET', path: '/admin/products/{id}' })
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const product = await productService.getById(context.shop.id, input.id)
      if (!product) throw new ORPCError('NOT_FOUND')
      return (await productService.withDetails([product]))[0]!
    }),

  publications: readPublications
    .route({ method: 'GET', path: '/admin/products/{id}/publications' })
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      if (!(await productService.getById(context.shop.id, input.id))) throw new ORPCError('NOT_FOUND')
      return (await publicationService.listFor(context.shop.id, 'product', [input.id])).get(input.id)!
    }),

  // Publishes the product on exactly these channels (an unpublished product, by status, is still hidden)
  setPublications: writePublications
    .route({ method: 'PUT', path: '/admin/products/{id}/publications' })
    .input(publicationsInput.extend({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const publications = await productService.setPublications(context.shop.id, input.id, input.publications)
      if (!publications) throw new ORPCError('NOT_FOUND')
      return publications
    }),

  create: write
    .route({ method: 'POST', path: '/admin/products' })
    .input(
      productFields
        .extend({
          options: z.array(optionInput).max(10).optional(),
          variants: z.array(variantInput).min(1).max(1000).optional(),
        })
        .refine((v) => (v.priceCents === undefined) !== (v.variants === undefined), {
          message: 'Provide either priceCents (simple product) or variants',
        }),
    )
    .handler(({ input, context }) => productService.create(context.shop.id, input)),

  // Partial update; `images` replaces the whole set when given
  update: write
    .route({ method: 'PATCH', path: '/admin/products/{id}' })
    .input(productFields.partial().extend({ id: z.uuid() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      const product = await productService.update(context.shop.id, id, patch)
      if (!product) throw new ORPCError('NOT_FOUND')
      return product
    }),

  // Replace options + variants. Variants keep their ids when their option combination is unchanged.
  setVariants: write
    .route({ method: 'PUT', path: '/admin/products/{id}/variants' })
    .input(variantsInput.extend({ id: z.uuid() }))
    .handler(async ({ input: { id, ...variants }, context }) => {
      const product = await productService.setVariants(context.shop.id, id, variants)
      if (!product) throw new ORPCError('NOT_FOUND')
      return product
    }),

  // One variant's price / SKU / stock
  updateVariant: write
    .route({ method: 'PATCH', path: '/admin/variants/{variantId}' })
    .input(variantInput.omit({ options: true }).partial().extend({ variantId: z.uuid() }))
    .handler(async ({ input: { variantId, ...patch }, context }) => {
      const variant = await variantService.update(context.shop.id, variantId, patch)
      if (!variant) throw new ORPCError('NOT_FOUND')
      return variant
    }),
}
