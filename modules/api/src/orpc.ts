import { ORPCError, implement, os } from '@orpc/server'
import { configureRpc, createProcedures, type Context, type ErrorMapper } from '@shopnex/rpc'
import { AiError } from '@shopnex/ai'
import { AppError, appService } from '@shopnex/apps'
import { auth, isSuperAdmin } from '@shopnex/auth'
import { ChannelError } from '@shopnex/channels'
import { CartError } from '@shopnex/cart'
import { CatalogError } from '@shopnex/catalog'
import { CustomFieldError } from '@shopnex/custom-fields'
import { moduleErrors } from './modules'
import { ContentError } from '@shopnex/content'
import { AccountError } from '@shopnex/customers'
import { EmailError } from '@shopnex/email'
import { OrderError } from '@shopnex/orders'
import { PaymentError } from '@shopnex/payments'
import { storefrontContract, storefrontErrorMap, type StorefrontErrorMap } from '@shopnex/storefront-sdk/contract'
import type { z } from 'zod'
import type { Shop } from '@shopnex/db/schema'
import {
  DomainError,
  StaffError,
  hasScope,
  resolveAdminShop,
  resolveApiToken,
  resolveStorefrontShop,
  type ApiScope,
  type ApiToken,
  type ShopRole,
} from '@shopnex/tenancy'
import { log } from './log'

export { createContext, type Context } from '@shopnex/rpc'

const base = os.$context<Context>()

// Domain modules throw their own errors; map them to 400s with a stable code
const mapDomainError: ErrorMapper = (error) => {
  if (error instanceof OrderError) {
    const status =
      error.code === 'ORDER_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'ORDER_CANCELLED' || error.code === 'INVALID_STATUS_TRANSITION'
          ? 'CONFLICT'
          : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof ChannelError) {
    const status =
      error.code === 'CHANNEL_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'HANDLE_TAKEN' || error.code === 'CHANNEL_IN_USE' || error.code === 'CHANNEL_PROTECTED'
          ? 'CONFLICT'
          : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof CartError) {
    const status =
      error.code === 'CART_NOT_FOUND' || error.code === 'VARIANT_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'CART_COMPLETED'
          ? 'CONFLICT'
          : error.code === 'NOT_A_CARRIER_APP'
            ? 'FORBIDDEN'
            : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof CatalogError) {
    const status =
      error.code === 'SLUG_TAKEN' || error.code === 'SKU_TAKEN'
        ? 'CONFLICT'
        : error.code === 'INVALID_VARIANTS' || error.code === 'HAS_VARIANTS'
          ? 'BAD_REQUEST'
          : 'NOT_FOUND'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  const moduleError = moduleErrors(error)
  if (moduleError) return moduleError
  if (error instanceof ContentError) {
    const status =
      error.code === 'HANDLE_TAKEN'
        ? 'CONFLICT'
        : error.code === 'MENU_NOT_FOUND' || error.code === 'PAGE_NOT_FOUND'
          ? 'NOT_FOUND'
          : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof EmailError) {
    return new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof AppError) {
    const status =
      error.code === 'APP_NOT_FOUND' || error.code === 'INSTALLATION_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'invalid_client'
          ? 'UNAUTHORIZED'
          : 'BAD_REQUEST'
    // OAuth clients look for `error` (RFC 6749 §5.2)
    return new ORPCError(status, {
      message: error.message,
      data: { code: error.code, error: error.code },
      cause: error,
    })
  }
  if (error instanceof PaymentError) {
    const status =
      error.code === 'SESSION_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'SESSION_CLOSED' || error.code === 'NOT_PAYABLE'
          ? 'CONFLICT'
          : error.code === 'NOT_A_PAYMENTS_APP'
            ? 'FORBIDDEN'
            : error.code === 'PROVIDER_UNAVAILABLE'
              ? 'BAD_GATEWAY'
              : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof AiError) {
    const status =
      error.code === 'SUBJECT_NOT_FOUND' || error.code === 'GENERATION_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'NOT_AN_AI_APP'
          ? 'FORBIDDEN'
          : error.code === 'PROVIDER_FAILED'
            ? 'BAD_GATEWAY'
            : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof DomainError) {
    const status =
      error.code === 'DOMAIN_NOT_FOUND' ? 'NOT_FOUND' : error.code === 'DOMAIN_TAKEN' ? 'CONFLICT' : 'BAD_REQUEST'
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  if (error instanceof StaffError) {
    const status = error.code === 'ALREADY_MEMBER' ? 'CONFLICT' : error.code
    return new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
  }
  return undefined
}

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
} = createProcedures(mapDomainError)

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
