import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { productService, variantService } from '@shopnex/catalog'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { optionInput, productFields, variantInput, variantsInput } from './schemas'

const read = scoped('read_products')
const write = scoped('write_products')

export const products = {
  list: read
    .route({ method: 'GET', path: '/admin/products' })
    .input(pagination.extend({ search: z.string().trim().max(200).optional() }))
    .handler(async ({ input, context }) => {
      const [rows, total] = await Promise.all([
        productService.list(context.shop.id, input),
        productService.count(context.shop.id, input),
      ])
      return { items: await productService.withDetails(rows), total }
    }),

  // Same shape as list items: images, options, variants, collection slugs
  get: read
    .route({ method: 'GET', path: '/admin/products/{id}' })
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const product = await productService.getById(context.shop.id, input.id)
      if (!product) throw new ORPCError('NOT_FOUND')
      return (await productService.withDetails([product]))[0]!
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
