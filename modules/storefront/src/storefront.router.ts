import { ORPCError } from '@orpc/server'
import { clientIp } from '@shopnex/auth'
import { cartService, checkoutService } from '@shopnex/cart'
import { publicationService } from '@shopnex/channels'
import { collectionService, productService } from '@shopnex/catalog'
import { menuService, pageService } from '@shopnex/content'
import { accountService } from '@shopnex/customers'
import { db } from '@shopnex/db'
import { sendLoginCode } from '@shopnex/email'
import { orderService } from '@shopnex/orders'
import { CUSTOMER_TOKEN_HEADER } from '@shopnex/storefront-sdk/constants'
import { themeService, verifyPreviewToken } from '@shopnex/theme'
import {
  activeProduct,
  appUrl,
  fieldsView,
  money,
  paginate,
  productFilters,
  signedIn,
  toCart,
  toCollection,
  toCustomer,
  toCustomerOrder,
  toMenuItems,
  toPage,
  toProduct,
  withLiveCollections,
} from './storefront.mappers'
import { defined, storefront } from './storefront.procedures'

export const storefrontRouter = storefront.router({
  shop: {
    get: storefront.shop.get.handler(({ context }) => ({
      id: context.shop.id,
      name: context.shop.name,
      handle: context.shop.slug,
      currencyCode: context.shop.currency,
      seo: {
        title: context.shop.seoTitle === '' ? null : context.shop.seoTitle,
        description: context.shop.seoDescription === '' ? null : context.shop.seoDescription,
      },
      cookieBanner: context.shop.cookieBanner,
    })),
  },
  products: {
    list: storefront.products.list.handler(async ({ input, context }) => {
      // A collection that isn't published on this channel doesn't exist here, so it has no products either
      if (
        input.collection &&
        !(await collectionService.liveSlugs(context.shop.id, context.channelId, [input.collection])).size
      ) {
        return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
      }
      const page = await paginate(input, async (limit, offset) =>
        productService.withDetails(
          await productService.list(context.shop.id, {
            limit,
            offset,
            collection: input.collection,
            sortKey: input.sortKey,
            reverse: input.reverse,
            status: 'active',
            channelId: context.channelId,
            ...(await productFilters(context.shop.id, input)),
          }),
        ),
      )
      const nodes = await withLiveCollections(page.nodes, context.shop.id, context.channelId)
      const fields = await fieldsView(context.shop.id, 'product')
      return { ...page, nodes: nodes.map((p) => toProduct(p, context.shop.currency, fields)) }
    }),
    facets: storefront.products.facets.handler(async ({ input, context }) => {
      const none = { vendors: [], productTypes: [], tags: [], price: null }
      if (
        input.collection &&
        !(await collectionService.liveSlugs(context.shop.id, context.channelId, [input.collection])).size
      ) {
        return none
      }
      const facets = await productService.facets(context.shop.id, {
        collection: input.collection,
        search: input.query,
        status: 'active',
        channelId: context.channelId,
      })
      const { currency } = context.shop
      return {
        ...facets,
        price: facets.price && {
          min: money(facets.price.minCents, currency),
          max: money(facets.price.maxCents, currency),
        },
      }
    }),
    get: storefront.products.get.handler(async ({ input, context }) =>
      activeProduct(await productService.getById(context.shop.id, input.id), context.shop.currency, context.channelId),
    ),
    getByHandle: storefront.products.getByHandle.handler(async ({ input, context }) =>
      activeProduct(
        await productService.getBySlug(context.shop.id, input.handle),
        context.shop.currency,
        context.channelId,
      ),
    ),
  },
  collections: {
    list: storefront.collections.list.handler(async ({ input, context }) => {
      const page = await paginate(input, (limit, offset) =>
        collectionService.list(context.shop.id, { limit, offset, channelId: context.channelId }),
      )
      return { ...page, nodes: page.nodes.map(toCollection) }
    }),
    getByHandle: storefront.collections.getByHandle.handler(async ({ input, context }) => {
      const collection = await collectionService.getBySlug(context.shop.id, input.handle)
      if (
        !collection ||
        !(await publicationService.isLive(context.shop.id, context.channelId, 'collection', collection.id, db))
      ) {
        throw new ORPCError('NOT_FOUND')
      }
      return toCollection(collection)
    }),
  },
  pages: {
    list: storefront.pages.list.handler(async ({ input, context }) => {
      const page = await paginate(input, (limit, offset) =>
        pageService.listPublished(context.shop.id, { limit, offset }),
      )
      return { ...page, nodes: page.nodes.map(toPage) }
    }),
    getByHandle: storefront.pages.getByHandle.handler(async ({ input, context }) => {
      const page = await pageService.getPublishedByHandle(context.shop.id, input.handle)
      if (!page) throw new ORPCError('NOT_FOUND')
      return toPage(page)
    }),
  },
  menu: {
    get: storefront.menu.get.handler(async ({ input, context }) => {
      const menu = await menuService.getByHandle(context.shop.id, input.handle)
      if (!menu) throw new ORPCError('NOT_FOUND')
      return {
        id: menu.id,
        handle: menu.handle,
        title: menu.title,
        items: toMenuItems(await menuService.resolve(context.shop.id, menu.items)),
      }
    }),
  },
  theme: {
    current: storefront.theme.current.handler(async ({ input, context }) => {
      // Preview: the draft of the library copy the editor is on
      const copyId = input.previewToken ? verifyPreviewToken(input.previewToken, context.shop.id) : null
      const copy = copyId ? await themeService.get(context.shop.id, copyId, db) : null
      if (copy) {
        const code = await themeService.codeDraft(context.shop.id, copy, db)
        const files = Object.keys(code.files).length ? { copyId: copy.id, version: code.version } : null
        return { themeId: copy.themeId, document: copy.draft, preview: true, files }
      }
      const live = await themeService.getLive(context.shop.id, db)
      return {
        themeId: live?.themeId ?? null,
        document: live?.published ?? null,
        preview: false,
        files: live?.hasFiles ? { copyId: live.id, version: live.filesVersion } : null,
      }
    }),
    // The preview reads the copy's code draft over its files; the live theme only what was published
    files: storefront.theme.files.handler(async ({ input, context }) => {
      const copyId = input.previewToken ? verifyPreviewToken(input.previewToken, context.shop.id) : null
      const copy = copyId ? await themeService.get(context.shop.id, copyId, db) : null
      if (copy) {
        const code = await themeService.codeDraft(context.shop.id, copy, db)
        return { copyId: copy.id, version: code.version, files: code.files }
      }
      const live = await themeService.getLive(context.shop.id, db)
      if (!live) return { copyId: null, version: 0, files: {} }
      const row = await themeService.get(context.shop.id, live.id, db)
      return { copyId: live.id, version: row?.filesVersion ?? 0, files: row?.files ?? {} }
    }),
    get: storefront.theme.get.handler(async ({ input, context }) => {
      // Preview: the draft of the library copy the editor is on (a copy of this storefront's theme)
      const copyId = input.previewToken ? verifyPreviewToken(input.previewToken, context.shop.id) : null
      const copy = copyId ? await themeService.get(context.shop.id, copyId, db) : null
      if (copy?.themeId === input.themeId) return { document: copy.draft, preview: true }
      const live = await themeService.getLive(context.shop.id, db)
      return { document: live?.themeId === input.themeId ? live.published : null, preview: false }
    }),
  },
  cart: {
    create: storefront.cart.create.handler(async ({ input, context }) =>
      toCart(
        await cartService.create(
          context.shop.id,
          context.channelId,
          input.lines?.map((l) => ({ variantId: l.merchandiseId, quantity: l.quantity })),
        ),
      ),
    ),
    get: storefront.cart.get.handler(async ({ input, context }) =>
      toCart(await cartService.get(context.shop.id, input.id)),
    ),
    linesAdd: storefront.cart.linesAdd.handler(async ({ input, context }) =>
      toCart(
        await cartService.addLines(
          context.shop.id,
          input.cartId,
          input.lines.map((l) => ({ variantId: l.merchandiseId, quantity: l.quantity })),
        ),
      ),
    ),
    linesUpdate: storefront.cart.linesUpdate.handler(async ({ input, context }) =>
      toCart(
        await cartService.updateLines(
          context.shop.id,
          input.cartId,
          input.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })),
        ),
      ),
    ),
    linesRemove: storefront.cart.linesRemove.handler(async ({ input, context }) =>
      toCart(await cartService.removeLines(context.shop.id, input.cartId, input.lineIds)),
    ),
    discountCodesUpdate: storefront.cart.discountCodesUpdate.handler(async ({ input, context }) =>
      toCart(await cartService.setDiscountCode(context.shop.id, input.cartId, input.discountCodes[0] ?? null)),
    ),
  },
  customer: {
    requestCode: storefront.customer.requestCode.handler(async ({ input, context }) => {
      const shopId = context.shop.id
      await accountService.requestLoginCode(shopId, input.email, (to, code) => sendLoginCode(shopId, to, code), {
        ip: clientIp(context.headers),
      })
      return { success: true as const }
    }),
    signIn: storefront.customer.signIn.handler(async ({ input, context }) => {
      const { token, customer } = await accountService.verifyLoginCode(context.shop.id, input.email, input.code, {
        ip: clientIp(context.headers),
      })
      return { token, customer: toCustomer(customer, await fieldsView(context.shop.id, 'customer')) }
    }),
    signOut: storefront.customer.signOut.handler(async ({ context }) => {
      const token = context.headers.get(CUSTOMER_TOKEN_HEADER)
      if (token) await accountService.signOut(token)
      return { success: true as const }
    }),
    get: storefront.customer.get.handler(async ({ context }) =>
      toCustomer(await signedIn(context), await fieldsView(context.shop.id, 'customer')),
    ),
    update: storefront.customer.update.handler(async ({ input, context }) => {
      const customer = await signedIn(context)
      const updated = await accountService.updateProfile(context.shop.id, customer.id, input)
      return toCustomer(updated ?? customer, await fieldsView(context.shop.id, 'customer'))
    }),
    orders: storefront.customer.orders.handler(async ({ input, context }) => {
      const customer = await signedIn(context)
      const fields = await fieldsView(context.shop.id, 'order')
      return paginate(input, async (limit, offset) => {
        const { items } = await orderService.list(context.shop.id, { customerId: customer.id, limit, offset })
        const full = await Promise.all(items.map((o) => orderService.getById(context.shop.id, o.id)))
        return full.flatMap((o) => (o ? [toCustomerOrder(o, fields)] : []))
      })
    }),
    order: storefront.customer.order.handler(async ({ input, context }) => {
      const customer = await signedIn(context)
      const order = await orderService.getById(context.shop.id, input.id)
      // Someone else's order looks like a missing one
      if (order?.customerId !== customer.id) throw defined('NOT_FOUND', 'Order not found')
      return toCustomerOrder(order, await fieldsView(context.shop.id, 'order'))
    }),
  },
  checkout: {
    options: storefront.checkout.options.handler(async ({ input, context }) => {
      const cart = await cartService.get(context.shop.id, input.cartId)
      const address = input.countryCode
        ? {
            countryCode: input.countryCode,
            province: input.province,
            city: input.city,
            zip: input.zip,
            address1: input.address1,
          }
        : undefined
      const [options, cost] = await Promise.all([
        checkoutService.options(context.shop.id, cart.subtotalCents, { cart, address }),
        checkoutService.estimate(context.shop.id, cart, { shippingRateId: input.shippingRateId, address }),
      ])
      const m = (cents: number) => money(cents, cart.currency)
      return {
        cost: {
          subtotalAmount: m(cost.subtotalCents),
          shippingAmount: m(cost.shippingCents),
          discountAmount: m(cost.discountCents),
          totalTaxAmount: cost.taxCents == null ? null : m(cost.taxCents),
          taxesIncluded: cost.taxesIncluded,
          totalAmount: m(cost.totalCents),
        },
        shippingRates: options.shippingRates.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          price: money(r.priceCents, cart.currency),
        })),
        paymentMethods: options.paymentMethods,
      }
    }),
    complete: storefront.checkout.complete.handler(({ input: { cartId, shippingAddress, ...buyer }, context }) =>
      checkoutService.complete(
        context.shop.id,
        cartId,
        { ...buyer, shippingAddress: shippingAddress && checkoutService.toMailingAddress(shippingAddress) },
        // The hosted confirmation page shows the payment's outcome
        { returnUrl: `${appUrl()}/checkout/${cartId}` },
      ),
    ),
  },
})
