import { ORPCError, implement, os } from '@orpc/server'
import { AppError, appService } from '@shopnex/apps'
import { auth, isSuperAdmin } from '@shopnex/auth'
import { ChannelError } from '@shopnex/channels'
import { CartError } from '@shopnex/cart'
import { CatalogError } from '@shopnex/catalog'
import { ContentError } from '@shopnex/content'
import { EmailError } from '@shopnex/email'
import { FilesError } from '@shopnex/files'
import { OrderError } from '@shopnex/orders'
import { PaymentError } from '@shopnex/payments'
import { PricingError } from '@shopnex/pricing'
import { storefrontContract, storefrontErrorMap, type StorefrontErrorMap } from '@shopnex/storefront-sdk/contract'
import type { z } from 'zod'
import type { Shop } from '@shopnex/db/schema'
import {
  StaffError,
  hasScope,
  resolveAdminShop,
  resolveApiToken,
  resolveStorefrontShop,
  type ApiScope,
  type ApiToken,
  type ShopRole,
} from '@shopnex/tenancy'

export type Context = { headers: Headers }

export function createContext(headers: Headers): Context {
  return { headers }
}

const base = os.$context<Context>()

// Domain modules throw their own errors; map them to 400s with a stable code
const domainErrors = base.middleware(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof OrderError) {
      const status =
        error.code === 'ORDER_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'ORDER_CANCELLED' || error.code === 'INVALID_STATUS_TRANSITION'
            ? 'CONFLICT'
            : 'BAD_REQUEST'
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof ChannelError) {
      const status =
        error.code === 'CHANNEL_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'HANDLE_TAKEN' || error.code === 'CHANNEL_IN_USE' || error.code === 'CHANNEL_PROTECTED'
            ? 'CONFLICT'
            : 'BAD_REQUEST'
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof CartError) {
      const status =
        error.code === 'CART_NOT_FOUND' || error.code === 'VARIANT_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'CART_COMPLETED'
            ? 'CONFLICT'
            : 'BAD_REQUEST'
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof CatalogError) {
      const status =
        error.code === 'SLUG_TAKEN' || error.code === 'SKU_TAKEN'
          ? 'CONFLICT'
          : error.code === 'INVALID_VARIANTS' || error.code === 'HAS_VARIANTS'
            ? 'BAD_REQUEST'
            : 'NOT_FOUND'
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof ContentError) {
      const status =
        error.code === 'HANDLE_TAKEN'
          ? 'CONFLICT'
          : error.code === 'MENU_NOT_FOUND' || error.code === 'PAGE_NOT_FOUND'
            ? 'NOT_FOUND'
            : 'BAD_REQUEST'
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof FilesError) {
      throw new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof EmailError) {
      throw new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof PricingError) {
      const status =
        error.code === 'DISCOUNT_NOT_FOUND' || error.code === 'TAX_RATE_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'CODE_TAKEN' || error.code === 'TAX_RATE_EXISTS'
            ? 'CONFLICT'
            : 'BAD_REQUEST'
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof AppError) {
      const status =
        error.code === 'APP_NOT_FOUND' || error.code === 'INSTALLATION_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'invalid_client'
            ? 'UNAUTHORIZED'
            : 'BAD_REQUEST'
      // OAuth clients look for `error` (RFC 6749 §5.2)
      throw new ORPCError(status, {
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
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    if (error instanceof StaffError) {
      const status = error.code === 'ALREADY_MEMBER' ? 'CONFLICT' : error.code
      throw new ORPCError(status, { message: error.message, data: { code: error.code }, cause: error })
    }
    throw error
  }
})

export const pub = base.use(domainErrors)

// Session is resolved lazily here, so public procedures never hit the DB for it
export const authed = pub.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers })
  if (!session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { session: session.session, user: session.user } })
})

// Storefront errors are part of the published contract: map domain errors to the contract's
// typed errors (code + data) so clients get `defined` errors instead of parsing messages.
// Status and data shape come from the contract's error map, so they can't drift from it.
type ErrorData<C extends keyof StorefrontErrorMap> = StorefrontErrorMap[C] extends { data: z.ZodType }
  ? [data: z.input<StorefrontErrorMap[C]['data']>]
  : []

const defined = <C extends keyof StorefrontErrorMap>(code: C, message: string, ...[data]: ErrorData<C>) => {
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

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

async function staffTenant({ session, user }: Session) {
  const tenant = await resolveAdminShop({
    userId: user.id,
    activeShopId: session.activeOrganizationId,
    superAdmin: isSuperAdmin(user),
  })
  if (!tenant) throw new ORPCError('FORBIDDEN', { message: 'Not a member of this shop' })
  return tenant
}

// Admin procedures: signed-in member of the active shop, or a super admin
export const admin = authed.use(async ({ context, next }) => {
  const tenant = await staffTenant(context)
  return next({ context: { shop: tenant.shop, role: tenant.role, superAdmin: tenant.superAdmin } })
})

// Who is calling an admin API procedure: staff (token null) or an API token (role null)
type ApiCaller = { shop: Shop; token: ApiToken | null; role: ShopRole | null; superAdmin: boolean }

const BEARER = /^Bearer\s+(\S+)$/i

// Admin API for apps: a staff session (same access as `admin`) or a bearer token, which only gets what
// `scoped()` allows: an API token (sk_…) or an app's 1-hour access token (a JWT from /oauth/token). A bearer
// header wins over the cookie.
export const adminOrToken = pub.use(async ({ context, next }) => {
  const bearer = context.headers.get('authorization')?.match(BEARER)?.[1]
  let caller: ApiCaller
  if (bearer) {
    const resolved = (await resolveApiToken(bearer)) ?? (await appService.resolveAccessToken(bearer))
    if (!resolved) throw new ORPCError('UNAUTHORIZED', { message: 'Invalid or revoked API token' })
    caller = { shop: resolved.shop, token: resolved.token, role: null, superAdmin: false }
  } else {
    const session = await auth.api.getSession({ headers: context.headers })
    if (!session) throw new ORPCError('UNAUTHORIZED')
    const tenant = await staffTenant(session)
    caller = { shop: tenant.shop, token: null, role: tenant.role, superAdmin: tenant.superAdmin }
  }
  return next({ context: caller })
})

// Staff always pass; tokens need the scope (write_* includes read_*)
export const scoped = (scope: ApiScope) =>
  adminOrToken.use(({ context, next }) => {
    if (context.token && !hasScope(context.token.scopes, scope)) {
      throw new ORPCError('FORBIDDEN', { message: `This API token needs the ${scope} scope` })
    }
    return next()
  })

// Payments apps: an installed app's token with the payment session scope (staff never resolve sessions)
export const paymentsApp = scoped('write_payment_sessions').use(({ context, next }) => {
  const appId = context.token?.appId
  if (!appId) throw new ORPCError('FORBIDDEN', { message: "Only a payments app's own token can do this" })
  return next({ context: { appId } })
})

// Shop settings (keys, etc.): owners/admins of the shop, or a super admin
export const shopManager = admin.use(async ({ context, next }) => {
  if (!context.superAdmin && context.role !== 'owner' && context.role !== 'admin') {
    throw new ORPCError('FORBIDDEN', { message: 'Requires shop owner or admin' })
  }
  return next()
})

// Webhooks: shop owners/admins, or an API token (which only sees the subscriptions it created)
export const webhookManager = adminOrToken.use(async ({ context, next }) => {
  if (!context.token && !context.superAdmin && context.role !== 'owner' && context.role !== 'admin') {
    throw new ORPCError('FORBIDDEN', { message: 'Requires shop owner or admin' })
  }
  return next()
})

// Platform-wide settings (the app registry): super admins only
export const superAdminOnly = admin.use(async ({ context, next }) => {
  if (!context.superAdmin) throw new ORPCError('FORBIDDEN', { message: 'Requires a super admin' })
  return next()
})
