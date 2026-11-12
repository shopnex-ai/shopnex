import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { publicationService } from '@shopnex/channels'
import { productService, seedSampleProducts, variantService } from '@shopnex/catalog'
import { customFieldService } from '@shopnex/custom-fields'
import { appService } from '@shopnex/apps'
import { scoped } from '../../orpc'
import { pagination } from '../pagination'
import { optionInput, productFields, publicationsInput, variantInput, variantsInput } from './schemas'
import { countOutput, productListOutput, productOutput, publicationsOutput, variantRowOutput } from './outputs'

const read = scoped('read_products')
const write = scoped('write_products')
const readPublications = scoped('read_publications')
const writePublications = scoped('write_publications')

/**
 * `fulfilledBy` says which app ships a product, and carrier apps trust it, so an app can only claim products for
 * itself. Anyone with write access can clear it (null: the shop ships it); staff can't name an app.
 */
async function checkFulfilledBy(token: { appId?: string | null } | null | undefined, value: string | null | undefined) {
  if (!value) return
  const mine = token?.appId ? await appService.clientIdOf(token.appId) : null
  if (mine !== value) {
    throw new ORPCError('FORBIDDEN', { message: 'fulfilledBy can only be set to the calling app itself' })
  }
}

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
  addSamples: write
    .route({ method: 'POST', path: '/admin/products/samples' })
    .output(countOutput)
    .handler(({ context }) => seedSampleProducts(context.shop.id)),

  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/products/bulk' })
    .output(countOutput)
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => productService.removeMany(context.shop.id, input.ids)),

  list: read
    .route({ method: 'GET', path: '/admin/products' })
    .output(productListOutput)
    .input(
      pagination.extend({
        search: z.string().trim().max(200).optional(),
        /** Only products with these custom field values, as `key:value` (e.g. `material:Linen`); all must match */
        customField: z.array(z.string().max(300)).max(10).optional(),
      }),
    )
    .handler(async ({ input: { customField, ...input }, context }) => {
      const filtered = {
        ...input,
        customFields: await customFieldService.parseFilters(context.shop.id, 'product', customField ?? []),
      }
      const [rows, total] = await Promise.all([
        productService.list(context.shop.id, filtered),
        productService.count(context.shop.id, filtered),
      ])
      return { items: await withPublications(context.shop.id, await productService.withDetails(rows)), total }
    }),

  // Images, options, variants, collection slugs (the list also has `publications`; get those with GET …/publications)
  get: read
    .route({ method: 'GET', path: '/admin/products/{id}' })
    .output(productOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const product = await productService.getById(context.shop.id, input.id)
      if (!product) throw new ORPCError('NOT_FOUND')
      return (await productService.withDetails([product]))[0]!
    }),

  publications: readPublications
    .route({ method: 'GET', path: '/admin/products/{id}/publications' })
    .output(publicationsOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      if (!(await productService.getById(context.shop.id, input.id))) throw new ORPCError('NOT_FOUND')
      return (await publicationService.listFor(context.shop.id, 'product', [input.id])).get(input.id)!
    }),

  // Publishes the product on exactly these channels (an unpublished product, by status, is still hidden)
  setPublications: writePublications
    .route({ method: 'PUT', path: '/admin/products/{id}/publications' })
    .output(publicationsOutput)
    .input(publicationsInput.extend({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const publications = await productService.setPublications(context.shop.id, input.id, input.publications)
      if (!publications) throw new ORPCError('NOT_FOUND')
      return publications
    }),

  create: write
    .route({ method: 'POST', path: '/admin/products' })
    .output(productOutput)
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
    .handler(async ({ input, context }) => {
      await checkFulfilledBy(context.token, input.fulfilledBy)
      return productService.create(context.shop.id, input)
    }),

  // Partial update; `images` replaces the whole set when given
  update: write
    .route({ method: 'PATCH', path: '/admin/products/{id}' })
    .output(productOutput)
    .input(productFields.partial().extend({ id: z.uuid() }))
    .handler(async ({ input: { id, ...patch }, context }) => {
      await checkFulfilledBy(context.token, patch.fulfilledBy)
      const product = await productService.update(context.shop.id, id, patch)
      if (!product) throw new ORPCError('NOT_FOUND')
      return product
    }),

  // Replace options + variants. Variants keep their ids when their option combination is unchanged.
  setVariants: write
    .route({ method: 'PUT', path: '/admin/products/{id}/variants' })
    .output(productOutput)
    .input(variantsInput.extend({ id: z.uuid() }))
    .handler(async ({ input: { id, ...variants }, context }) => {
      const product = await productService.setVariants(context.shop.id, id, variants)
      if (!product) throw new ORPCError('NOT_FOUND')
      return product
    }),

  // One variant's price / SKU / stock
  updateVariant: write
    .route({ method: 'PATCH', path: '/admin/variants/{variantId}' })
    .output(variantRowOutput)
    .input(variantInput.omit({ options: true }).partial().extend({ variantId: z.uuid() }))
    .handler(async ({ input: { variantId, ...patch }, context }) => {
      const variant = await variantService.update(context.shop.id, variantId, patch)
      if (!variant) throw new ORPCError('NOT_FOUND')
      return variant
    }),
}
