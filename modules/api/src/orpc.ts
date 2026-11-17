import { ORPCError, implement, os } from '@orpc/server'
import { configureRpc, createProcedures, type Context } from '@shopnex/rpc'
import { appService } from '@shopnex/apps'
import { auth, isSuperAdmin } from '@shopnex/auth'
import { CartError } from '@shopnex/cart'
import { CustomFieldError } from '@shopnex/custom-fields'
import { AccountError } from '@shopnex/customers'
import { EmailError } from '@shopnex/email'
import { OrderError } from '@shopnex/orders'
import { storefrontContract, storefrontErrorMap, type StorefrontErrorMap } from '@shopnex/storefront-sdk/contract'
import type { z } from 'zod'
import { hasScope } from '@shopnex/core/scopes'
import { resolveAdminShop, resolveApiToken, resolveStorefrontShop } from '@shopnex/tenancy'
import { log } from './log'

export { createContext, type Context } from '@shopnex/rpc'

const base = os.$context<Context>()

// What rpc needs to recognise a request. Registered here, once, because api is the layer that knows about logins, API
// tokens and shops: rpc itself depends on none of them, so a module below auth or tenancy can have routes too.
declare module '@shopnex/rpc' {
  interface Register {
    session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
  }
}

configureRpc({
  session: (headers) => auth.api.getSession({ headers }),
  adminShop: ({ session, user }) =>
    resolveAdminShop({ userId: user.id, activeShopId: session.activeOrganizationId, superAdmin: isSuperAdmin(user) }),
  token: async (bearer) => (await resolveApiToken(bearer)) ?? (await appService.resolveAccessToken(bearer)),
  hasScope,
})

export const {
  pub,
  authed,
  admin,
  adminOrToken,
  scoped,
  paymentsApp,
  aiApp,
  carrierApp,
  shopManager,
  webhookManager,
  superAdminOnly,
} = createProcedures()

// Storefront errors are part of the published contract: map domain errors to the contract's
// typed errors (code + data) so clients get `defined` errors instead of parsing messages.
// Status and data shape come from the contract's error map, so they can't drift from it.
type ErrorData<C extends keyof StorefrontErrorMap> = StorefrontErrorMap[C] extends { data: z.ZodType }
  ? [data: z.input<StorefrontErrorMap[C]['data']>]
  : []

export const defined = <C extends keyof StorefrontErrorMap>(code: C, message: string, ...[data]: ErrorData<C>) => {
  const config: { status?: number } = storefrontErrorMap[code]
  return new ORPCError(code, { defined: true, status: config.status, message, data })
}

const storefrontErrors = base.middleware(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof CartError) {
      switch (error.code) {
        case 'CART_NOT_FOUND':
          throw defined('NOT_FOUND', error.message)
        case 'CART_COMPLETED':
          throw defined('CART_COMPLETED', error.message)
        case 'EMPTY_CART':
          throw defined('EMPTY_CART', error.message)
        case 'LINE_NOT_FOUND':
          throw defined('LINE_NOT_FOUND', error.message, { lineIds: error.data.lineIds ?? [] })
        case 'VARIANT_NOT_FOUND':
          throw defined('MERCHANDISE_NOT_FOUND', error.message, { merchandiseIds: error.data.variantIds ?? [] })
        case 'OUT_OF_STOCK':
          // Without a variant id the data wouldn't match the contract; fall through and log it
          if (error.data.variantId) {
            throw defined('OUT_OF_STOCK', error.message, {
              merchandiseId: error.data.variantId,
              available: error.data.available ?? 0,
            })
          }
          break
        case 'INVALID_SHIPPING_RATE':
        case 'INVALID_PAYMENT_METHOD':
          throw new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code } })
      }
    }
    if (error instanceof AccountError) {
      switch (error.code) {
        case 'INVALID_CODE':
          throw defined('INVALID_CODE', error.message)
        case 'TOO_MANY_REQUESTS':
          throw defined('TOO_MANY_REQUESTS', error.message)
        case 'INVALID_EMAIL':
          throw new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code } })
      }
    }
    if (error instanceof CustomFieldError) {
      throw new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code } })
    }
    if (error instanceof EmailError && (error.code === 'EMAIL_OFF' || error.code === 'EMAIL_FAILED')) {
      // Details (SMTP errors) stay in the logs; the shopper only learns that sign-in isn't available
      if (error.code === 'EMAIL_FAILED') log.error({ err: error }, 'sign-in code email failed')
      throw defined('CUSTOMER_LOGIN_UNAVAILABLE', 'Sign-in is not available right now')
    }
    if (error instanceof OrderError) {
      if (error.code === 'OUT_OF_STOCK' && error.data.variantId) {
        throw defined('OUT_OF_STOCK', error.message, {
          merchandiseId: error.data.variantId,
          available: error.data.available ?? 0,
        })
      }
      if (error.code === 'VARIANT_NOT_FOUND') {
        throw defined('MERCHANDISE_NOT_FOUND', error.message, { merchandiseIds: error.data.variantIds ?? [] })
      }
      throw new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code }, cause: error })
    }
    throw error
  }
})

// Public storefront procedures implement the published contract (@shopnex/storefront-sdk).
// Shop and channel come from the publishable key, else the default shop (single) / request host (multi) and
// its Online Store.
export const storefront = implement(storefrontContract)
  .$context<Context>()
  .use(storefrontErrors)
  .use(async ({ context, next }) => {
    const result = await resolveStorefrontShop(context.headers)
    if (!result.ok) {
      throw result.reason === 'invalid_key'
        ? new ORPCError('UNAUTHORIZED', { message: 'Invalid or revoked publishable key' })
        : new ORPCError('NOT_FOUND', { message: 'Shop not found' })
    }
    return next({ context: { shop: result.shop, channelId: result.channelId } })
  })
